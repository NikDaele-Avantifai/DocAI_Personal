import { useState, useEffect } from "react"
import "./AuditPage.css"
import { API_BASE } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

type AuditEntry = {
  id: string
  page_id: string
  page_title: string
  space_key: string | null
  action: string
  decision: "approved" | "rejected" | "applied" | "rolled_back"
  reviewed_by: string | null
  applied_by: string | null
  rationale: string | null
  note: string | null
  snapshot_id: string | null
  created_at: string | null
  updated_at: string | null
}

const ACTION_STYLE: Record<string, { color: string; bg: string }> = {
  archive:        { color: "#BF2600", bg: "rgba(191,38,0,0.08)"  },
  add_summary:    { color: "#0747A6", bg: "rgba(7,71,166,0.08)"  },
  update_owner:   { color: "#974F0C", bg: "rgba(151,79,12,0.08)" },
  restructure:    { color: "#403294", bg: "rgba(64,50,148,0.08)" },
  merge:          { color: "#006644", bg: "rgba(0,102,68,0.08)"  },
  rewrite:        { color: "#403294", bg: "rgba(64,50,148,0.08)" },
  remove_section: { color: "#BF2600", bg: "rgba(191,38,0,0.08)"  },
  rename:         { color: "#006644", bg: "rgba(0,102,68,0.08)"  },
}

const ACTION_LABEL: Record<string, string> = {
  archive:        "Archive",
  add_summary:    "Add Summary",
  update_owner:   "Update Owner",
  restructure:    "Restructure",
  merge:          "Merge",
  rewrite:        "Rewrite",
  remove_section: "Remove Section",
  rename:         "Rename",
}

function dateGroup(iso: string | null): string {
  if (!iso) return "Unknown"
  const d = new Date(iso)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const entryStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.floor((todayStart - entryStart) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7)  return `${diff} days ago`
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d)
}

function formatTime(iso: string | null): string {
  if (!iso) return ""
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

export default function AuditPage() {
  const { isTokenReady } = useAuth()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<"all" | "approved" | "rejected" | "applied" | "rolled_back">("all")
  const [loading, setLoading] = useState(true)
  const [rollingBack, setRollingBack] = useState<string | null>(null)   // snapshot_id in progress
  const [confirmId, setConfirmId] = useState<string | null>(null)       // snapshot_id awaiting confirm

  function loadEntries() {
    setLoading(true)
    const qs = filter !== "all" ? `?decision=${filter}` : ""
    fetch(`${API_BASE}/api/audit/${qs}`)
      .then(r => r.json())
      .then(data => {
        setEntries(data.entries ?? [])
        setTotal(data.total ?? 0)
      })
      .catch(() => { setEntries([]); setTotal(0) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (isTokenReady) loadEntries() }, [filter, isTokenReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function doRollback(snapshotId: string) {
    setRollingBack(snapshotId)
    setConfirmId(null)
    try {
      const res = await fetch(`${API_BASE}/api/rollback/${snapshotId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rolled_back_by: "Dashboard User" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Rollback failed: ${err.detail ?? res.statusText}`)
        return
      }
      // Refresh list so decision shows "rolled_back"
      loadEntries()
    } catch {
      alert("Rollback failed: network error")
    } finally {
      setRollingBack(null)
    }
  }

  // Group entries by date label while preserving server order (newest first)
  const groupOrder: string[] = []
  const groups: Record<string, AuditEntry[]> = {}
  for (const e of entries) {
    const g = dateGroup(e.updated_at)
    if (!groups[g]) { groups[g] = []; groupOrder.push(g) }
    groups[g].push(e)
  }

  return (
    <div className="audit-layout">
      <div>
        <h1 className="audit-page-title">Audit Log</h1>
        <p className="audit-page-sub">Every approved, rejected, applied, and rolled-back change — recorded permanently.</p>
      </div>

      <div className="audit-controls">
        <div className="audit-filter-tabs">
          {(["all", "approved", "rejected", "applied", "rolled_back"] as const).map(f => (
            <button
              key={f}
              className={`audit-tab${filter === f ? " active" : ""}`}
              onClick={() => setFilter(f)}>
              {f === "rolled_back" ? "Rolled Back" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="audit-count">{loading ? "—" : `${total} entries`}</span>
      </div>

      <div data-tour="audit-table" className="audit-timeline">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="audit-entry">
            <div className="audit-decision-icon" style={{ background: "var(--surface-3)" }} />
            <div className="audit-entry-main">
              <div className="skel-block skel-audit-title" />
              <div className="skel-block skel-audit-sub" />
            </div>
          </div>
        ))}

        {!loading && entries.length === 0 && (
          <div className="audit-empty">
            <div className="audit-empty-icon">☰</div>
            <p>No {filter !== "all" ? filter.replace("_", " ") : ""} entries yet.</p>
            <p className="audit-empty-hint">
              {filter === "all"
                ? "Decisions appear here once proposals are approved or rejected."
                : `No ${filter.replace("_", " ")} decisions recorded.`}
            </p>
          </div>
        )}

        {!loading && groupOrder.map(group => (
          <div key={group} className="audit-date-group">
            <div className="audit-date-label">{group}</div>

            {groups[group].map(entry => {
              const style = ACTION_STYLE[entry.action] ?? ACTION_STYLE.add_summary
              const actor = entry.applied_by ?? entry.reviewed_by ?? "DocAI"
              const canRollback = entry.decision === "applied" && !!entry.snapshot_id
              const isConfirming = !!entry.snapshot_id && confirmId === entry.snapshot_id
              const isRollingBack = !!entry.snapshot_id && rollingBack === entry.snapshot_id

              return (
                <div key={entry.id} className="audit-entry">
                  <div className={`audit-decision-icon ${entry.decision}`}>
                    {entry.decision === "applied"
                      ? "↗"
                      : entry.decision === "approved"
                      ? "✓"
                      : entry.decision === "rolled_back"
                      ? "↺"
                      : "✕"}
                  </div>

                  <div className="audit-entry-main">
                    <div className="audit-entry-top">
                      <span className="audit-entry-page">{entry.page_title}</span>
                      <span
                        className="audit-action-badge"
                        style={{ color: style.color, background: style.bg }}>
                        {ACTION_LABEL[entry.action] ?? entry.action}
                      </span>
                    </div>
                    {entry.rationale && (
                      <div className="audit-rationale">{entry.rationale}</div>
                    )}
                    {entry.note && (
                      <div className="audit-note">"{entry.note}"</div>
                    )}
                  </div>

                  <div className="audit-entry-right">
                    <div className="audit-reviewer">{actor}</div>
                    <div className="audit-decision-label" data-decision={entry.decision}>
                      {entry.decision === "rolled_back" ? "Rolled Back" : entry.decision}
                    </div>
                    <div className="audit-time">{formatTime(entry.updated_at)}</div>

                    {canRollback && !isConfirming && !isRollingBack && (
                      <button
                        className="btn-rollback"
                        onClick={() => setConfirmId(entry.snapshot_id)}>
                        ↺ Rollback
                      </button>
                    )}
                    {canRollback && isConfirming && (
                      <div className="rollback-confirm">
                        <span className="rollback-confirm-text">Restore page?</span>
                        <button
                          className="btn-rollback-confirm"
                          onClick={() => doRollback(entry.snapshot_id!)}>
                          Yes
                        </button>
                        <button
                          className="btn-rollback-cancel"
                          onClick={() => setConfirmId(null)}>
                          No
                        </button>
                      </div>
                    )}
                    {isRollingBack && (
                      <span className="rollback-in-progress">Restoring…</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
