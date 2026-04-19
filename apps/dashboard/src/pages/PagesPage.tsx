import { useState, useEffect, useRef, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import "./PagesPage.css"
import SpaceTree, { type PageNode } from "../components/SpaceTree"
import ContentViewer, { type Issue as ContentIssue } from "../components/ContentViewer"
import { apiClient } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

type EditType = "restructure" | "add_summary" | "rewrite" | "remove_section" | "targeted_fix"

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
  issues: ContentIssue[]
}

const SEV = {
  high:   { color: "#FF5566", bg: "rgba(255,85,102,0.1)",  label: "High"   },
  medium: { color: "#FFB547", bg: "rgba(255,181,71,0.1)",  label: "Medium" },
  low:    { color: "#818CF8", bg: "rgba(129,140,248,0.1)", label: "Low"    },
}

const EDIT_OPTIONS: { type: EditType; label: string; description: string; icon: string }[] = [
  { type: "restructure",    label: "Restructure",    description: "Reorganize with clear headings and sections",        icon: "⬡" },
  { type: "rewrite",        label: "Rewrite",        description: "Improve clarity and fix grammar",                   icon: "✎" },
  { type: "add_summary",    label: "Summarize",      description: "Prepend Overview with owner and last-reviewed date", icon: "≡" },
  { type: "remove_section", label: "Remove Section", description: "Strip a specific outdated section",                 icon: "✕" },
]


const FLAG_LABEL: Record<string, string> = {
  stale:         "stale content",
  empty:         "insufficient content",
  no_owner:      "no owner",
  generic_title: "generic title",
  needs_review:  "open issues",
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "Unknown"
  try {
    return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return iso
  }
}

function countDescendants(nodes: PageNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countDescendants(n.children), 0)
}

