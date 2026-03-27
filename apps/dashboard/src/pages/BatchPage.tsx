import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import "./BatchPage.css"

const API_BASE = "http://localhost:8000"

type Space = { key: string; name: string; page_count: number }

type RenameResult = {
  pages_scanned: number
  pages_flagged: number
  proposals_created: number
  proposal_ids: string[]
  skipped_low_confidence: number
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

  const [scanState, setScanState] = useState<ScanState>("idle")
  const [spaces, setSpaces] = useState<Space[]>([])
  const [selectedSpace, setSelectedSpace] = useState<string>("__all__")
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [minConfidence, setMinConfidence] = useState(70)
  const [result, setResult] = useState<RenameResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanMsgIdx, setScanMsgIdx] = useState(0)

  // Load synced spaces on mount
  useEffect(() => {
    setScanState("loading_spaces")
    fetch(`${API_BASE}/api/sync/spaces`)
      .then(r => r.json())
      .then(data => {
        setSpaces(data.spaces ?? [])
        setScanState("ready")
      })
      .catch(() => setScanState("ready"))
  }, [])

  // Update page count when space selection changes
  useEffect(() => {
    const key = selectedSpace === "__all__" ? undefined : selectedSpace
    const qs = key ? `?space_key=${key}` : ""
    fetch(`${API_BASE}/api/batch/rename/preview${qs}`)
      .then(r => r.json())
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
      const res = await fetch(`${API_BASE}/api/batch/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space_key: selectedSpace === "__all__" ? null : selectedSpace,
          min_confidence: minConfidence,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Server error ${res.status}`)
      }

      const data: RenameResult = await res.json()
      setResult(data)
      setScanState("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed")
      setScanState("error")
    }
  }

  function reset() {
    setResult(null)
    setError(null)
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

              <div className="results-cta-row">
                <button className="btn-goto-approvals" onClick={() => navigate("/approvals")}>
                  Review in Approvals ↗
                </button>
                <button className="btn-ghost" onClick={reset}>
                  Scan again
                </button>
              </div>

              <div className="results-preview">
                <div className="results-preview-label">Proposals created</div>
                <div className="results-preview-count-badge">
                  {result.proposals_created} pending review
                </div>
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
