import { Injectable } from '@nestjs/common';
import type {
  DailyMetricDto,
  MemberMetricsDto,
  MetricTotals,
  MetricsSummaryDto,
  RollupDto,
  RollupGroupBy,
  RollupRow,
} from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AccessScopeService } from '../org/access-scope.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { toDay } from '../common/http/http';

type Sums = {
  commits: number | null;
  prsRaised: number | null;
  prsReviewed: number | null;
  prsMerged: number | null;
  issuesCompleted: number | null;
  storyPoints: number | null;
  cycleTimeHoursSum: number | null;
  cycleTimeSamples: number | null;
  assignmentsCompleted: number | null;
  assignmentsHandedOver: number | null;
  assignmentsReworked: number | null;
  holdHoursSum: number | null;
  holdSamples: number | null;
};

const SUM = {
  commits: true,
  prsRaised: true,
  prsReviewed: true,
  prsMerged: true,
  issuesCompleted: true,
  storyPoints: true,
  cycleTimeHoursSum: true,
  cycleTimeSamples: true,
  assignmentsCompleted: true,
  assignmentsHandedOver: true,
  assignmentsReworked: true,
  holdHoursSum: true,
  holdSamples: true,
} as const;

const sumTotals = (rows: MetricTotals[]): Sums => {
  const acc = {
    commits: 0,
    prsRaised: 0,
    prsReviewed: 0,
    prsMerged: 0,
    issuesCompleted: 0,
    storyPoints: 0,
    cycleTimeHoursSum: 0,
    cycleTimeSamples: 0,
    assignmentsCompleted: 0,
    assignmentsHandedOver: 0,
    assignmentsReworked: 0,
    holdHoursSum: 0,
    holdSamples: 0,
  };
  for (const r of rows) {
    acc.commits += r.commits;
    acc.prsRaised += r.prsRaised;
    acc.prsReviewed += r.prsReviewed;
    acc.prsMerged += r.prsMerged;
    acc.issuesCompleted += r.issuesCompleted;
    acc.storyPoints += r.storyPoints;
    acc.assignmentsCompleted += r.assignmentsCompleted;
    acc.assignmentsHandedOver += r.assignmentsHandedOver;
    acc.assignmentsReworked += r.assignmentsReworked;
  }
  return acc;
};

const totals = (s: Sums): MetricTotals => ({
  commits: s.commits ?? 0,
  prsRaised: s.prsRaised ?? 0,
  prsReviewed: s.prsReviewed ?? 0,
  prsMerged: s.prsMerged ?? 0,
  issuesCompleted: s.issuesCompleted ?? 0,
  storyPoints: Math.round((s.storyPoints ?? 0) * 10) / 10,
  cycleTimeHoursAvg: s.cycleTimeSamples
    ? Math.round(((s.cycleTimeHoursSum ?? 0) / s.cycleTimeSamples) * 10) / 10
    : null,
  assignmentsCompleted: s.assignmentsCompleted ?? 0,
  assignmentsHandedOver: s.assignmentsHandedOver ?? 0,
  assignmentsReworked: s.assignmentsReworked ?? 0,
  holdTimeHoursAvg: s.holdSamples ? Math.round(((s.holdHoursSum ?? 0) / s.holdSamples) * 10) / 10 : null,
});

/** Completed work items of a group, each counted once however many members held it. */
type ItemSums = {
  _count: { _all: number; cycleTimeHours: number };
  _sum: { storyPoints: number | null; cycleTimeHours: number | null };
};
const ITEM_AGG = {
  _count: { _all: true, cycleTimeHours: true },
  _sum: { storyPoints: true, cycleTimeHours: true },
} as const;

/** Replaces the per-person sums of issues, points and cycle time with group-level (de-duplicated) ones. */
const withItems = (t: MetricTotals, w?: ItemSums): MetricTotals => ({
  ...t,
  issuesCompleted: w?._count._all ?? 0,
  storyPoints: Math.round((w?._sum.storyPoints ?? 0) * 10) / 10,
  cycleTimeHoursAvg: w?._count.cycleTimeHours
    ? Math.round(((w._sum.cycleTimeHours ?? 0) / w._count.cycleTimeHours) * 10) / 10
    : null,
});

