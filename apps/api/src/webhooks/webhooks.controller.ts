import { Controller, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(':connectionId')
  @HttpCode(202)
  receive(
    @Param('connectionId') connectionId: string,
    @Req() req: RawBodyRequest<Request>,
    @Query('token') token?: string,
  ) {
    return this.webhooks.receive(
      connectionId,
      { headers: req.headers, rawBody: req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})), body: req.body },
      token,
    );
  }
}
