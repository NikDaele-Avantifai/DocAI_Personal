import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth0 } from "@auth0/auth0-react"
import "./LoginPage.css"

const AUTH0_CONFIGURED = !!import.meta.env.VITE_AUTH0_DOMAIN

// ── Auth0 login page (only rendered when Auth0Provider is in the tree) ────────

function Auth0LoginPage() {
  const { loginWithRedirect, isAuthenticated, isLoading } = useAuth0()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/overview", { replace: true })
    }
  }, [isAuthenticated, isLoading, navigate])

  function handleLogin() {
    loginWithRedirect()
  }

  if (isLoading) {
    return (
      <div className="login-page">
        <div className="login-spinner" />
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">DocAI</div>
        <p className="login-tagline">
          Enterprise document intelligence<br />for Confluence workspaces
        </p>

        <button className="login-btn" onClick={handleLogin}>
          Continue with Google
        </button>

        <p className="login-footer">DocAI by Avantifai · Enterprise document intelligence</p>
      </div>
    </div>
  )
}

// ── Dev-bypass login page (no Auth0Provider needed) ───────────────────────────

function BypassLoginPage() {
  function handleLogin() {
    window.location.href = "/"
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">DocAI</div>
        <p className="login-tagline">
          Enterprise document intelligence<br />for Confluence workspaces
        </p>

        <button className="login-btn" onClick={handleLogin}>
          Enter as Dev User
        </button>

        <p className="login-footer">DocAI by Avantifai · Enterprise document intelligence</p>
      </div>
    </div>
  )
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default function LoginPage() {
  if (!AUTH0_CONFIGURED) return <BypassLoginPage />
  return <Auth0LoginPage />
}
