import { useState, useRef, useEffect } from "react"
import "./popup.css"

const API_BASE = "http://localhost:8000"

// ── Types ──────────────────────────────────────────────────────────────────────

type Severity = "low" | "medium" | "high"
type IssueType = "stale" | "duplicate" | "orphan" | "unowned" | "unstructured"

interface Issue {
  type: IssueType
  severity: Severity
  title: string
  description: string
  suggestion: string
}

interface AnalyzeResponse {
  page_title: string
  page_url: string
  issues: Issue[]
  summary: string
}

type AnalyzeState =
  | { status: "idle" }
  | { status: "loading"; step: number }
  | { status: "done"; result: AnalyzeResponse; contentFound: boolean }
  | { status: "error"; message: string }
  | { status: "not_confluence" }

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SEVERITY: Record<Severity, { label: string; color: string; bg: string }> = {
  high:   { label: "High",   color: "#BF2600", bg: "#FFEBE6" },
  medium: { label: "Medium", color: "#974F0C", bg: "#FFF7D6" },
  low:    { label: "Low",    color: "#0747A6", bg: "#EBF2FF" },
}

const SEV_LINE: Record<Severity, string> = {
  high: "#DE350B", medium: "#FF991F", low: "#0052CC",
}

const ICONS: Record<IssueType, string> = {
  stale: "🕐", duplicate: "📄", orphan: "🔗", unowned: "👤", unstructured: "📋",
}

const STEPS = ["Reading active tab", "Scraping page content", "Analyzing with AI"]

const CHAT_STARTERS = [
  "What's wrong with this page?",
  "How should I restructure this?",
  "Who should own this page?",
  "Is this content outdated?",
]

// ── Issue Card ────────────────────────────────────────────────────────────────

