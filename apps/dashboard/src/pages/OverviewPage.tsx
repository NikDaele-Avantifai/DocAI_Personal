import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { AlertCircle, CheckCircle2, Folder } from "lucide-react"
import { SkeletonRow } from "../components/Skeleton"
import { useTour } from "../contexts/TourContext"
import "./OverviewPage.css"
import { API_BASE } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

type IssueCategory = "stale" | "empty" | "no_owner" | "generic_title" | "needs_review"

type AtRiskPage = {
  id: string
  title: string
  space_key: string
  flags: IssueCategory[]
  word_count: number
  last_modified: string | null
  is_healthy: boolean
  is_folder?: boolean
}

type SweepResult = {
  id: number
  status: string
  pages_scanned: number
  pages_healthy: number
  pages_at_risk: number
  issue_counts: Record<IssueCategory, number>
  at_risk_pages: AtRiskPage[]
  completed_at: string | null
}

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

const ISSUE_META: Record<string, { label: string; color: string; bg: string }> = {
  stale:         { label: "Stale content",        color: "#92400e", bg: "#fef3c7" },
  empty:         { label: "Insufficient content",  color: "#991b1b", bg: "#fee2e2" },
  no_owner:      { label: "No owner assigned",     color: "#374151", bg: "#f3f4f6" },
  generic_title: { label: "Generic title",         color: "#1e40af", bg: "#dbeafe" },
  needs_review:  { label: "Has open issues",       color: "#065f46", bg: "#d1fae5" },
}

const FLAG_SHORT: Record<string, string> = {
  stale:         "Stale",
  empty:         "Empty",
  no_owner:      "No owner",
  generic_title: "Generic",
  needs_review:  "Review",
}

const DECISION_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  approved:    { color: "#065f46", bg: "#d1fae5", label: "Approved"    },
  rejected:    { color: "#991b1b", bg: "#fee2e2", label: "Rejected"    },
  applied:     { color: "#1e40af", bg: "#dbeafe", label: "Applied"     },
  rolled_back: { color: "#92400e", bg: "#fef3c7", label: "Rolled back" },
  pending:     { color: "#374151", bg: "#f3f4f6", label: "Pending"     },
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
  targeted_fix:   "Targeted fix",
}

const ISSUE_ORDER: IssueCategory[] = ["empty", "stale", "no_owner", "generic_title", "needs_review"]

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

function calcHealthScore(stats: Stats, sweep: SweepResult | null): number {
  let score = 100
  score -= stats.proposals_pending * 2
  score -= stats.proposals_awaiting_apply * 3
  score += (stats.pages_healthy ?? 0) * 2
  // Factor content quality from latest sweep (up to -25 pts)
  if (sweep && sweep.pages_scanned > 0) {
    const riskRatio = sweep.pages_at_risk / sweep.pages_scanned
    score -= Math.round(riskRatio * 25)
  }
  return Math.max(0, Math.min(100, score))
}

