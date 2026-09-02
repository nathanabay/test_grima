import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  EnableMfaDto,
  LoginDto,
  RefreshDto,
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
