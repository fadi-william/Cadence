import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { PROVIDER_LABELS, type MemberSourceTotals, type MetricTotals } from '@cadence/shared';
import { ApiService } from '../../core/api.service';
import { DateRange, fmtHours, lastNDays, shortDay } from '../../core/dates';
import { ActivityCalendar } from '../../shared/activity-calendar';
import { Avatar } from '../../shared/avatar';
import { BrandArcs } from '../../shared/brand-arcs';
import { Chart, ChartSpec } from '../../shared/chart';
import { DateRangePicker } from '../../shared/date-range';
import { Icon } from '../../shared/icon';
import { ProviderIcon } from '../../shared/provider-icon';
import { StatCard } from '../../shared/stat-card';

/** Count of "things done" used for the combined activity score and platform share. */
const activity = (
  t: Pick<MetricTotals, 'commits' | 'prsRaised' | 'prsReviewed' | 'issuesCompleted'>,
) => t.commits + t.prsRaised + t.prsReviewed + t.issuesCompleted;

/** One combined view of an individual: Azure DevOps + Jira merged into a single scorecard and timeline. */
@Component({
  selector: 'app-member-detail-page',
  imports: [
    RouterLink,
    ActivityCalendar,
    Avatar,
    BrandArcs,
    Chart,
    DateRangePicker,
    Icon,
    ProviderIcon,
    StatCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './member-detail.page.html',
})
export class MemberDetailPage {
  private readonly api = inject(ApiService);
  readonly id = input.required<string>();
  protected readonly labels = PROVIDER_LABELS;
  protected readonly range = signal<DateRange>(lastNDays(30));

  protected readonly member = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.member(params),
  });
  protected readonly metrics = resource({
    params: () => ({ id: this.id(), ...this.range() }),
    loader: ({ params }) => this.api.memberMetrics(params.id, params.from, params.to),
  });
  private readonly sixMonths = resource({
    params: () => ({ id: this.id(), ...lastNDays(182) }),
    loader: ({ params }) => this.api.memberMetrics(params.id, params.from, params.to),
  });

  private readonly days = computed(() => this.metrics.value()?.days ?? []);

  protected readonly kpis = computed(() => {
    const m = this.metrics.value();
    if (!m) return [];
    const t = m.totals;
    const p = m.previous;
    const d = this.days();
    return [
      {
        label: 'Commits',
        icon: 'commit',
        color: 'primary' as const,
        value: t.commits,
        current: t.commits,
        previous: p.commits,
        invert: false,
        hint: 'Azure DevOps',
        series: d.map((x) => x.commits),
      },
      {
        label: 'Pull requests',
        icon: 'merge',
        color: 'secondary' as const,
        value: `${t.prsMerged} / ${t.prsRaised}`,
        current: t.prsMerged,
        previous: p.prsMerged,
        invert: false,
        hint: 'merged / raised',
        series: d.map((x) => x.prsMerged),
      },
      {
        label: 'Reviews',
        icon: 'eye',
        color: 'accent' as const,
        value: t.prsReviewed,
        current: t.prsReviewed,
        previous: p.prsReviewed,
        invert: false,
        hint: 'PRs reviewed for others',
        series: d.map((x) => x.prsReviewed),
      },
      {
        label: 'Issues done',
        icon: 'ticket',
        color: 'info' as const,
        value: t.issuesCompleted,
        current: t.issuesCompleted,
        previous: p.issuesCompleted,
        invert: false,
        hint: `${t.storyPoints} pts · cycle ${fmtHours(t.cycleTimeHoursAvg)}`,
        series: d.map((x) => x.issuesCompleted),
      },
    ];
  });

  protected readonly timeline = computed<ChartSpec>(() => ({
    categories: this.days().map((d) => shortDay(d.date)),
    series: [
      {
        name: 'Commits',
        type: 'bar',
        data: this.days().map((d) => d.commits),
        color: 'primary',
        stack: 'code',
      },
      {
        name: 'PRs raised',
        type: 'bar',
        data: this.days().map((d) => d.prsRaised),
        color: 'secondary',
        stack: 'code',
      },
      {
        name: 'Reviews',
        type: 'bar',
        data: this.days().map((d) => d.prsReviewed),
        color: 'accent',
        stack: 'code',
      },
      {
        name: 'Issues done',
        type: 'line',
        data: this.days().map((d) => d.issuesCompleted),
        color: 'info',
        area: true,
      },
    ],
  }));

  protected readonly sources = computed(() => {
    const list: MemberSourceTotals[] = this.metrics.value()?.sources ?? [];
    const total = Math.max(
      1,
      list.reduce((n, s) => n + activity(s.totals), 0),
    );
    return list.map((s) => ({
      ...s,
      share: Math.round((activity(s.totals) / total) * 100),
      numbers:
        s.provider === 'JIRA'
          ? [
              { label: 'Issues', value: s.totals.issuesCompleted },
              { label: 'Points', value: s.totals.storyPoints },
              { label: 'Cycle', value: fmtHours(s.totals.cycleTimeHoursAvg) },
              { label: 'Assignments', value: s.totals.assignmentsCompleted },
              { label: 'Hold', value: fmtHours(s.totals.holdTimeHoursAvg) },
              { label: 'Rework', value: s.totals.assignmentsReworked },
            ]
          : [
              { label: 'Commits', value: s.totals.commits },
              { label: 'PRs', value: s.totals.prsRaised },
              { label: 'Reviews', value: s.totals.prsReviewed },
            ],
    }));
  });

  protected readonly calendar = computed(() =>
    this.sixMonths.value()?.days.map((d) => ({ date: d.date, value: activity(d) })),
  );
}
