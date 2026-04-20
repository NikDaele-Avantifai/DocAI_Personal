import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth0 } from "@auth0/auth0-react"
import "./LoginPage.css"

const AUTH0_CONFIGURED = !!import.meta.env.VITE_AUTH0_DOMAIN

// ── Auth0 login page (only rendered when Auth0Provider is in the tree) ────────

function Auth0LoginPage() {
  const { loginWithRedirect, isAuthenticated, isLoading, logout } = useAuth0()
  const navigate = useNavigate()
  const [accessError, setAccessError] = useState<string | null>(null)

  useEffect(() => {
    // Phase 2: we've come back from Auth0 logout, show the persisted error
    const storedError = sessionStorage.getItem('docai_auth_error')
    if (storedError) {
      setAccessError(storedError)
      sessionStorage.removeItem('docai_auth_error')
      window.history.replaceState({}, '', '/login')
      return
    }

    // Phase 1: Auth0 redirected back with an error in the URL
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    const errorDescription = params.get('error_description')

    if (error) {
      const message = errorDescription ?? 'Access denied. Contact Avantifai to request access.'
      sessionStorage.setItem('docai_auth_error', message)
      logout({ logoutParams: { returnTo: window.location.origin + '/login' } })
      return
    }
  }, [logout])

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/overview', { replace: true })
    }
  }, [isAuthenticated, isLoading, navigate])

  function handleLogin() {
    loginWithRedirect({ authorizationParams: { prompt: 'select_account' } })
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

        {accessError && (
          <div className="login-error">
            <div className="login-error-icon">⚠</div>
            <div className="login-error-content">
              <div className="login-error-title">Access Denied</div>
              <div className="login-error-message">{accessError}</div>
            </div>
          </div>
        )}

        <button className="login-btn" onClick={handleLogin}>
          Continue with Google
        </button>

        {accessError && (
          <p className="login-access-note">
            Need access? Contact{' '}
            <a href="mailto:nikolaidaelemans@avantifai.com">
              nikolaidaelemans@avantifai.com
            </a>
          </p>
        )}

        <p className="login-footer">
          DocAI by Avantifai · Enterprise document intelligence
        </p>
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
