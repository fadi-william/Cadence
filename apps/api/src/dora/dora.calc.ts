import type { DoraRating } from '@cadence/shared';

export interface DeploymentPoint {
  serviceId: string;
  status: 'SUCCESS' | 'FAILED';
  finishedAt: Date;
  leadTimeHours: number | null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/**
 * Time to restore: per service, from the first failed deployment of an incident to the next
 * successful deployment of the same service. Returns the median duration in hours.
 */
export function timeToRestoreHours(deployments: DeploymentPoint[]): number | null {
  const byService = new Map<string, DeploymentPoint[]>();
  for (const d of deployments) byService.set(d.serviceId, [...(byService.get(d.serviceId) ?? []), d]);
  const durations: number[] = [];
  for (const list of byService.values()) {
    list.sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime());
    let failedAt: Date | null = null;
    for (const d of list) {
      if (d.status === 'FAILED' && !failedAt) failedAt = d.finishedAt;
      else if (d.status === 'SUCCESS' && failedAt) {
        durations.push((d.finishedAt.getTime() - failedAt.getTime()) / 36e5);
        failedAt = null;
      }
    }
  }
  return median(durations);
}

/** Thresholds follow the DORA State of DevOps performance clusters. */
export const rate = {
  deploymentFrequency(perDay: number, deployments: number): DoraRating | null {
    if (!deployments) return null;
    if (perDay >= 1) return 'ELITE';
    if (perDay >= 1 / 7) return 'HIGH';
    if (perDay >= 1 / 30) return 'MEDIUM';
    return 'LOW';
  },
  leadTime(hours: number | null): DoraRating | null {
    if (hours === null) return null;
    if (hours < 24) return 'ELITE';
    if (hours < 24 * 7) return 'HIGH';
    if (hours < 24 * 30) return 'MEDIUM';
    return 'LOW';
  },
  changeFailureRate(rate: number | null): DoraRating | null {
    if (rate === null) return null;
    if (rate <= 0.05) return 'ELITE';
    if (rate <= 0.1) return 'HIGH';
    if (rate <= 0.15) return 'MEDIUM';
    return 'LOW';
  },
  mttr(hours: number | null): DoraRating | null {
    if (hours === null) return null;
    if (hours < 1) return 'ELITE';
    if (hours < 24) return 'HIGH';
    if (hours < 24 * 7) return 'MEDIUM';
    return 'LOW';
  },
};
