import React, {
  Fragment,
  useState,
  useRef,
  useMemo,
  useLayoutEffect,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import "./ContentViewer.css"

// ── Exported types ─────────────────────────────────────────────────────────

export type IssueLocation = {
  section: string
  quote: string | null
  line_hint: string
}

export type Issue = {
  // v2 fields
  id?: string
  type?: "text-issue" | "general-issue" | string
  category?: string
  explanation?: string
  exactContent?: string | null
  suggestedFix?: string | null
  affectedElement?: string | null
  // v1 backward-compat
  severity: "low" | "medium" | "high"
  title: string
  description?: string
  suggestion?: string | null
  location?: IssueLocation | null
  needs_human_intervention?: boolean
  requires_human?: boolean
  human_action_needed?: string | null
  fixable?: boolean
  confidence?: number
}

// ── Accessors (v1 + v2) ────────────────────────────────────────────────────

function issueExplanation(issue: Issue): string {
  return issue.explanation ?? issue.description ?? ""
}

function issueSuggestion(issue: Issue): string | null | undefined {
  return issue.suggestedFix ?? issue.suggestion
}

function issueQuote(issue: Issue): string | null | undefined {
  return issue.exactContent ?? issue.location?.quote
}

function issueNeedsHuman(issue: Issue): boolean {
  if (issue.needs_human_intervention || issue.requires_human) return true
  if (issue.type === "text-issue" && issue.suggestedFix === null) return true
  return false
}

function issueKey(issue: Issue): string {
  return issue.id ? `id::${issue.id}` : `${issue.type}::${issue.title}`
}

// ── Internal types ─────────────────────────────────────────────────────────

type ConnectorLine = {
  key: string
  x1: number; y1: number
  x2: number; y2: number
  severity: "low" | "medium" | "high"
}

type MarkTarget = {
  key: string   // issueKey
  text: string  // exactContent
}

// ── Constants ──────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  high:   "#C0392B",
  medium: "#856404",
  low:    "#0550AE",
}

const SEV_LABEL: Record<string, string> = {
  high:   "High",
  medium: "Medium",
  low:    "Low",
}

const ACTION_BTNS = [
  { type: "restructure",    label: "Restructure"    },
  { type: "rewrite",        label: "Rewrite"        },
  { type: "add_summary",    label: "Summarize"      },
  { type: "remove_section", label: "Remove Section" },
] as const

// ── HTML pre-processing ────────────────────────────────────────────────────

/**
 * Clean up Confluence-specific artefacts before DOMParser sees the HTML:
 * - CDATA markers that leak out of ac:plain-text-body blocks
 * - Zero-width characters
 */
function preprocessConfluenceHtml(html: string): string {
  return html
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/\u200B/g, "")  // zero-width spaces
}

// ── HTML → React converter with inline mark injection ──────────────────────

/**
 * Splits a text string around MarkTarget matches and injects <mark> elements
 * with amber styling and a data-issue-key attribute.
 */
function splitAndMark(
  text: string,
  marks: MarkTarget[],
  refCb: (key: string, el: HTMLElement | null) => void,
  prefix: string,
): ReactNode[] {
  type Span = { start: number; end: number; k: string }
  const spans: Span[] = []

  for (const m of marks) {
    if (!m.text) continue
    // Exact match first, then NBSP-normalised fallback
    let idx = text.indexOf(m.text)
    if (idx === -1) {
      const norm = (s: string) => s.replace(/\u00A0/g, " ")
      idx = norm(text).indexOf(norm(m.text))
    }
    if (idx !== -1 && !spans.some(s => idx < s.end && idx + m.text.length > s.start)) {
      spans.push({ start: idx, end: idx + m.text.length, k: m.key })
    }
  }

  if (spans.length === 0) return [text]
  spans.sort((a, b) => a.start - b.start)

  const nodes: ReactNode[] = []
  let pos = 0
  for (const s of spans) {
    if (s.start > pos) nodes.push(text.slice(pos, s.start))
    const ik = s.k
    nodes.push(
      <mark
        key={`${prefix}-${s.start}`}
        data-issue-key={ik}
        className="cv-mark-amber"
        ref={(el: HTMLElement | null) => refCb(ik, el)}
      >
        {text.slice(s.start, s.end)}
      </mark>
    )
    pos = s.end
  }
  if (pos < text.length) nodes.push(text.slice(pos))
  return nodes
}

