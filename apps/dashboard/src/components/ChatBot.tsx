import { useState, useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"
import { MessageSquare, X, ArrowUp, Trash2, Sparkles } from "lucide-react"
import "./ChatBot.css"
import { apiClient, API_BASE } from "@/lib/api"

interface Source {
  page_id: string
  title: string
  space_key: string
  url: string | null
  owner: string | null
}

interface Message {
  role: "user" | "assistant"
  content: string
  sources?: Source[]
  ts: number
}

const STARTERS = [
  "What are the most critical issues in my workspace?",
  "Summarise the pages most at risk of being outdated.",
  "Which pages have duplicate content?",
  "How do I improve my workspace health score?",
]

function useWorkspaceStats() {
  const [stats, setStats] = useState<Record<string, number>>({})
  useEffect(() => {
    apiClient
      .get("/api/stats/")
      .then((r) => r.data)
      .then((d) =>
        setStats({
          pages: d.pages_total ?? 0,
          issues: d.proposals_pending ?? 0,
          duplicates: 0,
        }),
      )
      .catch(() => {})
  }, [])
  return stats
}

// ── Lightweight markdown renderer ────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let rem = text
  let k = 0

  const patterns: { re: RegExp; el: (inner: string) => React.ReactNode }[] = [
    { re: /\*\*([^*\n]+)\*\*/, el: (s) => <strong key={k++}>{s}</strong> },
    { re: /\*([^*\n]+)\*/, el: (s) => <em key={k++}>{s}</em> },
    { re: /`([^`\n]+)`/, el: (s) => <code key={k++} className="chat-inline-code">{s}</code> },
  ]

  while (rem.length > 0) {
    let earliest: { index: number; len: number; node: React.ReactNode } | null = null

    for (const { re, el } of patterns) {
      const m = rem.match(re)
      if (m && m.index !== undefined) {
        const candidate = { index: m.index, len: m[0].length, node: el(m[1]) }
        if (!earliest || candidate.index < earliest.index) earliest = candidate
      }
    }

    if (!earliest) {
      parts.push(rem)
      break
    }
    if (earliest.index > 0) parts.push(rem.slice(0, earliest.index))
    parts.push(earliest.node)
    rem = rem.slice(earliest.index + earliest.len)
  }

  return parts
}

function Markdown({ text }: { text: string }) {
  if (!text) return null
  const lines = text.split("\n")
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith("```")) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      blocks.push(
        <pre key={key++} className="chat-code-block">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      )
      i++
      continue
    }

    // Headings
    if (line.startsWith("### ")) {
      blocks.push(
        <p key={key++} className="chat-md-h3">
          {renderInline(line.slice(4))}
        </p>,
      )
      i++
      continue
    }
    if (line.startsWith("## ")) {
      blocks.push(
        <p key={key++} className="chat-md-h2">
          {renderInline(line.slice(3))}
        </p>,
      )
      i++
      continue
    }

    // Bullet list — collect consecutive items
    if (line.match(/^[-*] /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i}>{renderInline(lines[i].slice(2))}</li>)
        i++
      }
      blocks.push(<ul key={key++}>{items}</ul>)
      continue
    }

    // Numbered list
    if (/^\d+\. /.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(
          <li key={i}>{renderInline(lines[i].replace(/^\d+\. /, ""))}</li>,
        )
        i++
      }
      blocks.push(<ol key={key++}>{items}</ol>)
      continue
    }

    // Blank line
    if (line.trim() === "") {
      blocks.push(<div key={key++} className="chat-md-gap" />)
      i++
      continue
    }

    // Paragraph
    blocks.push(<p key={key++}>{renderInline(line)}</p>)
    i++
  }

  return <div className="chat-markdown">{blocks}</div>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChatBot() {
  const location = useLocation()
  const stats = useWorkspaceStats()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  // Auto-resize textarea
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    e.target.style.height = "auto"
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
  }

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return

    const userMsg: Message = { role: "user", content: text.trim(), ts: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    if (inputRef.current) inputRef.current.style.height = "auto"
    setStreaming(true)

    const context = {
      currentRoute: location.pathname,
      pages: stats.pages ?? 0,
      issues: stats.issues ?? 0,
      duplicates: stats.duplicates ?? 0,
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
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${err.detail ?? "Something went wrong"}`,
            ts: Date.now(),
          },
        ])
        setStreaming(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ""
      let currentSources: Source[] = []
      const assistantTs = Date.now()
      setMessages((prev) => [...prev, { role: "assistant", content: "", ts: assistantTs }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)

        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6)
          if (data === "[DONE]") break
          try {
            const parsed = JSON.parse(data)

            if (parsed.sources) {
              currentSources = parsed.sources
              setMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = {
                  role: "assistant",
                  content: assistantText,
                  sources: currentSources,
                  ts: assistantTs,
                }
                return next
              })
              continue
            }

            const delta = parsed.delta ?? parsed.text ?? ""
            assistantText += delta
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = {
                role: "assistant",
                content: assistantText,
                sources: currentSources,
                ts: assistantTs,
              }
              return next
            })
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Connection error. Please check your network and try again.",
          ts: Date.now(),
        },
      ])
    } finally {
      setStreaming(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function clearConversation() {
    setMessages([])
  }

  return (
    <>
      {/* ── Floating action button ── */}
      <button
        className={`chatbot-fab${open ? " chatbot-fab--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle DocAI Assistant"
        title="DocAI Assistant"
      >
        {open ? <X size={20} strokeWidth={2.5} /> : <MessageSquare size={20} strokeWidth={2} />}
        {!open && <span className="chatbot-fab-label">Ask AI</span>}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div className="chatbot-panel" ref={panelRef} role="dialog" aria-label="DocAI Assistant">
          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-left">
              <div className="chatbot-header-avatar">
                <Sparkles size={14} strokeWidth={2} />
              </div>
              <div>
                <div className="chatbot-header-name">DocAI Assistant</div>
                <div className="chatbot-header-status">
                  <span className={`chatbot-status-dot${streaming ? " chatbot-status-dot--thinking" : ""}`} />
                  {streaming ? "Thinking…" : "AI-powered · Confluence-aware"}
                </div>
              </div>
            </div>
            <div className="chatbot-header-actions">
              {messages.length > 0 && (
                <button
                  className="chatbot-icon-btn"
                  onClick={clearConversation}
                  title="Clear conversation"
                  aria-label="Clear conversation"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              )}
              <button
                className="chatbot-icon-btn"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="chatbot-messages">
            {messages.length === 0 && (
              <div className="chatbot-welcome">
                <div className="chatbot-welcome-icon">
                  <Sparkles size={22} strokeWidth={1.5} />
                </div>
                <p className="chatbot-welcome-title">How can I help?</p>
                <p className="chatbot-welcome-sub">
                  I have access to your Confluence documentation. Ask me anything.
                </p>
                <div className="chatbot-starters">
                  {STARTERS.map((s, i) => (
                    <button key={i} className="chatbot-starter" onClick={() => sendMessage(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`chatbot-msg chatbot-msg--${msg.role}`}>
                {msg.role === "assistant" && (
                  <div className="chatbot-msg-avatar">
                    <Sparkles size={11} strokeWidth={2} />
                  </div>
                )}
                <div className="chatbot-msg-body">
                  <div className="chatbot-bubble">
                    {msg.role === "assistant" ? (
                      msg.content ? (
                        <Markdown text={msg.content} />
                      ) : streaming && i === messages.length - 1 ? (
                        <span className="chatbot-typing">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : null
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>

                  {/* Source citations */}
                  {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                    <div className="chat-sources">
                      <span className="chat-sources-label">Sources</span>
                      {msg.sources.map((src, j) => (
                        <a
                          key={j}
                          className="chat-source-chip"
                          href={src.url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${src.space_key} · ${src.owner ?? ""}`}
                        >
                          {src.title}
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="chatbot-msg-time">{formatTime(msg.ts)}</div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="chatbot-input-area">
            <div className="chatbot-input-row">
              <textarea
                ref={inputRef}
                className="chatbot-input"
                placeholder="Ask about your Confluence docs…"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={streaming}
                aria-label="Chat input"
              />
              <button
                className="chatbot-send"
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || streaming}
                aria-label="Send"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </div>
            <div className="chatbot-input-hint">Enter to send · Shift+Enter for new line</div>
          </div>
        </div>
      )}
    </>
  )
}
