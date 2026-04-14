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
  source_page_id?: string
  source_page_title?: string
  pageTitle?: string
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
  is_deletion?: boolean
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


const ACTION_STYLE: Record<string, { color: string; bg: string }> = {
  archive:        { color: "#BF2600", bg: "rgba(191,38,0,0.08)"   },
  add_summary:    { color: "#0747A6", bg: "rgba(7,71,166,0.08)"   },
  update_owner:   { color: "#974F0C", bg: "rgba(151,79,12,0.08)"  },
  restructure:    { color: "#403294", bg: "rgba(64,50,148,0.08)"  },
  merge:          { color: "#006644", bg: "rgba(0,102,68,0.08)"   },
  rewrite:        { color: "#403294", bg: "rgba(64,50,148,0.08)"  },
  remove_section: { color: "#BF2600", bg: "rgba(191,38,0,0.08)"   },
  rename:         { color: "#006644", bg: "rgba(0,102,68,0.08)"   },
}

const API_BASE = "http://localhost:8000"

type NormalisedProposal = ReturnType<typeof normalise>

export default function ApprovalsPage() {
  const [proposals, setProposals] = useState<NormalisedProposal[]>([])
  const [selected, setSelected] = useState<NormalisedProposal | null>(null)
  const [filter, setFilter] = useState<"pending" | "all" | "approved" | "rejected">("pending")

  // Right panel tab state
  const [rightTab, setRightTab] = useState<"diff" | "edit">("diff")
  const [editedContents, setEditedContents] = useState<Record<string, string>>({})

  // Apply state
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  // Load proposals from API on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/proposals/`)
      .then(r => r.json())
      .then(data => {
        const apiProposals = ((data.proposals ?? []) as Proposal[]).map(normalise)
        setProposals(apiProposals)
      })
      .catch(() => {/* backend unavailable */})
  }, [])

  const filtered = proposals.filter(p => filter === "all" || p.status === filter)
  const pending = proposals.filter(p => p.status === "pending").length

  async function review(id: string, decision: "approved" | "rejected") {
    // Optimistic update
    setProposals((prev: NormalisedProposal[]) => prev.map((p: NormalisedProposal) => p.id === id ? { ...p, status: decision } : p))
    setSelected((prev: NormalisedProposal | null) => prev?.id === id ? { ...prev, status: decision } : prev)

    // Call real API (best-effort — mock proposals won't exist server-side)
    await fetch(`${API_BASE}/api/proposals/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: decision, reviewed_by: "Dashboard User" }),
    }).catch(() => {/* ignore if mock proposal or backend unavailable */})
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
          applied_by: "Dashboard User",
          content_override: editedContents[selected.id] ?? null,
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.detail ?? `API error ${res.status}`)
      }

      setProposals((prev: NormalisedProposal[]) => prev.map((p: NormalisedProposal) => p.id === selected.id ? { ...p, status: "applied" } : p))
      setSelected((prev: NormalisedProposal | null) => prev?.id === selected.id ? { ...prev, status: "applied" } : prev)

      // Re-fetch the page from Confluence into the DB, then re-analyze it to update health status
      const pageId = selected.source_page_id
      if (pageId) {
        try {
          const pageData = await fetch(`${API_BASE}/api/sync/pages/${pageId}`).then(r => r.json())
          const analyzeRes = await fetch(`${API_BASE}/api/analyze/?force_refresh=true`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url:           pageData.url ?? "",
              title:         pageData.title ?? selected.pageTitle,
              content:       pageData.content ?? "",
              last_modified: pageData.last_modified ?? null,
              owner:         pageData.owner ?? null,
              page_id:       pageId,
              page_version:  pageData.version ?? 1,
            }),
          })
          if (analyzeRes.ok) {
            const result = await analyzeRes.json()
            // Broadcast the updated health status so PagesPage and OverviewPage can react
            window.dispatchEvent(new CustomEvent("docai:pageHealthUpdated", {
              detail: {
                pageId,
                isHealthy: result.is_healthy && result.issues.length === 0,
                analysis: result,
              },
            }))
          }
        } catch {/* best-effort — apply already succeeded */}
      }
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

        <div data-tour="proposals-list" className="proposals-list">
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
                onClick={() => { setSelected(p); setRightTab("diff") }}>

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

            {/* Tabs — only shown when there is editable AI content and it's not a deletion */}
            {selected.new_content && !selected.is_deletion && (
              <div className="content-tabs">
                <button
                  className={`content-tab${rightTab === "diff" ? " active" : ""}`}
                  onClick={() => setRightTab("diff")}>
                  Diff
                </button>
                <button
                  className={`content-tab${rightTab === "edit" ? " active" : ""}`}
                  onClick={() => {
                    if (!editedContents[selected.id]) {
                      setEditedContents(prev => ({ ...prev, [selected.id]: selected.new_content! }))
                    }
                    setRightTab("edit")
                  }}>
                  Edit Content
                  {editedContents[selected.id] !== undefined &&
                   editedContents[selected.id] !== selected.new_content && (
                    <span className="modified-dot" title="Edited" />
                  )}
                </button>
              </div>
            )}

            {/* Diff viewer */}
            {rightTab === "diff" && (
            <div className="diff-view">
              <div className="diff-view-header">
                <span className="diff-view-title">
                  {selected.is_deletion ? "Deletion Proposal" : "Proposed Changes"}
                </span>
                <div className="diff-legend">
                  {!selected.is_deletion && <span className="legend-add">+ added</span>}
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
            )}

            {/* Content editor */}
            {rightTab === "edit" && selected.new_content && (
            <div className="diff-view">
              <div className="diff-view-header">
                <span className="diff-view-title">
                  {selected.action === "rename" ? "Edit Suggested Title" : "Edit Content"}
                </span>
                <span className="edit-hint">
                  {selected.action === "rename"
                    ? "Adjust the suggested title before applying"
                    : "Changes here will be sent to Confluence instead of the AI draft"}
                </span>
              </div>
              <textarea
                className={`content-editor${selected.action === "rename" ? " content-editor-title" : ""}`}
                value={editedContents[selected.id] ?? selected.new_content}
                onChange={e => setEditedContents(prev => ({ ...prev, [selected.id]: e.target.value }))}
                spellCheck={selected.action !== "rename"}
                rows={selected.action === "rename" ? 2 : undefined}
              />
            </div>
            )}

            {/* Actions */}
            {selected.status === "pending" && (
              <div className="diff-actions">
                <button data-tour="approve-button" className="btn-approve" onClick={() => review(selected.id, "approved")}>
                  ✓ Approve
                </button>
                <button className="btn-reject" onClick={() => review(selected.id, "rejected")}>
                  ✕ Reject
                </button>
                <button className="btn-ghost-sm">Open in Confluence ↗</button>
              </div>
            )}

            {selected.status === "approved" && (
              <div className="diff-actions-col">
                <div className="diff-actions">
                  <div className="decision-badge decision-approved">✓ Approved</div>
                  {selected.new_content && (
                    <button className="btn-apply" onClick={applyToConfluence} disabled={applyLoading}>
                      {applyLoading ? <span className="modal-loading"><span className="spinner-dark" /> Applying…</span> : "Apply to Confluence ↗"}
                    </button>
                  )}
                  <button className="btn-ghost-sm">Open in Confluence ↗</button>
                </div>
                {applyError && (
                  <div className="apply-error"><span>⚠</span> {applyError}</div>
                )}
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

    </div>
  )
}
