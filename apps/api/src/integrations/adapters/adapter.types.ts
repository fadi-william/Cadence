import { createHmac } from 'node:crypto';
import type { ProviderDescriptorDto } from '@cadence/shared';
import { safeEqual } from '../../common/crypto/tokens';
import { IntegrationProvider } from '../../generated/prisma/enums';

/**
 * Ports for external delivery platforms. To add a platform (e.g. GitHub, GitLab, Linear):
 *   1. implement WorkTrackingAdapter, SourceControlAdapter and/or DeploymentsAdapter
 *   2. add the provider to the Prisma enum + shared enum
 *   3. register the class in integrations.module.ts (INTEGRATION_ADAPTERS)
 */

export const INTEGRATION_ADAPTERS = Symbol('INTEGRATION_ADAPTERS');

export interface AdapterContext {
  baseUrl: string;
  config: Record<string, unknown>;
  /** Decrypted credential (API token / PAT). */
  secret: string;
}

export interface IdentityRef {
  memberId: string;
  username: string;
  externalId?: string | null;
}

/** Inclusive UTC date range. */
export interface DateRange {
  from: Date;
  to: Date;
}

/** Normalised activity for one member on one UTC day. All counters are additive. */
export interface ActivityRecord {
  memberId: string;
  date: string; // YYYY-MM-DD
  commits?: number;
  prsRaised?: number;
  prsReviewed?: number;
  prsMerged?: number;
  issuesCompleted?: number;
  /**
   * The completed work item this record credits (with issuesCompleted: 1). Several people can be
   * credited with the same item; team totals count each key once.
   */
  workItemKey?: string;
  storyPoints?: number;
  cycleTimeHours?: number[];
  /** Assignments (periods one person held a work item) that ended this day with a stage move. */
  assignmentsCompleted?: number;
  /** Assignments that ended this day by reassignment without a stage move. */
  assignmentsHandedOver?: number;
  /** Ended assignments where the person had already held the same item before. */
  assignmentsReworked?: number;
  /** Hold time (calendar hours) of each completed assignment. */
  holdHours?: number[];
}

export interface ExternalUser {
  username: string;
  displayName: string;
  email?: string;
  externalId?: string;
}

/** A production deployment of one service (pipeline / repository), normalised across CI/CD platforms. */
export interface DeploymentRecord {
  externalId: string;
  service: string;
  environment: string;
  status: 'SUCCESS' | 'FAILED';
  startedAt?: string | null;
  finishedAt: string;
  /** Hours from the deployed commit's authoring time to the deployment finishing. */
  leadTimeHours?: number | null;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: unknown;
}

export interface IntegrationAdapter {
  readonly provider: IntegrationProvider;
  describe(): ProviderDescriptorDto;
  testConnection(ctx: AdapterContext): Promise<{ ok: boolean; message?: string }>;
  searchUsers?(ctx: AdapterContext, query: string): Promise<ExternalUser[]>;
  /** Provider-native signature check (e.g. HMAC). Falls back to the X-Cadence-Token header when absent/false. */
  verifyWebhook?(req: WebhookRequest, secret: string): boolean;
  /** UTC days (YYYY-MM-DD) touched by a webhook event, so only those get re-synced. Defaults to today. */
  webhookDates?(body: unknown): string[];
}

export interface WorkTrackingAdapter extends IntegrationAdapter {
  fetchWorkItemActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange): Promise<ActivityRecord[]>;
}

export interface SourceControlAdapter extends IntegrationAdapter {
  fetchCodeActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange): Promise<ActivityRecord[]>;
}

export interface DeploymentsAdapter extends IntegrationAdapter {
  fetchDeployments(ctx: AdapterContext, range: DateRange): Promise<DeploymentRecord[]>;
}

export const isDeployments = (a: IntegrationAdapter): a is DeploymentsAdapter =>
  typeof (a as DeploymentsAdapter).fetchDeployments === 'function';

export const isWorkTracking = (a: IntegrationAdapter): a is WorkTrackingAdapter =>
  typeof (a as WorkTrackingAdapter).fetchWorkItemActivity === 'function';

export const isSourceControl = (a: IntegrationAdapter): a is SourceControlAdapter =>
  typeof (a as SourceControlAdapter).fetchCodeActivity === 'function';

export const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** Exclusive end of an inclusive date range, i.e. the day after `to`. */
export const dayAfter = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));

export const header = (req: WebhookRequest, name: string): string | undefined => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** Verifies `<prefix><hex hmac-sha256(rawBody)>` signatures (Jira style). */
export function verifyHmacSha256(req: WebhookRequest, headerName: string, secret: string, prefix = 'sha256=') {
  const sig = header(req, headerName);
  if (!sig) return false;
  const expected = prefix + createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(sig, expected);
}

export const hoursBetween = (from: string | Date, to: string | Date) =>
  (new Date(to).getTime() - new Date(from).getTime()) / 36e5;

/** Splits an inclusive range into windows of at most `days` days. */
export function chunkRange(range: DateRange, days: number): DateRange[] {
  const out: DateRange[] = [];
  let start = new Date(range.from);
  while (start <= range.to) {
    const end = new Date(Math.min(start.getTime() + (days - 1) * 864e5, range.to.getTime()));
    out.push({ from: start, to: end });
    start = new Date(end.getTime() + 864e5);
  }
  return out;
}

/** Reads a string[] config value that may arrive as a list or comma-separated string. */
export function listConfig(ctx: AdapterContext, key: string): string[] {
  const v = ctx.config[key];
  if (Array.isArray(v))
    return v
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

export function stringConfig(ctx: AdapterContext, key: string, fallback = ''): string {
  const v = ctx.config[key];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}