/** Parses YYYY-MM-DD bounds (defaults: last 30 days). Ranges are capped at 2 years. */
/** The window of equal length immediately before [from, to]. */
export function previousRange(from: Date, to: Date) {
  const days = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
  return { from: new Date(from.getTime() - days * 864e5), to: new Date(from.getTime() - 864e5) };
}

export function parseRange(from?: string, to?: string) {
  const today = new Date(`${toDay(new Date())}T00:00:00.000Z`);
  const end = to ? new Date(`${to}T00:00:00.000Z`) : today;
  let start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(end.getTime() - 29 * 864e5);
  if (start > end) start = end;
  if (end.getTime() - start.getTime() > 730 * 864e5) start = new Date(end.getTime() - 730 * 864e5);
  return { from: start, to: end };
}

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
  ) {}

  private itemWhere(memberIds: string[], from: Date, to: Date) {
    return { date: { gte: from, lte: to }, contributors: { some: { memberId: { in: memberIds } } } };
  }

  private itemTotals(memberIds: string[], from: Date, to: Date): Promise<ItemSums> {
    return this.prisma.workItem.aggregate({ where: this.itemWhere(memberIds, from, to), ...ITEM_AGG });
  }

  private async itemsByDay(memberIds: string[], from: Date, to: Date) {
    const rows = await this.prisma.workItem.groupBy({
      by: ['date'],
      where: this.itemWhere(memberIds, from, to),
      ...ITEM_AGG,
    });
    return new Map(rows.map((r) => [toDay(r.date), r as ItemSums]));
  }

  async member(actor: AuthenticatedUser, memberId: string, fromS?: string, toS?: string): Promise<MemberMetricsDto> {
    await this.scope.assertMemberInScope(actor, memberId);
    const { from, to } = parseRange(fromS, toS);
    const where = { memberId, date: { gte: from, lte: to } };
    const prev = previousRange(from, to);
    const [byDay, agg, previous, bySource, identities] = await Promise.all([
      this.prisma.dailyMetric.groupBy({ by: ['date'], where, _sum: SUM, orderBy: { date: 'asc' } }),
      this.prisma.dailyMetric.aggregate({ where, _sum: SUM }),
      this.prisma.dailyMetric.aggregate({ where: { memberId, date: { gte: prev.from, lte: prev.to } }, _sum: SUM }),
      this.prisma.dailyMetric.groupBy({ by: ['connectionId'], where, _sum: SUM }),
      this.prisma.externalIdentity.findMany({
        where: { memberId },
        include: { connection: { select: { id: true, name: true, provider: true } } },
      }),
    ]);
    // Every linked platform appears, even with no activity in the window; plus any historical source.
    const sourceSums = new Map(bySource.map((s) => [s.connectionId, s._sum]));
    const connectionIds = new Set([...identities.map((i) => i.connectionId), ...sourceSums.keys()]);
    const connections = await this.prisma.integrationConnection.findMany({
      where: { id: { in: [...connectionIds] } },
      select: { id: true, name: true, provider: true },
      orderBy: { name: 'asc' },
    });
    const sources = connections.map((c) => ({
      connectionId: c.id,
      connectionName: c.name,
      provider: c.provider,
      username: identities.find((i) => i.connectionId === c.id)?.username ?? null,
      totals: totals(sourceSums.get(c.id) ?? ({} as Sums)),
    }));
    const map = new Map(byDay.map((d) => [toDay(d.date), totals(d._sum)]));
    const days: DailyMetricDto[] = [];
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 864e5)) {
      const key = toDay(d);
      days.push({ date: key, ...(map.get(key) ?? totals({} as Sums)) });
    }
    return {
      memberId,
      from: toDay(from),
      to: toDay(to),
      totals: totals(agg._sum),
      previous: totals(previous._sum),
      sources,
      days,
    };
  }

  async summary(
    actor: AuthenticatedUser,
    fromS?: string,
    toS?: string,
    managerId?: string,
  ): Promise<MetricsSummaryDto> {
    const { from, to } = parseRange(fromS, toS);
    const memberWhere = { ...(await this.scope.memberWhere(actor)), ...(managerId ? { AND: [{ managerId }] } : {}) };
    const members = await this.prisma.member.findMany({
      where: memberWhere,
      select: { id: true, name: true, manager: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const ids = members.map((m) => m.id);
    const where = { memberId: { in: ids }, date: { gte: from, lte: to } };
    const prev = previousRange(from, to);
    const [grouped, agg, previous, items, previousItems] = await Promise.all([
      this.prisma.dailyMetric.groupBy({ by: ['memberId'], where, _sum: SUM }),
      this.prisma.dailyMetric.aggregate({ where, _sum: SUM }),
      this.prisma.dailyMetric.aggregate({
        where: { memberId: { in: ids }, date: { gte: prev.from, lte: prev.to } },
        _sum: SUM,
      }),
      this.itemTotals(ids, from, to),
      this.itemTotals(ids, prev.from, prev.to),
    ]);
    const byMember = new Map(grouped.map((g) => [g.memberId, totals(g._sum)]));
    return {
      from: toDay(from),
      to: toDay(to),
      totals: withItems(totals(agg._sum), items),
      previous: withItems(totals(previous._sum), previousItems),
      rows: members.map((m) => ({
        memberId: m.id,
        memberName: m.name,
        managerName: m.manager.name,
        totals: byMember.get(m.id) ?? totals({} as Sums),
      })),
    };
  }

  /** Team (manager) or tribe roll-ups plus the scope-wide daily trend. */
  async rollup(actor: AuthenticatedUser, groupBy: RollupGroupBy, fromS?: string, toS?: string): Promise<RollupDto> {
    const { from, to } = parseRange(fromS, toS);
    const members = await this.prisma.member.findMany({
      where: await this.scope.memberWhere(actor),
      select: {
        id: true,
        manager: {
          select: { id: true, name: true, reportsTo: { select: { id: true, name: true, tribeName: true } } },
        },
      },
    });
    const where = { memberId: { in: members.map((m) => m.id) }, date: { gte: from, lte: to } };
    const [grouped, byDay, itemDays] = await Promise.all([
      this.prisma.dailyMetric.groupBy({ by: ['memberId'], where, _sum: SUM }),
      this.prisma.dailyMetric.groupBy({ by: ['date'], where, _sum: SUM, orderBy: { date: 'asc' } }),
      this.itemsByDay(
        members.map((m) => m.id),
        from,
        to,
      ),
    ]);
    const sums = new Map(grouped.map((g) => [g.memberId, g._sum]));

    const groups = new Map<string, { row: Omit<RollupRow, 'totals'>; sums: Sums[]; memberIds: string[] }>();
    for (const m of members) {
      const tl = m.manager.reportsTo;
      const key = groupBy === 'manager' ? m.manager.id : (tl?.id ?? 'unassigned');
      const g = groups.get(key) ?? {
        row:
          groupBy === 'manager'
            ? { id: m.manager.id, name: m.manager.name, subtitle: tl?.tribeName ?? null, memberCount: 0 }
            : { id: key, name: tl?.tribeName || tl?.name || 'Unassigned', subtitle: tl?.name ?? null, memberCount: 0 },
        sums: [],
        memberIds: [],
      };
      g.row.memberCount++;
      g.memberIds.push(m.id);
      const s = sums.get(m.id);
      if (s) g.sums.push(s);
      groups.set(key, g);
    }

    const groupList = [...groups.values()];
    const groupItems = await Promise.all(groupList.map((g) => this.itemTotals(g.memberIds, from, to)));
    const rows: RollupRow[] = groupList.map(({ row, sums: list }, i) => {
      const t = list.map((s) => totals(s));
      const merged = sumTotals(t);
      merged.holdHoursSum = list.reduce((n, s) => n + (s.holdHoursSum ?? 0), 0);
      merged.holdSamples = list.reduce((n, s) => n + (s.holdSamples ?? 0), 0);
      return { ...row, totals: withItems(totals(merged), groupItems[i]) };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const dayMap = new Map(byDay.map((d) => [toDay(d.date), totals(d._sum)]));
    const trend: DailyMetricDto[] = [];
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 864e5)) {
      const key = toDay(d);
      trend.push({ date: key, ...withItems(dayMap.get(key) ?? totals({} as Sums), itemDays.get(key)) });
    }
    return { from: toDay(from), to: toDay(to), groupBy, rows, trend };
  }
}
