import { Injectable } from '@nestjs/common';
import type { ProviderDescriptorDto } from '@cadence/shared';
import { IntegrationProvider } from '../../../generated/prisma/enums';
import { httpJson, toDay } from '../../../common/http/http';
import {
  ActivityRecord,
  AdapterContext,
  DateRange,
  ExternalUser,
  IdentityRef,
  WebhookRequest,
  WorkTrackingAdapter,
  dayAfter,
  listConfig,
  stringConfig,
  trimSlash,
  verifyHmacSha256,
} from '../adapter.types';
import { ChangelogHistory, buildAssignments } from './assignments';

interface JiraUser {
  accountId?: string;
  name?: string;
  key?: string;
  emailAddress?: string;
  displayName: string;
}

interface JiraIssue {
  key: string;
  fields: Record<string, unknown> & {
    assignee?: JiraUser | null;
    resolutiondate?: string | null;
    created?: string;
    status?: { id: string } | null;
  };
  changelog?: { histories: ChangelogHistory[]; total?: number; maxResults?: number };
}

/** Jira identifies users by different keys in different places; try them all. */
const userKeys = (u: JiraUser) => [u.accountId, u.name, u.key, u.emailAddress].filter((v): v is string => !!v);

interface JiraSearchPage {
  issues: JiraIssue[];
  nextPageToken?: string; // Cloud /search/jql
  total?: number; // Server/DC /search
  startAt?: number;
  maxResults?: number;
  isLast?: boolean;
}

/**
 * Jira Cloud (REST v3) and Jira Server/Data Center (REST v2).
 * Metrics per member/day: issues completed (resolved), story points, cycle time
 * (first transition into an "In Progress" category status → resolution date), and assignments
 * (see ./assignments.ts): each period one person held an issue, with its hold time.
 */
@Injectable()
export class JiraAdapter implements WorkTrackingAdapter {
  readonly provider = IntegrationProvider.JIRA;

  describe(): ProviderDescriptorDto {
    return {
      provider: 'JIRA',
      label: 'Jira',
      capabilities: ['WORK_TRACKING'],
      secretLabel: 'API token / Personal access token',
      secretHelp: 'Cloud: id.atlassian.com → Security → API tokens. Server/DC: Profile → Personal Access Tokens.',
      identityHint: 'Jira Cloud accountId (or username on Server/DC)',
      baseUrlHint: 'https://your-company.atlassian.net',
      webhookInstructions:
        'Jira settings → System → WebHooks → Create. URL: the Cadence webhook URL. Secret: the generated secret. ' +
        'Events: Issue created/updated. Jira signs requests with X-Hub-Signature.',
      configFields: [
        {
          key: 'deployment',
          label: 'Deployment',
          type: 'select',
          required: true,
          options: [
            { value: 'cloud', label: 'Jira Cloud' },
            { value: 'server', label: 'Server / Data Center' },
          ],
        },
        { key: 'email', label: 'Account e-mail (Cloud only)', type: 'text', placeholder: 'bot@company.com' },
        {
          key: 'storyPointsField',
          label: 'Story points field id',
          type: 'text',
          placeholder: 'customfield_10016',
          help: 'Leave empty to skip story points.',
        },
        { key: 'projects', label: 'Project keys (optional)', type: 'list', placeholder: 'CORE, WEB' },
      ],
    };
  }

  private isCloud(ctx: AdapterContext) {
    return stringConfig(ctx, 'deployment', 'cloud') === 'cloud';
  }

  verifyWebhook(req: WebhookRequest, secret: string) {
    return verifyHmacSha256(req, 'x-hub-signature', secret);
  }

  webhookDates(body: unknown): string[] {
    const b = body as { timestamp?: number; issue?: { fields?: { resolutiondate?: string | null } } };
    const dates = [b.issue?.fields?.resolutiondate, b.timestamp ? new Date(b.timestamp).toISOString() : undefined];
    return dates.filter((d): d is string => !!d).map(toDay);
  }

