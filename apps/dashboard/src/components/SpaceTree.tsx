import { useState, useEffect } from "react"
import "./SpaceTree.css"

const API_BASE = "http://localhost:8000"

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
  is_healthy: boolean
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
}: {
  page: PageNode
  depth: number
  onSelect: (p: PageNode) => void
  selectedId: string | null
  sweepFlags?: Record<string, string[]>
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = page.children.length > 0
  const flags = sweepFlags?.[page.id] ?? []
  const hasIssues = flags.length > 0

  return (
    <div>
      <div
        className={`tree-page-row${selectedId === page.id ? " selected" : ""}`}
        style={{ paddingLeft: `${14 + depth * 14}px` }}
        onClick={() => onSelect(page)}>

        <span
          className={`tree-chevron${hasChildren ? "" : " invisible"}`}
          onClick={e => {
            if (!hasChildren) return
            e.stopPropagation()
            setExpanded(v => !v)
          }}>
          {expanded ? "▾" : "▸"}
        </span>

        <span className="tree-page-icon">{hasChildren ? "⊟" : "◫"}</span>
        <span className="tree-page-title">{page.title}</span>

        {hasIssues ? (
          <span
            className={`tree-issue-dot${flags.length >= 2 ? " tree-issue-dot-red" : " tree-issue-dot-amber"}`}
            title="Issues detected by sweep — analyze to find exact fixes"
          />
        ) : (page.is_healthy && !hasChildren && (
          <span className="tree-healthy-check" title="No issues detected">✓</span>
        ))}
        {hasChildren && (
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
}: SpaceTreeProps) {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(new Set())
  const [trees, setTrees] = useState<Record<string, PageNode[]>>({})
  const [loadingTree, setLoadingTree] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/sync/spaces`)
      .then(r => r.json())
      .then(data => setSpaces(data.spaces ?? []))
      .catch(() => setError("Could not reach backend. Is it running on port 8000?"))
      .finally(() => setLoading(false))
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
