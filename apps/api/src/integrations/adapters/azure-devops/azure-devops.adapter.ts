import { Injectable, Logger } from '@nestjs/common';
import type { ProviderDescriptorDto } from '@cadence/shared';
import { IntegrationProvider } from '../../../generated/prisma/enums';
import { httpJson, limiter, toDay } from '../../../common/http/http';
import {
  ActivityRecord,
  AdapterContext,
  DateRange,
  DeploymentRecord,
  DeploymentsAdapter,
  ExternalUser,
  IdentityRef,
  SourceControlAdapter,
  dayAfter,
  hoursBetween,
  listConfig,
  stringConfig,
  trimSlash,
} from '../adapter.types';

const API = 'api-version=7.1';

interface AdoList<T> {
  value: T[];
  count: number;
}
interface AdoIdentityRef {
  id: string;
  uniqueName?: string;
  displayName?: string;
}
interface AdoCommit {
  commitId: string;
  author: { email: string; date: string };
}
interface AdoPullRequest {
  pullRequestId: number;
  status: 'active' | 'abandoned' | 'completed';
  createdBy: AdoIdentityRef;
  creationDate: string;
  closedDate?: string;
  repository: { id: string };
}
interface AdoBuild {
  id: number;
  definition: { id: number; name: string };
  result?: 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled' | 'none';
  startTime?: string;
  finishTime?: string;
  sourceVersion?: string;
  repository?: { id: string; type: string };
}
interface AdoThread {
  properties?: Record<string, { $value: string }>;
  comments: { author: AdoIdentityRef; publishedDate: string; commentType: string }[];
}

/**
 * Azure DevOps Services (dev.azure.com) and Azure DevOps Server.
 * Metrics per member/day: commits, PRs raised, PRs merged, PRs reviewed
 * (distinct PRs on which the member voted or commented, excluding their own).
 */
@Injectable()
export class AzureDevOpsAdapter implements SourceControlAdapter, DeploymentsAdapter {
  readonly provider = IntegrationProvider.AZURE_DEVOPS;
  private readonly logger = new Logger(AzureDevOpsAdapter.name);

  describe(): ProviderDescriptorDto {
    return {
      provider: 'AZURE_DEVOPS',
      label: 'Azure DevOps',
      capabilities: ['SOURCE_CONTROL', 'DEPLOYMENTS'],
      secretLabel: 'Personal access token',
      secretHelp:
        'User settings → Personal access tokens. Scopes: Code (Read), Build (Read), Identity (Read), Project & Team (Read).',
      identityHint: 'uniqueName — usually the user’s sign-in e-mail',
      baseUrlHint: 'https://dev.azure.com/your-org',
      webhookInstructions:
        'Project settings → Service hooks → Web Hooks. Events: Code pushed, Pull request created/updated/merged, ' +
        'Build completed. URL: the Cadence webhook URL. HTTP headers: "X-Cadence-Token: <secret>".',
      configFields: [
        {
          key: 'projects',
          label: 'Projects (optional)',
          type: 'list',
          placeholder: 'Platform, Mobile',
          help: 'Leave empty to scan every project in the organisation.',
        },
        {
          key: 'deploymentPipelines',
          label: 'Deployment pipelines (optional)',
          type: 'list',
          placeholder: 'api-deploy, web-release',
          help: 'Pipeline names that deploy to production. Empty = pipelines whose name contains deploy/release/prod/cd.',
        },
        {
          key: 'deploymentEnvironment',
          label: 'Environment label',
          type: 'text',
          placeholder: 'production',
        },
      ],
    };
  }

  private headers(ctx: AdapterContext) {
    return { Authorization: `Basic ${Buffer.from(`:${ctx.secret}`).toString('base64')}` };
  }

  private get<T>(ctx: AdapterContext, url: string) {
    return httpJson<T>(url, { headers: this.headers(ctx) });
  }

  /** Identity API lives on vssps.dev.azure.com for Services, on the collection URL for Server. */
  private identityBase(ctx: AdapterContext) {
    const url = new URL(trimSlash(ctx.baseUrl));
    if (url.hostname === 'dev.azure.com') return `https://vssps.dev.azure.com${url.pathname}`;
    return trimSlash(ctx.baseUrl);
  }

