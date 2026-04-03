import { useState, useEffect, useRef } from "react"
import { Outlet, NavLink, useLocation } from "react-router-dom"
import "./Layout.css"
import { useTour } from '../contexts/TourContext'

const API_BASE = "http://localhost:8000"

const WORKSPACE_NAV = [
  { to: "/overview",   icon: "⬡", label: "Overview"    },
  { to: "/pages",      icon: "◫", label: "Pages"        },
  { to: "/duplicates", icon: "⊕", label: "Duplicates"  },
  { to: "/proposals",  icon: "✓", label: "Proposals"   },
  { to: "/audit",      icon: "≡", label: "Audit Log"   },
]

const TOOLS_NAV = [
  { to: "/batch-rename", icon: "✎", label: "Batch Rename", disabled: false },
  { to: null, icon: "⊞", label: "Restructure",  disabled: true },
  { to: null, icon: "⛨", label: "Compliance",   disabled: true },
]

const PAGE_TITLES: Record<string, { title: string; breadcrumb: string[] }> = {
  "/overview":    { title: "Overview",      breadcrumb: ["Workspace", "Overview"]    },
  "/pages":       { title: "Pages",         breadcrumb: ["Workspace", "Pages"]       },
  "/duplicates":  { title: "Duplicates",    breadcrumb: ["Workspace", "Duplicates"]  },
  "/proposals":   { title: "Proposals",     breadcrumb: ["Workspace", "Proposals"]   },
  "/audit":       { title: "Audit Log",     breadcrumb: ["Workspace", "Audit Log"]   },
  "/batch-rename":{ title: "Batch Rename",  breadcrumb: ["Tools", "Batch Rename"]    },
  "/settings":    { title: "Settings",      breadcrumb: ["Settings"]                 },
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never"
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function Layout() {
  const location = useLocation()
  const [profileOpen, setProfileOpen] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const profileRef = useRef<HTMLDivElement>(null)
  const { startTour, isDemoMode } = useTour()

  // Load user profile from localStorage
  const profile = (() => {
    try { return JSON.parse(localStorage.getItem("docai_profile") || "{}") } catch { return {} }
  })()
  const userName: string = profile.name || "User"
  const userRole: string = profile.role || "Admin"
  const initials = userName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) || "U"

  useEffect(() => {
    fetch(`${API_BASE}/api/stats/`)
      .then(r => r.json())
      .then(d => {
        setPendingCount(d.proposals_pending ?? 0)
        setLastSync(d.last_sync ?? null)
      })
      .catch(() => {})

    // Load notification count from localStorage
    try {
      const notifs = JSON.parse(localStorage.getItem("docai_notifications") || "[]")
      const unread = notifs.filter((n: any) => !n.read).length
      setNotifCount(unread)
    } catch {}
  }, [location.pathname])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    if (profileOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [profileOpen])

  async function handleSync() {
    setSyncing(true)
    try {
      await fetch(`${API_BASE}/api/sync/spaces`, { method: "POST" })
      setLastSync(new Date().toISOString())
    } catch {}
    setSyncing(false)
  }

  const pageInfo = PAGE_TITLES[location.pathname] ?? { title: "DocAI", breadcrumb: ["DocAI"] }

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="logo-mark">D</div>
          <span className="logo-text">DocAI</span>
          <span className="logo-badge">Beta</span>
        </div>

        {/* Search */}
        <div className="sidebar-search">
          <button
            className="sidebar-search-btn"
            onClick={() => {
              const ev = new CustomEvent("docai:opensearch")
              window.dispatchEvent(ev)
            }}>
            <span className="sidebar-search-icon">🔍</span>
            Search…
            <span className="sidebar-search-shortcut">⌘K</span>
          </button>
        </div>

        {/* Main nav */}
        <nav className="sidebar-nav">
          <div className="nav-section-label">Workspace</div>
          {WORKSPACE_NAV.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
              {label === "Proposals" && pendingCount > 0 && (
                <span className="nav-badge">{pendingCount}</span>
              )}
            </NavLink>
          ))}

          <div className="nav-section-label" style={{ marginTop: 8 }}>Tools</div>
          {TOOLS_NAV.map(({ to, icon, label, disabled }) =>
            disabled || !to ? (
              <div key={label} className="nav-item-disabled">
                <span className="nav-icon">{icon}</span>
                <span>{label}</span>
                <span style={{
                  marginLeft: "auto", fontSize: 9, fontWeight: 700,
                  color: "var(--amber-text)", background: "var(--amber-bg)",
                  padding: "2px 6px", borderRadius: 3, textTransform: "uppercase",
                  letterSpacing: "0.3px"
                }}>Soon</span>
              </div>
            ) : (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
                <span className="nav-icon">{icon}</span>
                <span>{label}</span>
              </NavLink>
            )
          )}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-footer-top">
            <div
              className="sidebar-user-avatar"
              onClick={() => setProfileOpen(v => !v)}
              title="Profile">
              {initials}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{userName}</div>
              <div className="sidebar-user-role">{userRole}</div>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <div className="api-status">
              <div className="status-dot" />
              <span>API Connected</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                className="sidebar-icon-btn"
                title="Notifications"
                onClick={() => {
                  const ev = new CustomEvent("docai:opennotif")
                  window.dispatchEvent(ev)
                }}>
                🔔
                {notifCount > 0 && <span className="sidebar-notif-badge" />}
              </button>
              <button
                className="tour-trigger-btn"
                title="Start product tour"
                onClick={startTour}>
                ?
              </button>
              <NavLink to="/settings" className="sidebar-icon-btn" title="Settings">
                ⚙
              </NavLink>
            </div>
          </div>
        </div>

        {/* Profile dropdown */}
        {profileOpen && (
          <div className="profile-dropdown" ref={profileRef}>
            <div className="profile-dropdown-header">
              <div className="profile-dropdown-name">{userName}</div>
              <div className="profile-dropdown-email">{profile.email || "—"}</div>
              <div className="profile-dropdown-role">{userRole}</div>
            </div>
            <NavLink
              to="/settings"
              className="profile-dropdown-item"
              onClick={() => setProfileOpen(false)}>
              ⚙ Settings
            </NavLink>
            <NavLink
              to="/settings/integrations"
              className="profile-dropdown-item"
              onClick={() => setProfileOpen(false)}>
              🔗 Integrations
            </NavLink>
            <div className="profile-dropdown-divider" />
            <button
              className="profile-dropdown-item"
              style={{ fontSize: 12, color: "var(--text-3)" }}>
              Keyboard shortcuts
            </button>
            <div className="profile-dropdown-divider" />
            <button className="profile-dropdown-item danger">
              ↩ Sign out
            </button>
          </div>
        )}
      </aside>

      {/* ── Right column: topbar + content ── */}
      <div className="main-column">
        {/* Top bar */}
        <div className="topbar">
          <div className="topbar-breadcrumb">
            {pageInfo.breadcrumb.map((crumb, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {i > 0 && <span className="topbar-breadcrumb-sep">/</span>}
                {i === pageInfo.breadcrumb.length - 1
                  ? <span className="topbar-page-title">{crumb}</span>
                  : <span>{crumb}</span>}
              </span>
            ))}
          </div>

          {isDemoMode && <span className="tour-demo-badge">Demo</span>}

          <div className="topbar-actions">
            <button
              className="topbar-sync-btn"
              onClick={handleSync}
              disabled={syncing}>
              {syncing ? "⟳ Syncing…" : "⟳ Sync Confluence"}
              {lastSync && (
                <span className="topbar-sync-time">{relativeTime(lastSync)}</span>
              )}
            </button>
            <button
              className="topbar-icon-btn"
              title="Notifications"
              onClick={() => {
                const ev = new CustomEvent("docai:opennotif")
                window.dispatchEvent(ev)
              }}>
              🔔
              {notifCount > 0 && <span className="topbar-notif-badge" />}
            </button>
            <div
              className="topbar-avatar"
              title={userName}
              onClick={() => setProfileOpen(v => !v)}>
              {initials}
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
