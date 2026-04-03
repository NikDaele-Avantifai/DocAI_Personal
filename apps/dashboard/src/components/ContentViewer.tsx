import {
  useState,
  useMemo,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
} from "react"
import "./ContentViewer.css"

// ── Exported types ────────────────────────────────────────────────────────────

export type IssueLocation = {
  section: string
  quote: string | null
  line_hint: string
}

export type Issue = {
  type: string
  severity: "low" | "medium" | "high"
  title: string
  description: string
  suggestion?: string | null
  location?: IssueLocation | null
  needs_human_intervention?: boolean
  requires_human?: boolean
  human_action_needed?: string | null
  fixable?: boolean
  confidence?: number
}

// ── Internal types ────────────────────────────────────────────────────────────

type Section = {
  index: number
  text: string
  lineCount: number
}

type Highlight = {
  quote: string
  severity: "low" | "medium" | "high"
}

type CleanGroup = {
  kind: "group"
  groupIndex: number
  sections: Section[]
  lineCount: number
}

type AffectedBlock = {
  kind: "affected"
  section: Section
  issues: Issue[]
}

type RenderBlock = CleanGroup | AffectedBlock

type ConnectorLine = {
  key: string
  x1: number; y1: number
  x2: number; y2: number
  severity: "low" | "medium" | "high"
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

const GROUP_LINE_LIMIT = 100

// ── Pure helpers ──────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  // Preserve paragraph/line structure before stripping tags
  const withNewlines = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")

  // Decode all HTML entities (including &mdash; &ndash; &hellip; etc.)
  // using the browser's built-in parser — safe since all tags are stripped above
  const div = document.createElement("div")
  div.innerHTML = withNewlines
  const decoded = div.textContent ?? withNewlines

  return decoded
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function parseIntoSections(raw: string): Section[] {
  const text = stripHtml(raw)
  const blocks = text.split(/\n\n+/).map(b => b.trim()).filter(Boolean)
  return blocks.map((block, index) => ({
    index,
    text: block,
    lineCount: block.split("\n").length,
  }))
}

function getHeading(section: Section): string | null {
  const lines = section.text.split("\n")
  const first = lines[0].trim()
  if (
    first.length > 0 &&
    first.length <= 70 &&
    !first.match(/[.!?]$/) &&
    (lines.length === 1 || first.length < 50)
  ) {
    return first
  }
  return null
}

function issueKey(issue: Issue): string {
  return `${issue.type}::${issue.title}`
}

function highestSev(issues: Issue[]): "low" | "medium" | "high" {
  return issues.reduce<"low" | "medium" | "high">(
    (best, i) => (SEV_ORDER[i.severity] < SEV_ORDER[best] ? i.severity : best),
    "low"
  )
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim()
}

function matchIssuesToSections(
  issues: Issue[],
  sections: Section[]
): { sectionIssueMap: Map<number, Issue[]>; docLevelIssues: Issue[] } {
  const map = new Map<number, Issue[]>()
  const docLevel: Issue[] = []

  for (const issue of issues) {
    const loc = issue.location
    if (!loc || loc.line_hint === "full_document" || loc.section === "document") {
      docLevel.push(issue)
      continue
    }

    let matched = false

    if (loc.quote) {
      const normQuote = normalizeWhitespace(loc.quote)
      for (const s of sections) {
        // Try exact match first, then normalized fallback
        if (s.text.includes(loc.quote) || normalizeWhitespace(s.text).includes(normQuote)) {
          map.set(s.index, [...(map.get(s.index) ?? []), issue])
          matched = true
          break
        }
      }
    }

    if (!matched && loc.section && loc.section !== "document") {
      const needle = loc.section.toLowerCase()
      for (const s of sections) {
        const h = getHeading(s)
        if (h && (h.toLowerCase().includes(needle) || needle.includes(h.toLowerCase()))) {
          map.set(s.index, [...(map.get(s.index) ?? []), issue])
          matched = true
          break
        }
      }
    }

    if (!matched) docLevel.push(issue)
  }

  return { sectionIssueMap: map, docLevelIssues: docLevel }
}

function renderHighlights(text: string, highlights: Highlight[]): React.ReactNode {
  if (highlights.length === 0) return <>{text}</>

  type Span = { start: number; end: number; sev: string }
  const spans: Span[] = []

  for (const h of highlights) {
    if (!h.quote) continue
    let idx = text.indexOf(h.quote)
    if (idx === -1) {
      // Fallback: try replacing non-breaking spaces with regular spaces
      const normalized = text.replace(/\u00A0/g, " ")
      const normQuote = h.quote.replace(/\u00A0/g, " ")
      idx = normalized.indexOf(normQuote)
    }
    if (idx !== -1) spans.push({ start: idx, end: idx + h.quote.length, sev: h.severity })
  }

  if (spans.length === 0) return <>{text}</>

  spans.sort((a, b) => a.start - b.start)

  const nodes: React.ReactNode[] = []
  let pos = 0
  for (const s of spans) {
    if (s.start > pos) nodes.push(<span key={`t${pos}`}>{text.slice(pos, s.start)}</span>)
    nodes.push(
      <mark key={`m${s.start}`} className={`cv-mark cv-mark-${s.sev}`}>
        {text.slice(s.start, s.end)}
      </mark>
    )
    pos = s.end
  }
  if (pos < text.length) nodes.push(<span key="tail">{text.slice(pos)}</span>)
  return <>{nodes}</>
}

// ── Annotation card sub-component ────────────────────────────────────────────

interface AnnotationCardProps {
  issue: Issue
  created: boolean
  active: boolean
  cardRef: (el: HTMLDivElement | null) => void
  onClick: () => void
  onPropose: (e: React.MouseEvent) => void
}

function AnnotationCard({ issue, created, active, cardRef, onClick, onPropose }: AnnotationCardProps) {
  const needsHuman = !!(issue.requires_human || issue.needs_human_intervention)
  const color = needsHuman ? "var(--border)" : (SEV_COLOR[issue.severity] ?? SEV_COLOR.low)
  const label = SEV_LABEL[issue.severity] ?? "Low"
  const quote = issue.location?.quote
  const shortQuote = quote ? (quote.length > 60 ? quote.slice(0, 57) + "…" : quote) : null

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
            <div className="cv-human-action">
              {issue.human_action_needed ?? issue.description}
            </div>
          </div>
        ) : (
          <div className="cv-card-suggestion">{issue.suggestion}</div>
        )}
      </div>
      <div className="cv-card-footer">
        {needsHuman ? (
          <span className="cv-human-note">Edit directly in Confluence</span>
        ) : (
          <button
            className={`cv-propose-btn${created ? " cv-propose-done" : ""}`}
            disabled={created}
            onClick={onPropose}>
            {created ? "✓ Proposed" : "Propose Fix"}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Connector SVG sub-component ───────────────────────────────────────────────

function ConnectorSvg({ lines, height }: { lines: ConnectorLine[]; height: number }) {
  if (lines.length === 0 || height === 0) return null
  return (
    <svg
      className="cv-connectors"
      style={{ height }}
      aria-hidden="true">
      {lines.map(c => {
        const color = SEV_COLOR[c.severity] ?? SEV_COLOR.low
        const mx = c.x1 + (c.x2 - c.x1) * 0.5
        return (
          <g key={c.key}>
            <path
              d={`M ${c.x1} ${c.y1} C ${mx} ${c.y1} ${mx} ${c.y2} ${c.x2} ${c.y2}`}
              stroke={color}
              strokeWidth={1}
              strokeOpacity={0.3}
              fill="none"
            />
            {/* Source dot — on the right edge of the paragraph */}
            <circle cx={c.x1} cy={c.y1} r={2.5} fill={color} fillOpacity={0.4} />
            {/* Target dot — on the left edge of the card */}
            <circle cx={c.x2} cy={c.y2} r={2.5} fill={color} fillOpacity={0.55} />
          </g>
        )
      })}
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ContentViewerProps {
  content: string
  issues: Issue[]
  pageTitle: string
  onCreateProposal: (issue: Issue) => void
  onProposeAll: (issues: Issue[]) => void
}

export default function ContentViewer({
  content,
  issues,
  onCreateProposal,
  onProposeAll,
}: ContentViewerProps) {
  // ── Data ─────────────────────────────────────────────────────────────────
  const sections = useMemo(() => parseIntoSections(content), [content])

  const { sectionIssueMap, docLevelIssues } = useMemo(
    () => matchIssuesToSections(issues, sections),
    [issues, sections]
  )

  // Group consecutive clean sections into ~100-line blocks.
  const renderBlocks = useMemo((): RenderBlock[] => {
    const blocks: RenderBlock[] = []
    let groupIndex = 0
    let pending: Section[] = []
    let pendingLines = 0

    function flushGroup() {
      if (pending.length === 0) return
      blocks.push({ kind: "group", groupIndex, sections: pending, lineCount: pendingLines })
      groupIndex++
      pending = []
      pendingLines = 0
    }

    for (const section of sections) {
      const sectionIssues = sectionIssueMap.get(section.index) ?? []
      if (sectionIssues.length > 0) {
        flushGroup()
        blocks.push({ kind: "affected", section, issues: sectionIssues })
      } else {
        pending.push(section)
        pendingLines += section.lineCount
        if (pendingLines >= GROUP_LINE_LIMIT) flushGroup()
      }
    }
    flushGroup()
    return blocks
  }, [sections, sectionIssueMap])

  // All clean groups start collapsed
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  const [createdProposals, setCreatedProposals] = useState<Set<string>>(new Set())
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // SVG connector state — updated imperatively inside calculatePositions
  const [svgData, setSvgData] = useState<{ lines: ConnectorLine[]; height: number }>({
    lines: [],
    height: 0,
  })

  // ── Refs ─────────────────────────────────────────────────────────────────
  const columnsRef    = useRef<HTMLDivElement>(null)
  const leftColRef    = useRef<HTMLDivElement>(null)
  const rightColRef   = useRef<HTMLDivElement>(null)
  const highlightRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const cardRefs      = useRef<Map<string, HTMLDivElement>>(new Map())

  // ── Ordered annotation list ───────────────────────────────────────────────
  const orderedAnnotations = useMemo(() => {
    const result: Array<{ key: string; issue: Issue; sectionIndex: number }> = []
    for (const issue of docLevelIssues) {
      result.push({ key: issueKey(issue), issue, sectionIndex: -1 })
    }
    for (const [sIdx, list] of [...sectionIssueMap.entries()].sort(([a], [b]) => a - b)) {
      for (const issue of list) {
        result.push({ key: issueKey(issue), issue, sectionIndex: sIdx })
      }
    }
    return result
  }, [docLevelIssues, sectionIssueMap])

  // ── Layout: position cards + compute connector lines ─────────────────────
  const calculatePositions = useCallback(() => {
    if (!columnsRef.current || !rightColRef.current || !leftColRef.current) return

    const containerRect = columnsRef.current.getBoundingClientRect()

    // 1. Compute desired card tops
    type Entry = { key: string; desiredTop: number }
    const entries: Entry[] = []

    for (const ann of orderedAnnotations) {
      if (ann.sectionIndex === -1) {
        entries.push({ key: ann.key, desiredTop: 12 })
      } else {
        const el = highlightRefs.current.get(ann.key)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        entries.push({ key: ann.key, desiredTop: rect.top - containerRect.top })
      }
    }

    // 2. Resolve overlaps + set card positions
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

    // 4. Compute SVG connector lines (after card positions are applied)
    const newLines: ConnectorLine[] = []
    for (const ann of orderedAnnotations) {
      if (ann.sectionIndex === -1) continue
      const paraEl = highlightRefs.current.get(ann.key)
      const cardEl = cardRefs.current.get(ann.key)
      if (!paraEl || !cardEl) continue

      const paraRect = paraEl.getBoundingClientRect()
      const cardRect = cardEl.getBoundingClientRect()

      newLines.push({
        key: ann.key,
        // Start: right edge of paragraph at its vertical midpoint
        x1: paraRect.right - containerRect.left,
        y1: paraRect.top - containerRect.top + paraRect.height / 2,
        // End: left edge of card at its vertical midpoint
        x2: cardRect.left - containerRect.left,
        y2: cardRect.top - containerRect.top + cardRect.height / 2,
        severity: ann.issue.severity,
      })
    }

    setSvgData({ lines: newLines, height: contentHeight })
  }, [orderedAnnotations])

  useLayoutEffect(() => {
    calculatePositions()
  }, [calculatePositions])

  useEffect(() => {
    const ro = new ResizeObserver(calculatePositions)
    if (columnsRef.current) ro.observe(columnsRef.current)
    return () => ro.disconnect()
  }, [calculatePositions])

  // Also recalculate when groups expand/collapse (paragraph positions shift)
  useLayoutEffect(() => {
    calculatePositions()
  }, [expandedGroups, calculatePositions])

  // ── Controls ──────────────────────────────────────────────────────────────
  const allGroupIndices = useMemo(
    () => renderBlocks.filter((b): b is CleanGroup => b.kind === "group").map(b => b.groupIndex),
    [renderBlocks]
  )

  function collapseAll() { setExpandedGroups(new Set()) }
  function expandAll()   { setExpandedGroups(new Set(allGroupIndices)) }

  function toggleGroup(idx: number) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  function handlePropose(issue: Issue) {
    setCreatedProposals(prev => new Set([...prev, issueKey(issue)]))
    onCreateProposal(issue)
  }

  function handleProposeAll() {
    const toPropose = issues.filter(i => !createdProposals.has(issueKey(i)))
    if (toPropose.length === 0) return
    setCreatedProposals(new Set(issues.map(issueKey)))
    onProposeAll(toPropose)
  }

  // ── Summary counts ────────────────────────────────────────────────────────
  const highCount = issues.filter(i => i.severity === "high").length
  const medCount  = issues.filter(i => i.severity === "medium").length
  const lowCount  = issues.filter(i => i.severity === "low").length
  const allProposed = issues.length > 0 && issues.every(i => createdProposals.has(issueKey(i)))

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!content || content.trim() === "") {
    return (
      <div className="cv-empty">
        <span className="cv-empty-icon">◫</span>
        <p>Page content not available</p>
        <span className="cv-empty-hint">Sync this page from Confluence to view content.</span>
      </div>
    )
  }

  // ── No issues ─────────────────────────────────────────────────────────────
  if (issues.length === 0) {
    return (
      <div className="cv-wrapper">
        <div className="cv-no-issues-bar">
          <span className="cv-no-issues-dot" />
          No issues detected — page content looks good
        </div>
        <div className="cv-left cv-left-full">
          {sections.map(section => (
            <div key={section.index} className="cv-para">{section.text}</div>
          ))}
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="cv-wrapper">

      {/* ── Header bar ── */}
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
          <button className="cv-ctrl-btn" onClick={collapseAll}>Collapse all</button>
          <button className="cv-ctrl-btn" onClick={expandAll}>Expand all</button>
          {issues.length > 0 && (
            <button
              className={`cv-propose-all-btn${allProposed ? " cv-propose-all-done" : ""}`}
              disabled={allProposed}
              onClick={handleProposeAll}>
              {allProposed ? "✓ All proposed" : "Propose all fixes"}
            </button>
          )}
        </div>
      </div>

      {/* ── Two-column area ── */}
      <div className="cv-columns" ref={columnsRef}>

        {/* SVG connector overlay — absolutely positioned behind cards */}
        <ConnectorSvg lines={svgData.lines} height={svgData.height} />

        {/* Left column — document */}
        <div className="cv-left" ref={leftColRef}>
          {renderBlocks.map(block => {
            if (block.kind === "group") {
              const isExpanded = expandedGroups.has(block.groupIndex)
              return (
                <div key={`group-${block.groupIndex}`}>
                  <div
                    className="cv-group-toggle"
                    onClick={() => toggleGroup(block.groupIndex)}>
                    {isExpanded ? "▼" : "▶"}
                  </div>
                  {isExpanded && block.sections.map(section => (
                    <div key={section.index} className="cv-para">{section.text}</div>
                  ))}
                </div>
              )
            }

            // Affected section — always rendered
            const { section, issues: sectionIssues } = block
            const maxSev = highestSev(sectionIssues)
            const highlights: Highlight[] = sectionIssues
              .filter(i => i.location?.quote)
              .map(i => ({ quote: i.location!.quote!, severity: i.severity }))

            return (
              <div
                key={section.index}
                className={`cv-para cv-para-affected cv-para-${maxSev}`}
                ref={el => {
                  for (const issue of sectionIssues) {
                    const k = issueKey(issue)
                    if (el) highlightRefs.current.set(k, el as HTMLDivElement)
                    else    highlightRefs.current.delete(k)
                  }
                }}>
                {renderHighlights(section.text, highlights)}
              </div>
            )
          })}
        </div>

        {/* Right column — annotation cards */}
        <div className="cv-right" ref={rightColRef}>

          {/* Doc-level cards — anchored at top */}
          {docLevelIssues.map(issue => {
            const k = issueKey(issue)
            return (
              <AnnotationCard
                key={k}
                issue={issue}
                created={createdProposals.has(k)}
                active={activeKey === k}
                cardRef={el => {
                  if (el) cardRefs.current.set(k, el)
                  else    cardRefs.current.delete(k)
                }}
                onClick={() => setActiveKey(k === activeKey ? null : k)}
                onPropose={e => { e.stopPropagation(); handlePropose(issue) }}
              />
            )
          })}

          {/* Section-level cards — always rendered (affected sections always show) */}
          {[...sectionIssueMap.entries()]
            .sort(([a], [b]) => a - b)
            .flatMap(([, list]) =>
              list.map(issue => {
                const k = issueKey(issue)
                return (
                  <AnnotationCard
                    key={k}
                    issue={issue}
                    created={createdProposals.has(k)}
                    active={activeKey === k}
                    cardRef={el => {
                      if (el) cardRefs.current.set(k, el)
                      else    cardRefs.current.delete(k)
                    }}
                    onClick={() => setActiveKey(k === activeKey ? null : k)}
                    onPropose={e => { e.stopPropagation(); handlePropose(issue) }}
                  />
                )
              })
            )}
        </div>
      </div>
    </div>
  )
}
