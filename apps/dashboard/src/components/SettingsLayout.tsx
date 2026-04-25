import { useState, useEffect, useRef } from "react"
import { Outlet, NavLink, useNavigate } from "react-router-dom"
import "./Layout.css"
import "./SettingsLayout.css"
import { useAuth } from "../contexts/AuthContext"

const SETTINGS_NAV = [
  { to: "/settings",                  label: "Overview",     icon: "⬡", end: true  },
  { to: "/settings/profile",          label: "Profile",      icon: "◉"              },
  { to: "/settings/team",             label: "Team",         icon: "⊞"              },
  { to: "/settings/integrations",     label: "Integrations", icon: "⌁"              },
  { to: "/settings/preferences",      label: "Preferences",  icon: "◎"              },
  { to: "/settings/usage",            label: "Usage",        icon: "∥"              },
  { to: "/settings/analysis",         label: "Analysis",     icon: "◈"              },
  { to: "/settings/privacy",          label: "Privacy",      icon: "⛨"              },
  { to: "/settings/about",            label: "About",        icon: "ℹ"              },
]

export default function SettingsLayout() {
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const { user, logout } = useAuth()

  const localProfile = (() => {
    try { return JSON.parse(localStorage.getItem("docai_profile") || "{}") } catch { return {} }
  })()
  const userName: string  = user?.name  || localProfile.name  || "User"
  const userEmail: string = user?.email || localProfile.email || ""
  const userRole: string  = user?.roles?.[0] || localProfile.role || "Admin"
  const initials = userName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) || "U"

  function handleSignOut() {
    if (import.meta.env.VITE_AUTH0_DOMAIN) logout()
    else window.location.href = "/login"
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    if (profileOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [profileOpen])

  return (
    <div className="layout">
      <div className="sidebar-spacer" />

      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <span className="logo-text">DocAI</span>
          <span className="logo-badge">Beta</span>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {/* Back button */}
          <button
            className="sl-back-btn"
            onClick={() => navigate("/overview")}>
            ← Back to DocAI
          </button>

          {/* Section label */}
          <div className="sl-section-label">Settings</div>

          {SETTINGS_NAV.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
              <span className="nav-icon">{icon}</span>
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
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
            <button
              className="sidebar-signout-btn"
              title="Sign out"
              onClick={handleSignOut}>
              ↩
            </button>
          </div>
        </div>

        {/* Profile dropdown */}
        {profileOpen && (
          <div className="profile-dropdown" ref={profileRef}>
            <div className="profile-dropdown-header">
              <div className="profile-dropdown-name">{userName}</div>
              <div className="profile-dropdown-email">{userEmail || "—"}</div>
              <div className="profile-dropdown-role">{userRole}</div>
            </div>
            <div className="profile-dropdown-divider" />
            <button
              className="profile-dropdown-item danger"
              onClick={() => { setProfileOpen(false); handleSignOut() }}>
              ↩ Sign out
            </button>
          </div>
        )}
      </aside>

      {/* Content */}
      <div className="main-column">
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
