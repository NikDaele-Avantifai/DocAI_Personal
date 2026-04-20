import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Auth0Provider } from "@auth0/auth0-react"
import App from "./App"
import "./index.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error: any) => {
        // Never retry on 401 — it causes redirect loops
        if (error?.response?.status === 401) return false
        return failureCount < 1
      },
    },
  },
})

// Read Auth0 config from environment variables (set in .env)
const AUTH0_DOMAIN    = import.meta.env.VITE_AUTH0_DOMAIN    as string | undefined
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined

// When AUTH0_DOMAIN is not configured (local dev), skip the Auth0 wrapper so
// the app still works without credentials.  ProtectedRoute will still render
// normally; it only redirects to /login when isAuthenticated === false, which
// never happens in dev-bypass mode (no auth provider → useAuth0 returns
// isAuthenticated=false, so we need a thin shim — handled via bypassAuth flag).
const bypassAuth = !AUTH0_DOMAIN || !AUTH0_CLIENT_ID

if (bypassAuth) {
  console.info(
    "[DocAI] Auth0 not configured (VITE_AUTH0_DOMAIN / VITE_AUTH0_CLIENT_ID missing). " +
    "Running in dev-bypass mode — all routes are accessible without login.",
  )
}

function Root() {
  if (bypassAuth) {
    // No Auth0 → render the app directly; backend also skips auth in this mode
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App bypassAuth />
        </BrowserRouter>
      </QueryClientProvider>
    )
  }

  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN!}
      clientId={AUTH0_CLIENT_ID!}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
      cacheLocation="memory"
      useRefreshTokens={true}
      useRefreshTokensFallback={true}
      >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </Auth0Provider>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
