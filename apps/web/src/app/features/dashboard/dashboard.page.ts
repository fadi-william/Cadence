import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MetricTotals, RollupGroupBy } from '@cadence/shared';
import { ApiService } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { DateRange, fmtHours, lastNDays, shortDay } from '../../core/dates';
import { Avatar } from '../../shared/avatar';
import { BrandArcs } from '../../shared/brand-arcs';
import { Chart, ChartSpec } from '../../shared/chart';
import { DateRangePicker } from '../../shared/date-range';
import { DoraTile, doraKpis } from '../../shared/dora-tile';
import { Icon } from '../../shared/icon';
import { StatCard } from '../../shared/stat-card';

type View = 'members' | RollupGroupBy;
type SortKey = 'name' | keyof Omit<MetricTotals, 'cycleTimeHoursAvg' | 'holdTimeHoursAvg'>;

interface Row {
  id: string;
  name: string;
  subtitle: string | null;
  link: string[] | null;
  memberCount?: number;
  totals: MetricTotals;
}

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, Avatar, BrandArcs, Chart, DateRangePicker, DoraTile, Icon, StatCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthStore);
  protected readonly range = signal<DateRange>(lastNDays(30));
  protected readonly view = signal<View>('members');
  protected readonly sort = signal<SortKey>('commits');
  protected readonly hours = fmtHours;
  protected readonly today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  protected readonly views: { id: View; label: string }[] = [
    { id: 'members', label: 'People' },
    { id: 'manager', label: 'Teams' },
    { id: 'tribe', label: 'Tribes' },
  ];

  protected readonly columns = computed<{ key: SortKey; label: string; cls: string }[]>(() => [
    {
      key: 'name',
      label: this.view() === 'members' ? 'Person' : this.view() === 'manager' ? 'Team' : 'Tribe',
      cls: '',
    },
    { key: 'commits', label: 'Commits', cls: '' },
    { key: 'prsMerged', label: 'PRs merged', cls: 'hidden sm:table-cell' },
    { key: 'prsReviewed', label: 'Reviews', cls: 'hidden md:table-cell' },
    { key: 'issuesCompleted', label: 'Issues', cls: 'hidden md:table-cell' },
    { key: 'storyPoints', label: 'Points', cls: 'hidden lg:table-cell' },
  ]);

  protected readonly summary = resource({
    params: () => this.range(),
    loader: ({ params }) => this.api.summary(params.from, params.to),
  });
  /** Team roll-up also carries the scope-wide daily trend. */
  protected readonly teams = resource({
    params: () => this.range(),
    loader: ({ params }) => this.api.rollup('manager', params.from, params.to),
  });
  protected readonly tribes = resource({
    params: () => (this.view() === 'tribe' ? this.range() : undefined),
    loader: ({ params }) => this.api.rollup('tribe', params.from, params.to),
  });
  protected readonly dora = resource({
    params: () => this.range(),
    loader: ({ params }) => this.api.dora(params.from, params.to),
  });

  protected readonly firstName = computed(() => this.auth.user()?.name.split(' ')[0] ?? '');
  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  });
  protected readonly peopleCount = computed(() => this.summary.value()?.rows.length ?? 0);
  protected readonly teamCount = computed(() => this.teams.value()?.rows.length ?? 0);

  protected readonly glance = computed(() => [
    { label: 'People', value: this.peopleCount() },
    { label: 'Teams', value: this.teamCount() },
    { label: 'Deploys / day', value: this.dora.value()?.deploymentsPerDay ?? '—' },
  ]);

  private readonly trend = computed(() => this.teams.value()?.trend ?? []);

  protected readonly kpis = computed(() => {
    const t = this.summary.value()?.totals;
    const p = this.summary.value()?.previous;
    const tr = this.trend();
    return [
      {
        label: 'Commits',
        icon: 'commit',
        color: 'primary' as const,
        value: t?.commits ?? 0,
        current: t?.commits ?? null,
        previous: p?.commits ?? null,
        hint: 'vs previous period',
        series: tr.map((d) => d.commits),
      },
      {
        label: 'PRs merged',
        icon: 'merge',
        color: 'secondary' as const,
        value: t?.prsMerged ?? 0,
        current: t?.prsMerged ?? null,
        previous: p?.prsMerged ?? null,
        hint: `${t?.prsRaised ?? 0} raised`,
        series: tr.map((d) => d.prsMerged),
      },
      {
        label: 'Reviews',
        icon: 'eye',
        color: 'info' as const,
        value: t?.prsReviewed ?? 0,
        current: t?.prsReviewed ?? null,
        previous: p?.prsReviewed ?? null,
        hint: 'PRs reviewed',
        series: tr.map((d) => d.prsReviewed),
      },
      {
        label: 'Issues done',
        icon: 'ticket',
        color: 'success' as const,
        value: t?.issuesCompleted ?? 0,
        current: t?.issuesCompleted ?? null,
        previous: p?.issuesCompleted ?? null,
        hint: `${t?.storyPoints ?? 0} story points`,
        series: tr.map((d) => d.issuesCompleted),
      },
    ];
  });

  protected readonly trendSpec = computed<ChartSpec | null>(() => {
    if (!this.teams.value()) return null;
    const trend = this.trend();
    return {
      categories: trend.map((d) => shortDay(d.date)),
      series: [
        {
          name: 'Commits',
          type: 'bar',
          data: trend.map((d) => d.commits),
          color: 'primary',
          stack: 'code',
        },
        {
          name: 'PRs raised',
          type: 'bar',
          data: trend.map((d) => d.prsRaised),
          color: 'secondary',
          stack: 'code',
        },
        {
          name: 'Reviews',
          type: 'bar',
          data: trend.map((d) => d.prsReviewed),
          color: 'accent',
          stack: 'code',
        },
        {
          name: 'Issues done',
          type: 'line',
          data: trend.map((d) => d.issuesCompleted),
          color: 'info',
          area: true,
        },
      ],
    };
  });

  protected readonly mixSpec = computed<ChartSpec | null>(() => {
    const t = this.summary.value()?.totals;
    if (!t) return null;
    return {
      categories: [],
      series: [],
      donut: [
        { name: 'Commits', value: t.commits, color: 'primary' },
        { name: 'PRs raised', value: t.prsRaised, color: 'secondary' },
        { name: 'Reviews', value: t.prsReviewed, color: 'accent' },
        { name: 'Issues done', value: t.issuesCompleted, color: 'info' },
      ],
    };
  });

  protected readonly doraTiles = computed(() => {
    const d = this.dora.value();
    return d ? doraKpis(d, fmtHours) : [];
  });

  protected readonly loading = computed(() => {
    const v = this.view();
    if (v === 'members') return this.summary.isLoading() && !this.summary.value();
    const r = v === 'manager' ? this.teams : this.tribes;
    return r.isLoading() && !r.value();
  });

  protected readonly rows = computed<Row[]>(() => {
    const v = this.view();
    let rows: Row[];
    if (v === 'members') {
      rows = (this.summary.value()?.rows ?? []).map((r) => ({
        id: r.memberId,
        name: r.memberName,
        subtitle: r.managerName,
        link: ['/members', r.memberId],
        totals: r.totals,
      }));
    } else {
      const data = v === 'manager' ? this.teams.value() : this.tribes.value();
      rows = (data?.rows ?? []).map((r) => ({ ...r, link: null }));
    }
    const key = this.sort();
    return rows.sort((a, b) =>
      key === 'name' ? a.name.localeCompare(b.name) : b.totals[key] - a.totals[key],
    );
  });

  protected readonly maxCommits = computed(() =>
    Math.max(1, ...this.rows().map((r) => r.totals.commits)),
  );
}
