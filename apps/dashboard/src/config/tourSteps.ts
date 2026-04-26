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
    id: 'welcome',
    title: 'Welcome to DocAI',
    text: 'DocAI keeps your Confluence documentation healthy. This 2-minute tour shows you exactly how it works.',
    target: '',  // no target — center modal
    route: '/overview',
    position: 'center',
  },
  {
    id: 'health-score',
    title: 'Your documentation health score',
    text: 'DocAI analyzes your entire Confluence workspace and gives it a health score. Run a sweep to see your score update in real time.',
    target: '[data-tour="health-score"]',
    route: '/overview',
    position: 'bottom',
  },
  {
    id: 'stats-row',
    title: 'Live workspace metrics',
    text: 'Pages at risk, open issues, proposals awaiting review, and changes published — all updated after every sweep.',
    target: '[data-tour="stats-row"]',
    route: '/overview',
    position: 'bottom',
  },
  {
    id: 'activity-feed',
    title: 'Full audit trail',
    text: 'Every proposal, approval, and change is logged here. Your compliance team has complete visibility over every documentation decision.',
    target: '[data-tour="activity-feed"]',
    route: '/overview',
    position: 'left',
  },
  {
    id: 'pages-nav',
    title: 'Your Confluence workspace — mirrored live',
    text: 'DocAI mirrors your complete Confluence structure. Click any page to see its health status, issues found, and AI-proposed fixes.',
    target: '[data-tour="pages-tree"]',
    route: '/pages',
    position: 'right',
  },
  {
    id: 'proposals-queue',
    title: 'Nothing changes without your approval',
    text: 'Every proposed fix sits here waiting for your review. DocAI never touches your Confluence automatically — you approve every change.',
    target: '[data-tour="proposals-list"]',
    route: '/proposals',
    position: 'right',
  },
  {
    id: 'audit-log',
    title: 'Complete compliance audit trail',
    text: 'Every analysis, approval, and change — who did it, when, and what changed. Ready for your next compliance review or audit.',
    target: '[data-tour="audit-table"]',
    route: '/audit',
    position: 'top',
  },
  {
    id: 'duplicates',
    title: 'Semantic duplicate detection',
    text: 'DocAI uses AI to find pages with overlapping content — even when the wording differs. Flag, merge, or archive duplicates with one click.',
    target: '[data-tour="duplicates-panel"]',
    route: '/duplicates',
    position: 'right',
  },
  {
    id: 'batch-rename',
    title: 'Fix generic page titles in bulk',
    text: 'Pages named "Meeting Notes" or "Draft" get flagged automatically. DocAI proposes better names based on the actual content.',
    target: '',
    route: '/batch-rename',
    position: 'center',
  },
  {
    id: 'settings-overview',
    title: 'Configure DocAI for your team',
    text: 'Connect your Confluence workspace, invite team members, and set analysis preferences — all from Settings.',
    target: '',
    route: '/settings',
    position: 'center',
  },
  {
    id: 'finish',
    title: "You're ready to go 🎉",
    text: "Start by syncing your Confluence workspace if you haven't already. Then run your first sweep to see your documentation health score.",
    target: '[data-tour="health-score"]',
    route: '/overview',
    position: 'bottom',
  },
]
