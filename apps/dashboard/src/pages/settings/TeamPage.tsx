import { useState, useEffect } from "react"
import { apiClient } from "@/lib/api"
import { useRole } from "@/contexts/WorkspaceContext"
import { AdminOnly } from "@/components/AdminOnly"
import "./TeamPage.css"

interface Member {
  id: number
  email: string
  role: "admin" | "viewer"
  joined_at: string
  invited_by: string | null
}

interface PendingInvite {
  id: number
  email: string
  role: "admin" | "viewer"
  expires_at: string
  invited_by: string | null
}

interface MembersData {
  owner: { email: string | null; role: string; is_owner: boolean }
  members: Member[]
  pending_invites: PendingInvite[]
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

function RoleBadge({ role }: { role: string }) {
  const label = role === "admin" ? "Admin" : role === "editor" ? "Editor" : "Viewer"
  return (
    <span className={`team-role-badge team-role-badge-${role}`}>
      {label}
    </span>
  )
}

export default function TeamPage() {
  const { isAdmin } = useRole()
  const [data, setData] = useState<MembersData | null>(null)
  const [loading, setLoading] = useState(true)

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "editor" | "viewer">("viewer")
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Per-member role update state
  const [updatingRole, setUpdatingRole] = useState<number | null>(null)
  const [removingId, setRemovingId] = useState<number | null>(null)
  const [cancellingId, setCancellingId] = useState<number | null>(null)

  async function load() {
    try {
      const res = await apiClient.get("/api/workspace/members")
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function sendInvite() {
    setInviting(true)
    setInviteSuccess(null)
    setInviteError(null)
    try {
      await apiClient.post("/api/workspace/members/invite", {
        email: inviteEmail,
        role: inviteRole,
      })
      setInviteSuccess(
        `Invite created for ${inviteEmail}. Remember to add them to the Auth0 allowlist before they can log in.`
      )
      setInviteEmail("")
      setInviteRole("viewer")
      await load()
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      if (typeof detail === "string") {
        setInviteError(detail)
      } else {
        setInviteError("Failed to send invite.")
      }
    } finally {
      setInviting(false)
    }
  }

  async function updateRole(memberId: number, role: "admin" | "editor" | "viewer") {
    setUpdatingRole(memberId)
    try {
      await apiClient.patch(`/api/workspace/members/${memberId}/role`, { role })
      await load()
    } catch {
      // silently ignore — role reverts on reload
    } finally {
      setUpdatingRole(null)
    }
  }

  async function removeMember(memberId: number, email: string) {
    if (!window.confirm(`Remove ${email} from workspace?`)) return
    setRemovingId(memberId)
    try {
      await apiClient.delete(`/api/workspace/members/${memberId}`)
      await load()
    } catch {
      // silently ignore
    } finally {
      setRemovingId(null)
    }
  }

  async function cancelInvite(inviteId: number) {
    setCancellingId(inviteId)
    try {
      await apiClient.delete(`/api/workspace/invites/${inviteId}`)
      await load()
    } catch {
      // silently ignore
    } finally {
      setCancellingId(null)
    }
  }

  const totalMembers = (data?.members.length ?? 0) + 1 // +1 for owner

  return (
    <div className="team-page">
      {/* Header */}
      <div className="team-header">
        <h1 className="team-title">Team Members</h1>
        <p className="team-subtitle">Manage who has access to your DocAI workspace.</p>
      </div>

      {loading ? (
        <div className="team-loading">Loading…</div>
      ) : (
        <>
          {/* Members card */}
          <div className="ov-card">
            <div className="ov-card-head">
              <div>
                <div className="ov-card-title">Members</div>
                <div className="ov-card-sub">{totalMembers} member{totalMembers !== 1 ? "s" : ""}</div>
              </div>
            </div>

            <div className="team-members-list">
              {/* Owner row — always first */}
              {data?.owner && (
                <div className="team-member-row">
                  <div className="team-member-email">{data.owner.email || "—"}</div>
                  <div className="team-member-meta">
                    <RoleBadge role="admin" />
                    <span className="team-owner-tag">Owner</span>
                  </div>
                </div>
              )}

              {/* Accepted members */}
              {data?.members.map(m => (
                <div key={m.id} className="team-member-row">
                  <div className="team-member-email">{m.email}</div>
                  <div className="team-member-meta">
                    <RoleBadge role={m.role} />
                    <AdminOnly>
                      <select
                        className="team-role-select"
                        value={m.role}
                        disabled={updatingRole === m.id}
                        onChange={e => updateRole(m.id, e.target.value as "admin" | "editor" | "viewer")}>
                        <option value="viewer">Viewer — can view all data, no actions</option>
                        <option value="editor">Editor — can analyze, approve, run sweeps</option>
                        <option value="admin">Admin — full access including settings</option>
                      </select>
                      <button
                        className="team-remove-btn"
                        disabled={removingId === m.id}
                        onClick={() => removeMember(m.id, m.email)}>
                        {removingId === m.id ? "…" : "Remove"}
                      </button>
                    </AdminOnly>
                  </div>
                </div>
              ))}

              {data?.members.length === 0 && (
                <div className="team-empty-row">No additional members yet.</div>
              )}
            </div>
          </div>

          {/* Pending invites card */}
          {(data?.pending_invites.length ?? 0) > 0 && (
            <div className="ov-card">
              <div className="ov-card-head">
                <div className="ov-card-title">Pending Invitations</div>
              </div>
              <div className="team-members-list">
                {data!.pending_invites.map(inv => (
                  <div key={inv.id} className="team-member-row">
                    <div className="team-member-email">{inv.email}</div>
                    <div className="team-member-meta">
                      <RoleBadge role={inv.role} />
                      <span className="team-expires">
                        Expires in {daysUntil(inv.expires_at)}d
                      </span>
                      <AdminOnly>
                        <button
                          className="team-remove-btn"
                          disabled={cancellingId === inv.id}
                          onClick={() => cancelInvite(inv.id)}>
                          {cancellingId === inv.id ? "…" : "Cancel"}
                        </button>
                      </AdminOnly>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invite form — admin only */}
          <AdminOnly fallback={
            !isAdmin ? (
              <div className="ov-card">
                <div className="ov-card-head">
                  <div className="ov-card-title">Invite a Team Member</div>
                </div>
                <div className="team-viewer-notice">
                  Contact your workspace admin to invite new members.
                </div>
              </div>
            ) : null
          }>
            <div className="ov-card">
              <div className="ov-card-head">
                <div className="ov-card-title">Invite a Team Member</div>
              </div>
              <div className="team-invite-body">
                {/* Auth0 notice */}
                <div className="team-auth0-notice">
                  <span className="team-auth0-notice-icon">⚠</span>
                  <span>
                    After sending an invite, you must also add this email to the{" "}
                    <strong>DocAI_Login Auth0 Action allowlist</strong>. Contact your developer (
                    <a href="mailto:nikolaidaelemans@avantifai.com">nikolaidaelemans@avantifai.com</a>
                    ) to complete access setup.
                  </span>
                </div>

                <div className="team-invite-fields">
                  <input
                    className="team-invite-input"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={e => { setInviteEmail(e.target.value); setInviteSuccess(null); setInviteError(null) }}
                  />
                  <select
                    className="team-invite-select"
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as "admin" | "editor" | "viewer")}>
                    <option value="viewer">Viewer — can view all data, no actions</option>
                    <option value="editor">Editor — can analyze, approve, run sweeps</option>
                    <option value="admin">Admin — full access including settings</option>
                  </select>
                  <button
                    className="team-invite-btn"
                    disabled={inviting || !inviteEmail.trim()}
                    onClick={sendInvite}>
                    {inviting ? "Sending…" : "Send Invite"}
                  </button>
                </div>

                {inviteSuccess && (
                  <div className="team-invite-success">{inviteSuccess}</div>
                )}
                {inviteError && (
                  <div className="team-invite-error">⚠ {inviteError}</div>
                )}
              </div>
            </div>
          </AdminOnly>
        </>
      )}
    </div>
  )
}