  private api(ctx: AdapterContext, path: string) {
    return `${trimSlash(ctx.baseUrl)}/rest/api/${this.isCloud(ctx) ? 3 : 2}${path}`;
  }

  private headers(ctx: AdapterContext): Record<string, string> {
    if (this.isCloud(ctx)) {
      const email = stringConfig(ctx, 'email');
      return { Authorization: `Basic ${Buffer.from(`${email}:${ctx.secret}`).toString('base64')}` };
    }
    return { Authorization: `Bearer ${ctx.secret}` };
  }

  async testConnection(ctx: AdapterContext) {
    try {
      const me = await httpJson<JiraUser>(this.api(ctx, '/myself'), { headers: this.headers(ctx), retries: 0 });
      return { ok: true, message: `Authenticated as ${me.displayName}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async searchUsers(ctx: AdapterContext, query: string): Promise<ExternalUser[]> {
    const param = this.isCloud(ctx) ? 'query' : 'username';
    const users = await httpJson<JiraUser[]>(this.api(ctx, `/user/search?${param}=${encodeURIComponent(query)}`), {
      headers: this.headers(ctx),
    });
    return users.map((u) => ({
      username: (u.accountId ?? u.name ?? u.key)!,
      displayName: u.displayName,
      email: u.emailAddress,
      externalId: u.accountId ?? u.key,
    }));
  }

  /** Map of status id → status category key ("new" | "indeterminate" | "done"). */
  private async statusCategories(ctx: AdapterContext) {
    const statuses = await httpJson<{ id: string; statusCategory: { key: string } }[]>(this.api(ctx, '/status'), {
      headers: this.headers(ctx),
    });
    return new Map(statuses.map((s) => [s.id, s.statusCategory.key]));
  }

  private async search(ctx: AdapterContext, jql: string, fields: string[]): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    if (this.isCloud(ctx)) {
      let nextPageToken: string | undefined;
      do {
        const page = await httpJson<JiraSearchPage>(this.api(ctx, '/search/jql'), {
          method: 'POST',
          headers: this.headers(ctx),
          body: { jql, fields, expand: 'changelog', maxResults: 100, nextPageToken },
        });
        issues.push(...page.issues);
        nextPageToken = page.isLast === false || page.nextPageToken ? page.nextPageToken : undefined;
      } while (nextPageToken);
    } else {
      let startAt = 0;
      for (;;) {
        const page = await httpJson<JiraSearchPage>(this.api(ctx, '/search'), {
          method: 'POST',
          headers: this.headers(ctx),
          body: { jql, fields, expand: ['changelog'], startAt, maxResults: 100 },
        });
        issues.push(...page.issues);
        startAt += page.issues.length;
        if (!page.issues.length || startAt >= (page.total ?? 0)) break;
      }
    }
    return issues;
  }

  /** Search results carry at most ~100 changelog entries; fetch the rest when an issue has more. */
  private async fullChangelog(ctx: AdapterContext, issue: JiraIssue): Promise<ChangelogHistory[]> {
    const cl = issue.changelog;
    const have = cl?.histories ?? [];
    if (!cl || cl.total === undefined || cl.total <= have.length) return have;
    if (!this.isCloud(ctx)) {
      const full = await httpJson<JiraIssue>(this.api(ctx, `/issue/${issue.key}?expand=changelog&fields=none`), {
        headers: this.headers(ctx),
      });
      return full.changelog?.histories ?? have;
    }
    const out: ChangelogHistory[] = [];
    for (let startAt = 0; ;) {
      const page = await httpJson<{ values: ChangelogHistory[]; isLast?: boolean; total?: number }>(
        this.api(ctx, `/issue/${issue.key}/changelog?startAt=${startAt}&maxResults=100`),
        { headers: this.headers(ctx) },
      );
      out.push(...page.values);
      startAt += page.values.length;
      if (!page.values.length || page.isLast || startAt >= (page.total ?? 0)) break;
    }
    return out;
  }

  async fetchWorkItemActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange) {
    if (!identities.length) return [];
    const spField = stringConfig(ctx, 'storyPointsField') || undefined;
    const projects = listConfig(ctx, 'projects');
    const byUser = new Map(identities.map((i) => [i.username.toLowerCase(), i.memberId]));
    const memberOf = (keys: (string | null | undefined)[]) =>
      keys
        .filter((v): v is string => !!v)
        .map((v) => byUser.get(v.toLowerCase()))
        .find(Boolean);
    const categories = await this.statusCategories(ctx);

    const from = toDay(range.from);
    const until = toDay(dayAfter(range.to));
    const quoted = identities.map((i) => `"${i.username.replace(/"/g, '\\"')}"`).join(', ');
    // Resolved in the range and held by a tracked person at any time, or held by a tracked person at
    // some point in the range (so assignments that ended in the range count even if still open).
    const resolvedClause = `(assignee was in (${quoted}) AND statusCategory = Done AND resolved >= "${from}" AND resolved < "${until}")`;
    const heldClause = `assignee was in (${quoted}) during ("${from}", "${until}")`;
    let jql = `(${resolvedClause} OR ${heldClause})`;
    if (projects.length) jql += ` AND project in (${projects.map((p) => `"${p}"`).join(', ')})`;

    const fields = ['assignee', 'resolutiondate', 'created', 'status', ...(spField ? [spField] : [])];
    const issues = await this.search(ctx, jql, fields);

    const out: ActivityRecord[] = [];
    for (const issue of issues) {
      const histories = await this.fullChangelog(ctx, issue);
      const a = issue.fields.assignee;
      const resolved = issue.fields.resolutiondate;
      const status = issue.fields.status?.id ?? null;

      const assignments = buildAssignments({
        created: issue.fields.created ?? histories[0]?.created ?? new Date().toISOString(),
        currentAssignee: a ? (a.accountId ?? a.name ?? a.key ?? null) : null,
        currentStatus: status,
        histories,
        categories,
      });

      // Issues done: credited to everyone who held the issue (and the assignee at resolution).
      if (resolved && status && categories.get(status) === 'done') {
        const contributors = new Set(
          [a ? memberOf(userKeys(a)) : undefined, ...assignments.map((s) => memberOf([s.assignee]))].filter(
            (m): m is string => !!m,
          ),
        );
        // Cycle time: first move into an "indeterminate" (In Progress) status → resolution.
        const started = histories
          .filter((h) =>
            h.items.some((it) => it.field === 'status' && it.to && categories.get(it.to) === 'indeterminate'),
          )
          .map((h) => new Date(h.created).getTime())
          .sort((x, y) => x - y)[0];
        const cycle = started ? (new Date(resolved).getTime() - started) / 36e5 : undefined;
        const sp = spField ? Number(issue.fields[spField] ?? 0) : 0;
        for (const memberId of contributors) {
          out.push({
            memberId,
            date: toDay(resolved),
            workItemKey: issue.key,
            issuesCompleted: 1,
            storyPoints: Number.isFinite(sp) ? sp : 0,
            cycleTimeHours: cycle !== undefined && cycle >= 0 ? [cycle] : [],
          });
        }
      }

      // Assignments: every period a tracked person held the issue, dated on the day it ended.
      for (const s of assignments) {
        const memberId = memberOf([s.assignee]);
        if (!memberId) continue;
        const completed = s.outcome === 'completed';
        out.push({
          memberId,
          date: toDay(s.end),
          assignmentsCompleted: completed ? 1 : 0,
          assignmentsHandedOver: completed ? 0 : 1,
          assignmentsReworked: s.rework ? 1 : 0,
          holdHours: completed ? [s.hours] : [],
        });
      }
    }
    return out;
  }
}
