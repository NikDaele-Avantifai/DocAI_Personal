import { useState } from "react"
import "./DashboardPage.css"

const stats = [
  { label: "Pages Analyzed",  value: "1",  delta: "today",   color: "#5B73FF" },
  { label: "Issues Found",    value: "4",  delta: "active",   color: "#FF5566" },
  { label: "High Priority",   value: "2",  delta: "urgent",   color: "#FFB547" },
  { label: "Pages Healthy",   value: "0",  delta: "clean",    color: "#34D399" },
]

const activity = [
  { time: "Just now",   page: "Q3 2021 Sprint Retrospective", action: "Analyzed", issues: 4, severity: "high"   },
  { time: "2m ago",     page: "API Integration Guide",        action: "Analyzed", issues: 3, severity: "high"   },
  { time: "5m ago",     page: "Customer Onboarding Process",  action: "Analyzed", issues: 2, severity: "medium" },
  { time: "8m ago",     page: "Team Handbook 2024",           action: "Analyzed", issues: 0, severity: "none"   },
]

const SEV_COLOR: Record<string, string> = {
  high:   "#FF5566",
  medium: "#FFB547",
  low:    "#818CF8",
  none:   "#34D399",
}

const SEV_BG: Record<string, string> = {
  high:   "rgba(255,85,102,0.1)",
  medium: "rgba(255,181,71,0.1)",
  low:    "rgba(129,140,248,0.1)",
  none:   "rgba(52,211,153,0.1)",
}

export default function DashboardPage() {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)

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
            <div className="scan-dot" />
            <span>Last scan: just now</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {stats.map((s, i) => (
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

        {/* Activity log */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Recent Activity</h2>
              <p className="card-sub">Pages analyzed in this session</p>
            </div>
            <span className="card-badge">{activity.length} pages</span>
          </div>

          <div className="activity-list">
            {activity.map((item, i) => (
              <div
                key={i}
                className={`activity-row${hoveredRow === i ? " hovered" : ""}`}
                onMouseEnter={() => setHoveredRow(i)}
                onMouseLeave={() => setHoveredRow(null)}>
                <div className="activity-left">
                  <div className="activity-icon">◫</div>
                  <div className="activity-info">
                    <span className="activity-page">{item.page}</span>
                    <span className="activity-meta">{item.action} · {item.time}</span>
                  </div>
                </div>
                <div className="activity-right">
                  {item.issues === 0 ? (
                    <span className="issue-pill" style={{ background: SEV_BG.none, color: SEV_COLOR.none }}>
                      ✓ Healthy
                    </span>
                  ) : (
                    <span
                      className="issue-pill"
                      style={{ background: SEV_BG[item.severity], color: SEV_COLOR[item.severity] }}>
                      {item.issues} {item.issues === 1 ? "issue" : "issues"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick actions / status */}
        <div className="side-col">

          {/* Connect Confluence */}
          <div className="card connect-card">
            <div className="connect-icon">⬡</div>
            <h3 className="connect-title">Confluence Connected</h3>
            <p className="connect-sub">Extension is active and analyzing pages in real time via the browser extension.</p>
            <div className="connect-status">
              <div className="status-dot" />
              <span>Live</span>
            </div>
          </div>

          {/* What's next */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Next Steps</h2>
            </div>
            <div className="steps-list">
              {[
                { done: true,  label: "Extension installed" },
                { done: true,  label: "Backend API running" },
                { done: true,  label: "First page analyzed" },
                { done: false, label: "Connect Confluence API" },
                { done: false, label: "Set up approval workflow" },
                { done: false, label: "Enable audit logging" },
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