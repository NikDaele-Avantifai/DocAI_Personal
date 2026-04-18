import { Navigate, useLocation } from "react-router-dom"
import { useAuth0 } from "@auth0/auth0-react"

const AUTH0_CONFIGURED = !!import.meta.env.VITE_AUTH0_DOMAIN

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // Dev bypass — no auth required, render directly
  if (!AUTH0_CONFIGURED) {
    return <>{children}</>
  }

  // Real auth check — safe to call useAuth0 because Auth0Provider is in tree
  return <Auth0Guard>{children}</Auth0Guard>
}

// Separate component so useAuth0 is only called when Auth0Provider exists
function Auth0Guard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth0()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <style>{`
          .auth-loading {
            display: flex; align-items: center; justify-content: center;
            height: 100vh; background: #F7F9FB;
          }
          .auth-loading-spinner {
            width: 32px; height: 32px;
            border: 3px solid rgba(26,46,68,0.15);
            border-top-color: #1A2E44;
            border-radius: 50%;
            animation: auth-spin 0.7s linear infinite;
          }
          @keyframes auth-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
