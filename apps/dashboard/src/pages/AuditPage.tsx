import { useState } from "react"
import "./AuditPage.css"

type AuditEntry = {
  id: string
  pageTitle: string
  pageSpace: string
  action: string
  actionLabel: string
  decision: "approved" | "rejected"
  reviewer: string
  reviewedAt: string
  dateGroup: string
  rationale: string
}

const ACTION_STYLE: Record<string, { color: string; bg: string }> = {
  archive:      { color: "#BF2600", bg: "rgba(191,38,0,0.08)"  },
  add_summary:  { color: "#0747A6", bg: "rgba(7,71,166,0.08)"  },
  update_owner: { color: "#974F0C", bg: "rgba(151,79,12,0.08)" },
  restructure:  { color: "#403294", bg: "rgba(64,50,148,0.08)" },
  merge:        { color: "#006644", bg: "rgba(0,102,68,0.08)"  },
}

const mockAuditLog: AuditEntry[] = [
  {
    id: "a1",
    pageTitle: "Legacy Onboarding v1",
    pageSpace: "Operations",
    action: "archive",
    actionLabel: "Archive",
    decision: "approved",
    reviewer: "You",
    reviewedAt: "3:42 PM",
    dateGroup: "Yesterday",
    rationale: "Page was 2+ years old with no owner. No objections from Operations.",
  },
  {
    id: "a2",
    pageTitle: "Engineering Runbook 2022",
    pageSpace: "Engineering",
    action: "add_summary",
    actionLabel: "Add Summary",
    decision: "rejected",
    reviewer: "You",
    reviewedAt: "2:15 PM",
    dateGroup: "Yesterday",
    rationale: "Page is still actively maintained — team confirmed in Slack.",
  },
  {
    id: "a3",
    pageTitle: "Product Roadmap Q2 2023",
    pageSpace: "Product",
    action: "update_owner",
    actionLabel: "Update Owner",
    decision: "approved",
    reviewer: "You",
    reviewedAt: "11:08 AM",
    dateGroup: "Yesterday",
    rationale: "Former owner had left the company. Ownership transferred to Product team.",
  },
  {
    id: "a4",
    pageTitle: "Security Policy v2",
    pageSpace: "Engineering",
    action: "restructure",
    actionLabel: "Restructure",
    decision: "approved",
    reviewer: "You",
    reviewedAt: "4:30 PM",
    dateGroup: "2 days ago",
    rationale: "Page lacked headers and was difficult to navigate. Structure improved.",
  },
  {
    id: "a5",
    pageTitle: "Sales Playbook 2021",
    pageSpace: "Sales",
    action: "archive",
    actionLabel: "Archive",
    decision: "rejected",
    reviewer: "You",
    reviewedAt: "9:15 AM",
    dateGroup: "2 days ago",
    rationale: "Sales team indicated portions are still referenced during onboarding.",
  },
  {
    id: "a6",
    pageTitle: "Incident Response Runbook",
    pageSpace: "Engineering",
    action: "update_owner",
    actionLabel: "Update Owner",
    decision: "approved",
    reviewer: "You",
    reviewedAt: "2:00 PM",
    dateGroup: "Mar 22",
    rationale: "On-call rotation changed. Ownership updated to Platform team.",
  },
]

export default function AuditPage() {
  const [filter, setFilter] = useState<"all" | "approved" | "rejected">("all")

  const filtered = mockAuditLog.filter(
    e => filter === "all" || e.decision === filter
  )

  const groupOrder = Array.from(new Set(mockAuditLog.map(e => e.dateGroup)))
  const groups = filtered.reduce<Record<string, AuditEntry[]>>((acc, entry) => {
    if (!acc[entry.dateGroup]) acc[entry.dateGroup] = []
    acc[entry.dateGroup].push(entry)
    return acc
  }, {})

  return (
    <div className="audit-layout">
      <div>
        <h1 className="audit-page-title">Audit Log</h1>
        <p className="audit-page-sub">Every approved and rejected change is recorded here.</p>
      </div>

      <div className="audit-controls">
        <div className="audit-filter-tabs">
          {(["all", "approved", "rejected"] as const).map(f => (
            <button
              key={f}
              className={`audit-tab${filter === f ? " active" : ""}`}
              onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="audit-count">{filtered.length} entries</span>
      </div>

      <div className="audit-timeline">
        {filtered.length === 0 && (
          <div className="audit-empty">No {filter} entries yet.</div>
        )}

        {groupOrder
          .filter(g => groups[g]?.length > 0)
          .map(group => (
            <div key={group} className="audit-date-group">
              <div className="audit-date-label">{group}</div>

              {groups[group].map(entry => {
                const style = ACTION_STYLE[entry.action] ?? ACTION_STYLE.add_summary
                return (
                  <div key={entry.id} className="audit-entry">
                    <div className={`audit-decision-icon ${entry.decision}`}>
                      {entry.decision === "approved" ? "✓" : "✕"}
                    </div>

                    <div className="audit-entry-main">
                      <div className="audit-entry-top">
                        <span className="audit-entry-page">{entry.pageTitle}</span>
                        <span
                          className="audit-action-badge"
                          style={{ color: style.color, background: style.bg }}>
                          {entry.actionLabel}
                        </span>
                      </div>
                      <div className="audit-rationale">{entry.rationale}</div>
                    </div>

                    <div className="audit-entry-right">
                      <div className="audit-reviewer">{entry.reviewer}</div>
                      <div className="audit-time">{entry.reviewedAt}</div>
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
