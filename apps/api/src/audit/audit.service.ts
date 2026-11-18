import { Injectable, Logger } from '@nestjs/common';
import type { AuditLogDto, AuditPageDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { currentContext } from '../common/context/request-context';
import { Prisma } from '../generated/prisma/client';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Defaults to the authenticated user of the current request. */
  actor?: { id: string; email: string } | null;
}

/** Append-only audit trail. Recording never throws: auditing must not break the main action. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const ctx = currentContext();
    const actor = entry.actor === undefined ? ctx.user : entry.actor;
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          actorId: actor?.id ?? null,
          actorEmail: actor?.email ?? null,
          ip: ctx.ip ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to write audit entry ${entry.action}: ${(e as Error).message}`);
    }
  }

  async list(opts: { cursor?: string; limit?: number; entityType?: string; action?: string }): Promise<AuditPageDto> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(opts.entityType ? { entityType: opts.entityType } : {}),
        ...(opts.action ? { action: { startsWith: opts.action } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const items: AuditLogDto[] = rows.slice(0, take).map((r) => ({
      ...r,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }
}
