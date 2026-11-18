import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DelayedError, Job, Queue, Worker } from 'bullmq';
import { CronJob } from 'cron';
import { Redis } from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { DateRange } from './adapters/adapter.types';
import { SyncService, SyncTrigger } from './sync.service';
import type { SyncRun } from '../generated/prisma/client';

const QUEUE = 'cadence-sync';
const LOCK_TTL_MS = 2 * 60 * 60 * 1000;
const LOCK_RETRY_MS = 30_000;

interface SyncJobData {
  runId?: string;
  connectionId: string;
  from: string;
  to: string;
  trigger: SyncTrigger;
}

/**
 * Decides *how* syncs run.
 *  - REDIS_URL set   → BullMQ queue + worker(s); nightly schedule is a BullMQ job scheduler (fires once
 *                      across all API instances); a Redis lock serialises syncs per connection.
 *  - no REDIS_URL    → in-process execution with an in-memory lock and a local cron.
 * Set SYNC_WORKER=false on API instances that should only enqueue (dedicated worker deployment).
 */
@Injectable()
export class SyncDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncDispatcher.name);
  private queue?: Queue<SyncJobData>;
  private worker?: Worker<SyncJobData>;
  private redis?: Redis;
  private readonly localLocks = new Set<string>();
  private readonly debounce = new Map<string, { timer: NodeJS.Timeout; range: DateRange }>();

  constructor(
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    const cron = this.config.get<string>('SYNC_CRON', '0 2 * * *');
    if (url) {
      const connection = { url, maxRetriesPerRequest: null };
      this.queue = new Queue<SyncJobData>(QUEUE, {
        connection,
        defaultJobOptions: { removeOnComplete: { count: 500 }, removeOnFail: { count: 500 } },
      });
      this.redis = new Redis(url, { maxRetriesPerRequest: null });
      if (this.config.get('SYNC_WORKER', 'true') !== 'false') {
        this.worker = new Worker<SyncJobData>(QUEUE, (job, token) => this.process(job, token), {
          connection,
          concurrency: Number(this.config.get('SYNC_CONCURRENCY', 2)),
        });
        this.worker.on('failed', (job, err) => this.logger.warn(`Sync job ${job?.id} failed: ${err.message}`));
      }
      if (cron !== 'off') {
        await this.queue.upsertJobScheduler('nightly-sync', { pattern: cron }, { name: 'sync-all' });
      } else {
        await this.queue.removeJobScheduler('nightly-sync');
      }
      this.logger.log(`Sync queue ready (BullMQ, worker=${!!this.worker}, schedule=${cron})`);
    } else if (cron !== 'off') {
      const job = CronJob.from({ cronTime: cron, onTick: () => void this.enqueueAll(2), start: true });
      this.scheduler.addCronJob('nightly-sync', job);
      this.logger.log(`Sync running in-process (no REDIS_URL); nightly schedule ${cron}`);
    }
  }

  async onModuleDestroy() {
    for (const { timer } of this.debounce.values()) clearTimeout(timer);
    await this.worker?.close();
    await this.queue?.close();
    this.redis?.disconnect();
  }

  /** Queues a sync for every enabled connection (nightly). */
  async enqueueAll(days: number) {
    const connections = await this.prisma.integrationConnection.findMany({ where: { enabled: true } });
    for (const c of connections) await this.enqueue(c.id, this.sync.rangeForDays(days), 'schedule');
  }

  /** Creates a QUEUED run and schedules it. Returns immediately; poll the run for completion. */
  async enqueue(connectionId: string, range: DateRange, trigger: SyncTrigger): Promise<SyncRun> {
    const run = await this.sync.createRun(connectionId, range, trigger);
    const data: SyncJobData = {
      runId: run.id,
      connectionId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      trigger,
    };
    if (this.queue) await this.queue.add('sync', data, { jobId: `run-${run.id}` });
    else setImmediate(() => void this.runInline(data));
    return run;
  }

  /** Coalesces bursts (e.g. webhooks) into one sync per connection after `delayMs` of quiet. */
  async enqueueDebounced(connectionId: string, range: DateRange, trigger: SyncTrigger, delayMs: number) {
    if (this.queue) {
      await this.queue.add(
        'sync',
        { connectionId, from: range.from.toISOString(), to: range.to.toISOString(), trigger },
        {
          delay: delayMs,
          deduplication: { id: `debounce:${connectionId}`, ttl: delayMs, extend: true, replace: true },
        },
      );
      return;
    }
    const pending = this.debounce.get(connectionId);
    const merged = pending
      ? {
          from: new Date(Math.min(pending.range.from.getTime(), range.from.getTime())),
          to: new Date(Math.max(pending.range.to.getTime(), range.to.getTime())),
        }
      : range;
    if (pending) clearTimeout(pending.timer);
    const timer = setTimeout(() => {
      this.debounce.delete(connectionId);
      void this.enqueue(connectionId, merged, trigger);
    }, delayMs);
    timer.unref?.();
    this.debounce.set(connectionId, { timer, range: merged });
  }

  // ---------- execution ----------

  private async runInline(data: SyncJobData) {
    if (this.localLocks.has(data.connectionId)) {
      setTimeout(() => void this.runInline(data), LOCK_RETRY_MS).unref?.();
      return;
    }
    this.localLocks.add(data.connectionId);
    try {
      await this.sync.execute(data.runId!);
    } catch (e) {
      await this.sync.markFailed(data.runId!, (e as Error).message);
    } finally {
      this.localLocks.delete(data.connectionId);
    }
  }

  private async process(job: Job<SyncJobData>, token?: string) {
    if (job.name === 'sync-all') {
      await this.enqueueAll(2);
      return;
    }
    const lockKey = `cadence:sync-lock:${job.data.connectionId}`;
    const acquired = await this.redis!.set(lockKey, job.id ?? '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired) {
      await job.moveToDelayed(Date.now() + LOCK_RETRY_MS, token);
      throw new DelayedError();
    }
    try {
      let runId = job.data.runId;
      if (!runId) {
        const run = await this.sync.createRun(
          job.data.connectionId,
          { from: new Date(job.data.from), to: new Date(job.data.to) },
          job.data.trigger,
        );
        runId = run.id;
        await job.updateData({ ...job.data, runId });
      }
      const run = await this.sync.execute(runId);
      return { status: run?.status, recordsWritten: run?.recordsWritten };
    } finally {
      // Only release our own lock.
      if ((await this.redis!.get(lockKey)) === (job.id ?? '1')) await this.redis!.del(lockKey);
    }
  }
}
