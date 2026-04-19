import { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import "./DuplicatesPage.css"
import { API_BASE } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

// ── Types ─────────────────────────────────────────────────────────────────────

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

type ParagraphMatch = { aIdx: number; bIdx: number; key: string }

type MirrorConnector = {
  key: string
  x1: number; y1: number
  x2: number; y2: number
}

// ── Content helpers ───────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  const withNewlines = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
  const div = document.createElement("div")
  div.innerHTML = withNewlines
  return (div.textContent ?? withNewlines).replace(/\n{3,}/g, "\n\n").trim()
}

function parseParagraphs(raw: string): string[] {
  return stripHtml(raw)
    .split(/\n\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function wordOverlap(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const wa = words(a)
  const wb = words(b)
  let count = 0
  for (const w of wa) if (wb.has(w)) count++
  return count / Math.max(wa.size, wb.size, 1)
}

function findMatches(parasA: string[], parasB: string[]): ParagraphMatch[] {
  const matches: ParagraphMatch[] = []
  const usedB = new Set<number>()
  for (let ai = 0; ai < parasA.length; ai++) {
    if (matches.length >= 6) break
    if (parasA[ai].length < 25) continue
    let bestScore = 0.28
    let bestBi = -1
    for (let bi = 0; bi < parasB.length; bi++) {
      if (usedB.has(bi)) continue
      const score = wordOverlap(parasA[ai], parasB[bi])
      if (score > bestScore) { bestScore = score; bestBi = bi }
    }
    if (bestBi >= 0) {
      matches.push({ aIdx: ai, bIdx: bestBi, key: `${ai}:${bestBi}` })
      usedB.add(bestBi)
    }
  }
  return matches
}

// ── DuplicateMirror ───────────────────────────────────────────────────────────

const TRUNCATE_PARAS = 10

function DuplicateMirror({
  pair,
  contentA,
  contentB,
  truncated = true,
  onViewFull,
}: {
  pair: DuplicatePair
  contentA: string
  contentB: string
  truncated?: boolean
  onViewFull?: () => void
}) {
  const parasA = useMemo(() => parseParagraphs(contentA), [contentA])
  const parasB = useMemo(() => parseParagraphs(contentB), [contentB])

  const displayA = useMemo(
    () => truncated ? parasA.slice(0, TRUNCATE_PARAS) : parasA,
    [truncated, parasA],
  )
  const displayB = useMemo(
    () => truncated ? parasB.slice(0, TRUNCATE_PARAS) : parasB,
    [truncated, parasB],
  )

  const matches   = useMemo(() => findMatches(displayA, displayB), [displayA, displayB])
  const matchedA  = useMemo(() => new Set(matches.map(m => m.aIdx)), [matches])
  const matchedB  = useMemo(() => new Set(matches.map(m => m.bIdx)), [matches])

  const containerRef = useRef<HTMLDivElement>(null)
  const paraARefs    = useRef<Map<number, HTMLDivElement>>(new Map())
  const paraBRefs    = useRef<Map<number, HTMLDivElement>>(new Map())
  const [connectors, setConnectors] = useState<MirrorConnector[]>([])

  const calculate = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const lines: MirrorConnector[] = []
    for (const { aIdx, bIdx, key } of matches) {
      const elA = paraARefs.current.get(aIdx)
      const elB = paraBRefs.current.get(bIdx)
      if (!elA || !elB) continue
      const rA = elA.getBoundingClientRect()
      const rB = elB.getBoundingClientRect()
      lines.push({
        key,
        x1: rA.right - rect.left,
        y1: rA.top - rect.top + rA.height / 2,
        x2: rB.left - rect.left,
        y2: rB.top - rect.top + rB.height / 2,
      })
    }
    setConnectors(lines)
  }, [matches])

  useLayoutEffect(() => { calculate() }, [calculate])

  useEffect(() => {
    const ro = new ResizeObserver(calculate)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [calculate])

  const needsFullView =
    truncated && (parasA.length > TRUNCATE_PARAS || parasB.length > TRUNCATE_PARAS)

  return (
    <div className="dup-mirror" ref={containerRef}>

      {/* SVG connector overlay */}
      {connectors.length > 0 && (
        <svg className="dup-mirror-svg" aria-hidden="true">
          <defs>
            <marker id="dup-arrow-a" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <circle cx="3" cy="3" r="2.5" fill="var(--color-primary)" fillOpacity="0.35" />
            </marker>
          </defs>
          {connectors.map(c => {
            const mx = c.x1 + (c.x2 - c.x1) * 0.5
            return (
              <g key={c.key}>
                <path
                  d={`M ${c.x1} ${c.y1} C ${mx} ${c.y1} ${mx} ${c.y2} ${c.x2} ${c.y2}`}
                  stroke="var(--color-primary)"
                  strokeWidth={1.5}
                  strokeOpacity={0.3}
                  strokeDasharray="5 3"
                  fill="none"
                />
                <circle cx={c.x1} cy={c.y1} r={3} fill="var(--color-primary)" fillOpacity={0.4} />
                <circle cx={c.x2} cy={c.y2} r={3} fill="var(--color-primary)" fillOpacity={0.4} />
              </g>
            )
          })}
        </svg>
      )}

      {/* Two-column content */}
      <div className="dup-mirror-cols">

        {/* Page A */}
        <div className="dup-mirror-col">
          <div className="dup-mirror-col-header">
            <span className="dup-mirror-col-label">Page A</span>
            <span className="dup-mirror-col-title" title={pair.page_a.title}>
              {pair.page_a.title}
            </span>
          </div>
          <div className="dup-mirror-paras">
            {displayA.map((text, i) => (
              <div
                key={i}
                ref={el => el
                  ? paraARefs.current.set(i, el as HTMLDivElement)
                  : paraARefs.current.delete(i)}
                className={`dup-mirror-para${matchedA.has(i) ? " dup-mirror-para-match" : ""}`}>
                {text}
              </div>
            ))}
            {truncated && parasA.length > TRUNCATE_PARAS && (
              <div className="dup-mirror-more">
                +{parasA.length - TRUNCATE_PARAS} more section{parasA.length - TRUNCATE_PARAS !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

        {/* Page B */}
        <div className="dup-mirror-col">
          <div className="dup-mirror-col-header">
            <span className="dup-mirror-col-label">Page B</span>
            <span className="dup-mirror-col-title" title={pair.page_b.title}>
              {pair.page_b.title}
            </span>
          </div>
          <div className="dup-mirror-paras">
            {displayB.map((text, i) => (
              <div
                key={i}
                ref={el => el
                  ? paraBRefs.current.set(i, el as HTMLDivElement)
                  : paraBRefs.current.delete(i)}
                className={`dup-mirror-para${matchedB.has(i) ? " dup-mirror-para-match" : ""}`}>
                {text}
              </div>
            ))}
            {truncated && parasB.length > TRUNCATE_PARAS && (
              <div className="dup-mirror-more">
                +{parasB.length - TRUNCATE_PARAS} more section{parasB.length - TRUNCATE_PARAS !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* View full CTA */}
      {needsFullView && onViewFull && (
        <div className="dup-mirror-footer">
          <span className="dup-mirror-footer-hint">
            Showing first {TRUNCATE_PARAS} sections of each page
          </span>
          <button className="dup-viewfull-btn" onClick={onViewFull}>
            View full pages side by side →
          </button>
        </div>
      )}
    </div>
  )
}

// ── ProposeOptions ────────────────────────────────────────────────────────────

function ProposeOptions({
  isProposing,
  onArchive,
  onRewrite,
}: {
  isProposing: boolean
  onArchive: () => void
  onRewrite: () => void
}) {
  return (
    <div className="dup-propose-options">
      <span className="dup-propose-label">Resolve duplicate:</span>
      <button
        className={`btn-propose${isProposing ? " loading" : ""}`}
        onClick={onArchive}
        disabled={isProposing}>
        {isProposing
          ? <><span className="spinner-sm" /> Working…</>
          : "Archive one page"}
      </button>
      <button
        className={`btn-propose btn-propose-primary${isProposing ? " loading" : ""}`}
        onClick={onRewrite}
        disabled={isProposing}>
        {isProposing
          ? <><span className="spinner-sm" /> Working…</>
          : "Rewrite & merge →"}
      </button>
    </div>
  )
}

// ── DecisionPanel ─────────────────────────────────────────────────────────────

function DecisionPanel({
  isProposing,
  onSelect,
  onClose,
}: {
  isProposing: boolean
  onSelect: (action: "remove-block" | "consolidate-pages") => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("keydown", handleKey)
    document.addEventListener("mousedown", handleMouseDown)
    return () => {
      document.removeEventListener("keydown", handleKey)
      document.removeEventListener("mousedown", handleMouseDown)
    }
  }, [onClose])

  return (
    <div className="dup-decision-panel" ref={panelRef}>
      <div className="dup-decision-title">How would you like to resolve this?</div>
      <div className="dup-decision-options">

        <div className="dup-decision-option">
          <div className="dup-decision-option-body">
            <div className="dup-decision-icon">✂</div>
            <div>
              <div className="dup-decision-option-name">Remove duplicate section</div>
              <div className="dup-decision-option-desc">
                Remove the duplicate content from one page and keep it in the other.
                Best when only part of the page overlaps.
              </div>
            </div>
          </div>
          <button
            className={`btn-decision-select${isProposing ? " loading" : ""}`}
            onClick={() => onSelect("remove-block")}
            disabled={isProposing}>
            {isProposing ? <><span className="spinner-sm" /> Working…</> : "Select"}
          </button>
        </div>

        <div className="dup-decision-option">
          <div className="dup-decision-option-body">
            <div className="dup-decision-icon">⑂</div>
            <div>
              <div className="dup-decision-option-name">Consolidate into one page</div>
              <div className="dup-decision-option-desc">
                Remove one page entirely and merge its unique content into the other.
                Best when pages are heavily overlapping.
              </div>
            </div>
          </div>
          <button
            className={`btn-decision-select${isProposing ? " loading" : ""}`}
            onClick={() => onSelect("consolidate-pages")}
            disabled={isProposing}>
            {isProposing ? <><span className="spinner-sm" /> Working…</> : "Select"}
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DuplicatesPage() {
  const navigate = useNavigate()
  const { isTokenReady } = useAuth()

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
  const [proposing, setProposing] = useState<string | null>(null)
  const [proposed, setProposed]   = useState<Set<string>>(new Set())
  const [proposeError, setProposeError] = useState<string | null>(null)
  const [decisionPanelPair, setDecisionPanelPair] = useState<string | null>(null)

  // Why similar? panel state
  const [expandedPairs, setExpandedPairs] = useState<Set<string>>(new Set())

  // Page content cache
  const [pageContents, setPageContents] = useState<Record<string, string>>({})
  const [loadingContent, setLoadingContent] = useState<Set<string>>(new Set())

  // Full-view modal
  const [fullViewPair, setFullViewPair] = useState<DuplicatePair | null>(null)

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function pairKey(p: DuplicatePair) {
    return [p.page_a.id, p.page_b.id].sort().join(":")
  }

  // ── Data fetching ────────────────────────────────────────────────────────────

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

  useEffect(() => { if (isTokenReady) loadStatus() }, [isTokenReady]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function fetchPairContent(pair: DuplicatePair) {
    const key = pairKey(pair)
    if (pageContents[pair.page_a.id] && pageContents[pair.page_b.id]) return
    setLoadingContent(prev => new Set(prev).add(key))
    try {
      const [aRes, bRes] = await Promise.all([
        fetch(`${API_BASE}/api/sync/pages/${pair.page_a.id}`).then(r => r.json()),
        fetch(`${API_BASE}/api/sync/pages/${pair.page_b.id}`).then(r => r.json()),
      ])
      setPageContents(prev => ({
        ...prev,
        [pair.page_a.id]: aRes.content ?? "",
        [pair.page_b.id]: bRes.content ?? "",
      }))
    } catch { /* silent */ } finally {
      setLoadingContent(prev => {
        const n = new Set(prev)
        n.delete(key)
        return n
      })
    }
  }

  async function proposeMerge(pair: DuplicatePair, action: "archive" | "rewrite") {
    const key = pairKey(pair)
    setProposing(key)
    setProposeError(null)
    try {
      const res = await fetch(`${API_BASE}/api/duplicates/propose-merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_a_id: pair.page_a.id,
          page_b_id: pair.page_b.id,
          action,
        }),
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

  async function proposeDuplicate(pair: DuplicatePair, action: "remove-block" | "consolidate-pages") {
    const key = pairKey(pair)
    setProposing(key)
    setProposeError(null)
    setDecisionPanelPair(null)
    try {
      const res = await fetch(`${API_BASE}/api/duplicates/propose-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_a_id: pair.page_a.id,
          page_b_id: pair.page_b.id,
          action,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `API error ${res.status}`)
      }
      setProposed(prev => new Set(prev).add(key))
    } catch (e) {
      setProposeError(e instanceof Error ? e.message : "Failed to create proposal")
    } finally {
      setProposing(null)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const coveragePct = status
    ? Math.round((status.embedded_pages / Math.max(status.total_pages, 1)) * 100)
    : 0

  const thresholdLabel =
    threshold >= 0.90 ? "Very selective — only near-identical pages" :
    threshold >= 0.82 ? "Balanced — catches clear duplicates" :
                        "Inclusive — may surface partial overlaps"

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div data-tour="duplicates-panel" className="dup-layout">

      {/* ── Header ── */}
      <div className="dup-header">
        <div>
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
          <div className="dup-embed-btns">
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
                className="btn-embed btn-embed-ghost"
                onClick={() => runEmbed(true)}
                title="Clear all embeddings and re-index from scratch (needed after switching embedding model)">
                ↺ Re-index All
              </button>
            )}
          </div>
        </div>

        {status && (
          <div className="dup-coverage">
            <div className="dup-coverage-row">
              <span className="dup-coverage-label">
                {status.embedded_pages} / {status.total_pages} pages indexed
              </span>
              <span className="dup-coverage-pct">{coveragePct}%</span>
            </div>
            <div className="dup-coverage-track">
              <div className="dup-coverage-fill" style={{ width: `${coveragePct}%` }} />
            </div>
          </div>
        )}

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
        <div className="dup-card-sub dup-card-sub-spaced">
          Restrict to a specific space and tune how similar two pages need to be to count as duplicates.
        </div>

        <div className="dup-config-row">
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

      {/* ── Scanning state ── */}
      {scanning && (
        <div className="dup-scanning-state">
          <span className="spinner-lg" />
          <span>Comparing embeddings across {status?.embedded_pages ?? "—"} pages…</span>
        </div>
      )}

      {/* ── Results ── */}
      {pairs !== null && !scanning && (
        <>
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
                <button className="results-link" onClick={() => navigate("/proposals")}>
                  {proposed.size} proposal{proposed.size !== 1 ? "s" : ""} in Proposals ↗
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
            const isDone      = proposed.has(key)
            const pct         = Math.round(pair.similarity * 100)
            const isExpanded  = expandedPairs.has(key)
            const isLoading   = loadingContent.has(key)
            const hasContent  = !!(pageContents[pair.page_a.id] && pageContents[pair.page_b.id])

            return (
              <div
                key={key}
                className={`dup-pair-card${pair.severity === "exact" || pair.severity === "high" ? " high" : ""}`}>

                {/* Severity row */}
                <div className="dup-pair-severity">
                  <span className={`sev-badge sev-${pair.severity}`}>
                    {pair.severity === "exact" ? "Exact" : pair.severity === "high" ? "High" : "Medium"}
                  </span>
                  <span className="sev-pct">{pct}% similar</span>
                  <div className="sev-bar-track">
                    <div className={`sev-bar-fill ${pair.severity}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Page summary boxes */}
                <div className="dup-pair-pages">
                  <div className="dup-page-box">
                    <div className="dup-page-label">Page A</div>
                    <div className="dup-page-title">{pair.page_a.title}</div>
                    {!/^~|^[0-9a-f]{8,}$/i.test(pair.page_a.space_key) && (
                      <div className="dup-page-space">{pair.page_a.space_key}</div>
                    )}
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
                    {!/^~|^[0-9a-f]{8,}$/i.test(pair.page_b.space_key) && (
                      <div className="dup-page-space">{pair.page_b.space_key}</div>
                    )}
                    {pair.page_b.url && (
                      <a href={pair.page_b.url} target="_blank" rel="noreferrer" className="dup-page-link">
                        Open in Confluence ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* Why similar? panel */}
                <div className="dup-why-section">
                  <button
                    className="dup-why-btn"
                    onClick={() => {
                      const nowOpen = !isExpanded
                      setExpandedPairs(prev => {
                        const next = new Set(prev)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                      if (nowOpen && !hasContent) fetchPairContent(pair)
                    }}>
                    Why similar? {isExpanded ? "↑" : "↓"}
                  </button>

                  {isExpanded && (
                    <div className="dup-why-expanded">
                      {isLoading ? (
                        <div className="dup-content-loading">
                          <span className="spinner-sm spinner-dark" />
                          Loading page content…
                        </div>
                      ) : hasContent ? (
                        <DuplicateMirror
                          pair={pair}
                          contentA={pageContents[pair.page_a.id]}
                          contentB={pageContents[pair.page_b.id]}
                          truncated
                          onViewFull={() => setFullViewPair(pair)}
                        />
                      ) : (
                        <div className="dup-content-loading">Content unavailable for this pair.</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer — two propose options */}
                <div className="dup-pair-footer">
                  {isDone ? (
                    <div className="propose-done">
                      <span>✓ Proposal created</span>
                      <button className="results-link" onClick={() => navigate("/proposals")}>
                        Review in Proposals ↗
                      </button>
                    </div>
                  ) : (
                    <ProposeOptions
                      isProposing={isProposing}
                      onArchive={() => proposeMerge(pair, "archive")}
                      onRewrite={() => setDecisionPanelPair(key)}
                    />
                  )}
                </div>

                {/* Inline decision panel */}
                {decisionPanelPair === key && !isDone && (
                  <DecisionPanel
                    isProposing={isProposing}
                    onSelect={(action) => proposeDuplicate(pair, action)}
                    onClose={() => setDecisionPanelPair(null)}
                  />
                )}
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
              { n: "1", title: "Index",  desc: "AI reads every page and generates a semantic fingerprint (embedding) capturing its meaning." },
              { n: "2", title: "Scan",   desc: "Embeddings are compared using cosine similarity — pages with overlapping meaning score high." },
              { n: "3", title: "Review", desc: "Duplicate pairs are ranked by severity. High = near-identical, Medium = significant overlap." },
              { n: "4", title: "Merge",  desc: "Claude analyses both pages and drafts a merge proposal. You review and apply it in Proposals." },
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

      {/* ── Full-view modal ── */}
      {fullViewPair && (() => {
        const fKey       = pairKey(fullViewPair)
        const isProposing = proposing === fKey
        const isDone      = proposed.has(fKey)
        const pct         = Math.round(fullViewPair.similarity * 100)

        return (
          <div className="dup-fullview-overlay" onClick={() => setFullViewPair(null)}>
            <div className="dup-fullview-modal" onClick={e => e.stopPropagation()}>

              <div className="dup-fullview-header">
                <div className="dup-fullview-header-left">
                  <div className="dup-fullview-title">Similarity Analysis</div>
                  <div className="dup-fullview-meta">
                    <span className={`sev-badge sev-${fullViewPair.severity}`}>
                      {fullViewPair.severity === "exact" ? "Exact" : fullViewPair.severity === "high" ? "High" : "Medium"}
                    </span>
                    <span className="dup-fullview-pct">{pct}% similar</span>
                    <span className="dup-fullview-pages">
                      {fullViewPair.page_a.title} · {fullViewPair.page_b.title}
                    </span>
                  </div>
                </div>
                <button className="dup-fullview-close" onClick={() => setFullViewPair(null)}>✕</button>
              </div>

              <div className="dup-fullview-body">
                <DuplicateMirror
                  pair={fullViewPair}
                  contentA={pageContents[fullViewPair.page_a.id] ?? ""}
                  contentB={pageContents[fullViewPair.page_b.id] ?? ""}
                  truncated={false}
                />
              </div>

              <div className="dup-fullview-footer">
                {isDone ? (
                  <div className="propose-done">
                    <span>✓ Proposal created</span>
                    <button className="results-link" onClick={() => navigate("/proposals")}>
                      Review in Proposals ↗
                    </button>
                  </div>
                ) : decisionPanelPair === fKey ? (
                  <DecisionPanel
                    isProposing={isProposing}
                    onSelect={(action) => { proposeDuplicate(fullViewPair, action); setFullViewPair(null) }}
                    onClose={() => setDecisionPanelPair(null)}
                  />
                ) : (
                  <ProposeOptions
                    isProposing={isProposing}
                    onArchive={() => proposeMerge(fullViewPair, "archive")}
                    onRewrite={() => setDecisionPanelPair(fKey)}
                  />
                )}
              </div>

            </div>
          </div>
        )
      })()}
    </div>
  )
}
