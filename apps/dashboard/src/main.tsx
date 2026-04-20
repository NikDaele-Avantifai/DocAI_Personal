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
    <Root />
  </React.StrictMode>,
)