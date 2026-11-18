import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationBody, SyncBody, UpdateIntegrationBody, WebhookSecretBody } from './dto';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../generated/prisma/enums';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** Readable by everyone so managers can pick a connection when linking identities. */
  @Get()
  list() {
    return this.integrations.list();
  }

  @Get('providers')
  providers() {
    return this.integrations.providers();
  }

  @Get(':id/users')
  searchUsers(@Param('id') id: string, @Query('q') q = '') {
    return this.integrations.searchUsers(id, q);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: CreateIntegrationBody) {
    return this.integrations.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateIntegrationBody) {
    return this.integrations.update(id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.integrations.remove(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id') id: string) {
    return this.integrations.test(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/sync')
  @HttpCode(200)
  sync(@Param('id') id: string, @Body() body: SyncBody) {
    return this.integrations.runSync(id, body.days);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id/runs')
  runs(@Param('id') id: string) {
    return this.integrations.runs(id);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id/runs/:runId')
  run(@Param('id') id: string, @Param('runId') runId: string) {
    return this.integrations.run(id, runId);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id/webhook')
  webhook(@Param('id') id: string) {
    return this.integrations.webhookInfo(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/webhook')
  @HttpCode(200)
  setWebhook(@Param('id') id: string, @Body() body: WebhookSecretBody) {
    return this.integrations.setWebhookSecret(id, body.secret);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/webhook')
  disableWebhook(@Param('id') id: string) {
    return this.integrations.disableWebhook(id);
  }
}
