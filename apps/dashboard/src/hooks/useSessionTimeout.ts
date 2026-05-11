import { useEffect, useRef, useCallback } from 'react'
import { useAuth0 } from '@auth0/auth0-react'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000         // 30 minutes
const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 hours
const WARNING_BEFORE_MS = 2 * 60 * 1000         // warn 2 min before idle logout
const SESSION_START_KEY = 'docai_session_start'
const LAST_ACTIVITY_KEY = 'docai_last_activity'

export function useSessionTimeout(onWarning: (secondsLeft: number) => void) {
  const { logout, isAuthenticated } = useAuth0()
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const absoluteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doLogout = useCallback(() => {
    localStorage.removeItem(SESSION_START_KEY)
    localStorage.removeItem(LAST_ACTIVITY_KEY)
    logout({
      logoutParams: {
        returnTo: window.location.origin + '/login?reason=session_expired',
      },
    })
  }, [logout])

  const resetIdleTimer = useCallback(() => {
    if (!isAuthenticated) return

    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString())

    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (warningTimer.current) clearTimeout(warningTimer.current)

    // Warning fires 2 minutes before logout
    warningTimer.current = setTimeout(() => {
      onWarning(WARNING_BEFORE_MS / 1000)
    }, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS)

    idleTimer.current = setTimeout(() => {
      doLogout()
    }, IDLE_TIMEOUT_MS)
  }, [isAuthenticated, doLogout, onWarning])

  useEffect(() => {
    if (!isAuthenticated) return

    if (!localStorage.getItem(SESSION_START_KEY)) {
      localStorage.setItem(SESSION_START_KEY, Date.now().toString())
    }

    // Enforce absolute session timeout
    const sessionStart = parseInt(localStorage.getItem(SESSION_START_KEY) ?? '0')
    const sessionAge = Date.now() - sessionStart
    if (sessionAge > ABSOLUTE_TIMEOUT_MS) {
      doLogout()
      return
    }

    const remainingAbsolute = ABSOLUTE_TIMEOUT_MS - sessionAge
    absoluteTimer.current = setTimeout(doLogout, remainingAbsolute)

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click', 'focus']

    // Throttle activity detection to once per 30 seconds
    let lastReset = 0
    const handleActivity = () => {
      const now = Date.now()
      if (now - lastReset > 30_000) {
        lastReset = now
        resetIdleTimer()
      }
    }

    events.forEach(e => window.addEventListener(e, handleActivity, { passive: true }))
    resetIdleTimer()

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity))
      if (idleTimer.current) clearTimeout(idleTimer.current)
      if (warningTimer.current) clearTimeout(warningTimer.current)
      if (absoluteTimer.current) clearTimeout(absoluteTimer.current)
    }
  }, [isAuthenticated, resetIdleTimer, doLogout])
}
