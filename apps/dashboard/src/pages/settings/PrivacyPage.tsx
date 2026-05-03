import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { apiClient } from "@/lib/api"
import { AdminOnly } from "@/components/AdminOnly"
import "./PrivacyPage.css"

// ── Data export ───────────────────────────────────────────────────────────────

function ExportSection() {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const data = await apiClient.get("/api/workspace/export").then(r => r.data)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `docai-export-${new Date().toISOString().split("T")[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : "Export failed. Please try again.")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="priv-card">
      <div className="priv-card-header">
        <h2 className="priv-card-title">Export your data</h2>
      </div>
      <p className="priv-card-desc">
        Download all data DocAI holds for your workspace in JSON format. This includes
        pages, audit log, sweep history, and usage data. API tokens and credentials are
        never included.
      </p>
      <AdminOnly fallback={
        <p className="priv-restricted">Admin access required to export workspace data.</p>
      }>
        {exportError && (
          <div className="priv-error">{exportError}</div>
        )}
        <button
          className="priv-btn"
          onClick={handleExport}
          disabled={exporting}>
          {exporting ? "Preparing export…" : "Export workspace data"}
        </button>
      </AdminOnly>
    </div>
  )
}

// ── Danger zone ───────────────────────────────────────────────────────────────

const REQUIRED_PHRASE = "DELETE MY WORKSPACE"

function DangerZone() {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete() {
    if (confirmText !== REQUIRED_PHRASE) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiClient.delete("/api/workspace/", {
        headers: { "X-Confirm-Deletion": REQUIRED_PHRASE },
      })
      // Clear all local state before redirecting
      localStorage.clear()
      sessionStorage.clear()
      navigate("/login", { replace: true })
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Deletion failed. Please try again.")
      setDeleting(false)
    }
  }

  return (
    <AdminOnly>
      <div className="priv-danger-card">
        <div className="priv-card-header">
          <h2 className="priv-danger-title">Delete workspace</h2>
        </div>
        <p className="priv-card-desc">
          Permanently delete all DocAI data for this workspace. This includes all pages,
          analyses, proposals, audit log entries, and team members. This action cannot
          be undone.
        </p>

        {!expanded ? (
          <button className="priv-btn-danger" onClick={() => setExpanded(true)}>
            Delete all workspace data
          </button>
        ) : (
          <div className="priv-confirm-box">
            <p className="priv-confirm-label">
              Type <strong>{REQUIRED_PHRASE}</strong> to confirm:
            </p>
            <input
              className="priv-confirm-input"
              type="text"
              placeholder={REQUIRED_PHRASE}
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              autoFocus
              spellCheck={false}
            />
            {deleteError && (
              <div className="priv-error">{deleteError}</div>
            )}
            <div className="priv-confirm-actions">
              <button
                className="priv-btn-cancel"
                onClick={() => { setExpanded(false); setConfirmText(""); setDeleteError(null) }}
                disabled={deleting}>
                Cancel
              </button>
              <button
                className="priv-btn-danger"
                onClick={handleDelete}
                disabled={confirmText !== REQUIRED_PHRASE || deleting}>
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminOnly>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PrivacyPage() {
  return (
    <div className="priv-root">
      <div className="priv-page-header">
        <h1 className="priv-page-title">Privacy &amp; Data</h1>
        <p className="priv-page-sub">
          Manage your workspace data under GDPR Articles 15 and 17.
        </p>
      </div>

      <div className="priv-sections">
        <ExportSection />
        <DangerZone />
      </div>
    </div>
  )
}
