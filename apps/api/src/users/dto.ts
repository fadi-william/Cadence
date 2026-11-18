import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { UserRole } from '../generated/prisma/enums';

export class CreateUserBody {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsIn([UserRole.TRIBE_LEAD, UserRole.ENGINEERING_MANAGER])
  role!: typeof UserRole.TRIBE_LEAD | typeof UserRole.ENGINEERING_MANAGER;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  /** Tribe Lead id for an EM. Ignored for Tribe Leads (they report to the creating admin). */
  @IsOptional()
  @IsString()
  reportsToId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tribeName?: string;
}

export class UpdateUserBody extends PartialType(OmitType(CreateUserBody, ['role'] as const)) {}
