import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import "./BatchPage.css"
import { apiClient } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

type Space = { key: string; name: string; page_count: number }

type RenameResult = {
  pages_scanned: number
  pages_flagged: number
  proposals_created: number
  proposal_ids: string[]
  skipped_low_confidence: number
  skipped_empty_pages?: number
  skipped_empty_folders?: number
}

type RenamePreviewItem = {
  pageId: string
  currentTitle: string
  suggestedTitle: string
  isFolder?: boolean
}

type ScanState = "idle" | "loading_spaces" | "ready" | "scanning" | "done" | "error"

const SCAN_MESSAGES = [
  "Reading page index…",
  "Identifying naming patterns…",
  "Running AI analysis…",
  "Detecting poor titles…",
  "Generating suggestions…",
  "Creating proposals…",
]

export default function BatchPage() {
  const navigate = useNavigate()
  const { isTokenReady } = useAuth()

  const [scanState, setScanState] = useState<ScanState>("idle")
  const [spaces, setSpaces] = useState<Space[]>([])
  const [selectedSpace, setSelectedSpace] = useState<string>("__all__")
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [minConfidence, setMinConfidence] = useState(70)
  const [result, setResult] = useState<RenameResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanMsgIdx, setScanMsgIdx] = useState(0)
  const [previewRenames, setPreviewRenames] = useState<RenamePreviewItem[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)

  // Load synced spaces on mount — wait for token
  useEffect(() => {
    if (!isTokenReady) return
    setScanState("loading_spaces")
    apiClient.get('/api/sync/spaces')
      .then(r => r.data)
      .then(data => {
        setSpaces(data.spaces ?? [])
        setScanState("ready")
      })
      .catch(() => setScanState("ready"))
  }, [isTokenReady])

  // Update page count when space selection changes
  useEffect(() => {
    const key = selectedSpace === "__all__" ? undefined : selectedSpace
    const qs = key ? `?space_key=${key}` : ""
    apiClient.get(`/api/batch/rename/preview${qs}`)
      .then(r => r.data)
      .then(data => setPageCount(data.total ?? null))
      .catch(() => setPageCount(null))
  }, [selectedSpace])

  // Cycle scan messages while scanning
  useEffect(() => {
    if (scanState !== "scanning") return
    const id = setInterval(() => {
      setScanMsgIdx(i => (i + 1) % SCAN_MESSAGES.length)
    }, 1800)
    return () => clearInterval(id)
  }, [scanState])

  async function runScan() {
    setScanState("scanning")
    setError(null)
    setResult(null)
    setScanMsgIdx(0)

    try {
      const data: RenameResult = await apiClient.post('/api/batch/rename', {
        space_key: selectedSpace === "__all__" ? null : selectedSpace,
        min_confidence: minConfidence,
      }).then(r => r.data)
      setResult(data)

      // Fetch the proposal to populate the inline preview
      if (data.proposal_ids?.length > 0) {
        try {
          const propData = await apiClient.get(`/api/proposals/${data.proposal_ids[0]}`).then(r => r.data)
          setPreviewRenames(propData.renames ?? [])
        } catch {/* preview is best-effort */}
      }

      setScanState("done")
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? (e instanceof Error ? e.message : "Scan failed"))
      setScanState("error")
    }
  }

  function reset() {
    setResult(null)
    setError(null)
    setPreviewRenames([])
    setPreviewOpen(false)
    setScanState("ready")
  }

  const scanning = scanState === "scanning"

  return (
    <div className="batch-layout">

      {/* ── Header ── */}
      <div className="batch-header">
        <div className="batch-header-text">
          <div className="batch-eyebrow">Batch Operations</div>
          <h1 className="batch-title">Smart Rename</h1>
          <p className="batch-sub">
            DocAI scans your entire Confluence workspace, identifies pages with vague or
            auto-generated titles, and suggests professional alternatives — ready to review
            and apply in one click.
          </p>
        </div>
        <div className="batch-header-icon">✎</div>
      </div>

      {/* ── Config card ── */}
      {(scanState === "ready" || scanState === "loading_spaces" || scanState === "error") && (
        <div className="batch-config-card">
          <div className="config-section">
            <label className="config-label">Scope</label>
            <div className="config-row">
              <select
                className="config-select"
                value={selectedSpace}
                onChange={e => setSelectedSpace(e.target.value)}
                disabled={scanState === "loading_spaces"}>
                <option value="__all__">All synced spaces</option>
                {spaces.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.name} ({s.page_count} pages)
                  </option>
                ))}
              </select>
              {pageCount !== null && (
                <span className="config-page-count">{pageCount} pages in scope</span>
              )}
            </div>
          </div>

          <div className="config-section">
            <label className="config-label">
              Minimum confidence — {minConfidence}%
            </label>
            <div className="config-row config-slider-row">
              <input
                type="range"
                className="config-slider"
                min={50} max={95} step={5}
                value={minConfidence}
                onChange={e => setMinConfidence(Number(e.target.value))}
              />
              <span className="config-slider-hint">
                {minConfidence >= 85 ? "Very selective" : minConfidence >= 70 ? "Balanced" : "Inclusive"}
              </span>
            </div>
          </div>

          {error && (
            <div className="batch-error"><span>⚠</span> {error}</div>
          )}

          <button
            className="btn-scan"
            onClick={runScan}
            disabled={scanState === "loading_spaces" || pageCount === 0}>
            {pageCount === 0
              ? "No pages — sync Confluence first"
              : `Scan ${pageCount !== null ? pageCount : ""} Pages with DocAI`}
          </button>
        </div>
      )}

      {/* ── Scanning state ── */}
      {scanning && (
        <div className="batch-scanning">
          <div className="scanning-animation">
            <div className="scanning-ring" />
            <div className="scanning-icon">✎</div>
          </div>
          <div className="scanning-msg">{SCAN_MESSAGES[scanMsgIdx]}</div>
          <div className="scanning-sub">
            Analyzing {pageCount !== null ? `${pageCount} pages` : "your workspace"} — this takes a few seconds
          </div>
          <div className="scanning-dots">
            <span /><span /><span />
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {scanState === "done" && result && (
        <div className="batch-results">

          {/* Summary bar */}
          <div className="results-summary">
            <div className="summary-stat">
              <span className="summary-num">{result.pages_scanned}</span>
              <span className="summary-lbl">pages scanned</span>
            </div>
            <div className="summary-divider" />
            <div className="summary-stat">
              <span className="summary-num highlight">{result.pages_flagged}</span>
              <span className="summary-lbl">poorly named</span>
            </div>
            <div className="summary-divider" />
            <div className="summary-stat">
              <span className="summary-num green">{result.proposals_created}</span>
              <span className="summary-lbl">proposals created</span>
            </div>
            {result.skipped_low_confidence > 0 && (
              <>
                <div className="summary-divider" />
                <div className="summary-stat">
                  <span className="summary-num muted">{result.skipped_low_confidence}</span>
                  <span className="summary-lbl">below threshold</span>
                </div>
              </>
            )}
          </div>
          {((result.skipped_empty_pages ?? 0) > 0 || (result.skipped_empty_folders ?? 0) > 0) && (
            <div className="summary-skipped">
              {(result.skipped_empty_pages ?? 0) > 0 && (
                <span>{result.skipped_empty_pages} page{result.skipped_empty_pages !== 1 ? "s" : ""} skipped — no content yet</span>
              )}
              {(result.skipped_empty_folders ?? 0) > 0 && (
                <span>{result.skipped_empty_folders} empty folder{result.skipped_empty_folders !== 1 ? "s" : ""} skipped</span>
              )}
            </div>
          )}

          {result.proposals_created === 0 ? (
            <div className="results-empty">
              <div className="results-empty-icon">✓</div>
              <h3>All pages are well named</h3>
              <p>
                DocAI scanned {result.pages_scanned} pages and found no titles that needed improvement
                {result.skipped_low_confidence > 0
                  ? ` (${result.skipped_low_confidence} were flagged but below the ${minConfidence}% confidence threshold)`
                  : ""}.
              </p>
              <button className="btn-ghost" onClick={reset}>Scan again</button>
            </div>
          ) : (
            <>
              <div className="results-list-header">
                <h2 className="results-list-title">
                  {result.proposals_created} rename proposal{result.proposals_created !== 1 ? "s" : ""} ready for review
                </h2>
                <p className="results-list-sub">
                  Go to Approvals to review each suggestion, edit the title if needed, and apply to Confluence.
                </p>
              </div>

              {previewRenames.length > 0 && (
                <div className="batch-preview-section">
                  <button
                    className="batch-preview-toggle"
                    onClick={() => setPreviewOpen(o => !o)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: previewOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                      <polyline points="9,18 15,12 9,6"/>
                    </svg>
                    Pages flagged ({previewRenames.length})
                  </button>
                  {previewOpen && (
                    <div className="batch-preview-list">
                      {previewRenames.map(r => (
                        <div key={r.pageId} className="batch-preview-row">
                          {r.isFolder ? (
                            <svg className="batch-preview-icon batch-preview-folder-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            </svg>
                          ) : (
                            <svg className="batch-preview-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14,2 14,8 20,8"/>
                            </svg>
                          )}
                          <span className="batch-preview-current">{r.currentTitle}</span>
                          <span className="batch-preview-arrow">→</span>
                          <span className="batch-preview-suggested">{r.suggestedTitle}</span>
                        </div>
                      ))}
                      <div className="batch-preview-note">
                        These suggestions will be created as a proposal in Approvals for your review.
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="results-cta-row">
                <button className="btn-goto-approvals" onClick={() => navigate("/approvals")}>
                  Review in Approvals ↗
                </button>
                <button className="btn-ghost" onClick={reset}>
                  Scan again
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── How it works ── */}
      {scanState === "ready" && (
        <div className="batch-explainer">
          <h3 className="explainer-title">How it works</h3>
          <div className="explainer-steps">
            {[
              {
                n: "1",
                title: "Scans your workspace",
                desc: "DocAI reads every synced page title and metadata from your Confluence workspace.",
              },
              {
                n: "2",
                title: "AI identifies poor names",
                desc: 'Claude detects placeholders ("Untitled", "Draft"), vague titles ("Notes", "Meeting"), and missing context.',
              },
              {
                n: "3",
                title: "Suggests better titles",
                desc: "A specific, professional alternative is proposed for each flagged page, with a rationale.",
              },
              {
                n: "4",
                title: "You review & apply",
                desc: "Each suggestion becomes a proposal. Edit the title, approve it, and DocAI renames the page in Confluence.",
              },
            ].map(step => (
              <div key={step.n} className="explainer-step">
                <div className="step-num">{step.n}</div>
                <div>
                  <div className="step-title">{step.title}</div>
                  <div className="step-desc">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
