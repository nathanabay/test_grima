import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  Matches,
} from 'class-validator';

export class LoginDto {
  /** Email, username or phone (§4). */
  @IsString()
  identifier!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /** Required when the account has MFA enabled. */
  @IsOptional()
  @IsString()
  mfaCode?: string;

  @IsOptional()
  @IsString()
  deviceLabel?: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @Matches(/[A-Z]/, { message: 'Password must contain an uppercase letter' })
  @Matches(/[a-z]/, { message: 'Password must contain a lowercase letter' })
  @Matches(/[0-9]/, { message: 'Password must contain a digit' })
  newPassword!: string;
}

export class RequestPasswordResetDto {
  @IsEmail()
  email!: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(10)
  newPassword!: string;
}

export class EnableMfaDto {
  @IsString()
  code!: string;
}

export class SetMfaDto {
  @IsBoolean()
  enabled!: boolean;
}
