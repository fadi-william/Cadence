// Shared contracts between @cadence/api and @cadence/web.
// String values intentionally mirror the Prisma enums in apps/api/prisma/schema.prisma.

export const UserRole = {
  ADMIN: 'ADMIN',
  TRIBE_LEAD: 'TRIBE_LEAD',
  ENGINEERING_MANAGER: 'ENGINEERING_MANAGER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const IntegrationProvider = {
  JIRA: 'JIRA',
  AZURE_DEVOPS: 'AZURE_DEVOPS',
} as const;
export type IntegrationProvider = (typeof IntegrationProvider)[keyof typeof IntegrationProvider];

export const IntegrationKind = {
  WORK_TRACKING: 'WORK_TRACKING',
  SOURCE_CONTROL: 'SOURCE_CONTROL',
  DEPLOYMENTS: 'DEPLOYMENTS',
} as const;
export type IntegrationKind = (typeof IntegrationKind)[keyof typeof IntegrationKind];

export const SyncStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  TRIBE_LEAD: 'Tribe Lead',
  ENGINEERING_MANAGER: 'Engineering Manager',
};

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  JIRA: 'Jira',
  AZURE_DEVOPS: 'Azure DevOps',
};

export const KIND_LABELS: Record<IntegrationKind, string> = {
  WORK_TRACKING: 'Work tracking',
  SOURCE_CONTROL: 'Source control',
  DEPLOYMENTS: 'Deployments',
};

// ---------- Setup & auth ----------

export interface SetupStatusDto {
  needsSetup: boolean;
  adminEmail: string | null;
  /** When true, /setup/complete requires the one-time token printed in the API log. */
  tokenRequired: boolean;
}

export interface CompleteSetupDto {
  name: string;
  email: string;
  password: string;
  setupToken?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  reportsToId: string | null;
  tribeName: string | null;
}

/** The refresh token travels in an httpOnly cookie, never in the body. */
export interface AuthResponseDto {
  accessToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: AuthUserDto;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  password: string;
}

export interface ResetLinkDto {
  url: string;
  expiresAt: string;
  /** True when the link was also e-mailed to the user. */
  emailed: boolean;
}

// ---------- Users (tribe leads / engineering managers) ----------

export interface UserDto extends AuthUserDto {
  createdAt: string;
  reportsTo?: { id: string; name: string } | null;
  _count?: { reports: number; members: number };
}

export interface CreateUserDto {
  email: string;
  name: string;
  role: Exclude<UserRole, 'ADMIN'>;
  password: string;
  reportsToId?: string;
  tribeName?: string;
}

export type UpdateUserDto = Partial<Omit<CreateUserDto, 'role'>>;

// ---------- Members ----------

export interface ExternalIdentityDto {
  id: string;
  connectionId: string;
  provider: IntegrationProvider;
  connectionName: string;
  username: string;
  displayName: string | null;
}

export interface MemberDto {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  managerId: string;
  manager?: { id: string; name: string };
  identities: ExternalIdentityDto[];
  createdAt: string;
}

export interface CreateMemberDto {
  name: string;
  email?: string;
  title?: string;
  managerId: string;
}

export type UpdateMemberDto = Partial<CreateMemberDto>;

export interface UpsertIdentityDto {
  username: string;
  displayName?: string;
}

// ---------- Org tree ----------

export interface OrgTreeMember {
  id: string;
  name: string;
  title: string | null;
}
export interface OrgTreeManager {
  id: string;
  name: string;
  email: string;
  members: OrgTreeMember[];
}
export interface OrgTreeTribeLead {
  id: string;
  name: string;
  email: string;
  tribeName: string | null;
  managers: OrgTreeManager[];
}
export interface OrgTreeDto {
  tribeLeads: OrgTreeTribeLead[];
}

// ---------- Integrations ----------

export interface ProviderConfigField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'select' | 'list';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface ProviderDescriptorDto {
  provider: IntegrationProvider;
  label: string;
  capabilities: IntegrationKind[];
  configFields: ProviderConfigField[];
  secretLabel: string;
  secretHelp?: string;
  identityHint: string;
  defaultBaseUrl?: string;
  baseUrlHint: string;
  /** How to configure the platform to call Cadence's webhook URL. */
  webhookInstructions?: string;
}

export interface ExternalUserDto {
  username: string;
  displayName: string;
  email?: string;
  externalId?: string;
}

export interface WebhookInfoDto {
  url: string;
  configured: boolean;
  /** Only returned right after (re)generating. */
  secret?: string;
}

export interface IntegrationConnectionDto {
  id: string;
  name: string;
  provider: IntegrationProvider;
  baseUrl: string;
  config: Record<string, unknown>;
  enabled: boolean;
  hasSecret: boolean;
  webhookConfigured: boolean;
  createdAt: string;
  lastSync?: SyncRunDto | null;
}

