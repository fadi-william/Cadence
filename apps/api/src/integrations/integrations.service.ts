import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IntegrationConnectionDto, WebhookInfoDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuditService } from '../audit/audit.service';
import { randomToken } from '../common/crypto/tokens';
import { AdapterRegistry } from './adapters/adapter.registry';
import { SyncService } from './sync.service';
import { SyncDispatcher } from './sync-dispatcher.service';
import { CreateIntegrationBody, UpdateIntegrationBody } from './dto';
import { Prisma } from '../generated/prisma/client';
import type { IntegrationConnection, SyncRun } from '../generated/prisma/client';

export const serialiseRun = (r: SyncRun) => ({
  id: r.id,
  connectionId: r.connectionId,
  status: r.status,
  trigger: r.trigger,
  recordsWritten: r.recordsWritten,
  error: r.error,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  rangeFrom: r.rangeFrom.toISOString().slice(0, 10),
  rangeTo: r.rangeTo.toISOString().slice(0, 10),
});

const toDto = (c: IntegrationConnection & { syncRuns?: SyncRun[] }): IntegrationConnectionDto => ({
  id: c.id,
  name: c.name,
  provider: c.provider,
  baseUrl: c.baseUrl,
  config: (c.config ?? {}) as Record<string, unknown>,
  enabled: c.enabled,
  hasSecret: !!c.encryptedSecret,
  webhookConfigured: !!c.encryptedWebhookSecret,
  createdAt: c.createdAt.toISOString(),
  lastSync: c.syncRuns?.[0] ? serialiseRun(c.syncRuns[0]) : null,
});

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: AdapterRegistry,
    private readonly sync: SyncService,
    private readonly dispatcher: SyncDispatcher,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  providers() {
    return this.registry.all().map((a) => a.describe());
  }

  async list() {
    const rows = await this.prisma.integrationConnection.findMany({
      orderBy: { name: 'asc' },
      include: { syncRuns: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    return rows.map(toDto);
  }

  private async find(id: string) {
    const c = await this.prisma.integrationConnection.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Integration not found');
    return c;
  }

  async create(body: CreateIntegrationBody) {
    this.registry.get(body.provider); // validates provider has an adapter
    const row = await this.prisma.integrationConnection.create({
      data: {
        name: body.name,
        provider: body.provider,
        baseUrl: body.baseUrl.replace(/\/+$/, ''),
        config: (body.config ?? {}) as Prisma.InputJsonValue,
        encryptedSecret: this.crypto.encrypt(body.secret),
        enabled: body.enabled ?? true,
      },
    });
    await this.audit.record({
      action: 'integration.created',
      entityType: 'integration',
      entityId: row.id,
      metadata: { name: row.name, provider: row.provider },
    });
    return toDto(row);
  }

  async update(id: string, body: UpdateIntegrationBody) {
    await this.find(id);
    const row = await this.prisma.integrationConnection.update({
      where: { id },
      data: {
        name: body.name,
        baseUrl: body.baseUrl?.replace(/\/+$/, ''),
        config: body.config as Prisma.InputJsonValue | undefined,
        enabled: body.enabled,
        ...(body.secret ? { encryptedSecret: this.crypto.encrypt(body.secret) } : {}),
      },
    });
    await this.audit.record({
      action: 'integration.updated',
      entityType: 'integration',
      entityId: id,
      metadata: { fields: Object.keys(body).map((k) => (k === 'secret' ? 'secret(changed)' : k)) },
    });
    return toDto(row);
  }

  async remove(id: string) {
    const c = await this.find(id);
    await this.prisma.integrationConnection.delete({ where: { id } });
    await this.audit.record({
      action: 'integration.deleted',
      entityType: 'integration',
      entityId: id,
      metadata: { name: c.name },
    });
  }

  context(c: IntegrationConnection) {
    return {
      baseUrl: c.baseUrl,
      config: (c.config ?? {}) as Record<string, unknown>,
      secret: this.crypto.decrypt(c.encryptedSecret),
    };
  }

  async test(id: string) {
    const c = await this.find(id);
    return this.registry.get(c.provider).testConnection(this.context(c));
  }

  async searchUsers(id: string, q: string) {
    const c = await this.find(id);
    const adapter = this.registry.get(c.provider);
    if (!adapter.searchUsers || q.trim().length < 2) return [];
    try {
      return await adapter.searchUsers(this.context(c), q.trim());
    } catch (e) {
      // Upstream failure (network, auth): a 502 the UI can ignore, not an unhandled 500.
      throw new BadGatewayException(`User lookup failed: ${(e as Error).message}`);
    }
  }

  async runSync(id: string, days = 14) {
    await this.find(id);
    const run = await this.dispatcher.enqueue(id, this.sync.rangeForDays(days), 'manual');
    await this.audit.record({
      action: 'integration.sync_requested',
      entityType: 'integration',
      entityId: id,
      metadata: { days },
    });
    return serialiseRun(run);
  }

  async runs(id: string) {
    await this.find(id);
    const runs = await this.prisma.syncRun.findMany({
      where: { connectionId: id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return runs.map(serialiseRun);
  }

  async run(id: string, runId: string) {
    const run = await this.prisma.syncRun.findFirst({ where: { id: runId, connectionId: id } });
    if (!run) throw new NotFoundException('Sync run not found');
    return serialiseRun(run);
  }

  webhookUrl(id: string) {
    const base = this.config.get<string>('PUBLIC_API_URL', 'http://localhost:3000/api').replace(/\/$/, '');
    return `${base}/webhooks/${id}`;
  }

  async webhookInfo(id: string): Promise<WebhookInfoDto> {
    const c = await this.find(id);
    return { url: this.webhookUrl(id), configured: !!c.encryptedWebhookSecret };
  }

  /** Generates a webhook secret, or stores one issued by the provider (e.g. a signing secret copied from Jira). */
  async setWebhookSecret(id: string, provided?: string): Promise<WebhookInfoDto> {
    await this.find(id);
    const secret = provided?.trim() || randomToken(24);
    await this.prisma.integrationConnection.update({
      where: { id },
      data: { encryptedWebhookSecret: this.crypto.encrypt(secret) },
    });
    await this.audit.record({
      action: 'integration.webhook_secret_set',
      entityType: 'integration',
      entityId: id,
      metadata: { source: provided ? 'provider' : 'generated' },
    });
    return { url: this.webhookUrl(id), configured: true, secret };
  }

  async disableWebhook(id: string): Promise<WebhookInfoDto> {
    await this.find(id);
    await this.prisma.integrationConnection.update({ where: { id }, data: { encryptedWebhookSecret: null } });
    await this.audit.record({ action: 'integration.webhook_disabled', entityType: 'integration', entityId: id });
    return { url: this.webhookUrl(id), configured: false };
  }
}
