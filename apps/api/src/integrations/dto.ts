import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IntegrationProvider } from '../generated/prisma/enums';

export class CreateIntegrationBody {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsIn(Object.values(IntegrationProvider))
  provider!: IntegrationProvider;

  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl!: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  secret!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** `secret` is optional on update: omit it to keep the stored credential. */
export class UpdateIntegrationBody extends PartialType(OmitType(CreateIntegrationBody, ['provider'] as const)) {}

export class SyncBody {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class WebhookSecretBody {
  /** Provider-issued signing secret. Omit to let Cadence generate one. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(500)
  secret?: string;
}
