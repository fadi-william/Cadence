import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateMemberBody {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  /** Defaults to the current user when they are an engineering manager. */
  @IsOptional()
  @IsString()
  managerId?: string;
}

export class UpdateMemberBody extends PartialType(CreateMemberBody) {}

export class UpsertIdentityBody {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;
}
