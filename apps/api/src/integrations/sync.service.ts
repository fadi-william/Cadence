import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AdapterRegistry } from './adapters/adapter.registry';
import {
  ActivityRecord,
  DateRange,
  DeploymentRecord,
  isDeployments,
  isSourceControl,
  isWorkTracking,
} from './adapters/adapter.types';
import { aggregate, workItems } from './aggregate';
import { DeploymentStatus, SyncStatus } from '../generated/prisma/enums';
import type { SyncRun } from '../generated/prisma/client';

export const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export type SyncTrigger = 'manual' | 'schedule' | 'webhook';

/**
 * Executes one sync run: pulls activity (and deployments) from the adapter and writes them.
 * Idempotent: daily metrics of the range are replaced; deployments are upserted by external id.
 * Scheduling, queueing and locking live in SyncDispatcher.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: AdapterRegistry,
  ) {}

  /** The last `days` days including today. */
  rangeForDays(days: number): DateRange {
    const to = utcMidnight(new Date());
    return { from: new Date(to.getTime() - (days - 1) * 864e5), to };
  }

  createRun(connectionId: string, range: DateRange, trigger: SyncTrigger) {
    return this.prisma.syncRun.create({
      data: { connectionId, rangeFrom: range.from, rangeTo: range.to, trigger, status: SyncStatus.QUEUED },
    });
  }

  async execute(runId: string): Promise<SyncRun | null> {
    const run = await this.prisma.syncRun.findUnique({ where: { id: runId }, include: { connection: true } });
    if (!run || (run.status !== SyncStatus.QUEUED && run.status !== SyncStatus.RUNNING)) return run;
    const { connection } = run;
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: { status: SyncStatus.RUNNING, startedAt: new Date() },
    });
    const range = { from: run.rangeFrom, to: run.rangeTo };

    try {
      const adapter = this.registry.get(connection.provider);
      const ctx = {
        baseUrl: connection.baseUrl,
        config: (connection.config ?? {}) as Record<string, unknown>,
        secret: this.crypto.decrypt(connection.encryptedSecret),
      };
      const identities = await this.prisma.externalIdentity.findMany({
        where: { connectionId: connection.id },
        select: { memberId: true, username: true, externalId: true },
      });

      const records: ActivityRecord[] = [];
      if (isWorkTracking(adapter)) records.push(...(await adapter.fetchWorkItemActivity(ctx, identities, range)));
      if (isSourceControl(adapter)) records.push(...(await adapter.fetchCodeActivity(ctx, identities, range)));
      const deployments = isDeployments(adapter) ? await adapter.fetchDeployments(ctx, range) : [];

      const rows = aggregate(records, range).map((r) => ({ ...r, connectionId: connection.id }));
      await this.prisma.$transaction([
        this.prisma.dailyMetric.deleteMany({
          where: { connectionId: connection.id, date: { gte: range.from, lte: range.to } },
        }),
        this.prisma.dailyMetric.createMany({ data: rows }),
        this.prisma.workItem.deleteMany({
          where: { connectionId: connection.id, date: { gte: range.from, lte: range.to } },
        }),
        ...workItems(records, range).map(({ memberIds, ...item }) =>
          this.prisma.workItem.upsert({
            where: { connectionId_key: { connectionId: connection.id, key: item.key } },
            create: {
              ...item,
              connectionId: connection.id,
              contributors: { create: [...memberIds].map((memberId) => ({ memberId })) },
            },
            update: {
              ...item,
              contributors: { deleteMany: {}, create: [...memberIds].map((memberId) => ({ memberId })) },
            },
          }),
        ),
      ]);
      const deploymentCount = await this.saveDeployments(connection.id, deployments);

      return await this.prisma.syncRun.update({
        where: { id: runId },
        data: { status: SyncStatus.SUCCESS, finishedAt: new Date(), recordsWritten: rows.length + deploymentCount },
      });
    } catch (e) {
      const message = (e as Error).message.slice(0, 2000);
      this.logger.warn(`Sync ${connection.name} failed: ${message}`);
      return await this.prisma.syncRun.update({
        where: { id: runId },
        data: { status: SyncStatus.FAILED, finishedAt: new Date(), error: message },
      });
    }
  }

  async markFailed(runId: string, error: string) {
    await this.prisma.syncRun.updateMany({
      where: { id: runId, status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
      data: { status: SyncStatus.FAILED, finishedAt: new Date(), error },
    });
  }

  private async saveDeployments(connectionId: string, records: DeploymentRecord[]) {
    const serviceIds = new Map<string, string>();
    for (const name of new Set(records.map((r) => r.service))) {
      const svc = await this.prisma.deliveryService.upsert({
        where: { connectionId_name: { connectionId, name } },
        create: { connectionId, name },
        update: {},
      });
      serviceIds.set(name, svc.id);
    }
    for (const r of records) {
      const serviceId = serviceIds.get(r.service)!;
      const data = {
        environment: r.environment,
        status: r.status === 'FAILED' ? DeploymentStatus.FAILED : DeploymentStatus.SUCCESS,
        startedAt: r.startedAt ? new Date(r.startedAt) : null,
        finishedAt: new Date(r.finishedAt),
        leadTimeHours: r.leadTimeHours ?? null,
      };
      await this.prisma.deployment.upsert({
        where: { serviceId_externalId: { serviceId, externalId: r.externalId } },
        create: { serviceId, externalId: r.externalId, ...data },
        update: data,
      });
    }
    return records.length;
  }
}