export default function OverviewPage() {
  const navigate = useNavigate()
  const { startTour, showWelcome, dismissWelcome } = useTour()
  const { isTokenReady } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [sweep, setSweep] = useState<SweepResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [sweepLoading, setSweepLoading] = useState(false)

  useEffect(() => {
    if (!isTokenReady) return
    Promise.all([
      fetch(`${API_BASE}/api/stats/`).then(r => r.json()),
      fetch(`${API_BASE}/api/sweep/latest`).then(r => r.json()).catch(() => null),
    ]).then(([s, sw]) => {
      setStats(s)
      setSweep(sw || null)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [isTokenReady])

  // Immediately update health state when a proposal is applied in ApprovalsPage
  useEffect(() => {
    function onHealthUpdated(e: Event) {
      const { pageId, isHealthy } = (e as CustomEvent).detail

      // Update sweep: remove the page from at_risk_pages if now healthy
      setSweep(prev => {
        if (!prev) return prev
        if (!isHealthy) return prev
        const wasAtRisk = prev.at_risk_pages.some(p => p.id === pageId)
        if (!wasAtRisk) return prev
        const newAtRisk = prev.at_risk_pages.filter(p => p.id !== pageId)
        return {
          ...prev,
          at_risk_pages: newAtRisk,
          pages_at_risk: Math.max(0, prev.pages_at_risk - 1),
          pages_healthy: prev.pages_healthy + 1,
        }
      })

      // Update stats: recalculate pages_healthy for the health score
      setStats(prev => {
        if (!prev) return prev
        if (!isHealthy) return prev
        return {
          ...prev,
          pages_healthy: prev.pages_healthy + 1,
        }
      })
    }
    window.addEventListener("docai:pageHealthUpdated", onHealthUpdated)
    return () => window.removeEventListener("docai:pageHealthUpdated", onHealthUpdated)
  }, [])

  async function runSweep() {
    setSweepLoading(true)
    try {
      const result = await fetch(`${API_BASE}/api/sweep/run`, { method: "POST" }).then(r => r.json())
      setSweep(result)
      const newStats = await fetch(`${API_BASE}/api/stats/`).then(r => r.json())
      setStats(newStats)
    } catch {}
    setSweepLoading(false)
  }

  const score = stats ? calcHealthScore(stats, sweep) : 0
  const scoreColor = score >= 80 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626"
  const scoreLabel = score >= 80 ? "Healthy" : score >= 50 ? "Needs attention" : "Critical"
  const hasAtRisk = sweep && sweep.pages_at_risk > 0

  // Banner acknowledgement: mark seen after 2s; re-animates only on new sweep
  const [bannerAcknowledged, setBannerAcknowledged] = useState(() => {
    try {
      const ack = localStorage.getItem("docai_banner_ack")
      const sweepTs = sweep?.completed_at ?? null
      return !!ack && (!sweepTs || ack >= sweepTs)
    } catch { return false }
  })

  useEffect(() => {
    if (!sweep?.completed_at || bannerAcknowledged) return
    const timer = setTimeout(() => {
      try { localStorage.setItem("docai_banner_ack", sweep.completed_at!) } catch {}
      setBannerAcknowledged(true)
    }, 2000)
    return () => clearTimeout(timer)
  }, [sweep?.completed_at, bannerAcknowledged])

  // Re-check acknowledgement when a new sweep result arrives
  useEffect(() => {
    if (!sweep?.completed_at) return
    try {
      const ack = localStorage.getItem("docai_banner_ack")
      setBannerAcknowledged(!!ack && ack >= sweep.completed_at)
    } catch {}
  }, [sweep?.completed_at])

  const topIssues = sweep
    ? Object.entries(sweep.issue_counts ?? {})
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([k, v]) => `${v} ${ISSUE_META[k]?.label.toLowerCase() ?? k}`)
    : []

  return (
    <div className="ov-page">

      {/* Welcome banner */}
      {showWelcome && (
        <div className="tour-welcome-banner">
          <span className="tour-welcome-icon">👋</span>
          <div className="tour-welcome-text">
            <strong>Welcome to DocAI</strong> — take a 2-minute tour to see what this tool can do for your team.
          </div>
          <div className="tour-welcome-actions">
            <button className="tour-welcome-start" onClick={startTour}>Start tour</button>
            <button className="tour-welcome-dismiss" onClick={dismissWelcome}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="ov-header">
        <div className="ov-header-left">
          <h1 className="ov-title">Workspace Overview</h1>
          {sweep?.completed_at && !sweepLoading && (
            <span className="ov-last-sweep">Last sweep {relativeTime(sweep.completed_at)}</span>
          )}
        </div>
        <button
          className={`btn-sweep${sweepLoading ? " running" : ""}`}
          onClick={runSweep}
          disabled={sweepLoading}>
          <span className={`btn-sweep-icon${sweepLoading ? " spin" : ""}`}>↻</span>
          {sweepLoading ? "Scanning…" : "Run Sweep"}
        </button>
      </div>

      {/* Alert banner — shown after any sweep; accent color reflects health */}
      {!loading && sweep && (
        <div className={`ov-alert${hasAtRisk ? " ov-alert-issues" : " ov-alert-healthy"}${bannerAcknowledged ? " ov-alert-ack" : ""}`}>
          <div className="ov-alert-left">
            {hasAtRisk
              ? <AlertCircle size={14} color="#D97706" strokeWidth={2} style={{ flexShrink: 0 }} />
              : <CheckCircle2 size={14} color="#16A34A" strokeWidth={2} style={{ flexShrink: 0 }} />
            }
            <span className="ov-alert-msg">
              {hasAtRisk
                ? <><strong>{sweep.pages_at_risk} page{sweep.pages_at_risk !== 1 ? "s" : ""} need attention</strong>
                    {topIssues.length > 0 && <span className="ov-alert-detail"> — {topIssues.join(" · ")}</span>}</>
                : <><strong>Workspace is healthy</strong>
                    <span className="ov-alert-detail"> — {sweep.pages_scanned} pages scanned, no issues found</span></>
              }
            </span>
          </div>
          {hasAtRisk && (
            <button className="ov-alert-cta" onClick={() => navigate("/pages")}>
              Review pages →
            </button>
          )}
        </div>
      )}

      {/* Metrics */}
      <div data-tour="stats-row" className="ov-metrics">

        <div data-tour="health-score" className="ov-metric ov-metric-primary">
          <div className="ov-metric-header">
            <span className="ov-metric-label">Health score</span>
            <span className="ov-metric-badge" style={{ color: scoreColor, background: `${scoreColor}14` }}>
              {loading ? "—" : scoreLabel}
            </span>
          </div>
          <div className="ov-metric-value" style={{ color: scoreColor }}>
            {loading ? "—" : score}<span className="ov-metric-denom">/100</span>
          </div>
          <div className="ov-metric-bar">
            <div className="ov-metric-bar-fill" style={{ width: `${score}%`, background: scoreColor }} />
          </div>
          <div className="ov-metric-sub">
            {stats ? `${stats.pages_healthy} of ${stats.pages_total} pages healthy` : "Loading…"}
          </div>
        </div>

        <div className="ov-metric ov-metric-clickable" onClick={() => navigate("/pages")}>
          <div className="ov-metric-label">Pages at risk</div>
          <div className="ov-metric-value" style={{ color: sweep?.pages_at_risk ? "#dc2626" : "var(--text-1)" }}>
            {loading ? "—" : (sweep?.pages_at_risk ?? "—")}
          </div>
          <div className="ov-metric-sub">
            {sweep ? `out of ${sweep.pages_scanned} scanned` : "Run a sweep to check"}
          </div>
        </div>

        <div className="ov-metric ov-metric-clickable" onClick={() => navigate("/proposals")}>
          <div className="ov-metric-label">Open issues</div>
          <div className="ov-metric-value" style={{ color: stats?.proposals_pending ? "#d97706" : "var(--text-1)" }}>
            {loading ? "—" : (stats?.proposals_pending ?? 0)}
          </div>
          <div className="ov-metric-sub">
            {stats?.proposals_awaiting_apply
              ? `${stats.proposals_awaiting_apply} awaiting apply`
              : "pending review"}
          </div>
        </div>

        <div className="ov-metric ov-metric-clickable" onClick={() => navigate("/audit")}>
          <div className="ov-metric-label">Changes applied</div>
          <div className="ov-metric-value">{loading ? "—" : (stats?.changes_applied ?? 0)}</div>
          <div className="ov-metric-sub">published to Confluence</div>
        </div>
      </div>

      {/* Main grid */}
      <div className="ov-grid">

        {/* ── Left column ── */}
        <div className="ov-left">

          {/* Content Quality / Sweep results */}
          <div className="ov-card">
            <div className="ov-card-head">
              <div>
                <div className="ov-card-title">Content Quality</div>
                <div className="ov-card-sub">
                  {sweep
                    ? `${sweep.pages_scanned} pages indexed · ${sweep.pages_healthy} healthy`
                    : "Index your workspace to see content quality signals"}
                </div>
              </div>
              {!sweep && !sweepLoading && (
                <button className="btn-sweep-sm" onClick={runSweep}>Run Sweep</button>
              )}
              {sweepLoading && <span className="ov-card-badge-scanning">Scanning…</span>}
            </div>

            {!sweep && !sweepLoading && (
              <div className="ov-empty-sweep">
                <div className="ov-empty-sweep-icon">◎</div>
                <div className="ov-empty-sweep-title">No sweep data yet</div>
                <div className="ov-empty-sweep-desc">
                  A quick sweep checks every page for stale content, missing owners, and
                  structural issues — no AI credits required. Takes seconds.
                </div>
              </div>
            )}

            {sweepLoading && (
              <div className="ov-sweep-progress">
                <div className="ov-sweep-bar">
                  <div className="ov-sweep-bar-fill" />
                </div>
                <div className="ov-sweep-progress-label">Indexing workspace…</div>
              </div>
            )}

            {sweep && !sweepLoading && (
              <div className="ov-issue-breakdown">
                {ISSUE_ORDER.map(cat => {
                  const count = (sweep.issue_counts ?? {})[cat] ?? 0
                  const pct = sweep.pages_scanned > 0
                    ? Math.max((count / sweep.pages_scanned) * 100, count > 0 ? 3 : 0)
                    : 0
                  const meta = ISSUE_META[cat]
                  return (
                    <div key={cat} className="ov-issue-row">
                      <div className="ov-issue-label">{meta.label}</div>
                      <div
                        className="ov-issue-count"
                        style={{ color: count > 0 ? meta.color : "var(--text-3)" }}>
                        {count}
                      </div>
                      <div className="ov-issue-bar-track">
                        <div
                          className="ov-issue-bar-fill"
                          style={{ width: `${pct}%`, background: count > 0 ? meta.color : "transparent" }}
                        />
                      </div>
                    </div>
                  )
                })}

                <div className="ov-issue-footer">
                  <span className="ov-issue-stat">
                    <span className="ov-dot ov-dot-green" />
                    {sweep.pages_healthy} healthy
                  </span>
                  <span className="ov-issue-stat">
                    <span className="ov-dot ov-dot-red" />
                    {sweep.pages_at_risk} need attention
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* At-risk pages */}
          {sweep && sweep.at_risk_pages.length > 0 && (
            <div className="ov-card">
              <div className="ov-card-head">
                <div>
                  <div className="ov-card-title">Pages Needing Attention</div>
                  <div className="ov-card-sub">Sorted by severity — most issues first</div>
                </div>
                <span className="ov-card-badge">{sweep.pages_at_risk}</span>
              </div>
              <div className="ov-risk-list">
                {sweep.at_risk_pages.slice(0, 8).map(page => {
                  const isFolder = page.is_folder ?? false
                  const isEmpty = !isFolder && (page.flags ?? []).includes("empty")
                  const visibleFlags = (page.flags ?? []).filter(f =>
                    isFolder ? f === "generic_title" : true
                  )
                  return (
                    <div
                      key={page.id}
                      className="ov-risk-row"
                      onClick={() => navigate("/pages")}>
                      <div className="ov-risk-left">
                        <div className="ov-risk-title">
                          {isFolder && (
                            <Folder size={13} color="var(--text-3)" style={{ flexShrink: 0, marginRight: 5, verticalAlign: "middle" }} />
                          )}
                          {page.title}
                        </div>
                        <div className="ov-risk-meta">
                          {page.space_key && !/^~|^[0-9a-f]{8,}$/i.test(page.space_key) && (
                            <span className="ov-space-badge">{page.space_key}</span>
                          )}
                          {isFolder ? (
                            <span
                              className="ov-risk-folder-badge"
                              title="Structural container — rename via Batch Rename">
                              FOLDER
                            </span>
                          ) : isEmpty ? (
                            <span
                              className="ov-risk-words"
                              title="This page has no content. Add content in Confluence to enable AI analysis.">
                              {page.word_count} words
                            </span>
                          ) : page.word_count < 50 ? (
                            <span className="ov-risk-words">{page.word_count} words</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="ov-risk-flags">
                        {visibleFlags.slice(0, 3).map(f => (
                          <span
                            key={f}
                            className="ov-flag"
                            style={{ color: ISSUE_META[f]?.color, background: ISSUE_META[f]?.bg }}>
                            {FLAG_SHORT[f] ?? f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="ov-right">

          {/* Recent Decisions */}
          <div data-tour="activity-feed" className="ov-card">
            <div className="ov-card-head">
              <div>
                <div className="ov-card-title">Recent Decisions</div>
                <div className="ov-card-sub">Latest from the approval workflow</div>
              </div>
              {stats && <span className="ov-card-badge">{stats.decisions_made} total</span>}
            </div>

            {loading && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ padding: "10px 18px" }}><SkeletonRow /></div>
            ))}

            {!loading && (!stats || stats.recent_activity.length === 0) && (
              <div className="ov-empty-state">
                <div className="ov-empty-icon">📋</div>
                <div className="ov-empty-title">No decisions yet</div>
                <div className="ov-empty-desc">Approve or reject a proposal to see activity here.</div>
                <button className="ov-text-link" onClick={() => navigate("/proposals")}>
                  Go to Proposals →
                </button>
              </div>
            )}

            {!loading && stats && stats.recent_activity.slice(0, 4).map(item => {
              const ds = DECISION_STYLE[item.decision] ?? DECISION_STYLE.pending
              return (
                <div key={item.id} className="ov-activity-row">
                  <div className="ov-activity-body">
                    <div className="ov-activity-title">{item.page_title}</div>
                    <div className="ov-activity-meta">
                      {ACTION_LABEL[item.action] ?? item.action}
                      {item.reviewed_by ? ` · ${item.reviewed_by}` : ""}
                    </div>
                  </div>
                  <div className="ov-activity-right">
                    <span className="ov-pill" style={{ color: ds.color, background: ds.bg }}>
                      {ds.label}
                    </span>
                    <span className="ov-time">{relativeTime(item.updated_at)}</span>
                  </div>
                </div>
              )
            })}

            {!loading && stats && stats.recent_activity.length > 4 && (
              <div className="ov-activity-footer">
                <button className="ov-text-link" onClick={() => navigate("/audit")}>
                  View all {stats.recent_activity.length} decisions in Audit Log →
                </button>
              </div>
            )}

            {!loading && stats && stats.recent_activity.length > 0 && stats.recent_activity.length <= 4 && (
              <div className="ov-activity-footer">
                <button className="ov-text-link" onClick={() => navigate("/audit")}>
                  View Audit Log →
                </button>
              </div>
            )}
          </div>

          {/* Milestones */}
          <div className="ov-card">
            <div className="ov-card-head">
              <div className="ov-card-title">Milestones</div>
            </div>
            <div className="ov-milestones">
              {[
                { done: (stats?.pages_total ?? 0) > 0,     label: "Workspace synced",              path: "/pages"     },
                { done: !!sweep,                             label: "First sweep complete",           path: null         },
                { done: (stats?.decisions_made ?? 0) > 0,  label: "First decision made",            path: "/proposals" },
                { done: (stats?.changes_applied ?? 0) > 0, label: "Change published to Confluence", path: "/audit"     },
                { done: (stats?.pages_healthy ?? 0) > 0,   label: "First page marked healthy",      path: "/pages"     },
              ].map((step, i) => (
                <div
                  key={i}
                  className={`ov-milestone${step.done ? " done" : ""}${step.path ? " clickable" : ""}`}
                  onClick={() => step.path && navigate(step.path)}>
                  <div className={`ov-milestone-check${step.done ? " done" : ""}`}>
                    {step.done ? "✓" : ""}
                  </div>
                  <span className="ov-milestone-label">{step.label}</span>
                  {step.path && <span className="ov-milestone-arrow">→</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="ov-card">
            <div className="ov-card-head">
              <div className="ov-card-title">Quick Actions</div>
            </div>
            <div className="ov-quick-actions">
              {[
                { icon: "↻", label: "Sync Confluence",  sub: "Fetch latest pages",                    action: () => navigate("/pages")      },
                { icon: "◎", label: "Run Sweep",         sub: "Index and healthcheck workspace",        action: runSweep                       },
                { icon: "⊕", label: "Duplicate Scan",   sub: "Find similar pages",                    action: () => navigate("/duplicates")  },
                { icon: "✎", label: "Batch Rename",      sub: "Fix page titles",                       action: () => navigate("/batch-rename")},
                { icon: "✓", label: "Review Proposals", sub: `${stats?.proposals_pending ?? 0} pending`, action: () => navigate("/proposals") },
              ].map((qa, i) => (
                <button key={i} className="ov-qa-btn" onClick={qa.action}>
                  <span className="ov-qa-icon">{qa.icon}</span>
                  <div>
                    <div className="ov-qa-label">{qa.label}</div>
                    <div className="ov-qa-sub">{qa.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
