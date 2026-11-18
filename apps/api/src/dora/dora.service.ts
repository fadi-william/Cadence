import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DeliveryServiceDto, DoraSummaryDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AccessScopeService } from '../org/access-scope.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { toDay } from '../common/http/http';
import { parseRange } from '../metrics/metrics.service';
import { Prisma } from '../generated/prisma/client';
import { median, rate, round1, timeToRestoreHours } from './dora.calc';

@Injectable()
export class DoraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Admins see every service (incl. unassigned); others only services owned by teams in their scope. */
  private async serviceWhere(actor: AuthenticatedUser, managerId?: string): Promise<Prisma.DeliveryServiceWhereInput> {
    const ids = await this.scope.managerIds(actor);
    const where: Prisma.DeliveryServiceWhereInput = ids === null ? {} : { managerId: { in: ids } };
    if (managerId) where.AND = [{ managerId }];
    return where;
  }

  async summary(actor: AuthenticatedUser, fromS?: string, toS?: string, managerId?: string): Promise<DoraSummaryDto> {
    const { from, to } = parseRange(fromS, toS);
    const services = await this.prisma.deliveryService.findMany({
      where: await this.serviceWhere(actor, managerId),
      include: { connection: { select: { name: true } }, manager: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const deployments = await this.prisma.deployment.findMany({
      where: {
        serviceId: { in: services.map((s) => s.id) },
        finishedAt: { gte: from, lt: new Date(to.getTime() + 864e5) },
      },
      orderBy: { finishedAt: 'asc' },
    });

    const days = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
    const successes = deployments.filter((d) => d.status === 'SUCCESS');
    const failed = deployments.length - successes.length;
    const perDay = successes.length / days;
    const cfr = deployments.length ? failed / deployments.length : null;
    const leadTime = median(successes.map((d) => d.leadTimeHours).filter((v): v is number => v !== null));
    const mttr = timeToRestoreHours(deployments);

    const daily = new Map<string, { deployments: number; failures: number }>();
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 864e5)) {
      daily.set(toDay(d), { deployments: 0, failures: 0 });
    }
    for (const d of deployments) {
      const bucket = daily.get(toDay(d.finishedAt));
      if (!bucket) continue;
      bucket.deployments++;
      if (d.status === 'FAILED') bucket.failures++;
    }

    return {
      from: toDay(from),
      to: toDay(to),
      deployments: deployments.length,
      failedDeployments: failed,
      deploymentsPerDay: Math.round(perDay * 100) / 100,
      changeFailureRate: cfr === null ? null : Math.round(cfr * 1000) / 1000,
      leadTimeHoursMedian: round1(leadTime),
      mttrHours: round1(mttr),
      ratings: {
        deploymentFrequency: rate.deploymentFrequency(perDay, successes.length),
        leadTime: rate.leadTime(leadTime),
        changeFailureRate: rate.changeFailureRate(cfr),
        mttr: rate.mttr(mttr),
      },
      daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
      services: services.map((s) => {
        const own = deployments.filter((d) => d.serviceId === s.id);
        return {
          id: s.id,
          name: s.name,
          connectionName: s.connection.name,
          managerId: s.managerId,
          managerName: s.manager?.name ?? null,
          deployments: own.length,
          failures: own.filter((d) => d.status === 'FAILED').length,
          leadTimeHoursMedian: round1(median(own.map((d) => d.leadTimeHours).filter((v): v is number => v !== null))),
        };
      }),
    };
  }

  async services(actor: AuthenticatedUser): Promise<DeliveryServiceDto[]> {
    const rows = await this.prisma.deliveryService.findMany({
      where: await this.serviceWhere(actor),
      include: {
        connection: { select: { name: true, provider: true } },
        manager: { select: { name: true } },
        _count: { select: { deployments: true } },
      },
      orderBy: [{ connectionId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      connectionId: s.connectionId,
      connectionName: s.connection.name,
      provider: s.connection.provider,
      managerId: s.managerId,
      managerName: s.manager?.name ?? null,
      deploymentCount: s._count.deployments,
    }));
  }

  /** Assigns the owning team. Admins: any service. Tribe leads: services owned by / moved to their EMs. */
  async setOwner(actor: AuthenticatedUser, serviceId: string, managerId: string | null) {
    const service = await this.prisma.deliveryService.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');
    const ids = await this.scope.managerIds(actor);
    if (ids !== null) {
      if (!service.managerId || !ids.includes(service.managerId))
        throw new ForbiddenException('Service outside your scope');
      if (!managerId || !ids.includes(managerId)) throw new ForbiddenException('Manager outside your scope');
    }
    if (managerId) await this.scope.assertManagerInScope(actor, managerId);
    await this.prisma.deliveryService.update({ where: { id: serviceId }, data: { managerId } });
    await this.audit.record({
      action: 'service.owner_changed',
      entityType: 'service',
      entityId: serviceId,
      metadata: { name: service.name, from: service.managerId, to: managerId },
    });
    return (await this.services(actor)).find((s) => s.id === serviceId) ?? null;
  }
}
