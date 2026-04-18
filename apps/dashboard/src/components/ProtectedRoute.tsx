import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"

const AUTH0_CONFIGURED = !!import.meta.env.VITE_AUTH0_DOMAIN

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // Dev bypass — no auth required, render directly
  if (!AUTH0_CONFIGURED) {
    return <>{children}</>
  }

  return <Auth0Guard>{children}</Auth0Guard>
}

function Auth0Guard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isTokenReady } = useAuth()
  const location = useLocation()

  // Spinner while Auth0 initialises or the API token is being fetched
  if (isLoading || (isAuthenticated && !isTokenReady)) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <div style={{
          width: 20,
          height: 20,
          border: "2px solid #87BAD0",
          borderTopColor: "#1A2E44",
          borderRadius: "50%",
          animation: "spin 0.6s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
