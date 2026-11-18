import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AuditPageDto,
  AuthResponseDto,
  AuthUserDto,
  ChangePasswordDto,
  CompleteSetupDto,
  CreateIntegrationDto,
  CreateMemberDto,
  CreateUserDto,
  DeliveryServiceDto,
  DoraSummaryDto,
  ExternalUserDto,
  IntegrationConnectionDto,
  LoginDto,
  MemberDto,
  MemberMetricsDto,
  MetricsSummaryDto,
  OrgTreeDto,
  ProviderDescriptorDto,
  ResetLinkDto,
  RollupDto,
  RollupGroupBy,
  SetupStatusDto,
  SyncRunDto,
  TestConnectionResultDto,
  UpdateIntegrationDto,
  UpdateMemberDto,
  UpdateUserDto,
  UpsertIdentityDto,
  UserDto,
  UserRole,
  WebhookInfoDto,
} from '@cadence/shared';

type Params = Record<string, string | number | undefined | null>;

/** Thin, promise-based client for the Cadence API (proxied at /api in dev). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  private params(params?: Params) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {}))
      if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return p;
  }
  private get<T>(path: string, params?: Params) {
    return firstValueFrom(this.http.get<T>(this.base + path, { params: this.params(params) }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(this.base + path, body, { withCredentials: true }));
  }
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(this.base + path, body));
  }
  private patch<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(this.base + path, body));
  }
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(this.base + path));
  }

  // setup & auth
  setupStatus = () => this.get<SetupStatusDto>('/setup/status');
  completeSetup = (dto: CompleteSetupDto) => this.post<AuthResponseDto>('/setup/complete', dto);
  login = (dto: LoginDto) => this.post<AuthResponseDto>('/auth/login', dto);
  refresh = () => this.post<AuthResponseDto>('/auth/refresh');
  logout = () => this.post<void>('/auth/logout');
  me = () => this.get<AuthUserDto>('/auth/me');
  changePassword = (dto: ChangePasswordDto) =>
    this.post<AuthResponseDto>('/auth/change-password', dto);
  forgotPassword = (email: string) =>
    this.post<{ ok: boolean }>('/auth/forgot-password', { email });
  resetPassword = (token: string, password: string) =>
    this.post<void>('/auth/reset-password', { token, password });

  // users
  users = (role?: UserRole) => this.get<UserDto[]>('/users', { role });
  createUser = (dto: CreateUserDto) => this.post<UserDto>('/users', dto);
  updateUser = (id: string, dto: UpdateUserDto) => this.patch<UserDto>(`/users/${id}`, dto);
  deleteUser = (id: string) => this.delete<void>(`/users/${id}`);
  resetLink = (id: string) => this.post<ResetLinkDto>(`/users/${id}/reset-link`);
  orgTree = () => this.get<OrgTreeDto>('/org/tree');

  // members
  members = (managerId?: string) => this.get<MemberDto[]>('/members', { managerId });
  member = (id: string) => this.get<MemberDto>(`/members/${id}`);
  createMember = (dto: CreateMemberDto) => this.post<MemberDto>('/members', dto);
  updateMember = (id: string, dto: UpdateMemberDto) => this.patch<MemberDto>(`/members/${id}`, dto);
  deleteMember = (id: string) => this.delete<void>(`/members/${id}`);
  linkIdentity = (id: string, connectionId: string, dto: UpsertIdentityDto) =>
    this.put<MemberDto>(`/members/${id}/identities/${connectionId}`, dto);
  unlinkIdentity = (id: string, connectionId: string) =>
    this.delete<MemberDto>(`/members/${id}/identities/${connectionId}`);

  // integrations
  providers = () => this.get<ProviderDescriptorDto[]>('/integrations/providers');
  integrations = () => this.get<IntegrationConnectionDto[]>('/integrations');
  createIntegration = (dto: CreateIntegrationDto) =>
    this.post<IntegrationConnectionDto>('/integrations', dto);
  updateIntegration = (id: string, dto: UpdateIntegrationDto) =>
    this.patch<IntegrationConnectionDto>(`/integrations/${id}`, dto);
  deleteIntegration = (id: string) => this.delete<void>(`/integrations/${id}`);
  testIntegration = (id: string) => this.post<TestConnectionResultDto>(`/integrations/${id}/test`);
  syncIntegration = (id: string, days = 14) =>
    this.post<SyncRunDto>(`/integrations/${id}/sync`, { days });
  syncRun = (id: string, runId: string) =>
    this.get<SyncRunDto>(`/integrations/${id}/runs/${runId}`);
  syncRuns = (id: string) => this.get<SyncRunDto[]>(`/integrations/${id}/runs`);
  searchExternalUsers = (id: string, q: string) =>
    this.get<ExternalUserDto[]>(`/integrations/${id}/users`, { q });
  webhook = (id: string) => this.get<WebhookInfoDto>(`/integrations/${id}/webhook`);
  setWebhookSecret = (id: string, secret?: string) =>
    this.post<WebhookInfoDto>(`/integrations/${id}/webhook`, secret ? { secret } : {});
  disableWebhook = (id: string) => this.delete<WebhookInfoDto>(`/integrations/${id}/webhook`);

  // metrics
  summary = (from?: string, to?: string, managerId?: string) =>
    this.get<MetricsSummaryDto>('/metrics/summary', { from, to, managerId });
  rollup = (groupBy: RollupGroupBy, from?: string, to?: string) =>
    this.get<RollupDto>('/metrics/rollup', { groupBy, from, to });
  memberMetrics = (id: string, from?: string, to?: string) =>
    this.get<MemberMetricsDto>(`/metrics/members/${id}`, { from, to });

  // DORA
  dora = (from?: string, to?: string, managerId?: string) =>
    this.get<DoraSummaryDto>('/dora/summary', { from, to, managerId });
  services = () => this.get<DeliveryServiceDto[]>('/dora/services');
  setServiceOwner = (id: string, managerId: string | null) =>
    this.patch<DeliveryServiceDto>(`/dora/services/${id}`, { managerId });

  // audit
  audit = (cursor?: string | null, entityType?: string, limit = 50) =>
    this.get<AuditPageDto>('/audit', { cursor, entityType, limit });
}

/** Extracts a human-readable message from an HttpErrorResponse. */
export function errorMessage(e: unknown): string {
  const err = e as { error?: { message?: string | string[] }; message?: string };
  const m = err?.error?.message ?? err?.message ?? 'Something went wrong';
  return Array.isArray(m) ? m.join(', ') : m;
}
