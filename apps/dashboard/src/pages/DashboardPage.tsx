import { useState, useEffect } from "react"
import "./DashboardPage.css"
import { API_BASE } from '@/lib/api'

type ActivityEntry = {
  id: string
  page_title: string
  space_key: string | null
  action: string
  decision: string
  reviewed_by: string | null
  updated_at: string | null
}

type Stats = {
  pages_total: number
  spaces_total: number
  proposals_pending: number
  proposals_awaiting_apply: number
  changes_applied: number
  decisions_made: number
  recent_activity: ActivityEntry[]
}

const ACTION_LABEL: Record<string, string> = {
  archive:        "Archive",
  add_summary:    "Add Summary",
  update_owner:   "Update Owner",
  restructure:    "Restructure",
  merge:          "Merge",
  rewrite:        "Rewrite",
  remove_section: "Remove Section",
}

const DECISION_STYLE: Record<string, { color: string; bg: string; icon: string }> = {
  approved: { color: "#006644", bg: "rgba(0,102,68,0.08)",  icon: "✓" },
  rejected: { color: "#BF2600", bg: "rgba(191,38,0,0.08)",  icon: "✕" },
  applied:  { color: "#0747A6", bg: "rgba(7,71,166,0.08)",  icon: "↗" },
}

function relativeTime(iso: string | null): string {
  if (!iso) return ""
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/api/stats/`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  const statCards = stats
    ? [
        {
          label: "Pages Synced",
          value: stats.pages_total,
          delta: `across ${stats.spaces_total} space${stats.spaces_total !== 1 ? "s" : ""}`,
          color: "#5B73FF",
        },
        {
          label: "Pending Reviews",
          value: stats.proposals_pending,
          delta: "awaiting decision",
          color: "#FFB547",
        },
        {
          label: "Awaiting Apply",
          value: stats.proposals_awaiting_apply,
          delta: "approved, not yet live",
          color: "#818CF8",
        },
        {
          label: "Changes Applied",
          value: stats.changes_applied,
          delta: "published to Confluence",
          color: "#34D399",
        },
      ]
    : []

  return (
    <div className="dashboard">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">Documentation health across your Confluence workspace</p>
        </div>
        <div className="header-actions">
          <div className="last-scan">
            <div className={`scan-dot${loading ? " pulsing" : ""}`} />
            <span>{loading ? "Loading…" : "Live"}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div className="stat-card" key={i}>
                <div className="stat-accent" style={{ background: "var(--border-2)" }} />
                <div className="skel-block skel-val" />
                <div className="skel-block skel-lbl" />
                <div className="skel-block skel-dlt" />
              </div>
            ))
          : statCards.map((s, i) => (
              <div className="stat-card" key={i}>
                <div className="stat-accent" style={{ background: s.color }} />
                <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                <div className="stat-label">{s.label}</div>
                <div className="stat-delta">{s.delta}</div>
              </div>
            ))}
      </div>

      {/* Content grid */}
      <div className="content-grid">

        {/* Recent activity */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Recent Activity</h2>
              <p className="card-sub">Latest decisions from the approval workflow</p>
            </div>
            {stats && (
              <span className="card-badge">{stats.decisions_made} total</span>
            )}
          </div>

          <div className="activity-list">
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="activity-row">
                <div className="activity-left">
                  <div className="activity-icon skel-icon" />
                  <div className="activity-info">
                    <div className="skel-block skel-line-lg" />
                    <div className="skel-block skel-line-sm" />
                  </div>
                </div>
              </div>
            ))}

            {!loading && (!stats || stats.recent_activity.length === 0) && (
              <div className="activity-empty">
                <span>No activity recorded yet.</span>
                <span className="activity-empty-hint">
                  Approve or reject a proposal to see it here.
                </span>
              </div>
            )}

            {!loading && stats && stats.recent_activity.map(item => {
              const ds = DECISION_STYLE[item.decision] ?? DECISION_STYLE.approved
              return (
                <div key={item.id} className="activity-row">
                  <div className="activity-left">
                    <div
                      className="activity-icon"
                      style={{ color: ds.color, background: ds.bg }}>
                      {ds.icon}
                    </div>
                    <div className="activity-info">
                      <span className="activity-page">{item.page_title}</span>
                      <span className="activity-meta">
                        {ACTION_LABEL[item.action] ?? item.action}
                        {item.space_key ? ` · ${item.space_key}` : ""}
                        {item.reviewed_by ? ` · by ${item.reviewed_by}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="activity-right">
                    <span
                      className="issue-pill"
                      style={{ background: ds.bg, color: ds.color }}>
                      {item.decision}
                    </span>
                    <span className="activity-time">{relativeTime(item.updated_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Side col */}
        <div className="side-col">

          <div className="card connect-card">
            <div className="connect-icon">⬡</div>
            <h3 className="connect-title">Confluence Connected</h3>
            <p className="connect-sub">
              {stats && stats.pages_total > 0
                ? `${stats.pages_total} pages synced across ${stats.spaces_total} space${stats.spaces_total !== 1 ? "s" : ""}.`
                : "Sync your workspace from the Pages tab to get started."}
            </p>
            <div className="connect-status">
              <div className="status-dot" />
              <span>Live</span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Workflow</h2>
            </div>
            <div className="steps-list">
              {[
                { done: (stats?.pages_total ?? 0) > 0,     label: "Workspace synced" },
                { done: (stats?.decisions_made ?? 0) > 0,  label: "First decision made" },
                { done: (stats?.changes_applied ?? 0) > 0, label: "Change applied to Confluence" },
                { done: false,                               label: "Invite a team member" },
                { done: false,                               label: "Schedule recurring sync" },
              ].map((step, i) => (
                <div key={i} className={`step-row${step.done ? " done" : ""}`}>
                  <div className="step-check">{step.done ? "✓" : ""}</div>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
