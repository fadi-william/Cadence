import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DoraRating } from '@cadence/shared';
import { Icon } from './icon';
import { RatingBadge } from './rating-badge';

const LEVEL: Record<DoraRating, { pct: number; color: string }> = {
  ELITE: { pct: 100, color: 'var(--color-success)' },
  HIGH: { pct: 75, color: 'var(--color-info)' },
  MEDIUM: { pct: 50, color: 'var(--color-warning)' },
  LOW: { pct: 25, color: 'var(--color-error)' },
};

/** One DORA key metric: daisyUI radial-progress showing the performance level, value and rating badge. */
@Component({
  selector: 'app-dora-tile',
  imports: [Icon, RatingBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'surface flex items-center gap-4 p-4 sm:p-5' },
  templateUrl: './dora-tile.html',
})
export class DoraTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly icon = input.required<string>();
  readonly rating = input<DoraRating | null>(null);
  readonly hint = input<string>();
  protected readonly level = computed(() => {
    const r = this.rating();
    return r ? LEVEL[r] : { pct: 0, color: 'var(--color-base-300)' };
  });
}

export const doraKpis = (
  d: {
    deploymentsPerDay: number;
    deployments: number;
    failedDeployments: number;
    leadTimeHoursMedian: number | null;
    changeFailureRate: number | null;
    mttrHours: number | null;
    ratings: Record<
      'deploymentFrequency' | 'leadTime' | 'changeFailureRate' | 'mttr',
      DoraRating | null
    >;
  },
  fmtHours: (h: number | null) => string,
) => [
  {
    label: 'Deployment frequency',
    icon: 'rocket',
    value: `${d.deploymentsPerDay}/day`,
    hint: `${d.deployments - d.failedDeployments} successful deploys`,
    rating: d.ratings.deploymentFrequency,
  },
  {
    label: 'Lead time for changes',
    icon: 'clock',
    value: fmtHours(d.leadTimeHoursMedian),
    hint: 'Median, commit → production',
    rating: d.ratings.leadTime,
  },
  {
    label: 'Change failure rate',
    icon: 'shield',
    value: d.changeFailureRate === null ? '—' : `${Math.round(d.changeFailureRate * 100)}%`,
    hint: `${d.failedDeployments} of ${d.deployments} failed`,
    rating: d.ratings.changeFailureRate,
  },
  {
    label: 'Time to restore',
    icon: 'refresh',
    value: fmtHours(d.mttrHours),
    hint: 'Median, failure → fix',
    rating: d.ratings.mttr,
  },
];
