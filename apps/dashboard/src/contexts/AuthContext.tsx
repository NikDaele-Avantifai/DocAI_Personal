/**
 * AuthContext — thin wrapper around @auth0/auth0-react.
 *
 * Two providers are exported:
 *  • RealAuthProvider  — used when AUTH0_DOMAIN is set; calls useAuth0()
 *  • AuthProvider      — selects real vs bypass automatically via `bypass` prop
 *
 * In dev-bypass mode Auth0Provider is not in the tree, so we must never call
 * useAuth0(). The bypass branch returns a synthetic dev user instead.
 */

import { createContext, useContext, useEffect, ReactNode } from "react"
import { useAuth0 } from "@auth0/auth0-react"
import { setAccessToken } from "@/lib/api"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  sub: string
  email?: string
  name?: string
  picture?: string
  /** Auth0 roles populated via the post-login Action / rule */
  roles?: string[]
}

interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  logout: () => void
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  logout: () => {},
})

// ── Real provider (Auth0Provider must be an ancestor) ─────────────────────────

function RealAuthProvider({ children }: { children: ReactNode }) {
  const {
    user: auth0User,
    isAuthenticated,
    isLoading,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0()

  useEffect(() => {
    if (!isAuthenticated) {
      setAccessToken(null)
      return
    }
    function refreshToken() {
      getAccessTokenSilently({
        authorizationParams: {
          audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        },
      })
        .then(token => setAccessToken(token))
        .catch(err => {
          console.error("Token fetch failed:", err)
          setAccessToken(null)
        })
    }
    refreshToken()
    const interval = setInterval(refreshToken, 50 * 60 * 1000)
    return () => clearInterval(interval)
  }, [isAuthenticated, getAccessTokenSilently])

  const user: AuthUser | null = auth0User
    ? {
        sub: auth0User.sub ?? "",
        email: auth0User.email,
        name: auth0User.name,
        picture: auth0User.picture,
        roles: (auth0User as any)["https://docai.io/roles"] ?? [],
      }
    : null

  function logout() {
    setAccessToken(null)
    auth0Logout({ logoutParams: { returnTo: window.location.origin + "/login" } })
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Dev-bypass provider (no Auth0Provider needed) ─────────────────────────────

const DEV_USER: AuthUser = {
  sub: "dev|local",
  email: "dev@localhost",
  name: "Dev User",
  roles: ["admin"],
}

function BypassAuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        user: DEV_USER,
        isAuthenticated: true,
        isLoading: false,
        logout: () => {},
      }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Unified export ────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode
  bypass?: boolean
}

export function AuthProvider({ children, bypass = false }: AuthProviderProps) {
  if (bypass) return <BypassAuthProvider>{children}</BypassAuthProvider>
  return <RealAuthProvider>{children}</RealAuthProvider>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
