export type TourStep = {
  id: string
  title: string
  text: string
  target: string
  route: string
  position: 'top' | 'bottom' | 'left' | 'right' | 'center'
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'health-score',
    title: 'Your documentation health at a glance',
    text: 'DocAI analyzes your entire Confluence workspace and calculates a health score based on issues found, ownership gaps, and stale content.',
    target: '[data-tour="health-score"]',
    route: '/overview',
    position: 'bottom',
  },
  {
    id: 'stats-row',
    title: 'Live workspace metrics',
    text: 'Total pages, open issues, approved proposals awaiting apply, and changes already published to Confluence — all updated in real time.',
    target: '[data-tour="stats-row"]',
    route: '/overview',
    position: 'bottom',
  },
  {
    id: 'activity-feed',
    title: 'Full audit trail — every change tracked',
    text: 'Every proposal, approval, and change is logged here. Your compliance team has complete visibility over every documentation decision.',
    target: '[data-tour="activity-feed"]',
    route: '/overview',
    position: 'right',
  },
  {
    id: 'pages-tree',
    title: 'Your Confluence workspace — mirrored live',
    text: 'DocAI mirrors your complete Confluence structure. Every space, every page, updated on every sync.',
    target: '[data-tour="pages-tree"]',
    route: '/pages',
    position: 'right',
  },
  {
    id: 'page-detail',
    title: 'Click any page to inspect it',
    text: 'Select a page to see its metadata, AI analysis results, and content with issues highlighted inline.',
    target: '[data-tour="page-detail"]',
    route: '/pages',
    position: 'left',
  },
  {
    id: 'proposals-queue',
    title: 'Nothing changes without your approval',
    text: 'Every proposed change sits here waiting for review. Approve, reject, or modify before anything touches your Confluence.',
    target: '[data-tour="proposals-list"]',
    route: '/proposals',
    position: 'right',
  },
  {
    id: 'approve-proposal',
    title: 'Review the diff before approving',
    text: 'Every proposal shows a precise diff — exactly what will change. Approve to queue it for Confluence, or reject to discard.',
    target: '[data-tour="approve-button"]',
    route: '/proposals',
    position: 'top',
  },
  {
    id: 'audit-log',
    title: 'Complete compliance audit trail',
    text: 'Every analysis, approval, and change — who did it, when, and what the result was. Ready for your next compliance review.',
    target: '[data-tour="audit-table"]',
    route: '/audit',
    position: 'top',
  },
  {
    id: 'duplicates',
    title: 'Semantic duplicate detection',
    text: 'DocAI uses AI embeddings to find pages with overlapping content — even when the wording is different. Flag, merge, or archive with one click.',
    target: '[data-tour="duplicates-panel"]',
    route: '/duplicates',
    position: 'right',
  },
  {
    id: 'analysis-settings',
    title: 'Configured for your industry',
    text: 'Set DocAI to prioritize compliance gaps for regulated industries, or structural issues for fast-growing teams. Full control over what gets flagged.',
    target: '[data-tour="focus-mode"]',
    route: '/settings',
    position: 'right',
  },
  {
    id: 'finish',
    title: 'You\'re all set 🎉',
    text: 'DocAI is ready to keep your documentation healthy. Start by syncing your Confluence workspace, then analyze a page to find your first issues.',
    target: '[data-tour="health-score"]',
    route: '/overview',
    position: 'bottom',
  },
]
