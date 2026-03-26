import { useState } from "react"
import "./PagesPage.css"
import SpaceTree, { type PageNode } from "../components/SpaceTree"

const API_BASE = "http://localhost:8000"

type EditType = "restructure" | "add_summary" | "rewrite" | "remove_section"

type AnalysisResult = {
  page_title: string
  page_url: string
  summary: string
  issues: {
    type: string
    severity: "low" | "medium" | "high"
    title: string
    description: string
    suggestion: string
  }[]
}

const SEV = {
  high:   { color: "#FF5566", bg: "rgba(255,85,102,0.1)",  label: "High"   },
  medium: { color: "#FFB547", bg: "rgba(255,181,71,0.1)",  label: "Medium" },
  low:    { color: "#818CF8", bg: "rgba(129,140,248,0.1)", label: "Low"    },
}

const EDIT_OPTIONS: { type: EditType; label: string; description: string; icon: string }[] = [
  { type: "add_summary",    label: "Add Summary",    description: "Prepend Overview with owner and last-reviewed date", icon: "≡" },
  { type: "restructure",    label: "Restructure",    description: "Reorganize with clear headings and sections",        icon: "⬡" },
  { type: "rewrite",        label: "Rewrite",        description: "Improve clarity and fix grammar",                   icon: "✎" },
  { type: "remove_section", label: "Remove Section", description: "Strip a specific outdated section",                 icon: "✕" },
]

function fmt(iso: string | null | undefined): string {
  if (!iso) return "Unknown"
  try {
    return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return iso
  }
}

