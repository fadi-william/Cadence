import { AzureDevOpsAdapter } from './azure-devops.adapter';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('AzureDevOpsAdapter.fetchCodeActivity', () => {
  const ctx = { baseUrl: 'https://dev.azure.com/acme', config: { projects: ['Core'] }, secret: 'pat' };
  const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') };
  const mia = { memberId: 'mia', username: 'Mia@acme.io' };
  const bob = { memberId: 'bob', username: 'bob@acme.io' };

  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/_apis/git/repositories?')) return json({ value: [{ id: 'r1', name: 'api' }], count: 1 });
      if (url.includes('/repositories/r1/commits')) {
        return json({
          value: [
            { commitId: 'a', author: { email: 'mia@acme.io', date: '2026-11-01T09:00:00Z' } },
            { commitId: 'b', author: { email: 'mia@acme.io', date: '2026-11-01T15:00:00Z' } },
            { commitId: 'c', author: { email: 'stranger@x.io', date: '2026-11-01T15:00:00Z' } },
          ],
          count: 3,
        });
      }
      if (url.includes('queryTimeRangeType=created')) {
        return json({
          value: [
            {
              pullRequestId: 7,
              status: 'completed',
              createdBy: { id: '1', uniqueName: 'mia@acme.io' },
              creationDate: '2026-11-01T10:00:00Z',
              closedDate: '2026-11-02T10:00:00Z',
              repository: { id: 'r1' },
            },
          ],
          count: 1,
        });
      }
      if (url.includes('/git/pullrequests?')) return json({ value: [], count: 0 });
      if (url.includes('/pullRequests/7/threads')) {
        return json({
          value: [
            {
              properties: { CodeReviewThreadType: { $value: 'VoteUpdate' } },
              comments: [
                {
                  author: { id: '2', uniqueName: 'bob@acme.io' },
                  publishedDate: '2026-11-02T08:00:00Z',
                  commentType: 'system',
                },
              ],
            },
            {
              comments: [
                {
                  author: { id: '2', uniqueName: 'bob@acme.io' },
                  publishedDate: '2026-11-02T09:00:00Z',
                  commentType: 'text',
                },
                {
                  author: { id: '1', uniqueName: 'mia@acme.io' },
                  publishedDate: '2026-11-02T09:30:00Z',
                  commentType: 'text',
                },
              ],
            },
          ],
          count: 2,
        });
      }
      throw new Error(`unexpected ${url}`);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('counts commits, PRs raised/merged and distinct reviews per day', async () => {
    const records = await new AzureDevOpsAdapter().fetchCodeActivity(ctx, [mia, bob], range);
    const sum = (member: string, key: 'commits' | 'prsRaised' | 'prsMerged' | 'prsReviewed') =>
      records.filter((r) => r.memberId === member).reduce((n, r) => n + (r[key] ?? 0), 0);
    expect(sum('mia', 'commits')).toBe(2);
    expect(sum('mia', 'prsRaised')).toBe(1);
    expect(sum('mia', 'prsMerged')).toBe(1);
    expect(sum('mia', 'prsReviewed')).toBe(0); // own PR comments are not reviews
    expect(sum('bob', 'prsReviewed')).toBe(1); // vote + comment same day = one review
  });
});

describe('AzureDevOpsAdapter.fetchDeployments', () => {
  afterEach(() => vi.restoreAllMocks());

  it('treats deploy pipelines as production deployments with commit lead time', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/_apis/build/builds?')) {
        return json({
          value: [
            {
              id: 1,
              definition: { id: 1, name: 'api-deploy' },
              result: 'succeeded',
              startTime: '2026-11-01T10:00:00Z',
              finishTime: '2026-11-01T12:00:00Z',
              sourceVersion: 'abc',
              repository: { id: 'r1', type: 'TfsGit' },
            },
            {
              id: 2,
              definition: { id: 1, name: 'api-deploy' },
              result: 'failed',
              finishTime: '2026-11-02T12:00:00Z',
              sourceVersion: 'def',
              repository: { id: 'r1', type: 'TfsGit' },
            },
            { id: 3, definition: { id: 2, name: 'api-ci' }, result: 'succeeded', finishTime: '2026-11-02T12:00:00Z' },
            {
              id: 4,
              definition: { id: 1, name: 'api-deploy' },
              result: 'canceled',
              finishTime: '2026-11-02T13:00:00Z',
            },
          ],
          count: 4,
        });
      }
      if (url.includes('/commits/abc')) return json({ author: { date: '2026-11-01T00:00:00Z' } });
      throw new Error(`unexpected ${url}`);
    });
    const deps = await new AzureDevOpsAdapter().fetchDeployments(
      { baseUrl: 'https://dev.azure.com/acme', config: { projects: ['Core'] }, secret: 'pat' },
      { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') },
    );
    expect(deps.map((d) => [d.externalId, d.status, d.leadTimeHours, d.service])).toEqual([
      ['1', 'SUCCESS', 12, 'Core/api-deploy'],
      ['2', 'FAILED', null, 'Core/api-deploy'],
    ]);
  });
});
