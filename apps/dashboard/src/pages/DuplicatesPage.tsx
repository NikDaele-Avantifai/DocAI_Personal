import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import "./DuplicatesPage.css"

const API_BASE = "http://localhost:8000"

type Space = { key: string; name: string; page_count: number }

type DuplicatePair = {
  page_a: { id: string; title: string; url: string | null; space_key: string }
  page_b: { id: string; title: string; url: string | null; space_key: string }
  similarity: number
  severity: "exact" | "high" | "medium"
}

type EmbedStatus = {
  total_pages: number
  embedded_pages: number
  missing_embeddings: number
}

type EmbedResult = {
  processed: number
  failed: number
  total: number
  content_fetched: number
  content_fetch_failed: number
}

export default function DuplicatesPage() {
  const navigate = useNavigate()

  // Status
  const [status, setStatus] = useState<EmbedStatus | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])

  // Embed
  const [embedding, setEmbedding] = useState(false)
  const [embedResult, setEmbedResult] = useState<EmbedResult | null>(null)
  const [embedError, setEmbedError] = useState<string | null>(null)

  // Scan
  const [selectedSpace, setSelectedSpace] = useState("__all__")
  const [threshold, setThreshold] = useState(0.75)
  const [scanning, setScanning] = useState(false)
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  // Per-pair proposal state
  const [proposing, setProposing] = useState<string | null>(null)   // pairKey
  const [proposed, setProposed]   = useState<Set<string>>(new Set())
  const [proposeError, setProposeError] = useState<string | null>(null)

  function pairKey(p: DuplicatePair) {
    return [p.page_a.id, p.page_b.id].sort().join(":")
  }

  async function loadStatus() {
    try {
      const [statusRes, spacesRes] = await Promise.all([
        fetch(`${API_BASE}/api/duplicates/status`).then(r => r.json()),
        fetch(`${API_BASE}/api/sync/spaces`).then(r => r.json()),
      ])
      setStatus(statusRes)
      setSpaces(spacesRes.spaces ?? [])
    } catch { /* silent */ }
  }

  useEffect(() => { loadStatus() }, [])

  async function runEmbed(force = false) {
    setEmbedding(true)
    setEmbedError(null)
    setEmbedResult(null)
    try {
      const url = `${API_BASE}/api/duplicates/embed-all${force ? "?force=true" : ""}`
      const res = await fetch(url, { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `API error ${res.status}`)
      }
      const data: EmbedResult = await res.json()
      setEmbedResult(data)
      await loadStatus()
    } catch (e) {
      setEmbedError(e instanceof Error ? e.message : "Embedding failed")
    } finally {
      setEmbedding(false)
    }
  }

  async function runScan() {
    setScanning(true)
    setScanError(null)
    setPairs(null)
    const qs = new URLSearchParams({ threshold: String(threshold) })
    if (selectedSpace !== "__all__") qs.set("space_key", selectedSpace)
    try {
      const res = await fetch(`${API_BASE}/api/duplicates/scan?${qs}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `API error ${res.status}`)
      }
      const data = await res.json()
      setPairs(data.pairs ?? [])
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed")
    } finally {
      setScanning(false)
    }
  }

  async function proposeMerge(pair: DuplicatePair) {
    const key = pairKey(pair)
    setProposing(key)
    setProposeError(null)
    try {
      const res = await fetch(`${API_BASE}/api/duplicates/propose-merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_a_id: pair.page_a.id, page_b_id: pair.page_b.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `API error ${res.status}`)
      }
      setProposed(prev => new Set(prev).add(key))
    } catch (e) {
      setProposeError(e instanceof Error ? e.message : "Failed to propose merge")
    } finally {
      setProposing(null)
    }
  }

  const coveragePct = status
    ? Math.round((status.embedded_pages / Math.max(status.total_pages, 1)) * 100)
    : 0

  const thresholdLabel =
    threshold >= 0.90 ? "Very selective — only near-identical pages" :
    threshold >= 0.82 ? "Balanced — catches clear duplicates" :
                        "Inclusive — may surface partial overlaps"

  return (
    <div data-tour="duplicates-panel" className="dup-layout">

      {/* ── Header ── */}
      <div className="dup-header">
        <div>
          <div className="dup-eyebrow">Tier 2 · Intelligence</div>
          <h1 className="dup-title">Duplicate Detector</h1>
          <p className="dup-sub">
            Find semantically similar pages across your Confluence workspace using AI embeddings
            and cosine similarity — then consolidate them with one click.
          </p>
        </div>
        <div className="dup-header-icon">⊕</div>
      </div>

      {/* ── Step 1: Embed ── */}
      <div className="dup-card">
        <div className="dup-step-label">Step 1</div>
        <div className="dup-card-header">
          <div>
            <div className="dup-card-title">Index your workspace</div>
            <div className="dup-card-sub">
              Generate semantic embeddings for all pages. This fetches content from Confluence
              and runs it through the AI model — takes ~1 s per page.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className={`btn-embed${embedding ? " loading" : ""}`}
              onClick={() => runEmbed(false)}
              disabled={embedding}>
              {embedding
                ? <><span className="spinner-sm" /> Indexing…</>
                : "Index Workspace"}
            </button>
            {status && status.embedded_pages > 0 && !embedding && (
              <button
                className="btn-embed"
                style={{ background: "var(--surface-2)", color: "var(--text-2)", border: "1px solid var(--border)" }}
                onClick={() => runEmbed(true)}
                title="Clear all embeddings and re-index from scratch (needed after switching embedding model)">
                ↺ Re-index All
              </button>
            )}
          </div>
        </div>

        {/* Coverage bar */}
        {status && (
          <div className="dup-coverage">
            <div className="dup-coverage-row">
              <span className="dup-coverage-label">
                {status.embedded_pages} / {status.total_pages} pages indexed
              </span>
              <span className="dup-coverage-pct">{coveragePct}%</span>
            </div>
            <div className="dup-coverage-track">
              <div
                className="dup-coverage-fill"
                style={{ width: `${coveragePct}%` }}
              />
            </div>
          </div>
        )}

        {/* Embed result */}
        {embedResult && (
          <div className="dup-embed-result">
            <span className="embed-stat"><strong>{embedResult.processed}</strong> embedded</span>
            <span className="embed-divider" />
            <span className="embed-stat"><strong>{embedResult.content_fetched}</strong> content fetched</span>
            <span className="embed-divider" />
            {embedResult.failed > 0 && (
              <span className="embed-stat warn"><strong>{embedResult.failed}</strong> skipped</span>
            )}
          </div>
        )}

        {embedError && <div className="dup-error">⚠ {embedError}</div>}
      </div>

      {/* ── Step 2: Scan ── */}
      <div className="dup-card">
        <div className="dup-step-label">Step 2</div>
        <div className="dup-card-title">Configure scan</div>
        <div className="dup-card-sub" style={{ marginBottom: 20 }}>
          Restrict to a specific space and tune how similar two pages need to be to count as duplicates.
        </div>

        <div className="dup-config-row">
          {/* Space selector */}
          <div className="dup-field">
            <label className="dup-label">Space</label>
            <select
              className="dup-select"
              value={selectedSpace}
              onChange={e => setSelectedSpace(e.target.value)}>
              <option value="__all__">All spaces</option>
              {spaces.map(s => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Threshold slider */}
          <div className="dup-field dup-field-grow">
            <label className="dup-label">
              Similarity threshold — <strong>{Math.round(threshold * 100)}%</strong>
            </label>
            <input
              type="range"
              className="dup-slider"
              min={0.5} max={0.99} step={0.01}
              value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
            />
            <div className="dup-slider-hint">{thresholdLabel}</div>
          </div>
        </div>

        <button
          className={`btn-scan${scanning ? " loading" : ""}`}
          onClick={runScan}
          disabled={scanning || (status?.embedded_pages === 0)}>
          {scanning
            ? <><span className="spinner-sm" /> Scanning…</>
            : "Scan for Duplicates"}
        </button>
        {status?.embedded_pages === 0 && !scanning && (
          <span className="dup-scan-hint">Index your workspace first</span>
        )}

        {scanError && <div className="dup-error">⚠ {scanError}</div>}
      </div>

      {/* ── Results ── */}
      {scanning && (
        <div className="dup-scanning-state">
          <span className="spinner-lg" />
          <span>Comparing embeddings across {status?.embedded_pages ?? "—"} pages…</span>
        </div>
      )}

      {pairs !== null && !scanning && (
        <>
          {/* Summary bar */}
          <div className="dup-results-bar">
            <span className="results-count">
              {pairs.length === 0
                ? "No duplicates found"
                : `${pairs.length} duplicate pair${pairs.length !== 1 ? "s" : ""} found`}
            </span>
            {pairs.length > 0 && (
              <>
                <span className="results-divider" />
                <span className="results-high">
                  {pairs.filter(p => p.severity === "high").length} high severity
                </span>
                <span className="results-divider" />
                <span className="results-medium">
                  {pairs.filter(p => p.severity === "medium").length} medium severity
                </span>
              </>
            )}
            {proposed.size > 0 && (
              <>
                <span className="results-divider" />
                <button className="results-link" onClick={() => navigate("/approvals")}>
                  {proposed.size} proposal{proposed.size !== 1 ? "s" : ""} in Approvals ↗
                </button>
              </>
            )}
          </div>

          {proposeError && <div className="dup-error">⚠ {proposeError}</div>}

          {pairs.length === 0 && (
            <div className="dup-empty">
              <div className="dup-empty-icon">✓</div>
              <p>No duplicates detected at {Math.round(threshold * 100)}% similarity.</p>
              <p className="dup-empty-hint">
                Try lowering the threshold to surface partial overlaps,
                or index more pages to improve coverage.
              </p>
            </div>
          )}

          {pairs.map(pair => {
            const key = pairKey(pair)
            const isProposing = proposing === key
            const isDone = proposed.has(key)
            const pct = Math.round(pair.similarity * 100)

            return (
              <div key={key} className={`dup-pair-card${pair.severity === "exact" || pair.severity === "high" ? " high" : ""}`}>
                <div className="dup-pair-severity">
                  <span className={`sev-badge sev-${pair.severity}`}>
                    {pair.severity === "exact" ? "Exact" : pair.severity === "high" ? "High" : "Medium"}
                  </span>
                  <span className="sev-pct">{pct}% similar</span>
                  <div className="sev-bar-track">
                    <div
                      className={`sev-bar-fill ${pair.severity}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <div className="dup-pair-pages">
                  <div className="dup-page-box">
                    <div className="dup-page-label">Page A</div>
                    <div className="dup-page-title">{pair.page_a.title}</div>
                    <div className="dup-page-space">{pair.page_a.space_key}</div>
                    {pair.page_a.url && (
                      <a href={pair.page_a.url} target="_blank" rel="noreferrer" className="dup-page-link">
                        Open in Confluence ↗
                      </a>
                    )}
                  </div>

                  <div className="dup-pair-connector">
                    <div className="connector-line" />
                    <div className="connector-badge">{pct}%</div>
                    <div className="connector-line" />
                  </div>

                  <div className="dup-page-box">
                    <div className="dup-page-label">Page B</div>
                    <div className="dup-page-title">{pair.page_b.title}</div>
                    <div className="dup-page-space">{pair.page_b.space_key}</div>
                    {pair.page_b.url && (
                      <a href={pair.page_b.url} target="_blank" rel="noreferrer" className="dup-page-link">
                        Open in Confluence ↗
                      </a>
                    )}
                  </div>
                </div>

                <div className="dup-pair-footer">
                  {isDone ? (
                    <div className="propose-done">
                      <span>✓ Merge proposal created</span>
                      <button className="results-link" onClick={() => navigate("/approvals")}>
                        Review in Approvals ↗
                      </button>
                    </div>
                  ) : (
                    <button
                      className={`btn-propose${isProposing ? " loading" : ""}`}
                      onClick={() => proposeMerge(pair)}
                      disabled={isProposing}>
                      {isProposing
                        ? <><span className="spinner-sm" /> Analysing with Claude…</>
                        : "Propose Merge"}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* ── Empty idle state ── */}
      {pairs === null && !scanning && (
        <div className="dup-howto">
          <div className="howto-title">How it works</div>
          <div className="howto-steps">
            {[
              { n: "1", title: "Index", desc: "AI reads every page and generates a semantic fingerprint (embedding) capturing its meaning." },
              { n: "2", title: "Scan",  desc: "Embeddings are compared using cosine similarity — pages with overlapping meaning score high." },
              { n: "3", title: "Review", desc: "Duplicate pairs are ranked by severity. High = near-identical, Medium = significant overlap." },
              { n: "4", title: "Merge", desc: "Claude analyses both pages and drafts a merge proposal. You review and apply it in Approvals." },
            ].map(step => (
              <div key={step.n} className="howto-step">
                <div className="howto-step-num">{step.n}</div>
                <div>
                  <div className="howto-step-title">{step.title}</div>
                  <div className="howto-step-desc">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
