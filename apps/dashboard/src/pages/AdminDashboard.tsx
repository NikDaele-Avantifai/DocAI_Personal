import { useState, useEffect } from "react"
import "./AdminDashboard.css"

// ── Types ─────────────────────────────────────────────────────────────────────

type Usage = {
  analyses: number
  chat: number
  rename: number
  duplication_scans: number
}

type WorkspaceRow = {
  id: string
  owner_email: string | null
  plan: string
  effective_plan: string
  confluence_connected: boolean
  confluence_base_url: string | null
  trial_ends_at: string | null
  is_trial_expired: boolean
  created_at: string
  current_month_usage: Usage
}

type WorkspacesResponse = {
  period: string
  total_workspaces: number
  workspaces: WorkspaceRow[]
}

type StatsResponse = {
  total_workspaces: number
  confluence_connected: number
  by_plan: Record<string, number>
  current_month: {
    total_analyses: number
    total_chat_messages: number
  }
}

type TeamMember = {
  id: number
  email: string
  role: string
  joined_at: string | null
}

type MonthlyTrend = {
  period: string
  analyses: number
  chat: number
  rename: number
  duplication_scans: number
}

type TokenUsage = {
  claude_input_tokens: number
  claude_output_tokens: number
  claude_cost_usd: number
  claude_cost_eur: number
  voyage_tokens: number
  voyage_cost_usd: number
  voyage_cost_eur: number
  total_cost_usd: number
  total_cost_eur: number
}

