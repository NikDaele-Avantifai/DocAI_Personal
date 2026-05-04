import { useWorkspace, useRole } from "@/contexts/WorkspaceContext"
import { useAuth } from "@/contexts/AuthContext"
import "./ProfilePage.css"

function initials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/)
  return parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || email[0]?.toUpperCase() || "?"
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86400000))
}

function RoleBadge({ role }: { role: string }) {
  const label = role === "admin" ? "Admin" : role === "editor" ? "Editor" : "Viewer"
  return <span className={`prof-role-badge prof-role-${role}`}>{label}</span>
}

function PlanBadge({ plan }: { plan: string }) {
  const label = plan === "trial" ? "Trial" : plan === "starter" ? "Starter" : plan === "growth" ? "Growth" : plan === "scale" ? "Scale" : plan
  return <span className={`prof-plan-badge prof-plan-${plan}`}>{label}</span>
}

export default function ProfilePage() {
  const { workspace } = useWorkspace()
  const { user } = useAuth()
  const { role } = useRole()

  const email = user?.email || workspace?.owner_email || "—"
  const avatarLetters = email !== "—" ? initials(email) : "?"
  const trialDays = daysUntil(workspace?.trial_ends_at ?? null)
  const provider = email.includes("microsoft") || email.includes("outlook") || email.includes("hotmail")
    ? "Microsoft"
    : "your login provider"

  return (
    <div className="prof-root">
      <div className="prof-page-header">
        <h1 className="prof-title">Your Profile</h1>
        <p className="prof-subtitle">Your identity is managed through your login provider.</p>
      </div>

      <div className="prof-card">
        {/* Avatar + email header */}
        <div className="prof-avatar-row">
          <div className="prof-avatar">{avatarLetters}</div>
          <div className="prof-avatar-info">
            <div className="prof-avatar-email">{email}</div>
            <RoleBadge role={role} />
          </div>
        </div>

        <div className="prof-divider" />

        {/* Fields */}
        <div className="prof-fields">
          <div className="prof-field">
            <div className="prof-field-label">Email address</div>
            <div className="prof-field-value">{email}</div>
            <div className="prof-field-note">Managed by {provider}</div>
          </div>

          <div className="prof-field">
            <div className="prof-field-label">Workspace role</div>
            <div className="prof-field-value"><RoleBadge role={role} /></div>
          </div>

          <div className="prof-field">
            <div className="prof-field-label">Connected workspace</div>
            <div className="prof-field-value">
              {workspace?.confluence_base_url
                ? <span className="prof-workspace-url">{workspace.confluence_base_url.replace(/https?:\/\//, "")}</span>
                : <span className="prof-field-empty">Not connected</span>}
            </div>
          </div>

          <div className="prof-field">
            <div className="prof-field-label">Current plan</div>
            <div className="prof-field-value prof-plan-row">
              <PlanBadge plan={workspace?.effective_plan ?? workspace?.plan ?? "trial"} />
              {workspace?.plan === "trial" && trialDays !== null && (
                <span className="prof-trial-days">
                  {trialDays === 0 ? "Expires today" : `${trialDays} day${trialDays !== 1 ? "s" : ""} remaining`}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="prof-footer-note">
        To update your name or email, sign in with a different account or contact{" "}
        <a href="mailto:privacy@avantifai.com">privacy@avantifai.com</a>
      </p>
    </div>
  )
}
