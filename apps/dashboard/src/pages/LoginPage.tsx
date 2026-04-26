import { useEffect, useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth0 } from "@auth0/auth0-react"
import "./LoginPage.css"

const AUTH0_CONFIGURED = !!import.meta.env.VITE_AUTH0_DOMAIN
const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID

// ── Icons ─────────────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

const MicrosoftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg>
)

const EmailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
)

// ── Auth0 login page ──────────────────────────────────────────────────────────

type View = "methods" | "email" | "sent"

function Auth0LoginPage() {
  const { loginWithRedirect, isAuthenticated, isLoading } = useAuth0()
  const navigate = useNavigate()
  const [accessError, setAccessError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [view, setView] = useState<View>("methods")
  const [email, setEmail] = useState("")
  const [sentEmail, setSentEmail] = useState("")
  const processedRef = useRef(false)

  // ── Error handling from Auth0 redirect ──────────────────────────────────────
  useEffect(() => {
    if (processedRef.current) return
    processedRef.current = true

    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    const errorDescription = params.get('error_description')

    window.history.replaceState({}, '', '/login')

    const storedError = sessionStorage.getItem('docai_auth_error')
    if (storedError) {
      setAccessError(storedError)
      sessionStorage.removeItem('docai_auth_error')
      return
    }

    if (error === 'access_denied') {
      const message = errorDescription
        ?? 'Access not authorized. Contact Avantifai to request access.'
      sessionStorage.setItem('docai_auth_error', message)

      const returnTo = encodeURIComponent(window.location.origin + '/login')
      const logoutUrl =
        `https://${AUTH0_DOMAIN}/v2/logout` +
        `?client_id=${AUTH0_CLIENT_ID}` +
        `&returnTo=${returnTo}` +
        `&federated`

      window.location.replace(logoutUrl)
    }
  }, [])

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      const storedError = sessionStorage.getItem('docai_auth_error')
      if (!storedError) {
        navigate('/overview', { replace: true })
      }
    }
  }, [isAuthenticated, isLoading, navigate])

  // ── Login handlers ───────────────────────────────────────────────────────────

  async function loginGoogle() {
    try {
      await loginWithRedirect({
        authorizationParams: { connection: 'google-oauth2', prompt: 'login' },
      })
    } catch {
      setLoginError("Login failed. Please try again.")
    }
  }

  async function loginMicrosoft() {
    try {
      await loginWithRedirect({
        authorizationParams: { connection: 'windowslive', prompt: 'login' },
      })
    } catch {
      setLoginError("Login failed. Please try again.")
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    try {
      await loginWithRedirect({
        authorizationParams: {
          connection: 'email',
          login_hint: email.trim(),
          prompt: 'login',
        },
      })
      setSentEmail(email.trim())
      setView("sent")
    } catch {
      setLoginError("Login failed. Please try again.")
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="login-page">
        <div className="login-spinner" />
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────

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

        {loginError && (
          <div className="login-error">
            <div className="login-error-icon">⚠</div>
            <div className="login-error-content">
              <div className="login-error-message">{loginError}</div>
            </div>
          </div>
        )}

        {/* STATE 1 — method selection */}
        {view === "methods" && (
          <div className="login-methods">
            <button className="login-btn-google" onClick={loginGoogle}>
              <GoogleIcon />
              Continue with Google
            </button>
            <button className="login-btn-microsoft" onClick={loginMicrosoft}>
              <MicrosoftIcon />
              Continue with Microsoft
            </button>
            <div className="login-divider">or</div>
            <button className="login-btn-email" onClick={() => { setLoginError(null); setView("email") }}>
              <EmailIcon />
              Continue with email
            </button>
          </div>
        )}

        {/* STATE 2 — email input */}
        {view === "email" && (
          <form className="login-methods" onSubmit={sendMagicLink}>
            <button type="button" className="login-back" onClick={() => { setLoginError(null); setView("methods") }}>
              ← Back
            </button>
            <input
              className="login-email-input"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
              required
            />
            <button className="login-btn" type="submit" disabled={!email.trim()}>
              Send login link
            </button>
            <p className="login-magic-note">
              We'll email you a magic link to sign in instantly.
            </p>
          </form>
        )}

        {/* STATE 3 — link sent */}
        {view === "sent" && (
          <div className="login-methods" style={{ alignItems: "center", textAlign: "center" }}>
            <div className="login-success-icon">✓</div>
            <div>
              <p className="login-success-title">Check your email</p>
              <p className="login-success-sub">We sent a login link to <strong>{sentEmail}</strong></p>
              <p className="login-success-sub">It expires in 5 minutes.</p>
            </div>
            <button className="login-retry" onClick={() => { setEmail(sentEmail); setView("email") }}>
              Didn't receive it? Try again
            </button>
          </div>
        )}

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

// ── Dev bypass page ───────────────────────────────────────────────────────────

function BypassLoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">DocAI</div>
        <p className="login-tagline">
          Enterprise document intelligence<br />for Confluence workspaces
        </p>
        <button
          className="login-btn"
          onClick={() => window.location.href = "/"}>
          Enter as Dev User
        </button>
        <p className="login-footer">
          DocAI by Avantifai · Enterprise document intelligence
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  if (!AUTH0_CONFIGURED) return <BypassLoginPage />
  return <Auth0LoginPage />
}
