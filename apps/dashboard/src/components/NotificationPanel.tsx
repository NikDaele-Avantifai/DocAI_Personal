import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import "./NotificationPanel.css"

const STORAGE_KEY = "docai_notifications"

export interface Notification {
  id: string
  type: "proposal" | "duplicate" | "stale" | "applied"
  title: string
  description: string
  timestamp: string
  read: boolean
  path: string
}

function getNotifications(): Notification[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") } catch { return [] }
}

function saveNotifications(notifs: Notification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifs))
}

const TYPE_ICON: Record<string, string> = {
  proposal:  "✓",
  duplicate: "⊕",
  stale:     "🕐",
  applied:   "↗",
}

const TYPE_COLOR: Record<string, string> = {
  proposal:  "var(--accent)",
  duplicate: "var(--amber-text)",
  stale:     "var(--text-3)",
  applied:   "var(--green-text)",
}

const TYPE_BG: Record<string, string> = {
  proposal:  "var(--blue-bg)",
  duplicate: "var(--amber-bg)",
  stale:     "var(--surface-3)",
  applied:   "var(--green-bg)",
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationPanel() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notification[]>([])

  function reload() {
    setNotifs(getNotifications())
  }

  useEffect(() => {
    reload()
    function handleOpen() { setOpen(true); reload() }
    window.addEventListener("docai:opennotif", handleOpen)
    return () => window.removeEventListener("docai:opennotif", handleOpen)
  }, [])

  function markAllRead() {
    const updated = notifs.map(n => ({ ...n, read: true }))
    setNotifs(updated)
    saveNotifications(updated)
  }

  function dismiss(id: string) {
    const updated = notifs.filter(n => n.id !== id)
    setNotifs(updated)
    saveNotifications(updated)
  }

  function handleView(notif: Notification) {
    const updated = notifs.map(n => n.id === notif.id ? { ...n, read: true } : n)
    setNotifs(updated)
    saveNotifications(updated)
    setOpen(false)
    navigate(notif.path)
  }

  const unread = notifs.filter(n => !n.read).length

  return (
    <>
      {/* Backdrop */}
      {open && <div className="notif-backdrop" onClick={() => setOpen(false)} />}

      {/* Panel */}
      <div className={`notif-panel${open ? " open" : ""}`}>
        <div className="notif-header">
          <div>
            <span className="notif-title">Notifications</span>
            {unread > 0 && (
              <span className="notif-unread-badge">{unread} new</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {unread > 0 && (
              <button className="notif-action-btn" onClick={markAllRead}>
                Mark all read
              </button>
            )}
            <button className="notif-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>
        </div>

        <div className="notif-body">
          {notifs.length === 0 && (
            <div className="notif-empty">
              <div className="notif-empty-icon">🔔</div>
              <p>No notifications yet</p>
              <p className="notif-empty-sub">
                New proposals, detected duplicates, and applied changes will appear here.
              </p>
            </div>
          )}

          {notifs.map(notif => (
            <div key={notif.id} className={`notif-item${notif.read ? " read" : ""}`}>
              <div
                className="notif-item-icon"
                style={{ color: TYPE_COLOR[notif.type], background: TYPE_BG[notif.type] }}>
                {TYPE_ICON[notif.type]}
              </div>
              <div className="notif-item-body">
                <div className="notif-item-title">{notif.title}</div>
                <div className="notif-item-desc">{notif.description}</div>
                <div className="notif-item-footer">
                  <span className="notif-item-time">{timeAgo(notif.timestamp)}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="notif-btn-view" onClick={() => handleView(notif)}>
                      View →
                    </button>
                    <button className="notif-btn-dismiss" onClick={() => dismiss(notif.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
              {!notif.read && <div className="notif-unread-dot" />}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
