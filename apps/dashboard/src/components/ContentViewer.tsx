import React, {
  Fragment,
  useState,
  useRef,
  useMemo,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import "./ContentViewer.css"
import { apiClient } from '@/lib/api'

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
  blockId?: string | null
  phase?: string | null
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
  key: string      // issueKey
  text: string     // exactContent
  blockId?: string // if set, only match within this specific block
}

// Pre-resolved per-text-node spans produced by block-level matching.
// Key is a DOM Text node from the DOMParser tree; value is the list of
// mark spans (character offsets within that node) to highlight.
type BlockSpans = Map<Text, Array<{ start: number; end: number; k: string }>>

// ── Constants ──────────────────────────────────────────────────────────────

// Mirrors the backend's ADDRESSABLE_TAGS — block elements that form natural
// matching units when the content has no data-block-id attributes.
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "td", "th"])

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

// ── Whitespace utilities ───────────────────────────────────────────────────

/**
 * Collapse whitespace runs in `s` to single spaces, building a map from each
 * position in the collapsed string back to the corresponding position in the
 * original. Used by splitAndMark's whitespace-tolerant fallback.
 */
function collapseWs(s: string): { collapsed: string; map: number[] } {
  const map: number[] = []
  let result = ""
  let i = 0
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      map.push(i)
      result += " "
      while (i < s.length && /\s/.test(s[i])) i++
    } else {
      map.push(i)
      result += s[i]
      i++
    }
  }
  return { collapsed: result, map }
}

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
  currentBlockId?: string,
  hasBlockIds: boolean = true,
): ReactNode[] {
  type Span = { start: number; end: number; k: string }
  const spans: Span[] = []

  // When the document carries no data-block-id attributes at all (content synced
  // before anchoring was deployed), ignore blockId scoping entirely so marks still
  // match. When block IDs are present, scope precisely to the declared block.
  const applicable = hasBlockIds
    ? marks.filter(m => !m.blockId || m.blockId === currentBlockId)
    : marks

  for (const m of applicable) {
    if (!m.text) continue

    let spanStart = -1
    let spanEnd   = -1

    // 1. Exact match (fast path)
    const exactIdx = text.indexOf(m.text)
    if (exactIdx !== -1) {
      spanStart = exactIdx
      spanEnd   = exactIdx + m.text.length
    }

    // 2. NBSP-normalised fallback
    if (spanStart === -1) {
      const norm = (s: string) => s.replace(/\u00A0/g, " ")
      const normIdx = norm(text).indexOf(norm(m.text))
      if (normIdx !== -1) {
        spanStart = normIdx
        spanEnd   = normIdx + m.text.length
      }
    }

    // 3. Whitespace-collapsed fallback \u2014 safety net for backend/DOM text divergence.
    //    Collapse \s+ runs to a single space in both haystack and needle, find the
    //    match, then map collapsed offsets back to the original string so the <mark>
    //    wraps the correct original characters.
    if (spanStart === -1) {
      const { collapsed, map } = collapseWs(text)
      const needle = m.text.replace(/\s+/g, " ")
      const colIdx = collapsed.indexOf(needle)
      if (colIdx !== -1) {
        spanStart = map[colIdx]
        const colEnd = colIdx + needle.length
        spanEnd = colEnd < map.length ? map[colEnd] : text.length
      }
    }

    if (spanStart === -1) {
      console.warn(
        `[splitAndMark] No match for mark text (all three strategies failed):`,
        JSON.stringify(m.text.slice(0, 80)),
      )
      continue
    }

    if (!spans.some(s => spanStart < s.end && spanEnd > s.start)) {
      spans.push({ start: spanStart, end: spanEnd, k: m.key })
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
 * For a block element, collect every descendant Text node in document order,
 * join their text, run the 3-strategy match for each applicable mark, then
 * map matched [start,end] ranges back to per-Text-node offsets.
 *
 * Returns a BlockSpans map so domToReact can highlight across node boundaries
 * (e.g. a sentence that spans a <strong> tag).
 */
function resolveBlockMarks(
  el: Element,
  applicable: MarkTarget[],
): BlockSpans {
  if (applicable.length === 0) return new Map()

  // Collect all descendant text nodes in document order
  const textNodes: Text[] = []
  const offsets: number[] = []
  let totalLen = 0
  const walker = el.ownerDocument!.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n: Node | null = walker.nextNode()
  while (n) {
    offsets.push(totalLen)
    totalLen += (n as Text).data.length
    textNodes.push(n as Text)
    n = walker.nextNode()
  }
  if (textNodes.length === 0) return new Map()

  const fullText = textNodes.map(t => t.data).join("")
  const result: BlockSpans = new Map()

  for (const m of applicable) {
    if (!m.text) continue

    let mStart = -1
    let mEnd   = -1

    // Strategy 1: exact
    const exact = fullText.indexOf(m.text)
    if (exact !== -1) { mStart = exact; mEnd = exact + m.text.length }

    // Strategy 2: NBSP-normalised
    if (mStart === -1) {
      const norm = (s: string) => s.replace(/ /g, " ")
      const ni = norm(fullText).indexOf(norm(m.text))
      if (ni !== -1) { mStart = ni; mEnd = ni + m.text.length }
    }

    // Strategy 3: whitespace-collapsed
    if (mStart === -1) {
      const { collapsed, map } = collapseWs(fullText)
      const needle = m.text.replace(/\s+/g, " ")
      const ci = collapsed.indexOf(needle)
      if (ci !== -1) {
        mStart = map[ci]
        const ce = ci + needle.length
        mEnd = ce < map.length ? map[ce] : fullText.length
      }
    }

    if (mStart === -1) {
      console.warn("[ContentViewer] No match in block for:", JSON.stringify(m.text.slice(0, 80)))
      continue
    }

    // Distribute the match range across whichever text nodes it overlaps
    for (let i = 0; i < textNodes.length; i++) {
      const nStart = offsets[i]
      const nEnd   = nStart + textNodes[i].data.length
      const oStart = Math.max(mStart, nStart)
      const oEnd   = Math.min(mEnd,   nEnd)
      if (oStart < oEnd) {
        const existing = result.get(textNodes[i]) ?? []
        existing.push({ start: oStart - nStart, end: oEnd - nStart, k: m.key })
        result.set(textNodes[i], existing)
      }
    }
  }

  return result
}

/**
 * Apply pre-resolved BlockSpans to a single text node's string.
 * Like splitAndMark but skips the matching step — spans are already computed.
 */
function applySpans(
  text: string,
  spans: Array<{ start: number; end: number; k: string }>,
  refCb: (key: string, el: HTMLElement | null) => void,
  prefix: string,
): ReactNode[] {
  if (spans.length === 0) return [text]
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const nodes: ReactNode[] = []
  let pos = 0
  for (const s of sorted) {
    if (s.start > pos) nodes.push(text.slice(pos, s.start))
    nodes.push(
      <mark
        key={`${prefix}-${s.start}`}
        data-issue-key={s.k}
        className="cv-mark-amber"
        ref={(el: HTMLElement | null) => refCb(s.k, el)}
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
 * Recursively converts a DOM node to React elements, with mark injection
 * and special handling for Confluence-specific HTML patterns.
 */
function domToReact(
  node: Node,
  marks: MarkTarget[],
  refCb: (key: string, el: HTMLElement | null) => void,
  c: { n: number },
  currentBlockId?: string,
  hasBlockIds: boolean = true,
  preResolvedSpans?: BlockSpans,
): ReactNode {
  const k = `${c.n++}`

  // ── Text node ────────────────────────────────────────────────────────────
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ""
    if (!text) return null

    // Primary path: block-level spans pre-resolved by resolveBlockMarks.
    // These cover multi-node matches (e.g. a sentence spanning a <strong>).
    const blockSpanList = preResolvedSpans?.get(node as Text)
    if (blockSpanList) {
      const parts = applySpans(text, blockSpanList, refCb, k)
      if (parts.length === 1 && typeof parts[0] === "string") return text
      return <Fragment key={k}>{parts}</Fragment>
    }

    // Fallback: per-node matching (handles text nodes outside resolved blocks)
    const parts = splitAndMark(text, marks, refCb, k, currentBlockId, hasBlockIds)
    if (parts.length === 1 && typeof parts[0] === "string") return text
    return <Fragment key={k}>{parts}</Fragment>
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const el = node as Element
  const tag = el.tagName.toLowerCase()

  // Skip non-content elements entirely
  if (["script", "style", "head", "colgroup", "col"].includes(tag)) return null

  // If this element carries a data-block-id, it becomes the active block context
  // for its children so that mark scoping works correctly.
  const elBlockId = el.getAttribute("data-block-id") ?? undefined
  const effectiveBlockId = elBlockId ?? currentBlockId

  // At block boundaries: resolve all applicable marks against the full block text
  // so multi-node matches (text spanning inline elements) are captured correctly.
  // For blocks without data-block-id (pre-anchoring content), use BLOCK_TAGS.
  const isBlockBoundary = elBlockId != null || (!hasBlockIds && BLOCK_TAGS.has(tag))
  const childSpans: BlockSpans | undefined = isBlockBoundary
    ? resolveBlockMarks(
        el,
        hasBlockIds
          ? marks.filter(m => !m.blockId || m.blockId === effectiveBlockId)
          : marks,
      )
    : preResolvedSpans  // inline elements inherit parent's resolved spans

  const ch = Array.from(el.childNodes)
    .map(n => domToReact(n, marks, refCb, c, effectiveBlockId, hasBlockIds, childSpans))
    .filter((n): n is ReactNode => n != null)

  // Helper: include data-block-id on rendered element so the DOM attr exists
  // for downstream querySelector lookups. Frontend NEVER assigns IDs — only propagates.
  const bid = (props: Record<string, string>) =>
    elBlockId ? { ...props, "data-block-id": elBlockId } : props

  switch (tag) {
    // ── Headings ─────────────────────────────────────────────────────────
    case "h1": return <h1 key={k} {...bid({ className: "cv-h1" })}>{ch}</h1>
    case "h2": return <h2 key={k} {...bid({ className: "cv-h2" })}>{ch}</h2>
    case "h3": return <h3 key={k} {...bid({ className: "cv-h3" })}>{ch}</h3>
    case "h4": return <h4 key={k} {...bid({ className: "cv-h4" })}>{ch}</h4>
    case "h5": return <h5 key={k} {...bid({ className: "cv-h5" })}>{ch}</h5>
    case "h6": return <h6 key={k} {...bid({ className: "cv-h6" })}>{ch}</h6>

    // ── Block text ────────────────────────────────────────────────────────
    case "p":          return <p          key={k} {...bid({ className: "cv-p" })}>{ch}</p>
    case "blockquote": return <blockquote key={k} {...bid({ className: "cv-blockquote" })}>{ch}</blockquote>

    // ── Lists ─────────────────────────────────────────────────────────────
    case "ul": return <ul key={k} className="cv-ul">{ch}</ul>
    case "ol": return <ol key={k} className="cv-ol">{ch}</ol>
    case "li": return <li key={k} {...bid({ className: "cv-li" })}>{ch}</li>

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
            .map(n => domToReact(n, marks, refCb, c, undefined, hasBlockIds, childSpans))
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
    case "th":    return <th    key={k} {...bid({ className: "cv-th" })}>{ch}</th>
    case "td":    return <td    key={k} {...bid({ className: "cv-td" })}>{ch}</td>

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

  // Detect whether anchoring ran on this content. If no element carries
  // data-block-id, block-scoped marks fall back to unscoped matching so
  // highlights still work on pre-anchoring content. Re-sync restores precision.
  const hasBlockIds = doc.body.querySelector("[data-block-id]") !== null
  if (!hasBlockIds && marks.some(m => m.blockId)) {
    console.info(
      "[ContentViewer] Content has no data-block-id attributes — " +
      "block-scoped marks will match without scope. Re-sync to restore precise scoping.",
    )
  }

  const c = { n: 0 }
  const children = Array.from(doc.body.childNodes)
    .map(n => domToReact(n, marks, refCb, c, undefined, hasBlockIds))
    .filter((n): n is ReactNode => n != null)
  return <>{children}</>
}

// ── Annotation card ────────────────────────────────────────────────────────

interface AnnotationCardProps {
  issue: Issue
  phase: PhaseKey
  created: boolean
  proposing: boolean
  active: boolean
  dismissed: boolean
  dismissing: boolean
  cardRef: (el: HTMLDivElement | null) => void
  onClick: () => void
  onPropose: (e: React.MouseEvent) => void
  onDismiss: (e: React.MouseEvent) => void
}

function AnnotationCard({ issue, phase, created, proposing, active, dismissed, dismissing, cardRef, onClick, onPropose, onDismiss }: AnnotationCardProps) {
  const needsHuman  = issueNeedsHuman(issue)
  const color       = needsHuman ? "var(--border)" : (SEV_COLOR[issue.severity] ?? SEV_COLOR.low)
  const label       = SEV_LABEL[issue.severity] ?? "Low"
  const quote       = issueQuote(issue)
  const shortQuote  = quote ? (quote.length > 60 ? quote.slice(0, 57) + "…" : quote) : null
  const suggestion  = issueSuggestion(issue)

  return (
    <div
      ref={cardRef}
      className={`cv-card${active ? " cv-card-active" : ""}${needsHuman ? " cv-card-human" : ""}${dismissed ? " cv-card-dismissed" : ""}`}
      onClick={onClick}>
      <div className="cv-card-header" style={{ borderLeftColor: color }}>
        {needsHuman
          ? <span className="cv-human-icon">👤</span>
          : <span className={`cv-sev-dot cv-sev-dot-${issue.severity}`} />
        }
        <span className="cv-sev-label" style={needsHuman ? { color: "var(--text-3)" } : {}}>{label}</span>
        <span className="cv-card-title">{issue.title}</span>
        <span className="cv-card-phase-badge">{PHASE_LABELS[phase]}</span>
      </div>
      <div className="cv-card-body">
        {shortQuote && <div className="cv-card-quote">"{shortQuote}"</div>}
        {needsHuman ? (
          <div className="cv-human-block">
            <div className="cv-human-action">{issue.human_action_needed ?? "Human review required"}</div>
          </div>
        ) : (
          <div className="cv-card-suggestion">{suggestion}</div>
        )}
      </div>
      <div className="cv-card-footer">
        {needsHuman ? (
          <div className="cv-human-footer">
            <span className="cv-human-note">Edit directly in Confluence</span>
            <button
              className={`cv-dismiss-btn${dismissed ? " cv-dismiss-done" : ""}`}
              disabled={dismissed || dismissing}
              onClick={onDismiss}
              title="Mark this issue as reviewed and valid — Claude won't raise it again">
              {dismissing
                ? <span className="cv-btn-spinner" />
                : dismissed
                ? "✓ Marked valid"
                : "Mark as valid"}
            </button>
          </div>
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

function ConnectorSvg({ lines }: { lines: ConnectorLine[] }) {
  if (lines.length === 0) return null
  return (
    <svg className="cv-connectors" aria-hidden="true">
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

// ── Phase grouping ─────────────────────────────────────────────────────────

const PHASE_ORDER = ["structure", "content", "compliance", "hygiene", "other"] as const
type PhaseKey = typeof PHASE_ORDER[number]

const PHASE_LABELS: Record<PhaseKey, string> = {
  structure:  "Structure",
  content:    "Content",
  compliance: "Compliance",
  hygiene:    "Hygiene",
  other:      "Other",
}

// ── Main component ─────────────────────────────────────────────────────────

export interface ContentViewerProps {
  content: string
  issues: Issue[]
  pageTitle: string
  pageId?: string
  onCreateProposal: (issue: Issue) => Promise<void>
  onProposeAll: (issues: Issue[]) => Promise<void>
  onAction?: (type: string) => void
  onNavigateToProposals?: () => void
}

export default function ContentViewer({
  content,
  issues,
  pageId,
  onCreateProposal,
  onProposeAll,
  onAction,
  onNavigateToProposals,
}: ContentViewerProps) {
  // ── Refs ──────────────────────────────────────────────────────────────
  const columnsRef = useRef<HTMLDivElement>(null)
  const markRefs   = useRef<Map<string, HTMLElement>>(new Map())
  const cardRefs   = useRef<Map<string, HTMLDivElement>>(new Map())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      .map(i => ({
        key: issueKey(i),
        text: issueQuote(i)!,
        blockId: i.blockId ?? undefined,  // scoped mark — only highlights within this block
      }))
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
  const [dismissedKeys,    setDismissedKeys]    = useState<Set<string>>(new Set())
  const [dismissingKey,    setDismissingKey]    = useState<string | null>(null)
  const [svgData,          setSvgData]          = useState<ConnectorLine[]>([])

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

  // ── Active connector (Option B: one line for the active card only) ───
  // Cards are in normal flow — no absolute positioning needed. When the user
  // activates a card we draw a single bezier from its mark to the card.
  const updateConnector = useCallback(() => {
    if (!activeKey || !columnsRef.current) {
      setSvgData([])
      return
    }
    const containerRect = columnsRef.current.getBoundingClientRect()
    const markEl = markRefs.current.get(activeKey)
    const cardEl = cardRefs.current.get(activeKey)
    if (!markEl || !cardEl) {
      setSvgData([])
      return
    }
    const markRect = markEl.getBoundingClientRect()
    const cardRect = cardEl.getBoundingClientRect()
    const ann = annotations.find(a => a.key === activeKey)
    setSvgData([{
      key: activeKey,
      x1: markRect.right  - containerRect.left,
      y1: markRect.top    - containerRect.top + markRect.height / 2,
      x2: cardRect.left   - containerRect.left,
      y2: cardRect.top    - containerRect.top + cardRect.height  / 2,
      severity: ann?.issue.severity ?? "low",
    }])
  }, [activeKey, annotations])

  useEffect(() => {
    const t = setTimeout(updateConnector, 50)
    return () => clearTimeout(t)
  }, [updateConnector])

  useEffect(() => {
    const ro = new ResizeObserver(updateConnector)
    if (columnsRef.current) ro.observe(columnsRef.current)
    return () => ro.disconnect()
  }, [updateConnector])

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

  async function handleDismiss(issue: Issue) {
    if (!pageId) return
    const k = issueKey(issue)
    if (dismissedKeys.has(k) || dismissingKey === k) return
    setDismissingKey(k)
    try {
      await apiClient.post(`/api/pages/${pageId}/dismiss`, {
        issue_id: issue.id ?? k,
        issue_title: issue.title,
        exact_content: issue.exactContent ?? issue.location?.quote ?? null,
      })
      setDismissedKeys(prev => new Set([...prev, k]))
    } catch {
      // leave in un-dismissed state so user can retry
    } finally {
      setDismissingKey(null)
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

        <ConnectorSvg lines={svgData} />

        {/* Left: document with inline amber marks */}
        <div className="cv-left">
          {renderedContent}
        </div>

        {/* Right: annotation cards grouped by phase — normal flow (Option B) */}
        <div className="cv-right-panel">
          <div className="cv-right-header">Issues</div>
          <div className="cv-right">
            {(() => {
              // Group annotations by phase; unknown phases fall into "other"
              const groups = new Map<PhaseKey, typeof annotations>()
              for (const phase of PHASE_ORDER) groups.set(phase, [])
              for (const ann of annotations) {
                const p = (ann.issue.phase ?? "other") as PhaseKey
                const key: PhaseKey = PHASE_ORDER.includes(p) ? p : "other"
                groups.get(key)!.push(ann)
              }

              return PHASE_ORDER.flatMap(phase => {
                const group = groups.get(phase)!
                if (group.length === 0) return []
                return [
                  <div key={`ph-${phase}`} className="cv-phase-group">
                    <div className="cv-phase-header">
                      <span className="cv-phase-label">{PHASE_LABELS[phase]}</span>
                      <span className="cv-count cv-phase-count-badge">{group.length}</span>
                    </div>
                    {group.map(({ key: k, issue }) => (
                      <AnnotationCard
                        key={k}
                        issue={issue}
                        phase={phase}
                        created={createdProposals.has(k)}
                        proposing={proposingKey === k}
                        active={activeKey === k}
                        dismissed={dismissedKeys.has(k)}
                        dismissing={dismissingKey === k}
                        cardRef={el => {
                          if (el) cardRefs.current.set(k, el)
                          else    cardRefs.current.delete(k)
                        }}
                        onClick={() => setActiveKey(k === activeKey ? null : k)}
                        onPropose={e => { e.stopPropagation(); handlePropose(issue) }}
                        onDismiss={e => { e.stopPropagation(); handleDismiss(issue) }}
                      />
                    ))}
                  </div>,
                ]
              })
            })()}
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
