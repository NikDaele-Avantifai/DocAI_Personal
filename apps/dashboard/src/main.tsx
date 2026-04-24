import * as Sentry from "@sentry/react"
import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Auth0Provider } from "@auth0/auth0-react"
import App from "./App"
import "./index.css"

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.PROD ? "production" : "development",
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers?.["Authorization"]) {
        event.request.headers["Authorization"] = "[Filtered]"
      }
      return event
    },
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error: any) => {
        if (error?.response?.status === 401) return false
        return failureCount < 1
      },
    },
  },
})

const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined
const bypassAuth = !AUTH0_DOMAIN || !AUTH0_CLIENT_ID

if (bypassAuth) {
  console.info("[DocAI] Running in dev-bypass mode.")
}

function Root() {
  if (bypassAuth) {
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
      cacheLocation="localstorage"
      useRefreshTokens={true}
      skipRedirectCallback={window.location.pathname === '/login'}
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
    <Sentry.ErrorBoundary
      fallback={
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: "12px",
          fontFamily: "Manrope, sans-serif",
          color: "#3D5166",
          background: "#F7F9FB",
        }}>
          <div style={{ fontSize: "32px", marginBottom: "4px" }}>⚠</div>
          <div style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#0D1B2A",
            fontFamily: "Nunito Sans, sans-serif",
          }}>
            Something went wrong
          </div>
          <div style={{ fontSize: "14px", color: "#7A96AE" }}>
            Our team has been notified automatically.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "12px",
              padding: "10px 24px",
              background: "#1A2E44",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "Manrope, sans-serif",
              fontWeight: 500,
            }}>
            Refresh page
          </button>
        </div>
      }
    >
      <Root />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
)
