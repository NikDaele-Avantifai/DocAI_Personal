import { useState, useEffect } from "react"
import "./ApprovalsPage.css"
import { apiClient } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useAdminAction, useEditorAction } from '@/components/AdminOnly'

type DiffLine = {
  type: "add" | "remove" | "context" | "hunk"
  content: string
}

type DupPageData = {
  id: string
  title: string
  duplicateContent: string
}

type RenameItem = {
  pageId: string
  currentTitle: string
  suggestedTitle: string | null
  reason: string
  isFolder?: boolean
  isEmptyPage?: boolean
  requiresHuman?: boolean
  applied?: boolean
}

type Proposal = {
  id: string
  status: "pending" | "approved" | "rejected" | "applied"
  action: string
  category?: string
  action_label?: string
  actionLabel?: string
  source_page_id?: string
  source_page_title?: string
  pageTitle?: string
  pageSpace?: string
  space?: string
  rationale: string
  proposedBy?: string
  proposed_by?: string
  proposedAt?: string
  created_at?: string
  confidence?: number
  diff: DiffLine[] | string
  new_content?: string
  is_deletion?: boolean
  // Duplication-specific fields
  pageA?: DupPageData
  pageB?: DupPageData
  recommendation?: "keep-pageA" | "keep-pageB"
  // Rename-specific fields
  renames?: RenameItem[]
}

// Normalise fields from the API (snake_case) into the shape the UI expects
function normalise(p: Proposal): Proposal & {
  actionLabel: string
  pageTitle: string
  pageSpace: string
  proposedBy: string
  proposedAt: string
  confidence: number
  diff: DiffLine[]
} {
  const rawDiff = p.diff
  let diff: DiffLine[]
  if (typeof rawDiff === "string") {
    try { diff = JSON.parse(rawDiff) } catch { diff = [] }
  } else {
    diff = rawDiff ?? []
  }

  return {
    ...p,
    actionLabel: p.action_label ?? p.actionLabel ?? p.action,
    pageTitle:   p.source_page_title ?? p.pageTitle ?? "Unknown Page",
    pageSpace:   p.space ?? p.pageSpace ?? "",
    proposedBy:  p.proposed_by ?? p.proposedBy ?? "DocAI",
    proposedAt:  p.created_at
      ? new Date(p.created_at).toLocaleString()
      : p.proposedAt ?? "",
    confidence:  p.confidence ?? 80,
    diff,
  }
}


const ACTION_STYLE: Record<string, { color: string; bg: string }> = {
  archive:        { color: "#BF2600", bg: "rgba(191,38,0,0.08)"   },
  add_summary:    { color: "#0747A6", bg: "rgba(7,71,166,0.08)"   },
  update_owner:   { color: "#974F0C", bg: "rgba(151,79,12,0.08)"  },
  restructure:    { color: "#403294", bg: "rgba(64,50,148,0.08)"  },
  merge:          { color: "#006644", bg: "rgba(0,102,68,0.08)"   },
  rewrite:        { color: "#403294", bg: "rgba(64,50,148,0.08)"  },
  remove_section: { color: "#BF2600", bg: "rgba(191,38,0,0.08)"   },
  rename:         { color: "#006644", bg: "rgba(0,102,68,0.08)"   },
}


type NormalisedProposal = ReturnType<typeof normalise>

