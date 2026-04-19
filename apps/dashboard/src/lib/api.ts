/**
 * Authenticated API client.
 *
 * Requests are aborted immediately when no token is present, so they never
 * hit the backend without an Authorization header.  AuthContext calls
 * setAccessToken() after getAccessTokenSilently() resolves; isTokenReady
 * gates every useEffect that fires on-mount, so by the time those effects
 * run the token is already in _accessToken.
 */

import axios from "axios"

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
})

let _accessToken: string | null = null
let _isRefreshingToken = false

export function setTokenRefreshing(refreshing: boolean): void {
  _isRefreshingToken = refreshing
}

/** Called by AuthContext after Auth0 returns a fresh token. */
export function setAccessToken(token: string | null): void {
  _accessToken = token
}

/** Returns the current access token (for one-off fetch() calls). */
export function getAccessToken(): string | null {
  return _accessToken
}

// Abort requests that have no token — never send unauthenticated API calls
apiClient.interceptors.request.use((config) => {
  if (!_accessToken) {
    const controller = new AbortController()
    controller.abort('Token not ready')
    config.signal = controller.signal
    return config
  }
  config.headers.Authorization = `Bearer ${_accessToken}`
  return config
})

// Ignore aborted requests; treat 401 as session-expired
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (axios.isCancel(err)) return Promise.resolve({ data: null })
    if (err.response?.status === 401) {
      if (!window.location.pathname.includes('/login') && !_isRefreshingToken) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

/**
 * Drop-in replacement for window.fetch that attaches the bearer token.
 * Aborts immediately if no token is available.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (!_accessToken) {
    // Return a no-op response rather than hitting the server without a token
    return new Response(null, { status: 204 })
  }
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${_accessToken}`)
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) {
    if (!window.location.pathname.includes('/login') && !_isRefreshingToken) {
      window.location.href = '/login'
    }
  }
  return res
}
