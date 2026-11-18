import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginBody {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ChangePasswordBody {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  newPassword!: string;
}

export class ForgotPasswordBody {
  @IsEmail()
  email!: string;
}

export class ResetPasswordBody {
  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  password!: string;
}
