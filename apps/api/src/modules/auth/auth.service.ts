import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { LoginDto } from './dto';

const MAX_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5);
const LOCKOUT_MINUTES = Number(process.env.LOCKOUT_MINUTES ?? 15);

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  static async hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Roles, permissions and scopes flattened for the JWT payload. */
  async loadAuthorization(userId: string): Promise<{
    roles: string[];
    permissions: string[];
    branchIds: string[];
    warehouseIds: string[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        scopes: true,
      },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');

    const roles = user.roles.map((r) => r.role.code);
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((r) => r.role.permissions.map((rp) => rp.permission.code)),
      ),
    );
    const branchIds = Array.from(
      new Set(user.scopes.map((s) => s.branchId).filter((b): b is string => !!b)),
    );
    const warehouseIds = Array.from(
      new Set(user.scopes.map((s) => s.warehouseId).filter((w): w is string => !!w)),
    );

    return { roles, permissions, branchIds, warehouseIds };
  }

  private async issueTokens(
    userId: string,
    sessionId: string,
  ): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, username: true, fullName: true },
    });
    const authz = await this.loadAuthorization(userId);

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        sid: sessionId,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        ...authz,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
      },
    );
    return { accessToken };
  }

  async login(
    dto: LoginDto,
    context: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<AuthTokens & { user: Omit<AuthenticatedUser, 'sessionId'> }> {
    const identifier = dto.identifier.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }, { phone: dto.identifier.trim() }],
      },
    });

    const failAndThrow = async (reason: string): Promise<never> => {
      await this.prisma.loginAttempt.create({
        data: {
          identifier,
          successful: false,
          reason,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      // Deliberately uniform message: never reveal whether the account exists.
      throw new UnauthorizedException('Invalid credentials');
    };

    if (!user) await failAndThrow('UNKNOWN_IDENTIFIER');

    if (user!.lockedUntil && user!.lockedUntil > new Date()) {
      await this.prisma.loginAttempt.create({
        data: {
          identifier,
          successful: false,
          reason: 'ACCOUNT_LOCKED',
          ipAddress: context.ipAddress ?? null,
        },
      });
      throw new ForbiddenException(
        `Account is locked until ${user!.lockedUntil.toISOString()}`,
      );
    }

    if (user!.status !== 'ACTIVE') await failAndThrow(`STATUS_${user!.status}`);

    const passwordOk = await argon2.verify(user!.passwordHash, dto.password).catch(() => false);
    if (!passwordOk) {
      const attempts = user!.failedAttempts + 1;
      const shouldLock = attempts >= MAX_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user!.id },
        data: {
          failedAttempts: attempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : null,
          status: shouldLock ? 'LOCKED' : user!.status,
        },
      });
      if (shouldLock) {
        await this.audit.record({
          userId: user!.id,
          module: 'auth',
          action: 'ACCOUNT_LOCKED',
          entityType: 'User',
          entityId: user!.id,
          reason: `${attempts} consecutive failed login attempts`,
          ipAddress: context.ipAddress ?? null,
        });
      }
      await failAndThrow('BAD_PASSWORD');
    }

    if (user!.mfaEnabled) {
      if (!dto.mfaCode) {
        throw new UnauthorizedException({
          message: 'MFA code required',
          mfaRequired: true,
        });
      }
      const valid = authenticator.verify({
        token: dto.mfaCode,
        secret: user!.mfaSecret ?? '',
      });
      if (!valid) await failAndThrow('BAD_MFA_CODE');
    }

    const refreshToken = randomBytes(48).toString('hex');
    const ttlDays = Number((process.env.JWT_REFRESH_TTL ?? '7d').replace('d', '')) || 7;

    const session = await this.prisma.session.create({
      data: {
        userId: user!.id,
        refreshHash: this.hashToken(refreshToken),
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
        deviceLabel: dto.deviceLabel ?? null,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
    });

    await this.prisma.user.update({
      where: { id: user!.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.prisma.loginAttempt.create({
      data: {
        identifier,
        successful: true,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    });
    await this.audit.record({
      userId: user!.id,
      userLabel: user!.fullName,
      module: 'auth',
      action: 'LOGIN',
      entityType: 'Session',
      entityId: session.id,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    const { accessToken } = await this.issueTokens(user!.id, session.id);
    const authz = await this.loadAuthorization(user!.id);

    return {
      accessToken,
      refreshToken,
      expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
      user: {
        id: user!.id,
        email: user!.email,
        username: user!.username,
        fullName: user!.fullName,
        ...authz,
      },
    };
  }

  /** Rotates the refresh token: the presented one is invalidated on use. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const hash = this.hashToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { refreshHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!session) throw new UnauthorizedException('Invalid or expired refresh token');

    const newRefresh = randomBytes(48).toString('hex');
    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshHash: this.hashToken(newRefresh), lastSeenAt: new Date() },
    });

    const { accessToken } = await this.issueTokens(session.userId, session.id);
    return {
      accessToken,
      refreshToken: newRefresh,
      expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
    };
  }

  async logout(sessionId: string, userId: string): Promise<{ success: boolean }> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      userId,
      module: 'auth',
      action: 'LOGOUT',
      entityType: 'Session',
      entityId: sessionId,
    });
    return { success: true };
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        deviceLabel: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<{ success: boolean }> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new BadRequestException('Session not found');
    return { success: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await AuthService.hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    // Force re-authentication everywhere else.
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      userId,
      module: 'auth',
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: userId,
    });
    return { success: true };
  }

  /** Returns the otpauth:// URI the authenticator app scans. */
  async beginMfaEnrollment(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret } });
    return {
      secret,
      otpauthUrl: authenticator.keyuri(
        user.email,
        process.env.MFA_ISSUER ?? 'PharmaCore',
        secret,
      ),
    };
  }

  async confirmMfa(userId: string, code: string): Promise<{ enabled: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecret) throw new BadRequestException('Start MFA enrollment first');
    if (!authenticator.verify({ token: code, secret: user.mfaSecret })) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await this.audit.record({
      userId,
      module: 'auth',
      action: 'MFA_ENABLED',
      entityType: 'User',
      entityId: userId,
    });
    return { enabled: true };
  }
}
