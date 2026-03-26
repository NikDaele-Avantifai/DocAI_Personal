import { useState, useEffect } from "react"
import "./ApprovalsPage.css"

type DiffLine = {
  type: "add" | "remove" | "context" | "hunk"
  content: string
}

type Proposal = {
  id: string
  status: "pending" | "approved" | "rejected" | "applied"
  action: string
  action_label?: string
  actionLabel?: string
  pageTitle?: string
  source_page_title?: string
  pageSpace?: string
  space?: string
  rationale: string
  proposedBy?: string
  proposed_by?: string
  proposedAt?: string
  created_at?: string
  confidence?: number
  diff: DiffLine[] | string
  new_content?: string
}

// Normalise fields from the API (snake_case) into the shape the UI expects
function normalise(p: Proposal): Proposal & {
  actionLabel: string
  pageTitle: string
  pageSpace: string
  proposedBy: string
  proposedAt: string
  confidence: number
  diff: DiffLine[]
} {
  const rawDiff = p.diff
  let diff: DiffLine[]
  if (typeof rawDiff === "string") {
    try { diff = JSON.parse(rawDiff) } catch { diff = [] }
  } else {
    diff = rawDiff ?? []
  }

  return {
    ...p,
    actionLabel: p.action_label ?? p.actionLabel ?? p.action,
    pageTitle:   p.source_page_title ?? p.pageTitle ?? "Unknown Page",
    pageSpace:   p.space ?? p.pageSpace ?? "",
    proposedBy:  p.proposed_by ?? p.proposedBy ?? "DocAI",
    proposedAt:  p.created_at
      ? new Date(p.created_at).toLocaleString()
      : p.proposedAt ?? "",
    confidence:  p.confidence ?? 80,
    diff,
  }
}

const mockProposals: Proposal[] = [
  {
    id: "p1",
    status: "pending",
    action: "archive",
    actionLabel: "Archive",
    pageTitle: "Q3 2021 Sprint Retrospective",
    pageSpace: "Engineering",
    rationale:
      "This page is 3+ years old with no recorded owner or follow-up actions. The sprint it references concluded in 2021 and the content provides no ongoing value. All action items remain unresolved with no assignee.",
    proposedBy: "DocAI",
    proposedAt: "2 minutes ago",
    confidence: 92,
    diff: [
      { type: "hunk",    content: "@@ Page marked for archival @@" },
      { type: "remove",  content: "# Q3 2021 Sprint Retrospective" },
      { type: "remove",  content: "" },
      { type: "remove",  content: "**Date:** September 30, 2021" },
      { type: "remove",  content: "**Facilitator:** Unknown" },
      { type: "remove",  content: "" },
      { type: "remove",  content: "## What went well" },
      { type: "remove",  content: "- Completed 23 of 27 story points" },
      { type: "remove",  content: "- Good team collaboration on auth feature" },
      { type: "remove",  content: "" },
      { type: "remove",  content: "## Action items" },
      { type: "remove",  content: "- [ ] Update estimation process   (UNRESOLVED)" },
      { type: "remove",  content: "- [ ] Schedule retrospective training  (UNRESOLVED)" },
    ],
  },
  {
    id: "p2",
    status: "pending",
    action: "add_summary",
    actionLabel: "Add Summary",
    pageTitle: "API Integration Guide",
    pageSpace: "Engineering",
    rationale:
      "This page lacks a structured introduction, ownership information, and review date. Adding an overview section will improve discoverability and establish clear accountability.",
    proposedBy: "DocAI",
    proposedAt: "5 minutes ago",
    confidence: 85,
    diff: [
      { type: "hunk",    content: "@@ -1,4 +1,9 @@" },
      { type: "context", content: "# API Integration Guide" },
      { type: "context", content: "" },
      { type: "add",     content: "## Overview" },
      { type: "add",     content: "This guide covers authentication and endpoint usage." },
      { type: "add",     content: "" },
      { type: "add",     content: "**Owner:** Engineering Team  |  **Last reviewed:** 2024-Q1" },
      { type: "add",     content: "" },
      { type: "context", content: "## Authentication" },
      { type: "context", content: "Use the API key from your settings page." },
      { type: "hunk",    content: "@@ -14,5 +19,3 @@" },
      { type: "remove",  content: "// TODO: document remaining endpoints" },
      { type: "remove",  content: "// last updated by: ???" },
    ],
  },
  {
    id: "p3",
    status: "pending",
    action: "update_owner",
    actionLabel: "Update Owner",
    pageTitle: "Customer Onboarding Process",
    pageSpace: "Operations",
    rationale:
      "The listed owner 'John' could not be resolved in the Confluence user directory. The Operations team has been identified as the likely owner based on the page's space and content.",
    proposedBy: "DocAI",
    proposedAt: "8 minutes ago",
    confidence: 78,
    diff: [
      { type: "hunk",    content: "@@ Page metadata @@" },
      { type: "remove",  content: "Owner:         John (unverified)" },
      { type: "remove",  content: "Last reviewed: Unknown" },
      { type: "add",     content: "Owner:         Operations Team" },
      { type: "add",     content: "Last reviewed: 2024-03-26" },
      { type: "hunk",    content: "@@ -8,3 +8,3 @@ Introduction" },
      { type: "remove",  content: "Contact John for any questions about this process." },
      { type: "add",     content: "Contact the Operations Team for any questions about this process." },
    ],
  },
]

