/** The user guides rendered from docs/guide/*.md (copied to /guide at build time). */
export interface Guide {
  slug: string;
  title: string;
  summary: string;
  icon: string;
  section: 'Start here' | 'Integrations' | 'Reference';
}

export const GUIDES: Guide[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    summary: 'Install Cadence, first launch, roles and configuration.',
    icon: 'rocket',
    section: 'Start here',
  },
  {
    slug: 'metrics',
    title: 'How metrics work',
    summary: 'Combined profiles, DORA ratings and responsible use.',
    icon: 'dashboard',
    section: 'Start here',
  },
  {
    slug: 'jira',
    title: 'Connect Jira',
    summary: 'API tokens, linking people, story points and webhooks.',
    icon: 'ticket',
    section: 'Integrations',
  },
  {
    slug: 'azure-devops',
    title: 'Connect Azure DevOps',
    summary: 'PAT scopes, deployments for DORA and service hooks.',
    icon: 'commit',
    section: 'Integrations',
  },
  {
    slug: 'adapters',
    title: 'Add a provider',
    summary: 'Write an adapter for GitHub, GitLab, Linear or your own tool.',
    icon: 'puzzle',
    section: 'Reference',
  },
];

export const GUIDE_SECTIONS = ['Start here', 'Integrations', 'Reference'] as const;
