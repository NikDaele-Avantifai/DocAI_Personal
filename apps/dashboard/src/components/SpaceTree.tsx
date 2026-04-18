import { useState, useEffect } from "react"
import "./SpaceTree.css"
import { API_BASE } from '@/lib/api'
const HEALTH_STALE_DAYS = 180

export type PageNode = {
  id: string
  title: string
  space_key: string
  parent_id: string | null
  url: string | null
  word_count: number
  last_modified: string | null
  owner: string | null
  version: number
  is_folder: boolean
  is_healthy: boolean
  last_fixed_at: string | null
  health_checked_at: string | null
  has_been_analyzed: boolean
  children: PageNode[]
}

type Space = {
  key: string
  name: string
  url: string
  page_count: number
  last_synced: string | null
}

interface SpaceTreeProps {
  onPageSelect: (page: PageNode) => void
  selectedPageId: string | null
  refreshKey: number
  sweepFlags?: Record<string, string[]>
  analysisHealth?: Record<string, boolean>  // pageId → true=healthy, false=has issues
}

function countPages(nodes: PageNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countPages(n.children), 0)
}

function PageTreeItem({
  page,
  depth,
  onSelect,
  selectedId,
  sweepFlags,
  analysisHealth,
  dismissedSweep,
  onDismissSweep,
}: {
  page: PageNode
  depth: number
  onSelect: (p: PageNode) => void
  selectedId: string | null
  sweepFlags?: Record<string, string[]>
  analysisHealth?: Record<string, boolean>
  dismissedSweep: Set<string>
  onDismissSweep: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = page.children.length > 0
  const isFolder = page.is_folder || hasChildren  // is_folder from DB or inferred from children
  const flags = sweepFlags?.[page.id] ?? []
  const hasSweepAlert = flags.length > 0 && !dismissedSweep.has(page.id)

  // Indicator: DB is source of truth (persists across refreshes).
  // session result provides immediate feedback after an in-session analysis.
  // Never-analyzed pages (no health_checked_at, no session result) show nothing.
  type Indicator = "healthy" | "healthy-stale" | "issues" | "none"
  let indicator: Indicator
  const sessionResult = analysisHealth?.[page.id]
  const isHealthy = sessionResult !== undefined
    ? sessionResult
    : page.health_checked_at != null ? page.is_healthy : null
  if (isHealthy === null) {
    indicator = "none"
  } else if (isHealthy) {
    const checkedAt = page.health_checked_at ? new Date(page.health_checked_at).getTime() : Date.now()
    const daysSince = (Date.now() - checkedAt) / 86_400_000
    indicator = daysSince <= HEALTH_STALE_DAYS ? "healthy" : "healthy-stale"
  } else {
    indicator = "issues"
  }

  return (
    <div>
      <div
        className={`tree-page-row${selectedId === page.id ? " selected" : ""}`}
        style={{ paddingLeft: `${14 + depth * 14}px` }}
        onClick={() => { onSelect(page); if (hasSweepAlert) onDismissSweep(page.id) }}>

        <span
          className={`tree-chevron${(hasChildren || isFolder) ? "" : " invisible"}`}
          onClick={e => {
            if (!hasChildren && !isFolder) return
            e.stopPropagation()
            setExpanded(v => !v)
          }}>
          {expanded ? "▾" : "▸"}
        </span>

        <span className="tree-page-icon">{isFolder ? "⊟" : "◫"}</span>
        <span className="tree-page-title">{page.title}</span>

        {!isFolder && hasSweepAlert && (
          <span
            className="tree-sweep-alert"
            title={`Sweep found ${flags.length} flag${flags.length > 1 ? "s" : ""} — click to dismiss`}
            onClick={e => { e.stopPropagation(); onDismissSweep(page.id) }}>
            !
          </span>
        )}

        {!isFolder && indicator === "healthy" && (
          <span className="tree-issue-dot tree-issue-dot-green" title="No issues — page is healthy" />
        )}
        {!isFolder && indicator === "healthy-stale" && (
          <span className="tree-issue-dot tree-issue-dot-yellow" title={`Last verified healthy ${Math.floor((Date.now() - new Date(page.health_checked_at!).getTime()) / 2_592_000_000)} months ago — consider re-analyzing`}>⚠</span>
        )}
        {!isFolder && indicator === "issues" && (
          <span className="tree-issue-dot tree-issue-dot-amber" title="Has open issues from latest analysis" />
        )}

        {isFolder && (
          <span className="tree-count">{page.children.length}</span>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {page.children.map(child => (
            <PageTreeItem
              key={child.id}
              page={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedId={selectedId}
              sweepFlags={sweepFlags}
              analysisHealth={analysisHealth}
              dismissedSweep={dismissedSweep}
              onDismissSweep={onDismissSweep}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SpaceTree({
  onPageSelect,
  selectedPageId,
  refreshKey,
  sweepFlags,
  analysisHealth,
}: SpaceTreeProps) {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(new Set())
  const [trees, setTrees] = useState<Record<string, PageNode[]>>({})
  const [loadingTree, setLoadingTree] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dismissedSweep, setDismissedSweep] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/sync/spaces`)
      .then(r => r.json())
      .then(data => setSpaces(data.spaces ?? []))
      .catch(() => setError("Could not reach backend. Is it running on port 8000?"))
      .finally(() => setLoading(false))
  }, [refreshKey])

  // Re-fetch trees for all currently expanded spaces when refreshKey changes
  // (e.g. after analysis updates is_healthy / health_checked_at in the DB)
  useEffect(() => {
    if (expandedSpaces.size === 0) return
    const keys = Array.from(expandedSpaces)
    Promise.all(
      keys.map(spaceKey =>
        fetch(`${API_BASE}/api/sync/spaces/${encodeURIComponent(spaceKey)}/tree`)
          .then(r => r.json())
          .then(data => ({ spaceKey, tree: data.tree ?? [] }))
          .catch(() => ({ spaceKey, tree: [] }))
      )
    ).then(results => {
      setTrees(prev => {
        const next = { ...prev }
        for (const { spaceKey, tree } of results) next[spaceKey] = tree
        return next
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  async function toggleSpace(spaceKey: string) {
    const isNowExpanded = !expandedSpaces.has(spaceKey)

    setExpandedSpaces(prev => {
      const next = new Set(prev)
      if (next.has(spaceKey)) next.delete(spaceKey)
      else next.add(spaceKey)
      return next
    })

    if (isNowExpanded && !trees[spaceKey]) {
      setLoadingTree(spaceKey)
      try {
        const res = await fetch(`${API_BASE}/api/sync/spaces/${encodeURIComponent(spaceKey)}/tree`)
        const data = await res.json()
        setTrees(prev => ({ ...prev, [spaceKey]: data.tree ?? [] }))
      } catch {
        // tree fetch failed; show empty
        setTrees(prev => ({ ...prev, [spaceKey]: [] }))
      } finally {
        setLoadingTree(null)
      }
    }
  }

  if (loading) {
    return (
      <div className="tree-state">
        <span className="tree-spinner" />
        <span>Loading spaces…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="tree-state tree-error">
        <span>⚠</span>
        <span>{error}</span>
      </div>
    )
  }

  if (spaces.length === 0) {
    return (
      <div className="tree-state tree-empty">
        <span className="tree-empty-icon">⬡</span>
        <p>No spaces synced yet.</p>
        <p className="tree-empty-hint">Click "Sync Confluence" above to mirror your workspace.</p>
      </div>
    )
  }

  return (
    <div className="space-tree">
      {spaces.map(space => {
        const isExpanded = expandedSpaces.has(space.key)
        const tree = trees[space.key] ?? []
        const isLoadingThisTree = loadingTree === space.key
        const totalPages = isExpanded ? countPages(tree) : space.page_count

        return (
          <div key={space.key} className="tree-space">
            <div
              className={`tree-space-row${isExpanded ? " expanded" : ""}`}
              onClick={() => toggleSpace(space.key)}>
              <span className="tree-space-chevron">{isExpanded ? "▾" : "▸"}</span>
              <span className="tree-space-icon">⬡</span>
              <span className="tree-space-name">{space.name}</span>
              <span className="tree-space-count">{totalPages}</span>
            </div>

            {isExpanded && (
              <div className="tree-space-pages">
                {isLoadingThisTree ? (
                  <div className="tree-loading-row">
                    <span className="tree-spinner-sm" />
                    <span>Loading pages…</span>
                  </div>
                ) : tree.length === 0 ? (
                  <div className="tree-loading-row">No pages found</div>
                ) : (
                  tree.map(page => (
                    <PageTreeItem
                      key={page.id}
                      page={page}
                      depth={0}
                      onSelect={onPageSelect}
                      selectedId={selectedPageId}
                      sweepFlags={sweepFlags}
                      analysisHealth={analysisHealth}
                      dismissedSweep={dismissedSweep}
                      onDismissSweep={id => setDismissedSweep(prev => new Set([...prev, id]))}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