const ACTION_STYLE: Record<string, { color: string; bg: string }> = {
  archive:        { color: "#BF2600", bg: "rgba(191,38,0,0.08)"   },
  add_summary:    { color: "#0747A6", bg: "rgba(7,71,166,0.08)"   },
  update_owner:   { color: "#974F0C", bg: "rgba(151,79,12,0.08)"  },
  restructure:    { color: "#403294", bg: "rgba(64,50,148,0.08)"  },
  merge:          { color: "#006644", bg: "rgba(0,102,68,0.08)"   },
  rewrite:        { color: "#403294", bg: "rgba(64,50,148,0.08)"  },
  remove_section: { color: "#BF2600", bg: "rgba(191,38,0,0.08)"   },
}

const API_BASE = "http://localhost:8000"

export default function ApprovalsPage() {
  const [proposals, setProposals] = useState(mockProposals.map(normalise))
  const [selected, setSelected] = useState<ReturnType<typeof normalise> | null>(null)
  const [filter, setFilter] = useState<"pending" | "all" | "approved" | "rejected">("pending")

  // Apply modal state
  const [applyModalOpen, setApplyModalOpen] = useState(false)
  const [applyUrl, setApplyUrl] = useState("")
  const [applyEmail, setApplyEmail] = useState("")
  const [applyToken, setApplyToken] = useState("")
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applySuccess, setApplySuccess] = useState(false)

  // Load real proposals from API on mount, merge with mocks
  useEffect(() => {
    fetch(`${API_BASE}/api/proposals/`)
      .then(r => r.json())
      .then(data => {
        if (data.proposals?.length) {
          const apiProposals = (data.proposals as Proposal[]).map(normalise)
          // Merge: API proposals first, then mock ones with different IDs
          const apiIds = new Set(apiProposals.map(p => p.id))
          const merged = [
            ...apiProposals,
            ...mockProposals.map(normalise).filter(p => !apiIds.has(p.id)),
          ]
          setProposals(merged)
        }
      })
      .catch(() => {/* backend not running — keep mock data */})
  }, [])

  const filtered = proposals.filter(p => filter === "all" || p.status === filter)
  const pending = proposals.filter(p => p.status === "pending").length

  async function review(id: string, decision: "approved" | "rejected") {
    // Optimistic update
    setProposals(prev => prev.map(p => p.id === id ? { ...p, status: decision } : p))
    setSelected(prev => prev?.id === id ? { ...prev, status: decision } : prev)

    // Call real API (best-effort — mock proposals won't exist server-side)
    await fetch(`${API_BASE}/api/proposals/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: decision, reviewed_by: "Dashboard User" }),
    }).catch(() => {/* ignore if mock proposal or backend unavailable */})
  }

  function openApplyModal() {
    setApplyUrl("")
    setApplyEmail("")
    setApplyToken("")
    setApplyError(null)
    setApplySuccess(false)
    setApplyModalOpen(true)
  }

  async function applyToConfluence() {
    if (!selected) return
    setApplyLoading(true)
    setApplyError(null)

    try {
      const res = await fetch(`${API_BASE}/api/proposals/${selected.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confluence_base_url: applyUrl,
          email: applyEmail,
          api_token: applyToken,
          applied_by: "Dashboard User",
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `API error ${res.status}`)
      }

      setApplySuccess(true)
      setProposals(prev => prev.map(p => p.id === selected.id ? { ...p, status: "applied" } : p))
      setSelected(prev => prev?.id === selected.id ? { ...prev, status: "applied" } : prev)
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setApplyLoading(false)
    }
  }

  const actionStyle = selected
    ? ACTION_STYLE[selected.action] ?? ACTION_STYLE.add_summary
    : null

  return (
    <div className="approvals-layout">

      {/* ── Left panel ── */}
      <div className="approvals-panel">
        <div className="approvals-header">
          <div>
            <h1 className="approvals-page-title">Approvals</h1>
            <p className="approvals-page-sub">
              {pending > 0
                ? `${pending} change${pending !== 1 ? "s" : ""} awaiting review`
                : "All caught up"}
            </p>
          </div>
          <div className="filter-tabs">
            {(["pending", "all", "approved", "rejected"] as const).map(f => (
              <button
                key={f}
                className={`filter-tab${filter === f ? " active" : ""}`}
                onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="proposals-list">
          {filtered.length === 0 && (
            <div className="proposals-empty">
              <span>✓</span>
              <p>No {filter !== "all" ? filter : ""} proposals</p>
            </div>
          )}

          {filtered.map(p => {
            const style = ACTION_STYLE[p.action] ?? ACTION_STYLE.add_summary
            return (
              <div
                key={p.id}
                className={`proposal-row${selected?.id === p.id ? " selected" : ""}`}
                onClick={() => setSelected(p)}>

                <div className="proposal-row-top">
                  <span className="proposal-page">{p.pageTitle}</span>
                  <span className="proposal-status" data-status={p.status}>
                    {p.status}
                  </span>
                </div>

                <div className="proposal-row-meta">
                  <span className="action-badge" style={{ color: style.color, background: style.bg }}>
                    {p.actionLabel}
                  </span>
                  <span className="proposal-time">{p.proposedAt}</span>
                </div>

                <div className="proposal-confidence">
                  <div className="confidence-bar">
                    <div className="confidence-fill" style={{ width: `${p.confidence}%` }} />
                  </div>
                  <span className="confidence-label">{p.confidence}% confidence</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="diff-panel">
        {selected && actionStyle ? (
          <div className="diff-content">

            {/* Header */}
            <div className="diff-header">
              <div className="diff-header-top">
                <div>
                  <h2 className="diff-title">{selected.pageTitle}</h2>
                  <p className="diff-meta">
                    {selected.pageSpace && `${selected.pageSpace} · `}
                    Proposed {selected.proposedAt} by {selected.proposedBy}
                  </p>
                </div>
                <span
                  className="action-badge-lg"
                  style={{ color: actionStyle.color, background: actionStyle.bg }}>
                  {selected.actionLabel}
                </span>
              </div>

              <div className="rationale-box">
                <div className="rationale-label">AI Rationale</div>
                <p className="rationale-text">{selected.rationale}</p>
              </div>
            </div>

            {/* Diff viewer */}
            <div className="diff-view">
              <div className="diff-view-header">
                <span className="diff-view-title">Proposed Changes</span>
                <div className="diff-legend">
                  <span className="legend-add">+ added</span>
                  <span className="legend-remove">− removed</span>
                </div>
              </div>

              <div className="diff-code">
                {selected.diff.map((line, i) => (
                  <div key={i} className={`diff-line diff-line-${line.type}`}>
                    <span className="diff-gutter">
                      {line.type === "add"
                        ? "+"
                        : line.type === "remove"
                        ? "−"
                        : line.type === "hunk"
                        ? "⋯"
                        : " "}
                    </span>
                    <span className="diff-line-content">{line.content || " "}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            {selected.status === "pending" && (
              <div className="diff-actions">
                <button className="btn-approve" onClick={() => review(selected.id, "approved")}>
                  ✓ Approve
                </button>
                <button className="btn-reject" onClick={() => review(selected.id, "rejected")}>
                  ✕ Reject
                </button>
                <button className="btn-ghost-sm">Open in Confluence ↗</button>
              </div>
            )}

            {selected.status === "approved" && (
              <div className="diff-actions">
                <div className="decision-badge decision-approved">✓ Approved</div>
                {selected.new_content && (
                  <button className="btn-apply" onClick={openApplyModal}>
                    Apply to Confluence ↗
                  </button>
                )}
                <button className="btn-ghost-sm">Open in Confluence ↗</button>
              </div>
            )}

            {selected.status === "rejected" && (
              <div className="diff-actions">
                <div className="decision-badge decision-rejected">✕ Rejected</div>
              </div>
            )}

            {selected.status === "applied" && (
              <div className="diff-actions">
                <div className="decision-badge decision-applied">✓ Applied to Confluence</div>
              </div>
            )}
          </div>
        ) : (
          <div className="diff-empty">
            <span className="diff-empty-icon">⬡</span>
            <p>Select a proposal to review changes</p>
          </div>
        )}
      </div>

      {/* ── Apply to Confluence modal ── */}
      {applyModalOpen && selected && (
        <div className="modal-overlay" onClick={() => setApplyModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>

            {applySuccess ? (
              <div className="modal-success">
                <div className="modal-success-icon">✓</div>
                <h3>Applied to Confluence</h3>
                <p>
                  The changes to <strong>{selected.pageTitle}</strong> have been
                  published to Confluence.
                </p>
                <button className="btn-primary" onClick={() => setApplyModalOpen(false)}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="modal-header">
                  <div>
                    <h3 className="modal-title">Apply to Confluence</h3>
                    <p className="modal-sub">{selected.pageTitle}</p>
                  </div>
                  <button
                    className="modal-close"
                    onClick={() => setApplyModalOpen(false)}>✕</button>
                </div>

                <div className="modal-body">
                  <p className="apply-note">
                    Enter your Confluence credentials to publish these changes.
                    Credentials are sent directly to Confluence and never stored.
                  </p>

                  <div className="modal-field">
                    <label className="modal-field-label">Confluence URL</label>
                    <input
                      className="modal-input"
                      type="text"
                      placeholder="https://yourorg.atlassian.net"
                      value={applyUrl}
                      onChange={e => setApplyUrl(e.target.value)}
                    />
                  </div>

                  <div className="modal-field">
                    <label className="modal-field-label">Email</label>
                    <input
                      className="modal-input"
                      type="email"
                      placeholder="you@yourorg.com"
                      value={applyEmail}
                      onChange={e => setApplyEmail(e.target.value)}
                    />
                  </div>

                  <div className="modal-field">
                    <label className="modal-field-label">API Token</label>
                    <input
                      className="modal-input"
                      type="password"
                      placeholder="Your Atlassian API token"
                      value={applyToken}
                      onChange={e => setApplyToken(e.target.value)}
                    />
                  </div>

                  {applyError && (
                    <div className="modal-error">
                      <span>⚠</span> {applyError}
                    </div>
                  )}
                </div>

                <div className="modal-footer">
                  <button
                    className="btn-ghost"
                    onClick={() => setApplyModalOpen(false)}
                    disabled={applyLoading}>
                    Cancel
                  </button>
                  <button
                    className="btn-apply-confirm"
                    onClick={applyToConfluence}
                    disabled={applyLoading || !applyUrl || !applyEmail || !applyToken}>
                    {applyLoading ? (
                      <span className="modal-loading">
                        <span className="spinner-dark" /> Applying…
                      </span>
                    ) : (
                      "Apply Changes"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
