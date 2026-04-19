import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import "./SearchModal.css"
import { API_BASE } from '@/lib/api'

interface SearchResult {
  id: string
  type: "page" | "proposal" | "audit"
  title: string
  subtitle: string
  path: string
}

const RECENT_KEY = "docai_recent_searches"

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") } catch { return [] }
}

function addRecent(q: string) {
  const prev = getRecent().filter(r => r !== q)
  localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, 8)))
}

export default function SearchModal() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [allData, setAllData] = useState<SearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Load search index once on mount
  useEffect(() => {
    async function loadIndex() {
      try {
        const [pagesRes, propsRes, auditRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/sync/spaces`).then(r => r.json()),
          fetch(`${API_BASE}/api/proposals/`).then(r => r.json()),
          fetch(`${API_BASE}/api/audit/`).then(r => r.json()),
        ])

        const items: SearchResult[] = []

        if (pagesRes.status === "fulfilled") {
          const spaces = pagesRes.value.spaces ?? []
          spaces.forEach((s: any) => {
            items.push({
              id: `space-${s.key}`,
              type: "page",
              title: s.name,
              subtitle: `Space · ${s.page_count ?? 0} pages`,
              path: "/pages",
            })
          })
        }

        if (propsRes.status === "fulfilled") {
          const proposals = Array.isArray(propsRes.value) ? propsRes.value : []
          proposals.forEach((p: any) => {
            items.push({
              id: `prop-${p.id}`,
              type: "proposal",
              title: p.source_page_title ?? "Proposal",
              subtitle: `${p.action_label ?? p.action} · ${p.status}`,
              path: "/proposals",
            })
          })
        }

        if (auditRes.status === "fulfilled") {
          const entries = Array.isArray(auditRes.value) ? auditRes.value : []
          entries.slice(0, 50).forEach((e: any) => {
            items.push({
              id: `audit-${e.id}`,
              type: "audit",
              title: e.page_title ?? "Audit entry",
              subtitle: `${e.action} · ${e.decision}`,
              path: "/audit",
            })
          })
        }

        setAllData(items)
      } catch {}
    }
    loadIndex()
  }, [])

  // Listen for global open event (from sidebar search btn or Cmd+K)
  useEffect(() => {
    function handleOpen() { setOpen(true) }
    window.addEventListener("docai:opensearch", handleOpen)
    return () => window.removeEventListener("docai:opensearch", handleOpen)
  }, [])

  // Cmd+K keyboard shortcut
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(v => !v)
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery("")
      setResults([])
      setActiveIdx(0)
    }
  }, [open])

  const search = useCallback((q: string) => {
    setQuery(q)
    setActiveIdx(0)
    if (!q.trim()) { setResults([]); return }
    const lower = q.toLowerCase()
    setResults(
      allData
        .filter(item => item.title.toLowerCase().includes(lower) || item.subtitle.toLowerCase().includes(lower))
        .slice(0, 12)
    )
  }, [allData])

  function handleKeyNav(e: React.KeyboardEvent) {
    const displayList = results.length > 0 ? results : []
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, displayList.length - 1)) }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === "Enter") {
      const item = displayList[activeIdx]
      if (item) selectItem(item)
    }
  }

  function selectItem(item: SearchResult) {
    if (query.trim()) addRecent(query.trim())
    setOpen(false)
    navigate(item.path)
  }

  const TYPE_ICON: Record<string, string> = {
    page: "◫",
    proposal: "✓",
    audit: "≡",
  }

  const TYPE_LABEL: Record<string, string> = {
    page: "Page",
    proposal: "Proposal",
    audit: "Audit",
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = []
    acc[r.type].push(r)
    return acc
  }, {})

  const recent = getRecent()

  if (!open) return null

  return (
    <div className="search-overlay" onClick={() => setOpen(false)}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <div className="search-input-row">
          <span className="search-input-icon">🔍</span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search pages, proposals, audit entries…"
            value={query}
            onChange={e => search(e.target.value)}
            onKeyDown={handleKeyNav}
          />
          {query && (
            <button className="search-clear" onClick={() => search("")}>✕</button>
          )}
          <kbd className="search-esc">Esc</kbd>
        </div>

        <div className="search-body">
          {query === "" && recent.length > 0 && (
            <div className="search-section">
              <div className="search-section-label">Recent</div>
              {recent.map((r, i) => (
                <button
                  key={i}
                  className="search-result-row"
                  onClick={() => { setQuery(r); search(r) }}>
                  <span className="search-result-icon">🕐</span>
                  <span className="search-result-title">{r}</span>
                </button>
              ))}
            </div>
          )}

          {query !== "" && results.length === 0 && (
            <div className="search-empty">No results for "{query}"</div>
          )}

          {Object.entries(grouped ?? {}).map(([type, items]) => {
            const globalStart = results.indexOf(items[0])
            return (
              <div key={type} className="search-section">
                <div className="search-section-label">
                  {TYPE_ICON[type]} {TYPE_LABEL[type]}s
                </div>
                {items.map((item, j) => {
                  const idx = globalStart + j
                  return (
                    <button
                      key={item.id}
                      className={`search-result-row${activeIdx === idx ? " active" : ""}`}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => selectItem(item)}>
                      <span className="search-result-icon">{TYPE_ICON[item.type]}</span>
                      <span className="search-result-title">{item.title}</span>
                      <span className="search-result-sub">{item.subtitle}</span>
                      <span className="search-result-arrow">→</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="search-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
