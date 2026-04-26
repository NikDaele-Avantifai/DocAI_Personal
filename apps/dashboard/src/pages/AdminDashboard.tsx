import { useState, useEffect, useRef } from "react"
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const SESSION_KEY = "docai_admin_token"
const API_BASE = import.meta.env.VITE_API_URL ?? ""

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

// ── Actions dropdown ──────────────────────────────────────────────────────────

const PLAN_ACTIONS = [
  { label: "Upgrade to Starter", plan: "starter" },
  { label: "Upgrade to Growth",  plan: "growth"  },
  { label: "Upgrade to Scale",   plan: "scale"   },
  { label: "Reset to Trial",     plan: "trial"   },
]

function ActionsMenu({
  ws,
  onPlanChange,
  onToast,
}: {
  ws: WorkspaceRow
  onPlanChange: () => void
  onToast: (msg: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  async function setPlan(plan: string) {
    setOpen(false)
    setBusy(true)
    try {
      await adminFetch(`/api/admin/workspaces/${ws.id}/plan`, {
        method: "PATCH",
        body: JSON.stringify({ plan }),
      })
      onToast(`Plan updated to ${plan}`)
      onPlanChange()
    } catch (err: unknown) {
      onToast(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function copyId() {
    setOpen(false)
    navigator.clipboard.writeText(ws.id)
    onToast("Workspace ID copied")
  }

  return (
    <div className="adm-actions-wrap" ref={ref}>
      <button
        className="adm-dot-btn"
        disabled={busy}
        onClick={() => setOpen(o => !o)}
        title="Actions">
        {busy ? "…" : "⋯"}
      </button>
      {open && (
        <div className="adm-dropdown">
          {PLAN_ACTIONS.filter(a => a.plan !== ws.plan).map(a => (
            <button key={a.plan} className="adm-dropdown-item" onClick={() => setPlan(a.plan)}>
              {a.label}
            </button>
          ))}
          <div className="adm-dropdown-sep" />
          <button className="adm-dropdown-item" onClick={copyId}>
            Copy workspace ID
          </button>
        </div>
      )}
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
                      <ActionsMenu ws={ws} onPlanChange={load} onToast={showToast} />
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