/**
 * True if an element is one of Confluence's line-number injections.
 * These appear inside code blocks and should not be rendered.
 */
function isLineNumberSpan(el: Element): boolean {
  const cls = el.getAttribute("class") ?? ""
  return (
    cls.includes("linenumber") ||
    cls.includes("ds-line-number") ||
    el.getAttribute("data-ds--line-number") !== null
  )
}

/**
 * Recursively converts a DOM node to React elements, with mark injection
 * and special handling for Confluence-specific HTML patterns.
 */
function domToReact(
  node: Node,
  marks: MarkTarget[],
  refCb: (key: string, el: HTMLElement | null) => void,
  c: { n: number },
): ReactNode {
  const k = `${c.n++}`

  // ── Text node ────────────────────────────────────────────────────────────
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ""
    if (!text) return null
    const parts = splitAndMark(text, marks, refCb, k)
    if (parts.length === 1 && typeof parts[0] === "string") return text
    return <Fragment key={k}>{parts}</Fragment>
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const el = node as Element
  const tag = el.tagName.toLowerCase()

  // Skip non-content elements entirely
  if (["script", "style", "head", "colgroup", "col"].includes(tag)) return null

  const ch = Array.from(el.childNodes)
    .map(n => domToReact(n, marks, refCb, c))
    .filter((n): n is ReactNode => n != null)

  switch (tag) {
    // ── Headings ─────────────────────────────────────────────────────────
    case "h1": return <h1 key={k} className="cv-h1">{ch}</h1>
    case "h2": return <h2 key={k} className="cv-h2">{ch}</h2>
    case "h3": return <h3 key={k} className="cv-h3">{ch}</h3>
    case "h4": return <h4 key={k} className="cv-h4">{ch}</h4>
    case "h5": return <h5 key={k} className="cv-h5">{ch}</h5>
    case "h6": return <h6 key={k} className="cv-h6">{ch}</h6>

    // ── Block text ────────────────────────────────────────────────────────
    case "p":          return <p          key={k} className="cv-p">{ch}</p>
    case "blockquote": return <blockquote key={k} className="cv-blockquote">{ch}</blockquote>

    // ── Lists ─────────────────────────────────────────────────────────────
    case "ul": return <ul key={k} className="cv-ul">{ch}</ul>
    case "ol": return <ol key={k} className="cv-ol">{ch}</ol>
    case "li": return <li key={k} className="cv-li">{ch}</li>

    // ── Inline formatting ─────────────────────────────────────────────────
    case "strong": case "b":             return <strong key={k}>{ch}</strong>
    case "em":     case "i":             return <em     key={k}>{ch}</em>
    case "u":                            return <u      key={k}>{ch}</u>
    case "s": case "strike": case "del": return <s      key={k}>{ch}</s>
    case "sup": return <sup key={k}>{ch}</sup>
    case "sub": return <sub key={k}>{ch}</sub>

    // ── Code ─────────────────────────────────────────────────────────────
    case "pre": {
      // If pre wraps a code element let the code case handle it
      return <pre key={k} className="cv-pre">{ch}</pre>
    }
    case "code": {
      // Confluence code blocks: <code style="white-space:pre"> containing
      // <span data-ds--code--row=""> line wrappers with line-number spans.
      const hasCodeRows = Array.from(el.children).some(
        c => c.hasAttribute("data-ds--code--row")
      )
      if (hasCodeRows) {
        // Strip line-number spans; each row span becomes a line of text
        const lines: ReactNode[] = []
        Array.from(el.children).forEach((row, i) => {
          if (!row.hasAttribute("data-ds--code--row")) return
          const lineNodes = Array.from(row.childNodes)
            .filter(n => {
              if (n.nodeType === Node.ELEMENT_NODE) {
                return !isLineNumberSpan(n as Element)
              }
              return true
            })
            .map(n => domToReact(n, marks, refCb, c))
            .filter((n): n is ReactNode => n != null)
          lines.push(
            <Fragment key={`row-${i}`}>{lineNodes}{"\n"}</Fragment>
          )
        })
        return (
          <pre key={k} className="cv-pre">
            <code className="cv-code">{lines}</code>
          </pre>
        )
      }
      return <code key={k} className="cv-code">{ch}</code>
    }

    // ── Tables ────────────────────────────────────────────────────────────
    case "table": return <table key={k} className="cv-table">{ch}</table>
    case "thead": return <thead key={k}>{ch}</thead>
    case "tbody": return <tbody key={k}>{ch}</tbody>
    case "tfoot": return <tfoot key={k}>{ch}</tfoot>
    case "tr":    return <tr    key={k}>{ch}</tr>
    case "th":    return <th    key={k} className="cv-th">{ch}</th>
    case "td":    return <td    key={k} className="cv-td">{ch}</td>

    // ── Misc ──────────────────────────────────────────────────────────────
    case "br":  return <br key={k} />
    case "hr":  return <hr key={k} className="cv-hr" />
    case "img": return null
    case "a":   return <span key={k}>{ch}</span>  // strip href, keep text

    // ── Span ─────────────────────────────────────────────────────────────
    case "span": {
      // Skip Confluence line-number injections
      if (isLineNumberSpan(el)) return null
      // Code-row spans: just render children (the parent code case handles structure)
      if (el.hasAttribute("data-ds--code--row")) {
        return ch.length > 0 ? <Fragment key={k}>{ch}</Fragment> : null
      }
      return ch.length > 0 ? <span key={k}>{ch}</span> : null
    }

    case "div":  return <div key={k}>{ch}</div>

    // ── Confluence AC tags + unknown → render children, no wrapper ────────
    default: return ch.length > 0 ? <Fragment key={k}>{ch}</Fragment> : null
  }
}

