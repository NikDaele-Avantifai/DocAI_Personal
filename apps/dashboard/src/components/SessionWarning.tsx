import { useState, useEffect } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import './SessionWarning.css'

interface SessionWarningProps {
  secondsLeft: number | null
  onDismiss: () => void
}

export function SessionWarning({ secondsLeft, onDismiss }: SessionWarningProps) {
  const { logout } = useAuth0()
  const [countdown, setCountdown] = useState(secondsLeft ?? 120)

  useEffect(() => {
    if (secondsLeft === null) return
    setCountdown(secondsLeft)
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [secondsLeft])

  if (secondsLeft === null) return null

  const minutes = Math.floor(countdown / 60)
  const seconds = countdown % 60
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  return (
    <div className="session-warning">
      <div className="session-warning-content">
        <span className="session-warning-icon">⏱</span>
        <span className="session-warning-text">
          Your session will expire in <strong>{timeStr}</strong> due to inactivity.
        </span>
        <div className="session-warning-actions">
          <button className="session-warning-btn-stay" onClick={onDismiss}>
            Stay logged in
          </button>
          <button
            className="session-warning-btn-logout"
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin + '/login' } })}>
            Log out now
          </button>
        </div>
      </div>
    </div>
  )
}