export default function PagesPage() {
  const navigate = useNavigate()
  const { isTokenReady } = useAuth()

  const [selected, setSelected] = useState<PageNode | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Per-page analysis cache (keyed by page ID)
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({})
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // Per-page content cache (keyed by page ID)
  const [pageContents, setPageContents] = useState<Record<string, string>>({})

  const prevAnalyzingRef = useRef(false)

  // Sweep flags (page id → string[] of issue categories)
  const [sweepPageFlags, setSweepPageFlags] = useState<Record<string, string[]>>({})

  // (proposing state is now managed inside ContentViewer)

  // Edit modal state
  const [modalOpen,            setModalOpen]            = useState(false)
  const [editType,             setEditType]             = useState<EditType>("add_summary")
  const [fixIssues,            setFixIssues]            = useState(false)
  const [applyImprovement,     setApplyImprovement]     = useState(false)
  const [removeSectionHint,    setRemoveSectionHint]    = useState("")
  const [editLoading,          setEditLoading]          = useState(false)
  const [editError,            setEditError]            = useState<string | null>(null)
  const [createdProposalCount, setCreatedProposalCount] = useState(0)

  // Listen for health updates triggered after a proposal is applied
  useEffect(() => {
    function onHealthUpdated(e: Event) {
      const { pageId, isHealthy, analysis } = (e as CustomEvent).detail
      setAnalyses(prev => ({ ...prev, [pageId]: analysis }))
      // If the now-healthy page was in the sweep flags, remove its flags
      if (isHealthy) {
        setSweepPageFlags(prev => {
          const next = { ...prev }
          delete next[pageId]
          return next
        })
      }
    }
    window.addEventListener("docai:pageHealthUpdated", onHealthUpdated)
    return () => window.removeEventListener("docai:pageHealthUpdated", onHealthUpdated)
  }, [])

  // Re-fetch tree when sync completes from the topbar
  useEffect(() => {
    function onSyncComplete() {
      setRefreshKey(k => k + 1)
    }
    window.addEventListener("docai:synccomplete", onSyncComplete)
    return () => window.removeEventListener("docai:synccomplete", onSyncComplete)
  }, [])

  // Load sweep data once on mount — wait for token
  useEffect(() => {
    if (!isTokenReady) return
    apiClient.get('/api/sweep/latest')
      .then(r => r.data)
      .then(data => {
        if (!data?.at_risk_pages) return
        const flags: Record<string, string[]> = {}
        for (const p of data.at_risk_pages) {
          flags[p.id] = p.flags
        }
        setSweepPageFlags(flags)
      })
      .catch(() => {})
  }, [isTokenReady])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function analyzeSelected(forceRefresh = false) {
    if (!selected) return
    const pageId = selected.id

    setAnalyses(prev => { const n = { ...prev }; delete n[pageId]; return n })
    setAnalyzingId(pageId)
    setAnalyzeError(null)

    try {
      const pageData = await apiClient.get(`/api/sync/pages/${pageId}`).then(r => r.data)

      if (pageData.content) {
        setPageContents(prev => ({ ...prev, [pageId]: pageData.content }))
      }

      const liveVersion = pageData.version ?? selected.version
      const qs = forceRefresh ? "?force_refresh=true" : ""
      const result: AnalysisResult = await apiClient.post(`/api/analyze/${qs}`, {
        url:           selected.url ?? `https://confluence.page/${selected.id}`,
        title:         selected.title,
        content:       pageData.content ?? "",
        last_modified: pageData.last_modified ?? selected.last_modified,
        owner:         pageData.owner ?? selected.owner,
        page_id:       selected.id,
        page_version:  liveVersion,
      }).then(r => r.data)
      setAnalyses(prev => ({ ...prev, [pageId]: result }))
      setRefreshKey(k => k + 1)
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed")
    } finally {
      setAnalyzingId(null)
    }
  }

  /** Directly submit a targeted fix for a single issue — no modal. */
  async function createProposal(issue: ContentIssue): Promise<void> {
    if (!selected) return
    const pageData = await apiClient.get(`/api/sync/pages/${selected.id}`).then(r => r.data)
    await apiClient.post('/api/edit/generate', {
      page_id:             selected.id,
      page_title:          selected.title,
      content:             pageData.content ?? "",
      page_version:        selected.version,
      edit_type:           "targeted_fix",
      space:               selected.space_key,
      issue_title:         issue.title,
      issue_description:   issue.explanation ?? issue.description ?? "",
      issue_suggestion:    issue.suggestedFix ?? issue.suggestion,
      issue_exact_content: issue.exactContent ?? undefined,
    })
  }

  async function proposeAll(issues: ContentIssue[]): Promise<void> {
    if (!selected) return
    const pageData = await apiClient.get(`/api/sync/pages/${selected.id}`).then(r => r.data)

    const fixable = issues.filter(i => !i.needs_human_intervention)
    if (fixable.length === 0) return

    await apiClient.post('/api/edit/generate', {
      page_id:           selected.id,
      page_title:        selected.title,
      content:           pageData.content ?? "",
      page_version:      selected.version,
      edit_type:         "targeted_fix",
      space:             selected.space_key,
      issue_title:       `Fix all ${fixable.length} detected issue${fixable.length !== 1 ? "s" : ""}`,
      issue_description: fixable.map(i => i.explanation ?? i.description ?? "").join(" | "),
      issue_suggestion:  fixable.map(i => i.suggestedFix ?? i.suggestion).filter(Boolean).join(" | "),
    })
  }

  function openEditModal(initialType?: EditType) {
    const hasFixable = (analysis?.issues.filter(i => !i.needs_human_intervention).length ?? 0) > 0
    setModalOpen(true)
    setEditType(initialType ?? "restructure")
    // Action buttons → improvement selected; "Propose a Fix" → issues selected (+ improvement if initialType given)
    setFixIssues(hasFixable && !initialType ? true : hasFixable)
    setApplyImprovement(!!initialType)
    setRemoveSectionHint("")
    setEditError(null)
    setCreatedProposalCount(0)
  }

  function closeModal() {
    setModalOpen(false)
    setEditLoading(false)
    setEditError(null)
    setCreatedProposalCount(0)
  }

  async function submitEdit() {
    if (!selected) return
    setEditLoading(true)
    setEditError(null)

    try {
      const pageData = await apiClient.get(`/api/sync/pages/${selected.id}`).then(r => r.data)

      const fixableIssues = fixIssues
        ? (analysis?.issues ?? []).filter(i => !i.needs_human_intervention)
        : []

      // Build a single request — if both options are selected, combine them
      const payload: Record<string, unknown> = {
        page_id:      selected.id,
        page_title:   selected.title,
        content:      pageData.content ?? "",
        page_version: selected.version,
        space:        selected.space_key,
      }

      if (applyImprovement) {
        // Use the improvement edit type; issue fields are passed alongside when fixIssues is also set
        payload.edit_type = editType
        if (removeSectionHint) payload.remove_section_hint = removeSectionHint
        if (fixableIssues.length > 0) {
          payload.issue_title       = `Fix ${fixableIssues.length} detected issue${fixableIssues.length !== 1 ? "s" : ""}`
          payload.issue_description = fixableIssues.map(i => i.explanation ?? i.description ?? "").join(" | ")
          payload.issue_suggestion  = fixableIssues.map(i => i.suggestedFix ?? i.suggestion).filter(Boolean).join(" | ")
        }
      } else {
        // Issues only
        payload.edit_type         = "targeted_fix"
        payload.issue_title       = `Fix all ${fixableIssues.length} detected issue${fixableIssues.length !== 1 ? "s" : ""}`
        payload.issue_description = fixableIssues.map(i => i.explanation ?? i.description ?? "").join(" | ")
        payload.issue_suggestion  = fixableIssues.map(i => i.suggestedFix ?? i.suggestion).filter(Boolean).join(" | ")
      }

      await apiClient.post('/api/edit/generate', payload)

      setCreatedProposalCount(1)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setEditLoading(false)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  // Map of pageId → healthy boolean, derived from analysis results
  const analysisHealth = useMemo<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    for (const [id, result] of Object.entries(analyses ?? {})) {
      map[id] = result.is_healthy && result.issues.length === 0
    }
    return map
  }, [analyses])

  const analysis    = selected ? analyses[selected.id] : null
  const isAnalyzing = selected ? analyzingId === selected.id : false
  const isFolder    = (selected?.children.length ?? 0) > 0
  const pageFlags   = selected ? (sweepPageFlags[selected.id] ?? []) : []

  // Auto-collapse the global sidebar when analysis finishes
  useEffect(() => {
    if (prevAnalyzingRef.current && !isAnalyzing && analysis) {
      window.dispatchEvent(new CustomEvent("docai:sidebarcollapse"))
    }
    prevAnalyzingRef.current = isAnalyzing
  }, [isAnalyzing, analysis])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="pages-layout">

      {/* ── Left panel ── */}
      <div data-tour="pages-tree" className="pages-panel">
        <div className="pages-header">
          <div>
            <h1 className="page-title">Pages</h1>
            <p className="page-sub">Confluence workspace mirror</p>
          </div>
        </div>

        <SpaceTree
          onPageSelect={page => {
            setSelected(page)
            setAnalyzeError(null)
          }}
          selectedPageId={selected?.id ?? null}
          refreshKey={refreshKey}
          sweepFlags={sweepPageFlags}
          analysisHealth={analysisHealth}
        />
      </div>

      {/* ── Right panel ── */}
      <div data-tour="page-detail" className="detail-panel">
        {selected ? (
          isFolder ? (

            /* ── Folder view ── */
            <div className="detail-content">
              <div className="detail-header">
                <div className="detail-icon">⊟</div>
                <div style={{ minWidth: 0 }}>
                  <h2 className="detail-title">{selected.title}</h2>
                  <p className="detail-meta">
                    {[
                      selected.space_key && !/^~|^[0-9a-f]{8,}$/i.test(selected.space_key) ? selected.space_key : null,
                      selected.last_modified ? `Modified ${fmt(selected.last_modified)}` : null,
                    ].filter(Boolean).join(' · ')}
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
                  Select an individual page to analyze it.
                </p>
                <div className="folder-children-list">
                  {selected.children.map(child => (
                    <div
                      key={child.id}
                      className="folder-child-row"
                      onClick={() => {
                        setSelected(child)
                        setAnalyzeError(null)
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

            /* ── Page view — no tabs ── */
            <div className="detail-page">

              {/* Slim page header */}
              <div className="detail-page-header">
                <div className="detail-header-left">
                  <div className="detail-icon">◫</div>
                  <div style={{ minWidth: 0 }}>
                    <h2 className="detail-title">{selected.title}</h2>
                    <p className="detail-meta">
                      {[
                        selected.space_key && !/^~|^[0-9a-f]{8,}$/i.test(selected.space_key) ? selected.space_key : null,
                        selected.last_modified ? `Modified ${fmt(selected.last_modified)}` : null,
                        `v${selected.version}`,
                        selected.word_count > 0 ? `${selected.word_count.toLocaleString()} words` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="detail-header-btns">
                  {analysis?.cached && <span className="cached-badge">Cached</span>}
                  {analysis && (
                    <>
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
                          apiClient.post(`/api/analyze/mark-reviewed/${selected.id}`)
                            .then(() => analyzeSelected(true))
                        }}
                        title="Mark this page as manually reviewed and healthy">
                        ✓ Reviewed
                      </button>
                    </>
                  )}
                  {selected.url ? (
                    <a href={selected.url} target="_blank" rel="noreferrer" className="btn-outline-sm">
                      Open ↗
                    </a>
                  ) : (
                    <button className="btn-outline-sm" disabled>Open ↗</button>
                  )}
                </div>
              </div>

              {/* Sweep hint — only shown before analysis */}
              {!analysis && !isAnalyzing && pageFlags.length > 0 && (
                <div className="detail-sweep-hint">
                  <span className={`detail-sweep-dot${pageFlags.length >= 2 ? " red" : " amber"}`} />
                  <span>
                    Sweep detected {pageFlags.length} potential issue{pageFlags.length !== 1 ? "s" : ""}
                    {" "}({pageFlags.map(f => FLAG_LABEL[f] ?? f).join(", ")}) — analyze to find exact fixes
                  </span>
                </div>
              )}

              {/* Resolved issues strip */}
              {analysis?.resolved_issues && analysis.resolved_issues.length > 0 && (
                <div className="detail-resolved-strip">
                  <span className="detail-resolved-label">Previously fixed</span>
                  {analysis.resolved_issues.map((r, i) => (
                    <span key={i} className="detail-resolved-item">
                      <span className="detail-resolved-check">✓</span>
                      {r.title}
                    </span>
                  ))}
                </div>
              )}

              {/* ── Body ── */}
              {isAnalyzing ? (

                <div className="detail-analyzing-state">
                  <span className="spinner-lg" />
                  <div className="detail-analyzing-label">Analyzing with DocAI…</div>
                  <div className="detail-analyzing-sub">Reading page content and checking for issues</div>
                </div>

              ) : analysis ? (

                analysis.is_healthy && analysis.issues.length === 0 ? (
                  <>
                    <div className="detail-healthy-banner">
                      <span className="detail-healthy-icon">✓</span>
                      <div>
                        <div className="detail-healthy-title">This page is healthy</div>
                        {analysis.summary && (
                          <div className="detail-healthy-sub">{analysis.summary}</div>
                        )}
                      </div>
                    </div>
                    <ContentViewer
                      key={selected.id}
                      content={pageContents[selected.id] ?? ""}
                      issues={[]}
                      pageTitle={selected.title}
                      onCreateProposal={createProposal}
                      onProposeAll={proposeAll}
                      onAction={type => openEditModal(type as EditType)}
                      onNavigateToProposals={() => navigate("/proposals")}
                    />
                  </>
                ) : (
                  <ContentViewer
                    key={selected.id}
                    content={pageContents[selected.id] ?? ""}
                    issues={analysis.issues as ContentIssue[]}
                    pageTitle={selected.title}
                    pageId={selected.id}
                    onCreateProposal={createProposal}
                    onProposeAll={proposeAll}
                    onAction={type => openEditModal(type as EditType)}
                  />
                )

              ) : (

                <div className="detail-pre-analysis">
                  <div className="detail-meta-row">
                    <div className="meta-item">
                      <span className="meta-label">Owner</span>
                      <span className="meta-value">{selected.owner ?? "—"}</span>
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

                  <div className="analyze-cta-block">
                    <div className="analyze-cta-title">AI Analysis</div>
                    <p className="analyze-cta-desc">
                      Detect stale content, missing ownership, poor structure, and more.
                      Results appear inline with the page content.
                    </p>
                    {analyzeError && (
                      <div className="analyze-error">⚠ {analyzeError}</div>
                    )}
                    <button
                      className="btn-analyze"
                      onClick={() => analyzeSelected()}>
                      Analyze with DocAI
                    </button>
                  </div>

                  <div className="detail-actions">
                    {selected.url ? (
                      <a href={selected.url} target="_blank" rel="noreferrer" className="btn-primary">
                        Open in Confluence ↗
                      </a>
                    ) : (
                      <button className="btn-primary" disabled>Open in Confluence ↗</button>
                    )}
                    <button className="btn-ghost" onClick={() => openEditModal()}>Propose a Fix</button>
                  </div>
                </div>

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
                  <a href="/proposals" className="btn-primary modal-link-btn">Go to Proposals ↗</a>
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

                <div className="modal-review-callout">
                  <span className="modal-review-icon">👤</span>
                  <span>
                    DocAI will generate a proposed change for your review.{" "}
                    <strong>Nothing is applied to Confluence until you approve it</strong>{" "}
                    in the Proposals queue.
                  </span>
                </div>

                <div className="modal-body">

                  {/* Issues section — toggle to include targeted fixes */}
                  {analysis && analysis.issues.length > 0 && (() => {
                    const fixable = analysis.issues.filter(i => !i.needs_human_intervention)
                    const human   = analysis.issues.filter(i =>  i.needs_human_intervention)
                    return (
                      <div
                        className={`modal-section modal-section-selectable${fixIssues ? " modal-section-active" : ""}`}
                        onClick={() => fixable.length > 0 && setFixIssues(v => !v)}>
                        <div className="modal-section-label">
                          <span className={`modal-section-checkbox${fixIssues ? " checked" : ""}`}>
                            {fixIssues ? "☑" : "☐"}
                          </span>
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
                                  <div className="modal-issue-suggestion">→ {issue.suggestedFix ?? issue.suggestion}</div>
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

                  {/* General improvement section — clicking a card toggles it on/off */}
                  <div className="modal-section">
                    <div className="modal-section-label">
                      <span className={`modal-section-checkbox${applyImprovement ? " checked" : ""}`}>
                        {applyImprovement ? "☑" : "☐"}
                      </span>
                      {analysis && analysis.issues.length > 0
                        ? "Also apply a general improvement"
                        : "Apply a general improvement"}
                    </div>
                    <div className="edit-type-grid">
                      {EDIT_OPTIONS.map(opt => (
                        <button
                          key={opt.type}
                          className={`edit-type-card${applyImprovement && editType === opt.type ? " selected" : ""}`}
                          onClick={e => {
                            e.stopPropagation()
                            if (applyImprovement && editType === opt.type) {
                              setApplyImprovement(false)
                            } else {
                              setApplyImprovement(true)
                              setEditType(opt.type)
                            }
                          }}>
                          <span className="edit-type-icon">{opt.icon}</span>
                          <span className="edit-type-label">{opt.label}</span>
                          <span className="edit-type-desc">{opt.description}</span>
                        </button>
                      ))}
                    </div>

                    {applyImprovement && editType === "remove_section" && (
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
                      (!fixIssues && !applyImprovement) ||
                      (applyImprovement && editType === "remove_section" && !removeSectionHint.trim())
                    }>
                    {editLoading ? (
                      <span className="modal-loading"><span className="spinner" /> Generating…</span>
                    ) : (() => {
                      const fixableCount = analysis?.issues.filter(i => !i.needs_human_intervention).length ?? 0
                      const improvLabel  = EDIT_OPTIONS.find(o => o.type === editType)?.label ?? "Improvement"
                      if (fixIssues && applyImprovement) return `Fix ${fixableCount} Issue${fixableCount !== 1 ? "s" : ""} + Apply ${improvLabel} →`
                      if (fixIssues) return `Fix ${fixableCount} Issue${fixableCount !== 1 ? "s" : ""} →`
                      if (applyImprovement) return `Apply ${improvLabel} →`
                      return "Select an option above"
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