function parseHtmlToReact(
  html: string,
  marks: MarkTarget[],
  refCb: (key: string, el: HTMLElement | null) => void,
): ReactNode {
  const clean = preprocessConfluenceHtml(html)
  const doc = new DOMParser().parseFromString(clean, "text/html")
  const c = { n: 0 }
  const children = Array.from(doc.body.childNodes)
    .map(n => domToReact(n, marks, refCb, c))
    .filter((n): n is ReactNode => n != null)
  return <>{children}</>
}

// ── Annotation card ────────────────────────────────────────────────────────

interface AnnotationCardProps {
  issue: Issue
  created: boolean
  proposing: boolean
  active: boolean
  cardRef: (el: HTMLDivElement | null) => void
  onClick: () => void
  onPropose: (e: React.MouseEvent) => void
}

function AnnotationCard({ issue, created, proposing, active, cardRef, onClick, onPropose }: AnnotationCardProps) {
  const needsHuman  = issueNeedsHuman(issue)
  const color       = needsHuman ? "var(--border)" : (SEV_COLOR[issue.severity] ?? SEV_COLOR.low)
  const label       = SEV_LABEL[issue.severity] ?? "Low"
  const quote       = issueQuote(issue)
  const shortQuote  = quote ? (quote.length > 60 ? quote.slice(0, 57) + "…" : quote) : null
  const suggestion  = issueSuggestion(issue)
  const explanation = issueExplanation(issue)

  return (
    <div
      ref={cardRef}
      className={`cv-card${active ? " cv-card-active" : ""}${needsHuman ? " cv-card-human" : ""}`}
      onClick={onClick}>
      <div className="cv-card-header" style={{ borderLeftColor: color }}>
        {needsHuman
          ? <span className="cv-human-icon">👤</span>
          : <span className={`cv-sev-dot cv-sev-dot-${issue.severity}`} />
        }
        <span className="cv-sev-label" style={needsHuman ? { color: "var(--text-3)" } : {}}>{label}</span>
        <span className="cv-card-title">{issue.title}</span>
      </div>
      <div className="cv-card-body">
        {shortQuote && <div className="cv-card-quote">"{shortQuote}"</div>}
        {needsHuman ? (
          <div className="cv-human-block">
            <div className="cv-human-label">Human review required</div>
            <div className="cv-human-action">{issue.human_action_needed ?? explanation}</div>
          </div>
        ) : (
          <div className="cv-card-suggestion">{suggestion}</div>
        )}
      </div>
      <div className="cv-card-footer">
        {needsHuman ? (
          <span className="cv-human-note">Edit directly in Confluence</span>
        ) : (
          <button
            className={`cv-propose-btn${created ? " cv-propose-done" : ""}`}
            disabled={created || proposing}
            onClick={onPropose}>
            {proposing
              ? <span className="cv-btn-spinner" />
              : created
              ? "✓ Proposed"
              : "Propose Fix"}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Connector SVG ──────────────────────────────────────────────────────────

function ConnectorSvg({ lines, height }: { lines: ConnectorLine[]; height: number }) {
  if (lines.length === 0 || height === 0) return null
  return (
    <svg className="cv-connectors" style={{ height }} aria-hidden="true">
      {lines.map(c => {
        const mx = c.x1 + (c.x2 - c.x1) * 0.5
        return (
          <g key={c.key}>
            <path
              d={`M ${c.x1} ${c.y1} C ${mx} ${c.y1} ${mx} ${c.y2} ${c.x2} ${c.y2}`}
              stroke="rgb(251,191,36)"
              strokeWidth={1}
              strokeOpacity={0.55}
              fill="none"
            />
            <circle cx={c.x1} cy={c.y1} r={2.5} fill="rgb(251,191,36)" fillOpacity={0.6} />
            <circle cx={c.x2} cy={c.y2} r={2.5} fill="rgb(251,191,36)" fillOpacity={0.7} />
          </g>
        )
      })}
    </svg>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export interface ContentViewerProps {
  content: string
  issues: Issue[]
  pageTitle: string
  onCreateProposal: (issue: Issue) => Promise<void>
  onProposeAll: (issues: Issue[]) => Promise<void>
  onAction?: (type: string) => void
  onNavigateToProposals?: () => void
}

export default function ContentViewer({
  content,
  issues,
  onCreateProposal,
  onProposeAll,
  onAction,
  onNavigateToProposals,
}: ContentViewerProps) {
  // ── Refs ──────────────────────────────────────────────────────────────
  const columnsRef  = useRef<HTMLDivElement>(null)
  const leftColRef  = useRef<HTMLDivElement>(null)
  const rightColRef = useRef<HTMLDivElement>(null)
  const markRefs    = useRef<Map<string, HTMLElement>>(new Map())
  const cardRefs    = useRef<Map<string, HTMLDivElement>>(new Map())
  const toastTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable ref callback — markRefs.current is always the same Map
  const markRefCb = useCallback((key: string, el: HTMLElement | null) => {
    if (el) markRefs.current.set(key, el)
    else    markRefs.current.delete(key)
  }, [])

  // ── Parsed content ────────────────────────────────────────────────────
  // Mark any issue that has a quote/exactContent, EXCEPT general-issue
  const marks = useMemo<MarkTarget[]>(() => {
    return issues
      .filter(i => i.type !== "general-issue" && !!issueQuote(i))
      .map(i => ({ key: issueKey(i), text: issueQuote(i)! }))
  }, [issues])

  const renderedContent = useMemo(
    () => parseHtmlToReact(content, marks, markRefCb),
    [content, marks, markRefCb]
  )

  // ── State ─────────────────────────────────────────────────────────────
  const [createdProposals, setCreatedProposals] = useState<Set<string>>(new Set())
  const [activeKey,        setActiveKey]        = useState<string | null>(null)
  const [proposingKey,     setProposingKey]     = useState<string | null>(null)
  const [proposingAll,     setProposingAll]     = useState(false)
  const [toast,            setToast]            = useState<string | null>(null)
  const [svgData,          setSvgData]          = useState<{ lines: ConnectorLine[]; height: number }>({
    lines: [],
    height: 0,
  })

  // ── Toast helper ──────────────────────────────────────────────────────
  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])

  // ── Annotations list ──────────────────────────────────────────────────
  const annotations = useMemo(
    () => issues.map(issue => ({ key: issueKey(issue), issue })),
    [issues]
  )

  // ── Layout: position cards + draw connectors ─────────────────────────
  const calculatePositions = useCallback(() => {
    if (!columnsRef.current || !rightColRef.current || !leftColRef.current) return

    const containerRect = columnsRef.current.getBoundingClientRect()

    // 1. Compute desired top for each card
    type Entry = { key: string; desiredTop: number }
    const entries: Entry[] = []

    for (const ann of annotations) {
      const markEl = markRefs.current.get(ann.key) ?? null
      if (markEl) {
        const markRect = markEl.getBoundingClientRect()
        entries.push({ key: ann.key, desiredTop: markRect.top - containerRect.top })
      } else {
        entries.push({ key: ann.key, desiredTop: 12 })
      }
    }

    // 2. Sort by document position, then resolve overlaps
    entries.sort((a, b) => a.desiredTop - b.desiredTop)

    let lastBottom = 0
    for (const { key, desiredTop } of entries) {
      const actual = Math.max(desiredTop, lastBottom + 8)
      const card = cardRefs.current.get(key)
      if (card) {
        card.style.top = `${actual}px`
        lastBottom = actual + card.offsetHeight
      }
    }

    // 3. Set right column min-height
    const contentHeight = Math.max(leftColRef.current.scrollHeight, lastBottom + 20)
    rightColRef.current.style.minHeight = `${contentHeight}px`

    // 4. Draw connectors — only for issues that have a visible mark
    const newLines: ConnectorLine[] = []
    for (const ann of annotations) {
      const markEl = markRefs.current.get(ann.key)
      const cardEl = cardRefs.current.get(ann.key)
      if (!markEl || !cardEl) continue  // no mark → no connector (covers general-issue)

      const markRect = markEl.getBoundingClientRect()
      // Hide arrow when mark is scrolled out of the visible viewport
      if (markRect.bottom < 0 || markRect.top > window.innerHeight) continue

      const cardRect = cardEl.getBoundingClientRect()
      newLines.push({
        key: ann.key,
        x1: markRect.right  - containerRect.left,
        y1: markRect.top    - containerRect.top + markRect.height / 2,
        x2: cardRect.left   - containerRect.left,
        y2: cardRect.top    - containerRect.top + cardRect.height  / 2,
        severity: ann.issue.severity,
      })
    }

    setSvgData({ lines: newLines, height: contentHeight })
  }, [annotations])

  useLayoutEffect(() => { calculatePositions() }, [calculatePositions])

  useEffect(() => {
    const ro = new ResizeObserver(calculatePositions)
    if (columnsRef.current) ro.observe(columnsRef.current)
    return () => ro.disconnect()
  }, [calculatePositions])

  useEffect(() => {
    window.addEventListener("scroll", calculatePositions, { passive: true })
    return () => window.removeEventListener("scroll", calculatePositions)
  }, [calculatePositions])

  // ── Handlers ──────────────────────────────────────────────────────────
  async function handlePropose(issue: Issue) {
    const k = issueKey(issue)
    if (proposingKey === k || createdProposals.has(k)) return
    setProposingKey(k)
    try {
      await onCreateProposal(issue)
      setCreatedProposals(prev => new Set([...prev, k]))
      showToast("Proposal created — view it in the Proposals tab")
    } catch {
      // leave button in un-proposed state so user can retry
    } finally {
      setProposingKey(null)
    }
  }

  async function handleProposeAll() {
    const toPropose = issues.filter(i => !createdProposals.has(issueKey(i)))
    if (toPropose.length === 0 || proposingAll) return
    setProposingAll(true)
    try {
      await onProposeAll(toPropose)
      setCreatedProposals(new Set(issues.map(issueKey)))
      showToast("All proposals created — view them in the Proposals tab")
    } catch {
      // leave state unchanged so user can retry
    } finally {
      setProposingAll(false)
    }
  }

  // ── Summary counts ────────────────────────────────────────────────────
  const highCount   = issues.filter(i => i.severity === "high").length
  const medCount    = issues.filter(i => i.severity === "medium").length
  const lowCount    = issues.filter(i => i.severity === "low").length
  const allProposed = issues.length > 0 && issues.every(i => createdProposals.has(issueKey(i)))

  // ── Empty state ───────────────────────────────────────────────────────
  if (!content || content.trim() === "") {
    return (
      <div className="cv-empty">
        <span className="cv-empty-icon">◫</span>
        <p>Page content not available</p>
        <span className="cv-empty-hint">Sync this page from Confluence to view content.</span>
      </div>
    )
  }

  // ── No issues ─────────────────────────────────────────────────────────
  if (issues.length === 0) {
    return (
      <div className="cv-wrapper">
        <div className="cv-no-issues-bar">
          <span className="cv-no-issues-dot" />
          <span>No issues detected — page content looks good</span>
          {onAction && (
            <div className="cv-no-issues-actions">
              {ACTION_BTNS.map(btn => (
                <button key={btn.type} className="cv-ctrl-btn" onClick={() => onAction(btn.type)}>
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="cv-left cv-left-full">
          {renderedContent}
        </div>
      </div>
    )
  }

  // ── Full render ───────────────────────────────────────────────────────
  return (
    <div className="cv-wrapper">

      {/* Header bar */}
      <div className="cv-header">
        <div className="cv-header-counts">
          {highCount > 0 && (
            <span className="cv-count cv-count-high">
              <span className="cv-dot cv-dot-high" />{highCount} high
            </span>
          )}
          {medCount > 0 && (
            <span className="cv-count cv-count-medium">
              <span className="cv-dot cv-dot-medium" />{medCount} medium
            </span>
          )}
          {lowCount > 0 && (
            <span className="cv-count cv-count-low">
              <span className="cv-dot cv-dot-low" />{lowCount} low
            </span>
          )}
          <span className="cv-count-total">
            · {issues.length} issue{issues.length !== 1 ? "s" : ""} total
          </span>
        </div>
        <div className="cv-header-actions">
          {onAction && (
            <>
              <span className="cv-header-divider" />
              {ACTION_BTNS.map(btn => (
                <button key={btn.type} className="cv-ctrl-btn" onClick={() => onAction(btn.type)}>
                  {btn.label}
                </button>
              ))}
              <span className="cv-header-divider" />
            </>
          )}
          <button
            className={`cv-propose-all-btn${allProposed ? " cv-propose-all-done" : ""}`}
            disabled={allProposed || proposingAll}
            onClick={handleProposeAll}>
            {proposingAll
              ? <><span className="cv-btn-spinner cv-btn-spinner-light" /> Proposing…</>
              : allProposed
              ? "✓ All proposed"
              : "Propose all fixes"}
          </button>
          {createdProposals.size > 0 && onNavigateToProposals && (
            <>
              <span className="cv-header-divider" />
              <button className="cv-goto-proposals-btn" onClick={onNavigateToProposals}>
                View Proposals →
              </button>
            </>
          )}
        </div>
      </div>

      {/* Two-column area */}
      <div className="cv-columns" ref={columnsRef}>

        <ConnectorSvg lines={svgData.lines} height={svgData.height} />

        {/* Left: document with inline amber marks */}
        <div className="cv-left" ref={leftColRef}>
          {renderedContent}
        </div>

        {/* Right: annotation cards (absolutely positioned) */}
        <div className="cv-right-panel">
          <div className="cv-right-header">Issues</div>
          <div className="cv-right" ref={rightColRef}>
            {annotations.map(({ key: k, issue }) => (
              <AnnotationCard
                key={k}
                issue={issue}
                created={createdProposals.has(k)}
                proposing={proposingKey === k}
                active={activeKey === k}
                cardRef={el => {
                  if (el) cardRefs.current.set(k, el)
                  else    cardRefs.current.delete(k)
                }}
                onClick={() => setActiveKey(k === activeKey ? null : k)}
                onPropose={e => { e.stopPropagation(); handlePropose(issue) }}
              />
            ))}
          </div>
        </div>

      </div>

      {/* Toast notification */}
      {toast && (
        <div className="cv-toast">
          <span className="cv-toast-check">✓</span>
          <span>{toast}</span>
          {onNavigateToProposals && (
            <button className="cv-toast-btn" onClick={onNavigateToProposals}>
              Go to Proposals →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
