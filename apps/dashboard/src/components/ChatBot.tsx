import { useState, useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"
import "./ChatBot.css"
import { API_BASE } from '@/lib/api'

interface Message {
  role: "user" | "assistant"
  content: string
}

const STARTERS = [
  "What are the most critical issues in my workspace?",
  "Which pages should I prioritize fixing?",
  "Explain the duplicate pages you found",
  "How is my documentation health score calculated?",
]

function useWorkspaceStats() {
  const [stats, setStats] = useState<Record<string, number>>({})
  useEffect(() => {
    fetch(`${API_BASE}/api/stats/`)
      .then(r => r.json())
      .then(d => setStats({ pages: d.pages_total ?? 0, issues: d.proposals_pending ?? 0, duplicates: 0 }))
      .catch(() => {})
  }, [])
  return stats
}

export default function ChatBot() {
  const location = useLocation()
  const stats = useWorkspaceStats()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return
    const userMsg: Message = { role: "user", content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput("")
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
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.detail ?? "Something went wrong"}` }])
        setStreaming(false)
        return
      }

      // SSE streaming
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ""
      setMessages(prev => [...prev, { role: "assistant", content: "" }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split("\n")
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") break
            try {
              const parsed = JSON.parse(data)
              const delta = parsed.delta ?? parsed.text ?? ""
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
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Is the backend running?" }])
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

  return (
    <>
      {/* Floating button */}
      <button
        className={`chatbot-fab${open ? " active" : ""}`}
        onClick={() => setOpen(v => !v)}
        title="DocAI Assistant">
        {open ? "✕" : "D"}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <div className="chatbot-header-info">
              <div className="chatbot-avatar">D</div>
              <div>
                <div className="chatbot-name">DocAI Assistant</div>
                <div className="chatbot-status">
                  <span className="chatbot-status-dot" />
                  {streaming ? "Typing…" : "Online"}
                </div>
              </div>
            </div>
            <button className="chatbot-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="chatbot-messages">
            {messages.length === 0 && (
              <div className="chatbot-welcome">
                <div className="chatbot-welcome-avatar">D</div>
                <p className="chatbot-welcome-text">
                  Hi! I'm your DocAI Assistant. Ask me anything about your workspace health, issues, or duplicates.
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
              <div key={i} className={`chatbot-msg chatbot-msg-${msg.role}`}>
                {msg.role === "assistant" && (
                  <div className="chatbot-msg-avatar">D</div>
                )}
                <div className="chatbot-msg-bubble">
                  {msg.content || (streaming && i === messages.length - 1
                    ? <span className="chatbot-typing"><span /><span /><span /></span>
                    : "")}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="chatbot-input-area">
            <textarea
              ref={inputRef}
              className="chatbot-input"
              placeholder="Ask anything…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={streaming}
            />
            <button
              className="chatbot-send"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || streaming}>
              ↑
            </button>
          </div>
        </div>
      )}
    </>
  )
}
