import { Outlet, NavLink } from "react-router-dom"
import "./Layout.css"

const nav = [
  { to: "/dashboard", icon: "⬡", label: "Overview"     },
  { to: "/pages",     icon: "◫", label: "Pages"         },
  { to: "/batch",     icon: "✎", label: "Batch Rename"  },
  { to: "/approvals", icon: "✓", label: "Approvals"     },
  { to: "/audit",     icon: "≡", label: "Audit Log"     },
]

export default function Layout() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark">⬡</div>
          <span className="logo-text">DocAI</span>
          <span className="logo-badge">Beta</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Workspace</div>
          {nav.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="api-status">
            <div className="status-dot" />
            <span>API Connected</span>
          </div>
          <div className="version">v0.1.0</div>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}