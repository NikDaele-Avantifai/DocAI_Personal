import { Outlet, NavLink } from "react-router-dom"
import "./Layout.css"

const navItems = [
  { to: "/dashboard", label: "Overview", icon: "⬡" },
  { to: "/approvals", label: "Approvals", icon: "✓" },
  { to: "/audit", label: "Audit Log", icon: "≡" }
]

function Layout() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-text">DocAI</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-item ${isActive ? "nav-item--active" : ""}`
              }>
              <span className="nav-icon">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