export default function ApprovalsPage() {
  const { isTokenReady } = useAuth()
  const adminAction = useAdminAction()
  const editorAction = useEditorAction()
  const [proposals, setProposals] = useState<NormalisedProposal[]>([])
  const [selected, setSelected] = useState<NormalisedProposal | null>(null)
  const [filter, setFilter] = useState<"pending" | "all" | "approved" | "rejected">("pending")
  const [categoryFilter, setCategoryFilter] = useState<"all" | "analysis" | "duplication" | "rename">("all")

  // Right panel tab state
  const [rightTab, setRightTab] = useState<"diff" | "edit">("diff")
  const [editedContents, setEditedContents] = useState<Record<string, string>>({})

  // Apply state
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  // Rollback state
  const [rollbackLoading, setRollbackLoading] = useState(false)
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  const [rollbackDone, setRollbackDone] = useState<Set<string>>(new Set())

  // Rename item state: applied set + per-item loading
  const [renameApplied, setRenameApplied] = useState<Set<string>>(new Set())
  const [renameLoading, setRenameLoading] = useState<Set<string>>(new Set())
  const [renameError, setRenameError] = useState<string | null>(null)

  // Page content cache for full-page diff view
  const [pageContents, setPageContents] = useState<Record<string, string>>({})
  const [loadingContent, setLoadingContent] = useState<Set<string>>(new Set())

  // Load proposals from API on mount — wait for token
  useEffect(() => {
    if (!isTokenReady) return
    apiClient.get('/api/proposals/')
      .then(r => r.data)
      .then(data => {
        const apiProposals = ((data.proposals ?? []) as Proposal[]).map(normalise)
        setProposals(apiProposals)
      })
      .catch(() => {/* backend unavailable */})
  }, [isTokenReady])

  const filtered = proposals.filter(p =>
    (filter === "all" || p.status === filter) &&
    (categoryFilter === "all" || (p.category ?? "analysis") === categoryFilter)
  )
  const pending = proposals.filter(p => p.status === "pending").length

  async function review(id: string, decision: "approved" | "rejected") {
    // Optimistic update
    setProposals((prev: NormalisedProposal[]) => prev.map((p: NormalisedProposal) => p.id === id ? { ...p, status: decision } : p))
    setSelected((prev: NormalisedProposal | null) => prev?.id === id ? { ...prev, status: decision } : prev)

    // Call real API (best-effort — mock proposals won't exist server-side)
    await apiClient.patch(`/api/proposals/${id}/review`, { status: decision, reviewed_by: "Dashboard User" })
      .catch(() => {/* ignore if mock proposal or backend unavailable */})
  }

  async function applyToConfluence() {
    if (!selected) return
    setApplyLoading(true)
    setApplyError(null)

    try {
      await apiClient.post(`/api/proposals/${selected.id}/apply`, {
        applied_by: "Dashboard User",
        content_override: editedContents[selected.id] ?? null,
      })

      setProposals((prev: NormalisedProposal[]) => prev.map((p: NormalisedProposal) => p.id === selected.id ? { ...p, status: "applied" } : p))
      setSelected((prev: NormalisedProposal | null) => prev?.id === selected.id ? { ...prev, status: "applied" } : prev)

      // Re-fetch the page from Confluence into the DB, then re-analyze it to update health status
      const pageId = selected.source_page_id
      if (pageId) {
        try {
          const pageData = await apiClient.get(`/api/sync/pages/${pageId}`).then(r => r.data)
          const analyzeResult = await apiClient.post('/api/analyze/?force_refresh=true', {
              url:           pageData.url ?? "",
              title:         pageData.title ?? selected.pageTitle,
              content:       pageData.content ?? "",
              last_modified: pageData.last_modified ?? null,
              owner:         pageData.owner ?? null,
              page_id:       pageId,
              page_version:  pageData.version ?? 1,
          }).then(r => r.data)
          if (analyzeResult) {
            const result = analyzeResult
            // Broadcast the updated health status so PagesPage and OverviewPage can react
            window.dispatchEvent(new CustomEvent("docai:pageHealthUpdated", {
              detail: {
                pageId,
                isHealthy: result.is_healthy && result.issues.length === 0,
                analysis: result,
              },
            }))
          }
        } catch {/* best-effort — apply already succeeded */}
      }
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setApplyLoading(false)
    }
  }

  // Fetch both page contents when a duplication proposal is selected
  useEffect(() => {
    if (!selected || (selected.category ?? "analysis") !== "duplication") return
    const ids = [selected.pageA?.id, selected.pageB?.id].filter(Boolean) as string[]
    const missing = ids.filter(id => !pageContents[id] && !loadingContent.has(id))
    if (missing.length === 0) return
    setLoadingContent(prev => new Set([...prev, ...missing]))
    Promise.all(
      missing.map(id =>
        apiClient.get(`/api/sync/pages/${id}`)
          .then(r => r.data)
          .then(d => ({ id, content: d.content ?? "" }))
          .catch(() => ({ id, content: "" }))
      )
    ).then(results => {
      setPageContents(prev => {
        const next = { ...prev }
        for (const { id, content } of results) next[id] = content
        return next
      })
      setLoadingContent(prev => {
        const next = new Set(prev)
        for (const id of missing) next.delete(id)
        return next
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  // Scroll highlighted duplicate content into view after content renders
  useEffect(() => {
    if (!selected) return
    const timer = setTimeout(() => {
      document.querySelectorAll('.dup-content-highlight').forEach(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [selected?.id, pageContents])

  async function rollback() {
    if (!selected) return
    setRollbackLoading(true)
    setRollbackError(null)
    try {
      await apiClient.post(`/api/proposals/${selected.id}/rollback`, { rolled_back_by: "Dashboard User" })
      setRollbackDone(prev => new Set([...prev, selected.id]))
      setProposals(prev => prev.map(p => p.id === selected.id ? { ...p, status: "pending" as const } : p))
      setSelected(prev => prev?.id === selected.id ? { ...prev, status: "pending" as const } : prev)
    } catch (e) {
      setRollbackError(e instanceof Error ? e.message : "Rollback failed")
    } finally {
      setRollbackLoading(false)
    }
  }

  async function applyRenameItem(proposalId: string, pageId: string, suggestedTitle: string) {
    setRenameLoading(prev => new Set([...prev, pageId]))
    setRenameError(null)
    try {
      await apiClient.post(`/api/proposals/${proposalId}/apply-rename`, { page_id: pageId, suggested_title: suggestedTitle, applied_by: "Dashboard User" })
      setRenameApplied(prev => new Set([...prev, pageId]))
      // Update title in the proposal renames list in-place
      setProposals(prev => prev.map(p => {
        if (p.id !== proposalId || !p.renames) return p
        return { ...p, renames: p.renames.map(r => r.pageId === pageId ? { ...r, applied: true } : r) }
      }))
      setSelected(prev => {
        if (!prev || prev.id !== proposalId || !prev.renames) return prev
        return { ...prev, renames: prev.renames.map(r => r.pageId === pageId ? { ...r, applied: true } : r) }
      })
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "Rename failed")
    } finally {
      setRenameLoading(prev => { const n = new Set(prev); n.delete(pageId); return n })
    }
  }

  async function applyAllRenames(proposalId: string, renames: RenameItem[]) {
    for (const r of renames) {
      if (!r.applied && !r.isFolder && r.suggestedTitle) await applyRenameItem(proposalId, r.pageId, r.suggestedTitle)
    }
  }

  // Strip HTML for readable page content preview
  function stripHtml(html: string): string {
    const d = document.createElement("div")
    d.innerHTML = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/li>/gi, "\n")
    return (d.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim()
  }

  function stripForMatch(text: string): string {
    return text.replace(/[*_+\[\]]/g, '').replace(/\s+/g, ' ').trim()
  }

  // Convert Confluence storage-format HTML to styled HTML for display
  function renderConfluenceMarkup(html: string): string {
    let text = html
    text = text.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gis, '<div class="cf-h1">$1</div>')
    text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gis, '<div class="cf-h2">$1</div>')
    text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gis, '<div class="cf-h3">$1</div>')
    text = text.replace(/<ul[^>]*>/gi, '<ul class="cf-ul">').replace(/<\/ul>/gi, '</ul>')
    text = text.replace(/<ol[^>]*>/gi, '<ol class="cf-ol">').replace(/<\/ol>/gi, '</ol>')
    text = text.replace(/<li[^>]*>/gi, '<li class="cf-li">').replace(/<\/li>/gi, '</li>')
    text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gis, '<strong>$1</strong>')
    text = text.replace(/<b[^>]*>(.*?)<\/b>/gis, '<strong>$1</strong>')
    text = text.replace(/<em[^>]*>(.*?)<\/em>/gis, '<em>$1</em>')
    text = text.replace(/<i[^>]*>(.*?)<\/i>/gis, '<em>$1</em>')
    text = text.replace(/<u[^>]*>(.*?)<\/u>/gis, '<u>$1</u>')
    text = text.replace(/<\/p>/gi, '</p>')
    text = text.replace(/<p[^>]*>/gi, '<p class="cf-p">')
    text = text.replace(/<br\s*\/?>/gi, '<br/>')
    text = text.replace(
      /<ac:structured-macro[^>]*ac:name=["']code["'][^>]*>[\s\S]*?<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
      (_, code) => `<pre class="cf-code"><code>${code.trim()}</code></pre>`,
    )
    if (!text.includes('<')) {
      text = text
        .replace(/^h2\. (.+)$/gm, '<div class="cf-h2">$1</div>')
        .replace(/^h3\. (.+)$/gm, '<div class="cf-h3">$1</div>')
        .replace(/^\* (.+)$/gm, '<li class="cf-li">$1</li>')
        .replace(/^# (.+)$/gm, '<li class="cf-li cf-li-ordered">$1</li>')
        .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
        .replace(/_([^_]+)_/g, '<em>$1</em>')
        .replace(/\n\n/g, '<br/><br/>')
    }
    text = text.replace(/<(?!\/?(strong|em|u|ul|ol|li|p|br|pre|code|div|h[1-6])\b)[^>]+>/gi, '')
    return text
  }

  // Render a page column: convert to styled HTML and inject highlight around duplicate content
  function renderColumnContent(html: string, dupContent: string): string {
    const markup = renderConfluenceMarkup(html)
    if (!dupContent) return markup
    const plainDup = stripForMatch(stripHtml(dupContent))
    const normalDup = plainDup.replace(/\s+/g, ' ').trim()
    if (!normalDup) return markup
    // Build a regex that matches normalDup in the HTML, allowing tags/whitespace between words
    const escaped = normalDup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = escaped.replace(/ /g, '(?:<[^>]+>|\\s)+')
    try {
      const match = new RegExp(pattern, 'i').exec(markup)
      if (match) {
        const s = match.index
        const e = s + match[0].length
        return (
          markup.slice(0, s) +
          '<mark class="dup-content-highlight">' +
          markup.slice(s, e) +
          '</mark>' +
          markup.slice(e)
        )
      }
    } catch {
      // regex too complex — skip highlight
    }
    console.warn('renderColumnContent: no match found', { normalDup: normalDup.slice(0, 200) })
    return markup
  }

  const actionStyle = selected
    ? ACTION_STYLE[selected.action] ?? ACTION_STYLE.add_summary
    : null

  // Build rename panel
  const renamePanel = (() => {
    if (!selected || (selected.category ?? "analysis") !== "rename" || !selected.renames) return null
    const renderableRenames = selected.renames.filter(r =>
      // Include rows with a valid suggestion OR empty pages needing human attention
      (r.suggestedTitle && r.suggestedTitle !== r.currentTitle) || r.isEmptyPage
    )
    const applicableRenames = renderableRenames.filter(r => r.suggestedTitle && !r.isEmptyPage)
    const pendingCount = applicableRenames.filter(r => !r.applied && !r.isFolder).length
    const totalCount = renderableRenames.length

    return (
      <div className="rename-panel">
        {/* Header */}
        <div className="rename-panel-header">
          <div className="rename-panel-header-left">
            <span className="category-badge category-badge-rename">RENAME</span>
            <div>
              <div className="rename-panel-title">File rename suggestions</div>
              <div className="rename-panel-sub">{totalCount} file{totalCount !== 1 ? "s" : ""} flagged</div>
            </div>
          </div>
          <p className="diff-meta">Proposed {selected.proposedAt} by {selected.proposedBy}</p>
        </div>

        {/* Rename rows */}
        <div className="rename-rows">
          {renderableRenames.map((r, i) => {
            const isLoading = renameLoading.has(r.pageId)
            const isDone = r.applied
            const isFolder = r.isFolder ?? false
            const isEmptyPage = r.isEmptyPage ?? false

            // Folder row — always check isFolder first
            if (isFolder) {
              return (
                <div key={r.pageId}>
                  {i > 0 && <div className="rename-row-divider" />}
                  <div className="rename-row rename-row-folder">
                    <div className="rename-row-main">
                      <div className="rename-row-titles">
                        <div className="rename-row-line1">
                          <svg className="rename-file-icon rename-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                          </svg>
                          <span className="rename-current-title">{r.currentTitle}</span>
                          <span className="rename-folder-badge">FOLDER</span>
                        </div>
                        {r.suggestedTitle && (
                          <div className="rename-row-line2">
                            <span className="rename-arrow-text">→</span>
                            <span className="rename-suggested-title">{r.suggestedTitle}</span>
                          </div>
                        )}
                      </div>
                      <div className="rename-row-action">
                        <span
                          className="rename-folder-skip"
                          title="Confluence doesn't expose a folder rename API — do this manually in Confluence">
                          Manual in Confluence
                        </span>
                      </div>
                    </div>
                    <div className="rename-row-reason">{r.reason}</div>
                  </div>
                </div>
              )
            }

            // Empty page with no suggestion — informational row only
            if (isEmptyPage && !r.suggestedTitle) {
              return (
                <div key={r.pageId}>
                  {i > 0 && <div className="rename-row-divider" />}
                  <div className="rename-row rename-row-empty-page">
                    <div className="rename-row-main">
                      <div className="rename-row-titles">
                        <div className="rename-row-line1">
                          <svg className="rename-file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14,2 14,8 20,8"/>
                          </svg>
                          <span className="rename-current-title">{r.currentTitle}</span>
                          <span className="rename-empty-badge">EMPTY</span>
                        </div>
                      </div>
                      <div className="rename-row-action">
                        <span className="rename-folder-skip" title="Add content in Confluence first">No suggestion</span>
                      </div>
                    </div>
                    <div className="rename-row-reason">{r.reason}</div>
                  </div>
                </div>
              )
            }

            // Normal rename row with suggestion
            return (
              <div key={r.pageId}>
                {i > 0 && <div className="rename-row-divider" />}
                <div className="rename-row">
                  <div className="rename-row-main">
                    <div className="rename-row-titles">
                      <div className="rename-row-line1">
                        <svg className="rename-file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14,2 14,8 20,8"/>
                        </svg>
                        <span className="rename-current-title">{r.currentTitle}</span>
                      </div>
                      <div className="rename-row-line2">
                        <span className="rename-arrow-text">→</span>
                        <span className="rename-suggested-title">{r.suggestedTitle}</span>
                      </div>
                    </div>
                    <div className="rename-row-action">
                      {isDone ? (
                        <span className="rename-done-badge">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20,6 9,17 4,12"/>
                          </svg>
                          Applied
                        </span>
                      ) : (
                        <button
                          className="rename-apply-btn"
                          disabled={isLoading || adminAction.disabled}
                          title={adminAction.title}
                          onClick={() => applyRenameItem(selected.id, r.pageId, r.suggestedTitle!)}>
                          {isLoading ? "…" : "Apply"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="rename-row-reason">{r.reason}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer actions */}
        {renameError && <div className="apply-error"><span>⚠</span> {renameError}</div>}
        <div className="rename-footer">
          <button
            className="btn-apply"
            disabled={pendingCount === 0 || renameLoading.size > 0 || adminAction.disabled}
            title={adminAction.title}
            onClick={() => applyAllRenames(selected.id, applicableRenames)}>
            {renameLoading.size > 0
              ? <span className="modal-loading"><span className="spinner-dark" /> Applying…</span>
              : `Apply all (${pendingCount})`}
          </button>
          <button className="btn-reject" onClick={() => review(selected.id, "rejected")} {...editorAction}>
            Dismiss all
          </button>
        </div>

        {selected.status === "applied" && (
          <div className="diff-actions-col" style={{ marginTop: 8 }}>
            <div className="diff-actions">
              <div className="decision-badge decision-applied">✓ Applied to Confluence</div>
              <button className="btn-rollback" onClick={rollback} disabled={rollbackLoading}>
                {rollbackLoading
                  ? <span className="modal-loading"><span className="spinner-dark-sm" /> Rolling back…</span>
                  : "↩ Roll back all"}
              </button>
            </div>
            {rollbackError && <div className="apply-error"><span>⚠</span> {rollbackError}</div>}
          </div>
        )}
      </div>
    )
  })()

  // Build duplication panel content outside JSX to avoid IIFE in ternary
  const dupPanel = (() => {
    if (!selected || (selected.category ?? "analysis") !== "duplication" || !selected.pageA || !selected.pageB) return null
    const isConsolidate = selected.action === "consolidate-pages"
    const keepA = selected.recommendation === "keep-pageA"
    const deletedPage = isConsolidate ? (keepA ? selected.pageB : selected.pageA) : null
    const keptPage    = isConsolidate ? (keepA ? selected.pageA : selected.pageB) : null
    const isLoadingA = loadingContent.has(selected.pageA.id)
    const isLoadingB = loadingContent.has(selected.pageB.id)
    const wasRolledBack = rollbackDone.has(selected.id)

    return (
      <>
        {/* Header */}
        <div className="diff-header">
          <div className="diff-header-top">
            <div>
              <div className="dup-proposal-badges">
                <span className="category-badge category-badge-duplication">DUPLICATION</span>
                <span className="dup-proposal-action-label">
                  {isConsolidate ? "Consolidate into one page" : "Remove duplicate section"}
                </span>
              </div>
              <p className="diff-meta" style={{ marginTop: 6 }}>
                Proposed {selected.proposedAt} by {selected.proposedBy}
              </p>
            </div>
          </div>
          <div className="rationale-box">
            <div className="rationale-label">AI Rationale</div>
            <p className="rationale-text">{selected.rationale}</p>
          </div>
        </div>

        <div className="dup-what-changes">
          {isConsolidate && deletedPage
            ? `${deletedPage.title} will be archived. Its unique content should be manually reviewed before applying.`
            : `The highlighted section in ${keepA ? selected.pageB!.title : selected.pageA!.title} will be removed. Content in ${keepA ? selected.pageA!.title : selected.pageB!.title} is unchanged.`
          }
        </div>

        {/* Consolidate: file cards showing deleted vs kept */}
        {isConsolidate && deletedPage && keptPage && (
          <div className="dup-file-cards">
            <div className="dup-file-card dup-file-card-deleted">
              <div className="dup-file-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="9" y1="12" x2="15" y2="12"/>
                </svg>
              </div>
              <div className="dup-file-card-body">
                <div className="dup-file-card-name">{deletedPage.title}</div>
                <div className="dup-file-card-sub">This page will be archived</div>
              </div>
              <div className="dup-file-card-status dup-file-card-status-deleted">DELETE</div>
            </div>
            <div className="dup-file-cards-arrow">→</div>
            <div className="dup-file-card dup-file-card-kept">
              <div className="dup-file-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><polyline points="9,15 12,18 15,15"/><line x1="12" y1="12" x2="12" y2="18"/>
                </svg>
              </div>
              <div className="dup-file-card-body">
                <div className="dup-file-card-name">{keptPage.title}</div>
                <div className="dup-file-card-sub">This page will be kept as canonical</div>
              </div>
              <div className="dup-file-card-status dup-file-card-status-kept">KEEP</div>
            </div>
          </div>
        )}

        {/* Full page content columns with highlights */}
        <div className="dup-proposal-cols">
          {([
            { label: "Page A", data: selected.pageA!, rawHtml: pageContents[selected.pageA!.id] ?? "", isLoading: isLoadingA },
            { label: "Page B", data: selected.pageB!, rawHtml: pageContents[selected.pageB!.id] ?? "", isLoading: isLoadingB },
          ] as const).map(({ label, data, rawHtml, isLoading }) => {
            const isDeleted = isConsolidate && deletedPage?.id === data.id
            return (
              <div key={label} className={`dup-proposal-col${isDeleted ? " dup-proposal-col-deleted" : ""}`}>
                <div className="dup-proposal-col-header">
                  <div className="dup-proposal-col-label">{label}</div>
                  {isConsolidate && (
                    <span className={`dup-col-fate${isDeleted ? " fate-delete" : " fate-keep"}`}>
                      {isDeleted ? "Archive" : "Keep"}
                    </span>
                  )}
                </div>
                <div className="dup-proposal-col-title">{data.title}</div>
                {isLoading ? (
                  <div className="dup-col-loading"><span className="dup-col-spinner" /> Loading…</div>
                ) : rawHtml ? (
                  <div
                    className="dup-proposal-col-content"
                    dangerouslySetInnerHTML={{ __html: renderColumnContent(rawHtml, data.duplicateContent) }}
                  />
                ) : (
                  <div className="dup-col-loading">Content not available</div>
                )}
              </div>
            )
          })}
        </div>

        {/* Actions */}
        {selected.status === "pending" && (
          <div className="diff-actions-col">
            <div className="diff-actions">
              <button className="btn-apply" onClick={applyToConfluence} disabled={applyLoading || adminAction.disabled} title={adminAction.title}>
                {applyLoading
                  ? <span className="modal-loading"><span className="spinner-dark" /> Applying…</span>
                  : "Apply fix"}
              </button>
              <button className="btn-reject" onClick={() => review(selected.id, "rejected")} {...editorAction}>
                Dismiss
              </button>
            </div>
            {applyError && <div className="apply-error"><span>⚠</span> {applyError}</div>}
          </div>
        )}

        {selected.status === "applied" && (
          <div className="diff-actions-col">
            <div className="diff-actions">
              <div className="decision-badge decision-applied">✓ Applied to Confluence</div>
              {!wasRolledBack && (
                <button className="btn-rollback" onClick={rollback} disabled={rollbackLoading}>
                  {rollbackLoading
                    ? <span className="modal-loading"><span className="spinner-dark-sm" /> Rolling back…</span>
                    : "↩ Roll back"}
                </button>
              )}
              {wasRolledBack && (
                <span className="rollback-done-badge">↩ Rolled back</span>
              )}
            </div>
            {rollbackError && <div className="apply-error"><span>⚠</span> {rollbackError}</div>}
          </div>
        )}

        {selected.status === "rejected" && (
          <div className="diff-actions">
            <div className="decision-badge decision-rejected">✕ Dismissed</div>
          </div>
        )}
      </>
    )
  })()

  return (
    <div className="approvals-layout">

      {/* ── Left panel ── */}
      <div className="approvals-panel">
        <div className="approvals-header">
          <div>
            <h1 className="approvals-page-title">Approvals</h1>
            <p className="approvals-page-sub">
              {pending > 0
                ? `${pending} change${pending !== 1 ? "s" : ""} awaiting review`
                : "All caught up"}
            </p>
          </div>
          <div className="filter-tabs">
            {(["pending", "all", "approved", "rejected"] as const).map(f => (
              <button
                key={f}
                className={`filter-tab${filter === f ? " active" : ""}`}
                onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="category-filter-tabs">
            {(["all", "analysis", "duplication", "rename"] as const).map(c => (
              <button
                key={c}
                className={`category-filter-tab${categoryFilter === c ? " active" : ""}`}
                onClick={() => setCategoryFilter(c)}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div data-tour="proposals-list" className="proposals-list">
          {filtered.length === 0 && (
            <div className="proposals-empty">
              <span>✓</span>
              <p>No {filter !== "all" ? filter : ""} proposals</p>
            </div>
          )}

          {filtered.map(p => {
            const style = ACTION_STYLE[p.action] ?? ACTION_STYLE.add_summary
            return (
              <div
                key={p.id}
                className={`proposal-row${selected?.id === p.id ? " selected" : ""}`}
                onClick={() => { setSelected(p); setRightTab("diff") }}>

                <div className="proposal-row-top">
                  <span className="proposal-page">{p.pageTitle}</span>
                  <span className="proposal-status" data-status={p.status}>
                    {p.status}
                  </span>
                </div>

                <div className="proposal-row-meta">
                  {(p.category ?? "analysis") === "duplication" && (
                    <span className="category-badge category-badge-duplication">DUPLICATION</span>
                  )}
                  <span className="action-badge" style={{ color: style.color, background: style.bg }}>
                    {p.actionLabel}
                  </span>
                  <span className="proposal-time">{p.proposedAt}</span>
                </div>

                <div className="proposal-confidence">
                  <div className="confidence-bar">
                    <div className="confidence-fill" style={{ width: `${p.confidence}%` }} />
                  </div>
                  <span className="confidence-label">{p.confidence}% confidence</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="diff-panel">
        {selected && actionStyle ? (
          <div className="diff-content">

            {/* ── Rename / Duplication proposal layouts ── */}
            {renamePanel !== null ? renamePanel : dupPanel !== null ? dupPanel : (
              <>
                {/* ── Standard analysis proposal layout ── */}
                <div className="diff-header">
                  <div className="diff-header-top">
                    <div>
                      <h2 className="diff-title">{selected.pageTitle}</h2>
                      <p className="diff-meta">
                        {selected.pageSpace && `${selected.pageSpace} · `}
                        Proposed {selected.proposedAt} by {selected.proposedBy}
                      </p>
                    </div>
                    <span
                      className="action-badge-lg"
                      style={{ color: actionStyle.color, background: actionStyle.bg }}>
                      {selected.actionLabel}
                    </span>
                  </div>

                  <div className="rationale-box">
                    <div className="rationale-label">AI Rationale</div>
                    <p className="rationale-text">{selected.rationale}</p>
                  </div>
                </div>

                {/* Tabs — only shown when there is editable AI content and it's not a deletion */}
                {selected.new_content && !selected.is_deletion && (
                  <div className="content-tabs">
                    <button
                      className={`content-tab${rightTab === "diff" ? " active" : ""}`}
                      onClick={() => setRightTab("diff")}>
                      Diff
                    </button>
                    <button
                      className={`content-tab${rightTab === "edit" ? " active" : ""}`}
                      onClick={() => {
                        if (!editedContents[selected.id]) {
                          setEditedContents(prev => ({ ...prev, [selected.id]: selected.new_content! }))
                        }
                        setRightTab("edit")
                      }}>
                      Edit Content
                      {editedContents[selected.id] !== undefined &&
                       editedContents[selected.id] !== selected.new_content && (
                        <span className="modified-dot" title="Edited" />
                      )}
                    </button>
                  </div>
                )}

                {/* Diff viewer */}
                {rightTab === "diff" && (
                <div className="diff-view">
                  <div className="diff-view-header">
                    <span className="diff-view-title">
                      {selected.is_deletion ? "Deletion Proposal" : "Proposed Changes"}
                    </span>
                    <div className="diff-legend">
                      {!selected.is_deletion && <span className="legend-add">+ added</span>}
                      <span className="legend-remove">− removed</span>
                    </div>
                  </div>

                  <div className="diff-code">
                    {selected.diff.map((line, i) => (
                      <div key={i} className={`diff-line diff-line-${line.type}`}>
                        <span className="diff-gutter">
                          {line.type === "add"
                            ? "+"
                            : line.type === "remove"
                            ? "−"
                            : line.type === "hunk"
                            ? "⋯"
                            : " "}
                        </span>
                        <span className="diff-line-content">{line.content || " "}</span>
                      </div>
                    ))}
                  </div>
                </div>
                )}

                {/* Content editor */}
                {rightTab === "edit" && selected.new_content && (
                <div className="diff-view">
                  <div className="diff-view-header">
                    <span className="diff-view-title">
                      {selected.action === "rename" ? "Edit Suggested Title" : "Edit Content"}
                    </span>
                    <span className="edit-hint">
                      {selected.action === "rename"
                        ? "Adjust the suggested title before applying"
                        : "Changes here will be sent to Confluence instead of the AI draft"}
                    </span>
                  </div>
                  <textarea
                    className={`content-editor${selected.action === "rename" ? " content-editor-title" : ""}`}
                    value={editedContents[selected.id] ?? selected.new_content}
                    onChange={e => setEditedContents(prev => ({ ...prev, [selected.id]: e.target.value }))}
                    spellCheck={selected.action !== "rename"}
                    rows={selected.action === "rename" ? 2 : undefined}
                  />
                </div>
                )}

                {/* Actions */}
                {selected.status === "pending" && (
                  <div className="diff-actions">
                    <button data-tour="approve-button" className="btn-approve" onClick={() => review(selected.id, "approved")} {...editorAction}>
                      ✓ Approve
                    </button>
                    <button className="btn-reject" onClick={() => review(selected.id, "rejected")} {...editorAction}>
                      ✕ Reject
                    </button>
                    <button className="btn-ghost-sm">Open in Confluence ↗</button>
                  </div>
                )}

                {selected.status === "approved" && (
                  <div className="diff-actions-col">
                    <div className="diff-actions">
                      <div className="decision-badge decision-approved">✓ Approved</div>
                      {selected.new_content && (
                        <button className="btn-apply" onClick={applyToConfluence} disabled={applyLoading || adminAction.disabled} title={adminAction.title}>
                          {applyLoading ? <span className="modal-loading"><span className="spinner-dark" /> Applying…</span> : "Apply to Confluence ↗"}
                        </button>
                      )}
                      <button className="btn-ghost-sm">Open in Confluence ↗</button>
                    </div>
                    {applyError && (
                      <div className="apply-error"><span>⚠</span> {applyError}</div>
                    )}
                  </div>
                )}

                {selected.status === "rejected" && (
                  <div className="diff-actions">
                    <div className="decision-badge decision-rejected">✕ Rejected</div>
                  </div>
                )}

                {selected.status === "applied" && (
                  <div className="diff-actions">
                    <div className="decision-badge decision-applied">✓ Applied to Confluence</div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="diff-empty">

            <span className="diff-empty-icon">⬡</span>
            <p>Select a proposal to review changes</p>
          </div>
        )}
      </div>

    </div>
  )
}