export interface CreateIntegrationDto {
  name: string;
  provider: IntegrationProvider;
  baseUrl: string;
  config?: Record<string, unknown>;
  secret: string;
  enabled?: boolean;
}

export type UpdateIntegrationDto = Partial<Omit<CreateIntegrationDto, 'provider'>>;

export interface TestConnectionResultDto {
  ok: boolean;
  message?: string;
}

export interface SyncRunDto {
  id: string;
  connectionId: string;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string | null;
  rangeFrom: string;
  rangeTo: string;
  recordsWritten: number;
  trigger: string;
  error: string | null;
}

// ---------- Metrics ----------

export interface DailyMetricDto {
  date: string; // YYYY-MM-DD
  commits: number;
  prsRaised: number;
  prsReviewed: number;
  prsMerged: number;
  issuesCompleted: number;
  storyPoints: number;
  cycleTimeHoursAvg: number | null;
  /** Assignments that ended with a stage move (moved forward or Done). */
  assignmentsCompleted: number;
  /** Assignments that ended by reassignment without a stage move. */
  assignmentsHandedOver: number;
  /** Ended assignments by someone who had already held the same item (rework). */
  assignmentsReworked: number;
  /** Average calendar hours a completed assignment was held. */
  holdTimeHoursAvg: number | null;
}

export interface MetricTotals {
  commits: number;
  prsRaised: number;
  prsReviewed: number;
  prsMerged: number;
  issuesCompleted: number;
  storyPoints: number;
  cycleTimeHoursAvg: number | null;
  /** Assignments that ended with a stage move (moved forward or Done). */
  assignmentsCompleted: number;
  /** Assignments that ended by reassignment without a stage move. */
  assignmentsHandedOver: number;
  /** Ended assignments by someone who had already held the same item (rework). */
  assignmentsReworked: number;
  /** Average calendar hours a completed assignment was held. */
  holdTimeHoursAvg: number | null;
}

/** One platform's contribution to a person's combined numbers. */
export interface MemberSourceTotals {
  connectionId: string;
  connectionName: string;
  provider: IntegrationProvider;
  username: string | null;
  totals: MetricTotals;
}

/** Combined (Jira + Azure DevOps) view of one individual. */
export interface MemberMetricsDto {
  memberId: string;
  from: string;
  to: string;
  totals: MetricTotals;
  /** Same-length window immediately before `from`, for trend deltas. */
  previous: MetricTotals;
  sources: MemberSourceTotals[];
  days: DailyMetricDto[];
}

export interface MetricsSummaryRow {
  memberId: string;
  memberName: string;
  managerName: string;
  totals: MetricTotals;
}

export interface MetricsSummaryDto {
  from: string;
  to: string;
  totals: MetricTotals;
  /** Same-length window immediately before `from`. */
  previous: MetricTotals;
  rows: MetricsSummaryRow[];
}

export interface MetricsTrendPoint extends DailyMetricDto {}

export type RollupGroupBy = 'manager' | 'tribe';

export interface RollupRow {
  id: string;
  name: string;
  /** Tribe name for a manager row; tribe lead name for a tribe row. */
  subtitle: string | null;
  memberCount: number;
  totals: MetricTotals;
}

export interface RollupDto {
  from: string;
  to: string;
  groupBy: RollupGroupBy;
  rows: RollupRow[];
  /** Per-day totals across the whole visible scope. */
  trend: DailyMetricDto[];
}

// ---------- DORA ----------

export type DoraRating = 'ELITE' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface DoraServiceRow {
  id: string;
  name: string;
  connectionName: string;
  managerId: string | null;
  managerName: string | null;
  deployments: number;
  failures: number;
  leadTimeHoursMedian: number | null;
}

export interface DoraSummaryDto {
  from: string;
  to: string;
  deployments: number;
  failedDeployments: number;
  deploymentsPerDay: number;
  changeFailureRate: number | null;
  leadTimeHoursMedian: number | null;
  mttrHours: number | null;
  ratings: {
    deploymentFrequency: DoraRating | null;
    leadTime: DoraRating | null;
    changeFailureRate: DoraRating | null;
    mttr: DoraRating | null;
  };
  daily: { date: string; deployments: number; failures: number }[];
  services: DoraServiceRow[];
}

export interface DeliveryServiceDto {
  id: string;
  name: string;
  connectionId: string;
  connectionName: string;
  provider: IntegrationProvider;
  managerId: string | null;
  managerName: string | null;
  deploymentCount: number;
}

// ---------- Audit ----------

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditPageDto {
  items: AuditLogDto[];
  nextCursor: string | null;
}
