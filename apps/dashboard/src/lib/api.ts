/**
 * Authenticated API client.
 *
 * All requests go through the Vite proxy (/api → http://localhost:8000/api).
 * Call `setAccessToken(token)` from AuthContext whenever the Auth0 token
 * changes so every subsequent request includes the Authorization header.
 *
 * Usage:
 *   import { apiClient } from "@/lib/api"
 *   const data = await apiClient.get("/api/stats/")
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

// Attach bearer token to every request automatically
apiClient.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${_accessToken}`
  }
  return config
})

// Treat 401 responses as session-expired; redirect to /login
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      if (!window.location.pathname.includes('/login') && !_isRefreshingToken) {
        window.location.href = "/login"
      }
    }
    return Promise.reject(err)
  },
)
/**
 * Drop-in replacement for window.fetch that attaches the bearer token.
 * Existing components that still use raw fetch() can import this instead
 * of migrating to apiClient right away.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (_accessToken) {
    headers.set("Authorization", `Bearer ${_accessToken}`)
  }
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) {
    if (!window.location.pathname.includes('/login') && !_isRefreshingToken) {
      window.location.href = "/login"
    }
  }
  return res
}