type WorkspaceDetail = {
  id: string
  owner_email: string | null
  owner_sub: string
  plan: string
  effective_plan: string
  trial_ends_at: string | null
  is_trial_expired: boolean
  confluence_connected: boolean
  confluence_base_url: string | null
  confluence_email: string | null
  onboarding_completed: boolean
  created_at: string
  updated_at: string
  current_month_usage: {
    period: string
    analyses: number
    chat: number
    rename: number
    duplication_scans: number
  }
  monthly_trend: MonthlyTrend[]
  token_usage: TokenUsage
  team_members: TeamMember[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SESSION_KEY = "docai_admin_token"
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""

function getToken() {
  return sessionStorage.getItem(SESSION_KEY) ?? ""
}

async function adminFetch(path: string, options: RequestInit = {}) {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": token,
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body}`)
  }
  return res.json()
}

function formatDate(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "1d ago"
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months === 1 ? "1mo ago" : `${months}mo ago`
}

const PLAN_LABEL: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
  expired: "Expired",
}

// ── Token entry ───────────────────────────────────────────────────────────────

function TokenEntry() {
  const [value, setValue] = useState("")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    sessionStorage.setItem(SESSION_KEY, value.trim())
    window.location.reload()
  }

  return (
    <div className="adm-gate">
      <div className="adm-gate-card">
        <div className="adm-gate-title">DocAI Admin</div>
        <form className="adm-gate-form" onSubmit={submit}>
          <input
            className="adm-gate-input"
            type="password"
            placeholder="Admin token"
            value={value}
            onChange={e => setValue(e.target.value)}
            autoFocus
          />
          <button className="adm-gate-btn" type="submit">Enter</button>
        </form>
      </div>
    </div>
  )
}

// ── Plan badge ────────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={`adm-plan-badge adm-plan-${plan}`}>
      {PLAN_LABEL[plan] ?? plan}
    </span>
  )
}

// ── Workspace detail page ─────────────────────────────────────────────────────

function WorkspaceDetailPage({
  workspaceId,
  onBack,
  onToast,
}: {
  workspaceId: string
  onBack: () => void
  onToast: (msg: string) => void
}) {
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingEmail, setEditingEmail] = useState(false)
  const [emailValue, setEmailValue] = useState("")
  const [savingEmail, setSavingEmail] = useState(false)

  const [changingPlan, setChangingPlan] = useState(false)

  const [showDelete, setShowDelete] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState("")
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const d = await adminFetch(`/api/admin/workspaces/${workspaceId}`)
      setDetail(d)
      setEmailValue(d.owner_email ?? "")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspaceId])

  async function saveEmail() {
    setSavingEmail(true)
    try {
      await adminFetch(`/api/admin/workspaces/${workspaceId}/email`, {
        method: "PATCH",
        body: JSON.stringify({ email: emailValue }),
      })
      onToast("Email updated")
      setEditingEmail(false)
      await load()
    } catch (e: unknown) {
      onToast(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSavingEmail(false)
    }
  }

  async function changePlan(plan: string) {
    setChangingPlan(true)
    try {
      await adminFetch(`/api/admin/workspaces/${workspaceId}/plan`, {
        method: "PATCH",
        body: JSON.stringify({ plan }),
      })
      onToast(`Plan updated to ${plan}`)
      await load()
    } catch (e: unknown) {
      onToast(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setChangingPlan(false)
    }
  }

  async function deleteWorkspace() {
    if (deleteConfirm !== workspaceId) return
    setDeleting(true)
    try {
      await adminFetch(`/api/admin/workspaces/${workspaceId}`, { method: "DELETE" })
      onToast("Workspace deleted")
      onBack()
    } catch (e: unknown) {
      onToast(`Error: ${e instanceof Error ? e.message : String(e)}`)
      setDeleting(false)
    }
  }

  if (loading) return <div className="adm-detail-loading">Loading workspace…</div>
  if (error)   return <div className="adm-detail-error">⚠ {error}</div>
  if (!detail) return null

  const plans = ["trial", "starter", "growth", "scale"]

  return (
    <div className="adm-detail-root">
      <div className="adm-detail-header">
        <button className="adm-back-btn" onClick={onBack}>← Back to workspaces</button>
        <span className="adm-detail-header-title">{detail.owner_email ?? detail.id}</span>
        <PlanBadge plan={detail.is_trial_expired ? "expired" : detail.plan} />
      </div>

      <div className="adm-detail-body">

        {/* Left column */}
        <div className="adm-detail-col">

          <div className="adm-detail-card">
            <div className="adm-detail-card-title">Account</div>

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Owner email</div>
              {editingEmail ? (
                <div className="adm-detail-field-edit">
                  <input
                    className="adm-detail-input"
                    value={emailValue}
                    onChange={e => setEmailValue(e.target.value)}
                    type="email"
                    autoFocus
                  />
                  <button className="adm-detail-btn-primary" onClick={saveEmail} disabled={savingEmail}>
                    {savingEmail ? "Saving…" : "Save"}
                  </button>
                  <button className="adm-detail-btn-ghost" onClick={() => { setEditingEmail(false); setEmailValue(detail.owner_email ?? "") }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="adm-detail-field-value">
                  {detail.owner_email ?? "—"}
                  <button className="adm-detail-edit-link" onClick={() => setEditingEmail(true)}>Edit</button>
                </div>
              )}
            </div>

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Auth0 subject</div>
              <div className="adm-detail-field-value adm-detail-mono">{detail.owner_sub}</div>
            </div>

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Workspace ID</div>
              <div className="adm-detail-field-value adm-detail-mono">{detail.id}</div>
            </div>

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Created</div>
              <div className="adm-detail-field-value">{formatDate(detail.created_at)}</div>
            </div>

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Last updated</div>
              <div className="adm-detail-field-value">{formatDate(detail.updated_at)}</div>
            </div>

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Onboarding</div>
              <div className="adm-detail-field-value">
                {detail.onboarding_completed ? "✓ Completed" : "⚠ Incomplete"}
              </div>
            </div>
          </div>

          <div className="adm-detail-card">
            <div className="adm-detail-card-title">Plan</div>

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Current plan</div>
              <div className="adm-detail-field-value">
                <PlanBadge plan={detail.is_trial_expired ? "expired" : detail.plan} />
              </div>
            </div>

            {detail.trial_ends_at && (
              <div className="adm-detail-field">
                <div className="adm-detail-field-label">Trial ends</div>
                <div className="adm-detail-field-value">{formatDate(detail.trial_ends_at)}</div>
              </div>
            )}

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Change plan</div>
              <div className="adm-detail-plan-btns">
                {plans.filter(p => p !== detail.plan).map(p => (
                  <button key={p} className="adm-detail-plan-btn" disabled={changingPlan} onClick={() => changePlan(p)}>
                    {PLAN_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="adm-detail-card">
            <div className="adm-detail-card-title">Confluence</div>

            <div className="adm-detail-field">
              <div className="adm-detail-field-label">Status</div>
              <div className="adm-detail-field-value">
                {detail.confluence_connected
                  ? <span className="adm-connected">✓ Connected</span>
                  : <span className="adm-disconnected">✗ Not connected</span>}
              </div>
            </div>

            {detail.confluence_base_url && (
              <div className="adm-detail-field">
                <div className="adm-detail-field-label">Base URL</div>
                <div className="adm-detail-field-value adm-detail-mono" style={{ fontSize: 12 }}>
                  {detail.confluence_base_url}
                </div>
              </div>
            )}

            {detail.confluence_email && (
              <div className="adm-detail-field">
                <div className="adm-detail-field-label">API email</div>
                <div className="adm-detail-field-value">{detail.confluence_email}</div>
              </div>
            )}
          </div>

          <div className="adm-detail-card">
            <div className="adm-detail-card-title">Team members ({detail.team_members.length + 1})</div>
            <div className="adm-detail-members">
              <div className="adm-detail-member-row">
                <span className="adm-detail-member-email">{detail.owner_email ?? "—"}</span>
                <span className="adm-detail-member-role owner">Owner</span>
              </div>
              {detail.team_members.map(m => (
                <div key={m.id} className="adm-detail-member-row">
                  <span className="adm-detail-member-email">{m.email}</span>
                  <span className={`adm-detail-member-role ${m.role}`}>{m.role}</span>
                </div>
              ))}
              {detail.team_members.length === 0 && (
                <div className="adm-detail-empty-row">No additional members</div>
              )}
            </div>
          </div>

        </div>

        {/* Right column */}
        <div className="adm-detail-col">

          <div className="adm-detail-card">
            <div className="adm-detail-card-title">Usage — {detail.current_month_usage.period}</div>
            <div className="adm-detail-usage-grid">
              {[
                { label: "Page analyses",      value: detail.current_month_usage.analyses },
                { label: "Chat messages",       value: detail.current_month_usage.chat },
                { label: "Batch renames",       value: detail.current_month_usage.rename },
                { label: "Duplication scans",   value: detail.current_month_usage.duplication_scans },
              ].map(item => (
                <div key={item.label} className="adm-detail-usage-item">
                  <div className="adm-detail-usage-value">{item.value}</div>
                  <div className="adm-detail-usage-label">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="adm-detail-card">
            <div className="adm-detail-card-title">3-Month Trend</div>
            <table className="adm-detail-trend-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Analyses</th>
                  <th>Chat</th>
                  <th>Renames</th>
                  <th>Scans</th>
                </tr>
              </thead>
              <tbody>
                {detail.monthly_trend.map(t => (
                  <tr key={t.period}>
                    <td className="adm-detail-mono">{t.period}</td>
                    <td>{t.analyses}</td>
                    <td>{t.chat}</td>
                    <td>{t.rename}</td>
                    <td>{t.duplication_scans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-detail-card">
            <div className="adm-detail-card-title">API Cost (All Time)</div>

            <div className="adm-detail-cost-section">
              <div className="adm-detail-cost-label">Claude (Anthropic)</div>
              <div className="adm-detail-cost-row">
                <span>Input tokens</span>
                <span>{detail.token_usage.claude_input_tokens.toLocaleString()}</span>
              </div>
              <div className="adm-detail-cost-row">
                <span>Output tokens</span>
                <span>{detail.token_usage.claude_output_tokens.toLocaleString()}</span>
              </div>
              <div className="adm-detail-cost-row adm-detail-cost-total">
                <span>Cost</span>
                <span>
                  ${detail.token_usage.claude_cost_usd.toFixed(4)}
                  <span className="adm-detail-cost-eur"> / €{detail.token_usage.claude_cost_eur.toFixed(4)}</span>
                </span>
              </div>
            </div>

            <div className="adm-detail-cost-section">
              <div className="adm-detail-cost-label">Voyage AI</div>
              <div className="adm-detail-cost-row">
                <span>Tokens embedded</span>
                <span>{detail.token_usage.voyage_tokens.toLocaleString()}</span>
              </div>
              <div className="adm-detail-cost-row adm-detail-cost-total">
                <span>Cost</span>
                <span>
                  ${detail.token_usage.voyage_cost_usd.toFixed(4)}
                  <span className="adm-detail-cost-eur"> / €{detail.token_usage.voyage_cost_eur.toFixed(4)}</span>
                </span>
              </div>
            </div>

            <div className="adm-detail-cost-grand-total">
              <span>Total estimated cost</span>
              <span>
                ${detail.token_usage.total_cost_usd.toFixed(2)}
                <span className="adm-detail-cost-eur"> / €{detail.token_usage.total_cost_eur.toFixed(2)}</span>
              </span>
            </div>

            <div className="adm-detail-cost-note">
              Token tracking requires track_claude_usage() to be called in analyze.py, chat.py, and batch.py.
              Costs shown are all-time, not current month only.
            </div>
          </div>

          <div className="adm-detail-card adm-detail-danger-card">
            <div className="adm-detail-card-title adm-detail-danger-title">Danger Zone</div>

            {!showDelete ? (
              <>
                <p className="adm-detail-danger-desc">
                  Permanently delete this workspace and all associated data. This action cannot be undone.
                </p>
                <button className="adm-detail-danger-btn" onClick={() => setShowDelete(true)}>
                  Delete workspace
                </button>
              </>
            ) : (
              <div className="adm-detail-delete-confirm">
                <p className="adm-detail-danger-desc">Type the workspace ID to confirm deletion:</p>
                <div className="adm-detail-mono adm-detail-delete-id">{workspaceId}</div>
                <input
                  className="adm-detail-input"
                  placeholder="Paste workspace ID here"
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                />
                <div className="adm-detail-delete-actions">
                  <button
                    className="adm-detail-danger-btn-confirm"
                    disabled={deleteConfirm !== workspaceId || deleting}
                    onClick={deleteWorkspace}>
                    {deleting ? "Deleting…" : "Permanently delete"}
                  </button>
                  <button className="adm-detail-btn-ghost" onClick={() => { setShowDelete(false); setDeleteConfirm("") }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

type PlanFilter = "all" | "trial" | "starter" | "growth" | "scale" | "expired"
const PLAN_FILTERS: PlanFilter[] = ["all", "trial", "starter", "growth", "scale", "expired"]

export default function AdminDashboard() {
  const hasToken = Boolean(getToken())

  const [data, setData] = useState<WorkspacesResponse | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all")
  const [search, setSearch] = useState("")
  const [toast, setToast] = useState<string | null>(null)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)

  if (!hasToken) return <TokenEntry />

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ws, st] = await Promise.all([
        adminFetch("/api/admin/workspaces"),
        adminFetch("/api/admin/stats"),
      ])
      setData(ws)
      setStats(st)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.startsWith("403")) {
        sessionStorage.removeItem(SESSION_KEY)
        window.location.reload()
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { load() }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY)
    window.location.reload()
  }

  const filtered = (data?.workspaces ?? []).filter(ws => {
    const effectivePlan = ws.is_trial_expired ? "expired" : ws.plan
    if (planFilter !== "all" && effectivePlan !== planFilter) return false
    if (search && !(ws.owner_email ?? "").toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Detail view
  if (selectedWorkspaceId) {
    return (
      <div className="adm-root">
        <div className="adm-header">
          <span className="adm-header-title">DocAI Admin Dashboard</span>
          <button className="adm-signout-btn" onClick={signOut}>Sign out</button>
        </div>
        <WorkspaceDetailPage
          workspaceId={selectedWorkspaceId}
          onBack={() => setSelectedWorkspaceId(null)}
          onToast={showToast}
        />
        {toast && <div className="adm-toast">{toast}</div>}
      </div>
    )
  }

  return (
    <div className="adm-root">
      {/* Header */}
      <div className="adm-header">
        <span className="adm-header-title">DocAI Admin Dashboard</span>
        <button className="adm-signout-btn" onClick={signOut}>Sign out</button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="adm-stats-row">
          <div className="adm-stat-card">
            <div className="adm-stat-value">{stats.total_workspaces}</div>
            <div className="adm-stat-label">Total workspaces</div>
          </div>
          <div className="adm-stat-card">
            <div className="adm-stat-value">{stats.confluence_connected}</div>
            <div className="adm-stat-label">Confluence connected</div>
          </div>
          <div className="adm-stat-card">
            <div className="adm-stat-value">{stats.current_month.total_analyses}</div>
            <div className="adm-stat-label">Analyses this month</div>
          </div>
          <div className="adm-stat-card">
            <div className="adm-stat-value">{stats.current_month.total_chat_messages}</div>
            <div className="adm-stat-label">Chat messages this month</div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="adm-filter-bar">
        <div className="adm-plan-filters">
          {PLAN_FILTERS.map(f => (
            <button
              key={f}
              className={`adm-filter-btn${planFilter === f ? " active" : ""}`}
              onClick={() => setPlanFilter(f)}>
              {f === "all" ? "All" : PLAN_LABEL[f] ?? f}
            </button>
          ))}
        </div>
        <input
          className="adm-search"
          type="search"
          placeholder="Search by email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="adm-table-wrap">
        {loading && <div className="adm-loading">Loading…</div>}
        {error && <div className="adm-error">⚠ {error}</div>}

        {!loading && !error && (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Plan</th>
                <th>Trial ends</th>
                <th>Connected</th>
                <th>Usage (mo)</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="adm-empty">No workspaces match your filter.</td>
                </tr>
              )}
              {filtered.map(ws => {
                const effectivePlan = ws.is_trial_expired ? "expired" : ws.plan
                return (
                  <tr key={ws.id}>
                    <td className="adm-td-email">
                      <span className="adm-email">{ws.owner_email ?? "—"}</span>
                      {ws.confluence_base_url && (
                        <span className="adm-url">{ws.confluence_base_url.replace(/https?:\/\//, "")}</span>
                      )}
                    </td>
                    <td><PlanBadge plan={effectivePlan} /></td>
                    <td className="adm-td-muted">
                      {ws.plan === "trial" ? formatDate(ws.trial_ends_at) : "—"}
                    </td>
                    <td>
                      {ws.confluence_connected
                        ? <span className="adm-connected">✓</span>
                        : <span className="adm-disconnected">✗</span>}
                    </td>
                    <td className="adm-td-usage">
                      <span title="Analyses">{ws.current_month_usage.analyses}a</span>
                      {" · "}
                      <span title="Chat">{ws.current_month_usage.chat}c</span>
                    </td>
                    <td className="adm-td-muted">{relativeTime(ws.created_at)}</td>
                    <td>
                      <div className="adm-row-actions">
                        <button
                          className="adm-row-btn adm-row-btn-edit"
                          onClick={() => setSelectedWorkspaceId(ws.id)}
                          title="View details">
                          Edit
                        </button>
                        <button
                          className="adm-row-btn adm-row-btn-delete"
                          onClick={() => setSelectedWorkspaceId(ws.id)}
                          title="Delete workspace">
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast */}
      {toast && <div className="adm-toast">{toast}</div>}
    </div>
  )
}
