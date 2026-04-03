import { useState } from "react"
import "./PagesPage.css"
import SpaceTree, { type PageNode } from "../components/SpaceTree"
import ContentViewer, { type Issue as ContentIssue } from "../components/ContentViewer"

const API_BASE = "http://localhost:8000"

type EditType = "restructure" | "add_summary" | "rewrite" | "remove_section" | "targeted_fix"

type IssueLocation = {
  section: string
  quote: string | null
  line_hint: string
}

type ResolvedIssue = {
  title: string
  resolution: string
}

type AnalysisResult = {
  page_title: string
  page_url: string
  summary: string
  is_healthy: boolean
  resolved_issues: ResolvedIssue[]
  cached?: boolean
  issues: {
    type: string
    severity: "low" | "medium" | "high"
    title: string
    description: string
    suggestion?: string | null
    location: IssueLocation | null
    needs_human_intervention?: boolean
    requires_human?: boolean
    human_action_needed?: string | null
    fixable?: boolean
    confidence?: number
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

// Map issue type → suggested edit type for the modal pre-selection
const ISSUE_TO_EDIT: Record<string, EditType> = {
  stale:        "rewrite",
  duplicate:    "remove_section",
  orphan:       "restructure",
  unowned:      "add_summary",
  unstructured: "restructure",
}

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
  const [activeTab, setActiveTab] = useState<"overview" | "content">("overview")

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<string | null>(null)

  // Per-page analysis cache (keyed by page ID)
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({})
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // Per-page content cache (keyed by page ID)
  const [pageContents, setPageContents] = useState<Record<string, string>>({})

  // Propose-all state
  const [proposingAll, setProposingAll] = useState(false)

  // Edit modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editType, setEditType] = useState<EditType>("add_summary")
  const [selectedIssueForFix, setSelectedIssueForFix] = useState<ContentIssue | null>(null)
  const [removeSectionHint, setRemoveSectionHint] = useState("")
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [createdProposalCount, setCreatedProposalCount] = useState(0)

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

  async function analyzeSelected(forceRefresh = false) {
    if (!selected) return
    const pageId = selected.id

    setAnalyses(prev => { const n = { ...prev }; delete n[pageId]; return n })
    setAnalyzingId(pageId)
    setAnalyzeError(null)

    try {
      // 1. Fetch live content from Confluence (also updates DB cache)
      const pageRes = await fetch(`${API_BASE}/api/sync/pages/${pageId}`)
      if (!pageRes.ok) throw new Error("Could not fetch page content")
      const pageData = await pageRes.json()

      // Store raw content for ContentViewer
      if (pageData.content) {
        setPageContents(prev => ({ ...prev, [pageId]: pageData.content }))
      }

      // 2. Run AI analysis — DB-cached unless forceRefresh
      // Use version from the live Confluence fetch — not the stale SpaceTree value.
      // After a fix is applied, Confluence increments the version; the SpaceTree
      // won't reflect this until the next full sync, but pageData always has the truth.
      const liveVersion = pageData.version ?? selected.version

      const qs = forceRefresh ? "?force_refresh=true" : ""
      const analyzeRes = await fetch(`${API_BASE}/api/analyze/${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url:           selected.url ?? `https://confluence.page/${selected.id}`,
          title:         selected.title,
          content:       pageData.content ?? "",
          last_modified: pageData.last_modified ?? selected.last_modified,
          owner:         pageData.owner ?? selected.owner,
          page_id:       selected.id,
          page_version:  liveVersion,
        }),
      })
      if (!analyzeRes.ok) throw new Error("Analysis failed")
      const result: AnalysisResult = await analyzeRes.json()
      setAnalyses(prev => ({ ...prev, [pageId]: result }))
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed")
    } finally {
      setAnalyzingId(null)
    }
  }

  async function proposeAll(issues: ContentIssue[]) {
    if (!selected || proposingAll) return
    setProposingAll(true)
    try {
      const pageRes = await fetch(`${API_BASE}/api/sync/pages/${selected.id}`)
      if (!pageRes.ok) throw new Error("Could not fetch page content")
      const pageData = await pageRes.json()

      await Promise.all(
        issues.map(issue =>
          fetch(`${API_BASE}/api/edit/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              page_id:      selected.id,
              page_title:   selected.title,
              content:      pageData.content ?? "",
              page_version: selected.version,
              edit_type:    ISSUE_TO_EDIT[issue.type] ?? "restructure",
              space:        selected.space_key,
            }),
          })
        )
      )
    } catch (e) {
      console.error("Propose all failed:", e)
    } finally {
      setProposingAll(false)
    }
  }

  function openEditModal(initialType?: EditType, issue?: ContentIssue) {
    setModalOpen(true)
    setEditType(initialType ?? "add_summary")
    setSelectedIssueForFix(issue ?? null)
    setRemoveSectionHint("")
    setEditError(null)
    setCreatedProposalId(null)
  }

  function closeModal() {
    setModalOpen(false)
    setEditLoading(false)
    setEditError(null)
    setSelectedIssueForFix(null)
    setCreatedProposalCount(0)
  }

  async function submitEdit() {
    if (!selected) return
    setEditLoading(true)
    setEditError(null)

    try {
      const pageRes = await fetch(`${API_BASE}/api/sync/pages/${selected.id}`)
      if (!pageRes.ok) throw new Error("Could not fetch page content from Confluence")
      const pageData = await pageRes.json()

      if (selectedIssueForFix) {
        // Single targeted fix — opened from ContentViewer annotation card
        const res = await fetch(`${API_BASE}/api/edit/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page_id:           selected.id,
            page_title:        selected.title,
            content:           pageData.content ?? "",
            page_version:      selected.version,
            edit_type:         "targeted_fix",
            space:             selected.space_key,
            issue_title:       selectedIssueForFix.title,
            issue_description: selectedIssueForFix.description,
            issue_suggestion:  selectedIssueForFix.suggestion,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail ?? `API error ${res.status}`)
        }
        setCreatedProposalCount(1)
      } else {
        // Overview mode: fix all fixable issues in parallel, or run a general improvement
        const fixableIssues = (analysis?.issues ?? []).filter(i => !i.needs_human_intervention)
        if (fixableIssues.length > 0) {
          const results = await Promise.allSettled(
            fixableIssues.map(issue =>
              fetch(`${API_BASE}/api/edit/generate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  page_id:           selected.id,
                  page_title:        selected.title,
                  content:           pageData.content ?? "",
                  page_version:      selected.version,
                  edit_type:         "targeted_fix",
                  space:             selected.space_key,
                  issue_title:       issue.title,
                  issue_description: issue.description,
                  issue_suggestion:  issue.suggestion,
                }),
              })
            )
          )
          const succeeded = results.filter(r => r.status === "fulfilled").length
          if (succeeded === 0) throw new Error("All proposals failed to generate")
          setCreatedProposalCount(succeeded)
        } else {
          // No fixable issues — general improvement
          const res = await fetch(`${API_BASE}/api/edit/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              page_id:             selected.id,
              page_title:          selected.title,
              content:             pageData.content ?? "",
              page_version:        selected.version,
              edit_type:           editType,
              remove_section_hint: removeSectionHint || undefined,
              space:               selected.space_key,
            }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.detail ?? `API error ${res.status}`)
          }
          setCreatedProposalCount(1)
        }
      }
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setEditLoading(false)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const analysis   = selected ? analyses[selected.id] : null
  const isAnalyzing = selected ? analyzingId === selected.id : false
  const isFolder   = (selected?.children.length ?? 0) > 0

  function countDescendants(nodes: PageNode[]): number {
    return nodes.reduce((acc, n) => acc + 1 + countDescendants(n.children), 0)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="pages-layout">

      {/* ── Left panel ── */}
      <div data-tour="pages-tree" className="pages-panel">
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
          onPageSelect={page => {
            setSelected(page)
            setAnalyzeError(null)
            setActiveTab("overview")
          }}
          selectedPageId={selected?.id ?? null}
          refreshKey={refreshKey}
        />
      </div>

      {/* ── Right panel ── */}
      <div data-tour="page-detail" className="detail-panel">
        {selected ? (
          isFolder ? (

            /* ── Folder view (unchanged) ── */
            <div className="detail-content">
              <div className="detail-header">
                <div className="detail-icon">⊟</div>
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
                  <span className="meta-label">Direct pages</span>
                  <span className="meta-value">{selected.children.length}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Total pages</span>
                  <span className="meta-value">{countDescendants(selected.children)}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Owner</span>
                  <span className="meta-value">{selected.owner ?? "Unknown"}</span>
                </div>
              </div>

              <div className="detail-analyze-cta">
                <div className="summary-label">Folder contents</div>
                <p className="analyze-hint">
                  This is a folder containing {selected.children.length} page{selected.children.length !== 1 ? "s" : ""}.
                  Select an individual page to analyze it or edit it with AI.
                </p>
                <div className="folder-children-list">
                  {selected.children.map(child => (
                    <div
                      key={child.id}
                      className="folder-child-row"
                      onClick={() => {
                        setSelected(child)
                        setAnalyzeError(null)
                        setActiveTab("overview")
                      }}>
                      <span className="folder-child-icon">{child.children.length > 0 ? "⊟" : "◫"}</span>
                      <span className="folder-child-title">{child.title}</span>
                      {child.children.length > 0 && (
                        <span className="folder-child-count">{child.children.length}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="detail-actions">
                {selected.url ? (
                  <a href={selected.url} target="_blank" rel="noreferrer" className="btn-primary">
                    Open in Confluence ↗
                  </a>
                ) : (
                  <button className="btn-primary" disabled>Open in Confluence ↗</button>
                )}
              </div>
            </div>

          ) : (

            /* ── Page view with tabs ── */
            <div className="detail-page">

              {/* Page header */}
              <div className="detail-page-header">
                <div className="detail-icon">◫</div>
                <div style={{ minWidth: 0 }}>
                  <h2 className="detail-title">{selected.title}</h2>
                  <p className="detail-meta">
                    ~{selected.id}
                    {selected.last_modified && ` · Modified ${fmt(selected.last_modified)}`}
                  </p>
                </div>
              </div>

              {/* Tab bar */}
              <div className="detail-tab-bar">
                <button
                  className={`detail-tab-btn${activeTab === "overview" ? " active" : ""}`}
                  onClick={() => setActiveTab("overview")}>
                  Overview
                </button>
                <button
                  data-tour="content-tab"
                  className={`detail-tab-btn${activeTab === "content" ? " active" : ""}`}
                  onClick={() => setActiveTab("content")}
                  disabled={!analysis}
                  title={!analysis ? "Run analysis first to enable content view" : undefined}>
                  Content
                </button>
              </div>

              {/* ── Overview tab ── */}
              {activeTab === "overview" && (
                <div className="detail-page-overview">

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
                  {isAnalyzing ? (
                    <div className="detail-analyze-cta">
                      <div className="summary-label">AI Analysis</div>
                      <button className="btn-analyze" disabled>
                        <span className="spinner" /> Analyzing…
                      </button>
                    </div>
                  ) : analysis ? (
                    <>
                      <div className="summary-label-row">
                        <span className="summary-label">AI Analysis</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {analysis.cached && (
                            <span className="cached-badge">Cached</span>
                          )}
                          <button
                            className="btn-reanalyze"
                            onClick={() => analyzeSelected(true)}
                            title="Re-fetch from Confluence and re-analyze">
                            ↻ Re-analyze
                          </button>
                          <button
                            className="btn-mark-reviewed"
                            onClick={() => {
                              if (!selected) return
                              fetch(`${API_BASE}/api/analyze/mark-reviewed/${selected.id}`, { method: "POST" })
                                .then(() => analyzeSelected(true))
                            }}
                            title="Mark this page as manually reviewed and healthy">
                            ✓ Mark Reviewed
                          </button>
                        </div>
                      </div>

                      {/* Healthy state banner */}
                      {analysis.is_healthy ? (
                        <div className="detail-healthy-banner">
                          <span className="detail-healthy-icon">✓</span>
                          <div>
                            <div className="detail-healthy-title">This page is healthy</div>
                            <div className="detail-healthy-sub">
                              No issues detected · {analysis.summary}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="detail-summary">
                          <p>{analysis.summary}</p>
                        </div>
                      )}

                      {/* Resolved issues (previously fixed) */}
                      {analysis.resolved_issues && analysis.resolved_issues.length > 0 && (
                        <div className="detail-resolved">
                          <div className="summary-label">Previously fixed</div>
                          <div className="resolved-list">
                            {analysis.resolved_issues.map((r, i) => (
                              <div key={i} className="resolved-row">
                                <span className="resolved-check">✓</span>
                                <div>
                                  <span className="resolved-title">{r.title}</span>
                                  <span className="resolved-how"> — {r.resolution}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Remaining issues */}
                      {analysis.issues.length > 0 && (
                        <div className="detail-issues">
                          <div className="summary-label">Issues detected</div>
                          <div className="issues-list">
                            {analysis.issues.map((issue, i) => {
                              const sev = SEV[issue.severity] ?? SEV.low
                              const needsHuman = !!issue.needs_human_intervention
                              return (
                                <div key={i} className={`issue-card${needsHuman ? " issue-card-flagged" : ""}`} {...(i === 0 ? { 'data-tour': 'issue-card' } : {})}>
                                  <div className="issue-card-top">
                                    <span className="issue-title">
                                      {needsHuman && <span className="issue-flag-icon" title="Needs manual input">⚑</span>}
                                      {issue.title}
                                    </span>
                                    <span className="sev-pill" style={{ background: sev.bg, color: sev.color }}>
                                      {sev.label}
                                    </span>
                                  </div>
                                  <p className="issue-desc">{issue.description}</p>
                                  {needsHuman ? (
                                    <p className="issue-human-note">
                                      Needs manual input — edit directly in Confluence (e.g. correct contact, owner, or internal reference).
                                    </p>
                                  ) : (
                                    <p className="issue-suggestion">→ {issue.suggestion}</p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
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
                        onClick={() => analyzeSelected()}>
                        Analyze with DocAI
                      </button>
                    </div>
                  )}

                  {/* CTA to jump to inline view when issues exist */}
                  {analysis && analysis.issues.length > 0 && (
                    <div className="detail-content-cta">
                      <button
                        className="btn-view-content"
                        onClick={() => setActiveTab("content")}>
                        View issues in context →
                      </button>
                      <span className="detail-content-hint">
                        See each issue highlighted directly in the page text
                      </span>
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
                    <button className="btn-ghost" onClick={() => openEditModal()}>Propose a Fix</button>
                  </div>
                </div>
              )}

              {/* ── Content tab ── */}
              {activeTab === "content" && analysis && (
                <ContentViewer
                  key={selected.id}
                  content={pageContents[selected.id] ?? ""}
                  issues={analysis.issues as ContentIssue[]}
                  pageTitle={selected.title}
                  onCreateProposal={issue => openEditModal(ISSUE_TO_EDIT[issue.type], issue)}
                  onProposeAll={proposeAll}
                />
              )}
            </div>
          )
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

            {createdProposalCount > 0 ? (
              <div className="modal-success">
                <div className="modal-success-icon">✓</div>
                <h3>{createdProposalCount === 1 ? "Proposal created" : `${createdProposalCount} proposals created`}</h3>
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
                    <h3 className="modal-title">Propose a Fix</h3>
                    <p className="modal-sub">{selected.title}</p>
                  </div>
                  <button className="modal-close" onClick={closeModal}>✕</button>
                </div>

                {/* Human-review callout */}
                <div className="modal-review-callout">
                  <span className="modal-review-icon">👤</span>
                  <span>
                    DocAI will generate a proposed change for your review.{" "}
                    <strong>Nothing is applied to Confluence until you approve it</strong>{" "}
                    in the Proposals queue.
                  </span>
                </div>

                <div className="modal-body">

                  {/* ── Section 1: Fixable issues summary ── */}
                  {analysis && analysis.issues.length > 0 && !selectedIssueForFix && (() => {
                    const fixable = analysis.issues.filter(i => !i.needs_human_intervention)
                    const human   = analysis.issues.filter(i =>  i.needs_human_intervention)
                    return (
                      <div className="modal-section">
                        <div className="modal-section-label">
                          Issues to fix
                          {fixable.length > 0 && (
                            <span className="modal-fix-count">{fixable.length} fixable</span>
                          )}
                        </div>
                        <div className="modal-issue-list">
                          {fixable.map((issue, i) => {
                            const sev = SEV[issue.severity] ?? SEV.low
                            return (
                              <div key={i} className="modal-issue-row modal-issue-row-static">
                                <span className="modal-issue-check">✓</span>
                                <div className="modal-issue-body">
                                  <div className="modal-issue-title">
                                    <span className="modal-issue-sev" style={{ color: sev.color, background: sev.bg }}>
                                      {sev.label}
                                    </span>
                                    {issue.title}
                                  </div>
                                  <div className="modal-issue-suggestion">→ {issue.suggestion}</div>
                                </div>
                              </div>
                            )
                          })}
                          {human.map((issue, i) => {
                            const sev = SEV[issue.severity] ?? SEV.low
                            return (
                              <div key={i} className="modal-issue-row needs-human">
                                <span className="modal-issue-radio">⚑</span>
                                <div className="modal-issue-body">
                                  <div className="modal-issue-title">
                                    <span className="modal-issue-sev" style={{ color: sev.color, background: sev.bg }}>
                                      {sev.label}
                                    </span>
                                    {issue.title}
                                  </div>
                                  <div className="modal-issue-human-flag">
                                    Needs manual input — edit directly in Confluence.
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* ── Section 2: General improvement ── */}
                  <div className={`modal-section${analysis && analysis.issues.filter(i => !i.needs_human_intervention).length > 0 && !selectedIssueForFix ? " modal-section-dimmed" : ""}`}>
                    <div className="modal-section-label">
                      {analysis && analysis.issues.length > 0
                        ? "Or apply a general improvement"
                        : "Choose an improvement"}
                    </div>
                    <div className="edit-type-grid">
                      {EDIT_OPTIONS.map(opt => (
                        <button
                          key={opt.type}
                          className={`edit-type-card${!selectedIssueForFix && editType === opt.type ? " selected" : ""}`}
                          onClick={() => { setSelectedIssueForFix(null); setEditType(opt.type) }}>
                          <span className="edit-type-icon">{opt.icon}</span>
                          <span className="edit-type-label">{opt.label}</span>
                          <span className="edit-type-desc">{opt.description}</span>
                        </button>
                      ))}
                    </div>

                    {!selectedIssueForFix && editType === "remove_section" && (
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
                  </div>

                  {editError && (
                    <div className="modal-error"><span>⚠</span> {editError}</div>
                  )}
                </div>

                <div className="modal-footer">
                  <button className="btn-ghost" onClick={closeModal} disabled={editLoading}>Cancel</button>
                  <button
                    className="btn-primary"
                    onClick={submitEdit}
                    disabled={
                      editLoading ||
                      (!selectedIssueForFix && editType === "remove_section" && !removeSectionHint.trim() && (analysis?.issues.filter(i => !i.needs_human_intervention).length ?? 0) === 0)
                    }>
                    {editLoading ? (
                      <span className="modal-loading"><span className="spinner" /> Generating…</span>
                    ) : (() => {
                      if (selectedIssueForFix) return "Generate Proposal →"
                      const fixableCount = analysis?.issues.filter(i => !i.needs_human_intervention).length ?? 0
                      if (fixableCount > 0) return `Fix ${fixableCount} Issue${fixableCount !== 1 ? "s" : ""} →`
                      return "Generate Proposal →"
                    })()}
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
