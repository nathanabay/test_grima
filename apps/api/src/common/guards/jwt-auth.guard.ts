import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, AuthenticatedUser } from '../decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../../modules/integrations/api-keys.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

    // Machine-to-machine callers present an API key instead of a session token
    // (§53). It is resolved into the same AuthenticatedUser shape, so every
    // downstream permission and scope check is identical to a person's — an
    // integration can never reach something no role could.
    const apiKeyHeader: string | undefined =
      request.headers['x-api-key'] ?? request.headers['X-Api-Key'];
    if (apiKeyHeader) {
      const key = await this.apiKeys.verify(String(apiKeyHeader));
      if (!key) throw new UnauthorizedException('Invalid or expired API key');

      request.user = {
        id: key.id,
        email: `${key.name}@api-key.local`,
        username: `apikey:${key.name}`,
        fullName: `API key: ${key.name}`,
        roles: ['API_KEY'],
        permissions: key.scopes,
        branchIds: key.branchId ? [key.branchId] : [],
        warehouseIds: [],
        sessionId: `apikey:${key.id}`,
      } satisfies AuthenticatedUser;
      request.apiKeyId = key.id;
      return true;
    }

    const header: string | undefined = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // A revoked session must stop working immediately, so the session is
    // checked on every request rather than trusted from the token alone.
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { id: true, revokedAt: true, expiresAt: true, userId: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is no longer active');
    }

    const user: AuthenticatedUser = {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
      fullName: payload.fullName,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      branchIds: payload.branchIds ?? [],
      warehouseIds: payload.warehouseIds ?? [],
      sessionId: payload.sid,
    };
    request.user = user;

    // Keep last-seen fresh for the device/session history screen (§4),
    // without awaiting it on the request path.
    void this.prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}