function IssueCard({ issue }: { issue: Issue }) {
  const [expanded, setExpanded] = useState(false)
  const sev = SEVERITY[issue.severity]
  return (
    <div
      className={`issue-card${expanded ? " expanded" : ""}`}
      style={{ "--sev-color": SEV_LINE[issue.severity] } as React.CSSProperties}
      onClick={() => setExpanded(!expanded)}>
      <div className="issue-header">
        <span className="issue-icon">{ICONS[issue.type]}</span>
        <span className="issue-title">{issue.title}</span>
        <span className="badge" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
        <span className="chevron">▼</span>
      </div>
      {expanded && (
        <div className="issue-body">
          <p className="issue-desc">{issue.description}</p>
          <div className="issue-suggestion">
            <span className="suggestion-label">💡 Suggestion</span>
            <p>{issue.suggestion}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Analyze Tab ───────────────────────────────────────────────────────────────

function AnalyzeTab() {
  const [state, setState] = useState<AnalyzeState>({ status: "idle" })

  async function analyze() {
    setState({ status: "loading", step: 0 })
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const url = tab.url || ""

    if (!url.includes("atlassian.net") && !url.includes("atlassian.com")) {
      setState({ status: "not_confluence" })
      return
    }

    setState({ status: "loading", step: 1 })

    let pageData: Record<string, unknown> = {
      title: tab.title?.replace(/ - Confluence.*$/, "").trim(),
      url, content: null, contentFound: false,
    }

    try {
      const scraped = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 3000)
        chrome.tabs.sendMessage(tab.id!, { type: "SCRAPE_PAGE" }, (res) => {
          clearTimeout(t)
          chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(res)
        })
      })
      if (scraped) pageData = { ...pageData, ...scraped }
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ["contents/confluence.js"] })
        await new Promise(r => setTimeout(r, 400))
        const scraped2 = await new Promise<Record<string, unknown>>(resolve => {
          chrome.tabs.sendMessage(tab.id!, { type: "SCRAPE_PAGE" }, res => resolve(res || {}))
        })
        if (scraped2?.content) pageData = { ...pageData, ...scraped2 }
      } catch { /* proceed with metadata */ }
    }

    setState({ status: "loading", step: 2 })

    try {
      const res = await fetch(`${API_BASE}/api/analyze/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: pageData.url || url,
          title: pageData.title,
          content: pageData.content || null,
          last_modified: pageData.lastModified || null,
          owner: pageData.owner || null,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail || `API error: ${res.status}`)
      }

      const result: AnalyzeResponse = await res.json()
      setState({ status: "done", result, contentFound: Boolean(pageData.contentFound) })
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Something went wrong" })
    }
  }

  const reset = () => setState({ status: "idle" })

  return (
    <div className="tab-content">
      {state.status === "idle" && (
        <div className="idle-state">
          <div className="idle-graphic">
            <div className="idle-ring idle-ring-1" />
            <div className="idle-ring idle-ring-2" />
            <div className="idle-core">D</div>
          </div>
          <div className="idle-copy">
            <h2>Documentation Intelligence</h2>
            <p>Open any Confluence page and analyze it for quality issues, staleness, and structural problems.</p>
          </div>
          <button className="btn-primary" onClick={analyze}>Analyze This Page</button>
        </div>
      )}

      {state.status === "loading" && (
        <div className="loading-state">
          <div className="spinner-wrap">
            <div className="spinner" />
            <div className="spinner-inner" />
          </div>
          <span className="loading-step">{STEPS[state.step]}</span>
          <div className="loading-steps">
            {STEPS.map((s, i) => (
              <div key={i} className={`step-item${i === state.step ? " active" : ""}`}>
                <div className="step-dot" />
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.status === "not_confluence" && (
        <div className="empty-state">
          <span className="empty-icon">🔍</span>
          <p>Navigate to a Confluence page first, then click Analyze.</p>
          <button className="btn-ghost" onClick={reset}>Got it</button>
        </div>
      )}

      {state.status === "error" && (
        <div className="empty-state">
          <span className="empty-icon">⚠️</span>
          <p>{state.message}</p>
          <button className="btn-primary" onClick={reset}>Try Again</button>
        </div>
      )}

      {state.status === "done" && (
        <div className="results">
          <div className="result-top-bar">
            <button className="btn-ghost-sm" onClick={reset}>← Back</button>
          </div>
          <div className="page-meta">
            <div className="page-meta-top">
              <p className="page-title">{state.result.page_title}</p>
              <span className={`issue-count ${state.result.issues.length > 0 ? "has-issues" : "no-issues"}`}>
                {state.result.issues.length} {state.result.issues.length === 1 ? "Issue" : "Issues"}
              </span>
            </div>
            {!state.contentFound && (
              <div className="content-warning">⚠️ Metadata-only — page content could not be scraped</div>
            )}
            <p className="page-summary">{state.result.summary}</p>
          </div>

          {state.result.issues.length === 0 ? (
            <div className="no-issues">
              <span>✅</span>
              <p>No issues detected. This page looks healthy!</p>
            </div>
          ) : (
            <div className="issues-section">
              <span className="issues-label">Detected Issues</span>
              <div className="issues-list">
                {state.result.issues.map((issue, i) => (
                  <IssueCard key={i} issue={issue} />
                ))}
              </div>
            </div>
          )}

          <button className="btn-secondary"
            onClick={() => chrome.tabs.create({ url: "http://localhost:3000/proposals" })}>
            View in Dashboard →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Chat Tab ──────────────────────────────────────────────────────────────────

function ChatTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [pageContext, setPageContext] = useState<{ title: string; url: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url?.includes("atlassian")) {
        setPageContext({
          title: tab.title?.replace(/ - Confluence.*$/, "").trim() ?? "",
          url: tab.url ?? "",
        })
      }
    })
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return
    const userMsg: ChatMessage = { role: "user", content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setStreaming(true)

    const context: Record<string, string> = { currentRoute: "extension" }
    if (pageContext) {
      context.pageTitle = pageContext.title
      context.pageUrl = pageContext.url
    }

    const history = [...messages, userMsg]

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context }),
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${(err as { detail?: string }).detail ?? "Something went wrong"}` }])
        setStreaming(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ""
      setMessages(prev => [...prev, { role: "assistant", content: "" }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") break
            try {
              const parsed = JSON.parse(data)
              const delta = parsed.delta ?? ""
              assistantText += delta
              setMessages(prev => {
                const next = [...prev]
                next[next.length - 1] = { role: "assistant", content: assistantText }
                return next
              })
            } catch {}
          }
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error — is the backend running?" }])
    } finally {
      setStreaming(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); sendMessage(input) }
  }

  return (
    <div className="chat-tab">
      {pageContext && (
        <div className="chat-context-bar">
          <span className="chat-context-icon">📄</span>
          <span className="chat-context-title" title={pageContext.title}>{pageContext.title || "Confluence page"}</span>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="chat-welcome-avatar">D</div>
            <p className="chat-welcome-text">Ask me anything about this page or your workspace.</p>
            <div className="chat-starters">
              {CHAT_STARTERS.map((s, i) => (
                <button key={i} className="chat-starter" onClick={() => sendMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
            {msg.role === "assistant" && <div className="chat-msg-av">D</div>}
            <div className="chat-msg-bubble">
              {msg.content || (streaming && i === messages.length - 1
                ? <span className="chat-typing"><span /><span /><span /></span>
                : "")}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="chat-input"
          placeholder="Ask anything…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={streaming}
        />
        <button
          className="chat-send"
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || streaming}>
          ↑
        </button>
      </div>
    </div>
  )
}

// ── Popup Root ────────────────────────────────────────────────────────────────

export default function Popup() {
  const [activeTab, setActiveTab] = useState<"analyze" | "chat">("analyze")

  return (
    <div className="popup">
      <header className="popup-header">
        <div className="logo">
          <div className="logo-mark">D</div>
          <span className="logo-text">DocAI</span>
          <span className="logo-badge">Beta</span>
        </div>
        <div className="popup-tabs">
          <button
            className={`popup-tab${activeTab === "analyze" ? " active" : ""}`}
            onClick={() => setActiveTab("analyze")}>
            Analyze
          </button>
          <button
            className={`popup-tab${activeTab === "chat" ? " active" : ""}`}
            onClick={() => setActiveTab("chat")}>
            Ask AI
          </button>
        </div>
      </header>

      <main className="popup-main">
        {activeTab === "analyze" && <AnalyzeTab />}
        {activeTab === "chat"    && <ChatTab />}
      </main>

      <footer className="popup-footer">
        <div className="footer-status">
          <div className="status-dot" />
          <span>Connected to API</span>
        </div>
        <a href="http://localhost:3000" target="_blank" rel="noreferrer" className="footer-link">
          Open Dashboard →
        </a>
      </footer>
    </div>
  )
}