  async testConnection(ctx: AdapterContext) {
    try {
      const res = await httpJson<AdoList<{ name: string }>>(
        `${trimSlash(ctx.baseUrl)}/_apis/projects?$top=100&${API}`,
        {
          headers: this.headers(ctx),
          retries: 0,
        },
      );
      return { ok: true, message: `Connected — ${res.count} project(s) visible` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async searchUsers(ctx: AdapterContext, query: string): Promise<ExternalUser[]> {
    const res = await this.get<
      AdoList<{ id: string; providerDisplayName: string; properties?: { Account?: { $value: string } } }>
    >(
      ctx,
      `${this.identityBase(ctx)}/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(query)}&${API}`,
    );
    return res.value.map((i) => ({
      username: i.properties?.Account?.$value ?? i.providerDisplayName,
      displayName: i.providerDisplayName,
      externalId: i.id,
    }));
  }

  private async projects(ctx: AdapterContext): Promise<string[]> {
    const configured = listConfig(ctx, 'projects');
    if (configured.length) return configured;
    const res = await this.get<AdoList<{ name: string }>>(
      ctx,
      `${trimSlash(ctx.baseUrl)}/_apis/projects?$top=500&${API}`,
    );
    return res.value.map((p) => p.name);
  }

  private async pagedPullRequests(ctx: AdapterContext, project: string, query: string) {
    const out: AdoPullRequest[] = [];
    for (let skip = 0; ; skip += 500) {
      const page = await this.get<AdoList<AdoPullRequest>>(
        ctx,
        `${trimSlash(ctx.baseUrl)}/${encodeURIComponent(project)}/_apis/git/pullrequests?${query}&$top=500&$skip=${skip}&${API}`,
      );
      out.push(...page.value);
      if (page.value.length < 500) return out;
    }
  }

  webhookDates(body: unknown): string[] {
    const created = (body as { createdDate?: string }).createdDate;
    return created ? [toDay(created)] : [];
  }

  /**
   * Production deployments = completed runs of deployment pipelines. Lead time is measured from the
   * author date of the built commit (Azure Repos only) to the run's finish time.
   */
  async fetchDeployments(ctx: AdapterContext, range: DateRange): Promise<DeploymentRecord[]> {
    const base = trimSlash(ctx.baseUrl);
    const wanted = new Set(listConfig(ctx, 'deploymentPipelines').map((n) => n.toLowerCase()));
    const isDeployPipeline = (name: string) =>
      wanted.size ? wanted.has(name.toLowerCase()) : /deploy|release|prod|\bcd\b/i.test(name);
    const environment = stringConfig(ctx, 'deploymentEnvironment', 'production');
    const limit = limiter(4);
    const out: DeploymentRecord[] = [];

    for (const project of await this.projects(ctx)) {
      const p = encodeURIComponent(project);
      const builds = await this.get<AdoList<AdoBuild>>(
        ctx,
        `${base}/${p}/_apis/build/builds?minTime=${range.from.toISOString()}&maxTime=${dayAfter(range.to).toISOString()}` +
          `&statusFilter=completed&queryOrder=finishTimeAscending&$top=5000&${API}`,
      );
      const relevant = builds.value.filter(
        (b) =>
          b.finishTime &&
          isDeployPipeline(b.definition.name) &&
          (b.result === 'succeeded' || b.result === 'partiallySucceeded' || b.result === 'failed'),
      );
      await Promise.all(
        relevant.map((b) =>
          limit(async () => {
            let leadTimeHours: number | null = null;
            if (b.sourceVersion && b.repository?.type === 'TfsGit' && b.result !== 'failed') {
              const commit = await this.get<{ author: { date: string } }>(
                ctx,
                `${base}/${p}/_apis/git/repositories/${b.repository.id}/commits/${b.sourceVersion}?${API}`,
              ).catch(() => null);
              if (commit) leadTimeHours = Math.max(0, hoursBetween(commit.author.date, b.finishTime!));
            }
            out.push({
              externalId: String(b.id),
              service: `${project}/${b.definition.name}`,
              environment,
              status: b.result === 'failed' ? 'FAILED' : 'SUCCESS',
              startedAt: b.startTime ?? null,
              finishedAt: b.finishTime!,
              leadTimeHours,
            });
          }),
        ),
      );
    }
    return out.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  }

  async fetchCodeActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange) {
    if (!identities.length) return [];
    const base = trimSlash(ctx.baseUrl);
    const byName = new Map(identities.map((i) => [i.username.toLowerCase(), i.memberId]));
    const match = (ref?: { uniqueName?: string; email?: string }) =>
      byName.get((ref?.uniqueName ?? ref?.email ?? '').toLowerCase());
    const fromIso = range.from.toISOString();
    const toIso = dayAfter(range.to).toISOString();
    const inRange = (d?: string) => !!d && d >= fromIso && d < toIso;
    const limit = limiter(4);
    const out: ActivityRecord[] = [];

    for (const project of await this.projects(ctx)) {
      const p = encodeURIComponent(project);

      // ---- Commits (per repository, then matched by author e-mail) ----
      const repos = await this.get<AdoList<{ id: string; name: string; isDisabled?: boolean }>>(
        ctx,
        `${base}/${p}/_apis/git/repositories?${API}`,
      );
      await Promise.all(
        repos.value
          .filter((r) => !r.isDisabled)
          .map((repo) =>
            limit(async () => {
              for (let skip = 0; ; skip += 1000) {
                const page = await this.get<AdoList<AdoCommit>>(
                  ctx,
                  `${base}/${p}/_apis/git/repositories/${repo.id}/commits?searchCriteria.fromDate=${fromIso}` +
                    `&searchCriteria.toDate=${toIso}&searchCriteria.$top=1000&searchCriteria.$skip=${skip}&${API}`,
                ).catch((e) => {
                  this.logger.warn(`Skipping repo ${repo.name}: ${(e as Error).message}`);
                  return { value: [], count: 0 };
                });
                for (const c of page.value) {
                  const memberId = match(c.author);
                  if (memberId && inRange(c.author.date))
                    out.push({ memberId, date: toDay(c.author.date), commits: 1 });
                }
                if (page.value.length < 1000) break;
              }
            }),
          ),
      );

      // ---- Pull requests: created in range, closed in range, and still active ----
      const timeQ = (type: string) =>
        `searchCriteria.status=all&searchCriteria.queryTimeRangeType=${type}` +
        `&searchCriteria.minTime=${fromIso}&searchCriteria.maxTime=${toIso}`;
      const [created, closed, active] = await Promise.all([
        this.pagedPullRequests(ctx, project, timeQ('created')),
        this.pagedPullRequests(ctx, project, timeQ('closed')),
        this.pagedPullRequests(ctx, project, 'searchCriteria.status=active'),
      ]);
      const prs = new Map<number, AdoPullRequest>();
      for (const pr of [...created, ...closed, ...active]) prs.set(pr.pullRequestId, pr);

      for (const pr of prs.values()) {
        const author = match(pr.createdBy);
        if (author && inRange(pr.creationDate))
          out.push({ memberId: author, date: toDay(pr.creationDate), prsRaised: 1 });
        if (author && pr.status === 'completed' && inRange(pr.closedDate)) {
          out.push({ memberId: author, date: toDay(pr.closedDate!), prsMerged: 1 });
        }
      }

      // ---- Reviews: votes + human comments in range by someone other than the author ----
      await Promise.all(
        [...prs.values()].map((pr) =>
          limit(async () => {
            const threads = await this.get<AdoList<AdoThread>>(
              ctx,
              `${base}/${p}/_apis/git/repositories/${pr.repository.id}/pullRequests/${pr.pullRequestId}/threads?${API}`,
            ).catch(() => ({ value: [], count: 0 }));
            const seen = new Set<string>(); // memberId|day → count each PR once per reviewer per day
            for (const t of threads.value) {
              const isVote = t.properties?.['CodeReviewThreadType']?.$value === 'VoteUpdate';
              for (const c of t.comments) {
                if (!isVote && c.commentType !== 'text') continue;
                const reviewer = match(c.author);
                if (!reviewer || c.author.uniqueName === pr.createdBy.uniqueName || !inRange(c.publishedDate)) continue;
                const key = `${reviewer}|${toDay(c.publishedDate)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ memberId: reviewer, date: toDay(c.publishedDate), prsReviewed: 1 });
              }
            }
          }),
        ),
      );
    }
    return out;
  }
}
