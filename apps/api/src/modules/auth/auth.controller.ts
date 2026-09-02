import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  EnableMfaDto,
  LoginDto,
  RefreshDto,
  RequestPasswordResetDto,
} from './dto';
import { AuthenticatedUser, CurrentUser, Public } from '../../common/decorators';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Authenticate with email/username/phone, password and optional MFA code' })
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token (rotates the refresh token)' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('password-reset/request')
  @ApiOperation({
    summary: 'Request a password reset token. Always reports success, so it cannot be used to discover accounts.',
  })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto, @Req() req: any) {
    return this.auth.requestPasswordReset(dto.email, { ipAddress: req.ip });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @Post('password-reset/confirm')
  @ApiOperation({ summary: 'Complete a password reset; revokes every existing session' })
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.auth.confirmPasswordReset(dto.token, dto.newPassword);
  }

  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.sessionId, user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user with resolved roles, permissions and scope' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Device and session history' })
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listSessions(user.id);
  }

  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.auth.revokeSession(user.id, id);
  }

  @Post('change-password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Post('mfa/enroll')
  @ApiOperation({ summary: 'Begin MFA enrollment and return the otpauth URI' })
  enrollMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.beginMfaEnrollment(user.id);
  }

  @Post('mfa/confirm')
  confirmMfa(@CurrentUser() user: AuthenticatedUser, @Body() dto: EnableMfaDto) {
    return this.auth.confirmMfa(user.id, dto.code);
  }
}
