import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { SetupService } from './setup.service';
import { sendSession } from '../auth/auth.controller';

class CompleteSetupBody {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  setupToken?: string;
}

@Public()
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  status() {
    return this.setup.status();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('complete')
  async complete(@Body() body: CompleteSetupBody, @Res({ passthrough: true }) res: Response) {
    return sendSession(res, await this.setup.complete(body));
  }
}
