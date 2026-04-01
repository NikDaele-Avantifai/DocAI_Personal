import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { SkeletonRow } from "../components/Skeleton"
import "./OverviewPage.css"

const API_BASE = "http://localhost:8000"

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
  pages_healthy: number
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
  rename:         "Rename",
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

function calcHealthScore(stats: Stats): number {
  // Each unresolved proposal deducts points; each healthy page adds a bonus.
  // This means fixing pages visibly improves the score.
  const healthyBonus = (stats.pages_healthy ?? 0) * 2
  const score = 100
    - (stats.proposals_pending * 2)
    - (stats.proposals_awaiting_apply * 3)
    + healthyBonus
  return Math.max(0, Math.min(100, score))
}

function healthColor(score: number): string {
  if (score >= 80) return "var(--green)"
  if (score >= 50) return "var(--amber)"
  return "var(--red)"
}

function healthLabel(score: number): string {
  if (score >= 80) return "Healthy"
  if (score >= 50) return "Needs Attention"
  return "Critical"
}

export default function OverviewPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/api/stats/`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  const score = stats ? calcHealthScore(stats) : 0
  const color = healthColor(score)

  return (
    <div className="overview-layout">

      {/* ── Health Score Banner ── */}
      <div className="health-banner" style={{ borderLeftColor: color }}>
        <div className="health-banner-left">
          <div className="health-score-ring" style={{ "--score-color": color } as React.CSSProperties}>
            {loading
              ? <span className="health-score-num" style={{ color: "var(--text-3)" }}>—</span>
              : <span className="health-score-num" style={{ color }}>{score}</span>
            }
            <span className="health-score-label">/ 100</span>
          </div>
          <div>
            <div className="health-title">
              Documentation Health
              {!loading && stats && (
                <span className="health-badge" style={{
                  background: color === "var(--green)" ? "var(--green-bg)" : color === "var(--amber)" ? "var(--amber-bg)" : "var(--red-bg)",
                  color: color === "var(--green)" ? "var(--green-text)" : color === "var(--amber)" ? "var(--amber-text)" : "var(--red-text)",
                }}>
                  {healthLabel(score)}
                </span>
              )}
            </div>
            {stats && (
              <p className="health-sub">
                {stats.pages_total} pages ·{" "}
                <span style={{ color: "var(--green-text, #15803d)", fontWeight: 500 }}>
                  {stats.pages_healthy ?? 0} healthy
                </span>
                {" "}·{" "}{stats.proposals_pending} issue{stats.proposals_pending !== 1 ? "s" : ""} open ·{" "}
                {stats.proposals_awaiting_apply} awaiting apply
              </p>
            )}
          </div>
        </div>

        <div className="health-bar-wrap">
          <div className="health-bar-track">
            <div
              className="health-bar-fill"
              style={{ width: loading ? "0%" : `${score}%`, background: color }}
            />
          </div>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div className="ov-stats-row">
        {[
          { label: "Total Pages",       value: stats?.pages_total ?? "—",             delta: `${stats?.spaces_total ?? 0} spaces · ${stats?.pages_healthy ?? 0} healthy`, accent: "#5B73FF", path: "/pages"    },
          { label: "Issues Found",      value: stats?.proposals_pending ?? "—",        delta: "pending review",                               accent: "#FF991F", path: "/proposals" },
          { label: "Awaiting Apply",    value: stats?.proposals_awaiting_apply ?? "—", delta: "approved proposals",                           accent: "#818CF8", path: "/proposals" },
          { label: "Changes Applied",   value: stats?.changes_applied ?? "—",          delta: "published to Confluence",                      accent: "#36B37E", path: "/audit"    },
        ].map((card, i) => (
          <button
            key={i}
            className="ov-stat-card"
            onClick={() => navigate(card.path)}>
            <div className="ov-stat-accent" style={{ background: card.accent }} />
            {loading
              ? <>
                  <div className="skel-val" style={{ height: 36, width: "50%", background: "var(--surface-3)", borderRadius: 4, marginBottom: 8 }} />
                  <div className="skel-lbl" style={{ height: 12, width: "70%", background: "var(--surface-3)", borderRadius: 3 }} />
                </>
              : <>
                  <div className="ov-stat-value" style={{ color: card.accent }}>{card.value}</div>
                  <div className="ov-stat-label">{card.label}</div>
                  <div className="ov-stat-delta">{card.delta}</div>
                </>
            }
          </button>
        ))}
      </div>

      {/* ── Two column ── */}
      <div className="ov-grid">

        {/* Recent Activity */}
        <div className="ov-card">
          <div className="ov-card-header">
            <div>
              <h2 className="ov-card-title">Recent Activity</h2>
              <p className="ov-card-sub">Latest decisions from the approval workflow</p>
            </div>
            {stats && <span className="ov-card-badge">{stats.decisions_made} total</span>}
          </div>

          <div className="ov-activity-list">
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ padding: "8px 0" }}>
                <SkeletonRow />
              </div>
            ))}

            {!loading && (!stats || stats.recent_activity.length === 0) && (
              <div className="ov-empty">
                <span className="ov-empty-icon">📋</span>
                <p>No activity yet</p>
                <p className="ov-empty-hint">Approve or reject a proposal to see it here.</p>
                <button className="ov-quick-btn" onClick={() => navigate("/proposals")}>
                  Go to Proposals →
                </button>
              </div>
            )}

            {!loading && stats && stats.recent_activity.slice(0, 10).map(item => {
              const ds = DECISION_STYLE[item.decision] ?? DECISION_STYLE.approved
              return (
                <div key={item.id} className="ov-activity-row">
                  <div className="ov-activity-left">
                    <div className="ov-activity-icon" style={{ color: ds.color, background: ds.bg }}>
                      {ds.icon}
                    </div>
                    <div className="ov-activity-info">
                      <span className="ov-activity-page">{item.page_title}</span>
                      <span className="ov-activity-meta">
                        {ACTION_LABEL[item.action] ?? item.action}
                        {item.space_key ? ` · ${item.space_key}` : ""}
                        {item.reviewed_by ? ` · by ${item.reviewed_by}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="ov-activity-right">
                    <span className="ov-pill" style={{ background: ds.bg, color: ds.color }}>
                      {item.decision}
                    </span>
                    <span className="ov-time">{relativeTime(item.updated_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right column */}
        <div className="ov-side">

          {/* Top Issues */}
          <div className="ov-card">
            <div className="ov-card-header">
              <h2 className="ov-card-title">Status</h2>
            </div>
            <div className="ov-steps">
              {[
                { done: (stats?.pages_total ?? 0) > 0,      label: "Workspace synced",             path: "/pages"       },
                { done: (stats?.decisions_made ?? 0) > 0,   label: "First decision made",          path: "/proposals"   },
                { done: (stats?.changes_applied ?? 0) > 0,  label: "Change applied to Confluence", path: "/audit"       },
                { done: (stats?.pages_healthy ?? 0) > 0,    label: "First page marked healthy",    path: "/pages"       },
              ].map((step, i) => (
                <div
                  key={i}
                  className={`ov-step-row${step.done ? " done" : ""}`}
                  onClick={() => navigate(step.path)}>
                  <div className="ov-step-check">{step.done ? "✓" : ""}</div>
                  <span>{step.label}</span>
                  <span className="ov-step-arrow">→</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="ov-card">
            <div className="ov-card-header">
              <h2 className="ov-card-title">Quick Actions</h2>
            </div>
            <div className="ov-quick-actions">
              <button className="ov-quick-action-btn" onClick={() => navigate("/pages")}>
                <span className="ov-qa-icon">⟳</span>
                <div>
                  <div className="ov-qa-label">Sync Confluence</div>
                  <div className="ov-qa-sub">Fetch latest pages</div>
                </div>
              </button>
              <button className="ov-quick-action-btn" onClick={() => navigate("/duplicates")}>
                <span className="ov-qa-icon">⊕</span>
                <div>
                  <div className="ov-qa-label">Duplicate Scan</div>
                  <div className="ov-qa-sub">Find similar pages</div>
                </div>
              </button>
              <button className="ov-quick-action-btn" onClick={() => navigate("/batch-rename")}>
                <span className="ov-qa-icon">✎</span>
                <div>
                  <div className="ov-qa-label">Batch Rename</div>
                  <div className="ov-qa-sub">Fix page titles</div>
                </div>
              </button>
              <button className="ov-quick-action-btn" onClick={() => navigate("/proposals")}>
                <span className="ov-qa-icon">✓</span>
                <div>
                  <div className="ov-qa-label">Review Proposals</div>
                  <div className="ov-qa-sub">{stats?.proposals_pending ?? 0} pending</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