export default function PagesPage() {
  const [selected, setSelected] = useState<PageNode | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<string | null>(null)

  // Per-page analysis cache
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({})
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // Edit modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editType, setEditType] = useState<EditType>("add_summary")
  const [removeSectionHint, setRemoveSectionHint] = useState("")
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [createdProposalId, setCreatedProposalId] = useState<string | null>(null)

  // ── Actions ────────────────────────────────────────────────────────────────

  async function syncConfluence() {
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch(`${API_BASE}/api/sync/spaces`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `API error ${res.status}`)
      }
      setLastSynced(new Date().toLocaleTimeString())
      setRefreshKey(k => k + 1)
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed")
    } finally {
      setSyncing(false)
    }
  }

  async function analyzeSelected() {
    if (!selected) return
    setAnalyzingId(selected.id)
    setAnalyzeError(null)

    try {
      // 1. Fetch content from Confluence via sync endpoint
      const pageRes = await fetch(`${API_BASE}/api/sync/pages/${selected.id}`)
      if (!pageRes.ok) throw new Error("Could not fetch page content")
      const pageData = await pageRes.json()

      // 2. Run AI analysis
      const analyzeRes = await fetch(`${API_BASE}/api/analyze/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: selected.url ?? `https://confluence.page/${selected.id}`,
          title: selected.title,
          content: pageData.content ?? "",
          last_modified: selected.last_modified,
          owner: selected.owner,
        }),
      })
      if (!analyzeRes.ok) throw new Error("Analysis failed")
      const result: AnalysisResult = await analyzeRes.json()
      setAnalyses(prev => ({ ...prev, [selected.id]: result }))
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed")
    } finally {
      setAnalyzingId(null)
    }
  }

  function openEditModal() {
    setModalOpen(true)
    setEditType("add_summary")
    setRemoveSectionHint("")
    setEditError(null)
    setCreatedProposalId(null)
  }

  function closeModal() {
    setModalOpen(false)
    setEditLoading(false)
    setEditError(null)
  }

  async function submitEdit() {
    if (!selected) return
    setEditLoading(true)
    setEditError(null)

    try {
      // Fetch content first
      const pageRes = await fetch(`${API_BASE}/api/sync/pages/${selected.id}`)
      if (!pageRes.ok) throw new Error("Could not fetch page content from Confluence")
      const pageData = await pageRes.json()

      const res = await fetch(`${API_BASE}/api/edit/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_id: selected.id,
          page_title: selected.title,
          content: pageData.content ?? "",
          page_version: selected.version,
          edit_type: editType,
          remove_section_hint: removeSectionHint || undefined,
          space: selected.space_key,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `API error ${res.status}`)
      }
      const proposal = await res.json()
      setCreatedProposalId(proposal.id)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setEditLoading(false)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const analysis = selected ? analyses[selected.id] : null
  const isAnalyzing = selected ? analyzingId === selected.id : false

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="pages-layout">

      {/* ── Left panel ── */}
      <div className="pages-panel">
        <div className="pages-header">
          <div>
            <h1 className="page-title">Pages</h1>
            <p className="page-sub">
              {lastSynced ? `Last synced ${lastSynced}` : "Confluence workspace mirror"}
            </p>
          </div>
          <button
            className={`btn-sync${syncing ? " loading" : ""}`}
            onClick={syncConfluence}
            disabled={syncing}>
            {syncing ? (
              <><span className="spinner-blue" /> Syncing…</>
            ) : (
              "⟳ Sync Confluence"
            )}
          </button>
          {syncError && <div className="sync-error">⚠ {syncError}</div>}
        </div>

        <SpaceTree
          onPageSelect={page => { setSelected(page); setAnalyzeError(null) }}
          selectedPageId={selected?.id ?? null}
          refreshKey={refreshKey}
        />
      </div>

      {/* ── Right panel ── */}
      <div className="detail-panel">
        {selected ? (
          <div className="detail-content">

            <div className="detail-header">
              <div className="detail-icon">◫</div>
              <div style={{ minWidth: 0 }}>
                <h2 className="detail-title">{selected.title}</h2>
                <p className="detail-meta">
                  {selected.space_key}
                  {selected.last_modified && ` · Modified ${fmt(selected.last_modified)}`}
                </p>
              </div>
            </div>

            <div className="detail-meta-row">
              <div className="meta-item">
                <span className="meta-label">Owner</span>
                <span className="meta-value">{selected.owner ?? "Unknown"}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Version</span>
                <span className="meta-value">v{selected.version}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Words</span>
                <span className="meta-value">
                  {selected.word_count > 0 ? selected.word_count.toLocaleString() : "—"}
                </span>
              </div>
            </div>

            {/* AI Analysis section */}
            {analysis ? (
              <>
                <div className="detail-summary">
                  <div className="summary-label">AI Summary</div>
                  <p>{analysis.summary}</p>
                </div>

                {analysis.issues.length > 0 ? (
                  <div className="detail-issues">
                    <div className="summary-label">Issues detected</div>
                    <div className="issues-list">
                      {analysis.issues.map((issue, i) => {
                        const sev = SEV[issue.severity] ?? SEV.low
                        return (
                          <div key={i} className="issue-card">
                            <div className="issue-card-top">
                              <span className="issue-title">{issue.title}</span>
                              <span className="sev-pill" style={{ background: sev.bg, color: sev.color }}>
                                {sev.label}
                              </span>
                            </div>
                            <p className="issue-desc">{issue.description}</p>
                            <p className="issue-suggestion">→ {issue.suggestion}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="detail-healthy">
                    <span style={{ color: "#34D399" }}>✓</span> Page looks healthy — no issues found
                  </div>
                )}
              </>
            ) : (
              <div className="detail-analyze-cta">
                <div className="summary-label">AI Analysis</div>
                <p className="analyze-hint">
                  Run DocAI analysis to detect issues like stale content, missing ownership, and poor structure.
                </p>
                {analyzeError && (
                  <div className="modal-error" style={{ marginBottom: 8 }}>
                    <span>⚠</span> {analyzeError}
                  </div>
                )}
                <button
                  className="btn-analyze"
                  onClick={analyzeSelected}
                  disabled={isAnalyzing}>
                  {isAnalyzing ? (
                    <><span className="spinner" /> Analyzing…</>
                  ) : (
                    "Analyze with DocAI"
                  )}
                </button>
              </div>
            )}

            <div className="detail-actions">
              {selected.url ? (
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary">
                  Open in Confluence ↗
                </a>
              ) : (
                <button className="btn-primary" disabled>Open in Confluence ↗</button>
              )}
              <button className="btn-ghost" onClick={openEditModal}>Edit with AI</button>
            </div>
          </div>
        ) : (
          <div className="detail-empty">
            <span className="empty-icon">◫</span>
            <p>Select a page to view details</p>
          </div>
        )}
      </div>

      {/* ── Edit modal ── */}
      {modalOpen && selected && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>

            {createdProposalId ? (
              <div className="modal-success">
                <div className="modal-success-icon">✓</div>
                <h3>Proposal created</h3>
                <p>
                  DocAI has generated proposed changes for <strong>{selected.title}</strong>.
                  Review and approve them in the Approvals tab.
                </p>
                <div className="modal-success-actions">
                  <a href="/approvals" className="btn-primary modal-link-btn">Go to Approvals ↗</a>
                  <button className="btn-ghost" onClick={closeModal}>Close</button>
                </div>
              </div>
            ) : (
              <>
                <div className="modal-header">
                  <div>
                    <h3 className="modal-title">Edit with AI</h3>
                    <p className="modal-sub">{selected.title}</p>
                  </div>
                  <button className="modal-close" onClick={closeModal}>✕</button>
                </div>

                <div className="modal-body">
                  <div className="modal-section-label">Choose edit type</div>
                  <div className="edit-type-grid">
                    {EDIT_OPTIONS.map(opt => (
                      <button
                        key={opt.type}
                        className={`edit-type-card${editType === opt.type ? " selected" : ""}`}
                        onClick={() => setEditType(opt.type)}>
                        <span className="edit-type-icon">{opt.icon}</span>
                        <span className="edit-type-label">{opt.label}</span>
                        <span className="edit-type-desc">{opt.description}</span>
                      </button>
                    ))}
                  </div>

                  {editType === "remove_section" && (
                    <div className="modal-field">
                      <label className="modal-field-label">Which section to remove?</label>
                      <input
                        className="modal-input"
                        type="text"
                        placeholder="e.g. Action items, TODO section, outdated procedures…"
                        value={removeSectionHint}
                        onChange={e => setRemoveSectionHint(e.target.value)}
                      />
                    </div>
                  )}

                  {editError && (
                    <div className="modal-error"><span>⚠</span> {editError}</div>
                  )}
                </div>

                <div className="modal-footer">
                  <button className="btn-ghost" onClick={closeModal} disabled={editLoading}>Cancel</button>
                  <button
                    className="btn-primary"
                    onClick={submitEdit}
                    disabled={editLoading || (editType === "remove_section" && !removeSectionHint.trim())}>
                    {editLoading ? (
                      <span className="modal-loading"><span className="spinner" /> Generating…</span>
                    ) : "Generate Proposal"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
