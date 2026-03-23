// ─── Confluence ───────────────────────────────────────────────────────────────

export interface ConfluencePage {
  id: string
  title: string
  spaceKey: string
  url: string
  lastModified: string // ISO date
  lastModifiedBy: string
  wordCount: number
  version: number
}

export interface ConfluenceSpace {
  key: string
  name: string
  url: string
  pageCount: number
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

export type IssueType =
  | "stale"        // Not updated in X days
  | "duplicate"    // Similar content exists elsewhere
  | "orphan"       // No parent, not linked from anywhere
  | "unowned"      // No assigned owner
  | "unstructured" // Doesn't follow space conventions

export interface DocumentIssue {
  id: string
  type: IssueType
  severity: "low" | "medium" | "high"
  pageId: string
  pageTitle: string
  description: string
  detectedAt: string // ISO date
}

// ─── Proposals (human approval layer) ─────────────────────────────────────────

export type ProposalAction =
  | "archive"
  | "merge"
  | "restructure"
  | "update_owner"
  | "add_summary"
  | "retag"

export type ProposalStatus = "pending" | "approved" | "rejected"

export interface Proposal {
  id: string
  action: ProposalAction
  status: ProposalStatus
  sourcePageId: string
  sourcePageTitle: string
  targetPageId?: string       // For merge proposals
  targetPageTitle?: string
  rationale: string           // Why the AI proposed this
  diff?: string               // For content changes
  createdAt: string
  reviewedAt?: string
  reviewedBy?: string
}

// ─── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string
  proposalId: string
  action: ProposalAction
  status: "approved" | "rejected"
  pageId: string
  pageTitle: string
  reviewedBy: string
  reviewedAt: string
  note?: string
}

// ─── API responses ─────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T
  success: boolean
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// ─── User / Auth ───────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string
  role: "admin" | "reviewer" | "viewer"
  confluenceBaseUrl?: string
}
