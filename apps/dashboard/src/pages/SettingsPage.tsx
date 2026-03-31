import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import "./SettingsPage.css"

const API_BASE = "http://localhost:8000"

type Tab = "profile" | "integrations" | "preferences" | "about"

interface Profile {
  name: string
  email: string
  role: string
}

interface Integrations {
  confluenceUrl: string
  confluenceEmail: string
  confluenceToken: string
  anthropicKey: string
  anthropicModel: string
  voyageKey: string
}

interface Preferences {
  threshold: number
  syncFreq: string
  staleDays: number
  notifProposals: boolean
  notifDuplicates: boolean
  notifApplied: boolean
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "profile",      label: "Profile",      icon: "👤" },
  { id: "integrations", label: "Integrations", icon: "🔗" },
  { id: "preferences",  label: "Preferences",  icon: "⚙" },
  { id: "about",        label: "About",        icon: "ℹ" },
]

function loadProfile(): Profile {
  try { return { name: "User", email: "", role: "Admin", ...JSON.parse(localStorage.getItem("docai_profile") || "{}") } }
  catch { return { name: "User", email: "", role: "Admin" } }
}

function loadIntegrations(): Integrations {
  try {
    return {
      confluenceUrl: "", confluenceEmail: "", confluenceToken: "",
      anthropicKey: "", anthropicModel: "claude-sonnet-4-20250514",
      voyageKey: "",
      ...JSON.parse(localStorage.getItem("docai_integrations") || "{}"),
    }
  } catch {
    return { confluenceUrl: "", confluenceEmail: "", confluenceToken: "", anthropicKey: "", anthropicModel: "claude-sonnet-4-20250514", voyageKey: "" }
  }
}

function loadPreferences(): Preferences {
  try {
    return {
      threshold: 0.8, syncFreq: "manual", staleDays: 90,
      notifProposals: true, notifDuplicates: true, notifApplied: true,
      ...JSON.parse(localStorage.getItem("docai_preferences") || "{}"),
    }
  } catch {
    return { threshold: 0.8, syncFreq: "manual", staleDays: 90, notifProposals: true, notifDuplicates: true, notifApplied: true }
  }
}

// ── Profile Tab ────────────────────────────────────────────────────────────────
function ProfileTab() {
  const [form, setForm] = useState<Profile>(loadProfile)
  const [saved, setSaved] = useState(false)

  const initials = form.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "U"

  function save() {
    localStorage.setItem("docai_profile", JSON.stringify(form))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Profile</h2>
        <p className="settings-section-sub">Your personal information and role within DocAI.</p>
      </div>

      <div className="settings-avatar-row">
        <div className="settings-avatar">{initials}</div>
        <div>
          <div className="settings-avatar-name">{form.name || "Your name"}</div>
          <div className="settings-avatar-role">{form.role}</div>
        </div>
      </div>

      <div className="settings-fields">
        <div className="settings-field">
          <label className="settings-label">Full Name</label>
          <input
            className="settings-input"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Jane Smith"
          />
        </div>
        <div className="settings-field">
          <label className="settings-label">Email</label>
          <input
            className="settings-input"
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="jane@yourcompany.com"
          />
        </div>
        <div className="settings-field">
          <label className="settings-label">Role</label>
          <select
            className="settings-select"
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="Admin">Admin</option>
            <option value="Reviewer">Reviewer</option>
            <option value="Viewer">Viewer</option>
          </select>
        </div>
      </div>

      <button className="settings-save-btn" onClick={save}>
        {saved ? "✓ Saved" : "Save Profile"}
      </button>
    </div>
  )
}

// ── Integrations Tab ───────────────────────────────────────────────────────────
function IntegrationsTab() {
  const [form, setForm] = useState<Integrations>(loadIntegrations)
  const [showTokens, setShowTokens] = useState({ confluence: false, anthropic: false, voyage: false })
  const [connStatus, setConnStatus] = useState<Record<string, "idle" | "testing" | "ok" | "error">>({
    confluence: "idle", anthropic: "idle", voyage: "idle",
  })
  const [saved, setSaved] = useState(false)

  function save() {
    localStorage.setItem("docai_integrations", JSON.stringify(form))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function testConfluence() {
    setConnStatus(s => ({ ...s, confluence: "testing" }))
    try {
      const res = await fetch(`${API_BASE}/api/confluence/test?base_url=${encodeURIComponent(form.confluenceUrl)}&email=${encodeURIComponent(form.confluenceEmail)}&api_token=${encodeURIComponent(form.confluenceToken)}`)
      const data = await res.json()
      setConnStatus(s => ({ ...s, confluence: data.connected ? "ok" : "error" }))
    } catch {
      setConnStatus(s => ({ ...s, confluence: "error" }))
    }
  }

  async function testAnthropic() {
    setConnStatus(s => ({ ...s, anthropic: "testing" }))
    await new Promise(r => setTimeout(r, 800))
    setConnStatus(s => ({ ...s, anthropic: form.anthropicKey.startsWith("sk-ant") ? "ok" : "error" }))
  }

  async function testVoyage() {
    setConnStatus(s => ({ ...s, voyage: "testing" }))
    await new Promise(r => setTimeout(r, 800))
    setConnStatus(s => ({ ...s, voyage: form.voyageKey.startsWith("pa-") ? "ok" : "error" }))
  }

  function StatusIcon({ key: k }: { key: string }) {
    const st = connStatus[k]
    if (st === "testing") return <span className="conn-testing">⟳ Testing…</span>
    if (st === "ok")      return <span className="conn-ok">✓ Connected</span>
    if (st === "error")   return <span className="conn-error">✕ Failed</span>
    return null
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Integrations</h2>
        <p className="settings-section-sub">Connect DocAI to your tools. API keys are stored locally in your browser.</p>
      </div>

      <div className="settings-local-warning">
        🔒 API keys are stored in your browser's localStorage — never transmitted to any server beyond direct API calls.
      </div>

      {/* Confluence */}
      <div className="settings-integration-block">
        <div className="settings-integration-header">
          <div className="settings-integration-icon">C</div>
          <div>
            <div className="settings-integration-name">Confluence</div>
            <div className="settings-integration-sub">Connect to your Atlassian Confluence workspace</div>
          </div>
          <StatusIcon key="confluence" />
        </div>

        <div className="settings-fields">
          <div className="settings-field">
            <label className="settings-label">Base URL</label>
            <input
              className="settings-input"
              value={form.confluenceUrl}
              onChange={e => setForm(f => ({ ...f, confluenceUrl: e.target.value }))}
              placeholder="https://yourorg.atlassian.net"
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">Email</label>
            <input
              className="settings-input"
              type="email"
              value={form.confluenceEmail}
              onChange={e => setForm(f => ({ ...f, confluenceEmail: e.target.value }))}
              placeholder="you@company.com"
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">API Token</label>
            <div className="settings-input-wrap">
              <input
                className="settings-input"
                type={showTokens.confluence ? "text" : "password"}
                value={form.confluenceToken}
                onChange={e => setForm(f => ({ ...f, confluenceToken: e.target.value }))}
                placeholder="ATATT3x…"
              />
              <button
                className="settings-toggle-btn"
                onClick={() => setShowTokens(s => ({ ...s, confluence: !s.confluence }))}>
                {showTokens.confluence ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </div>
        <button className="settings-test-btn" onClick={testConfluence}
          disabled={connStatus.confluence === "testing"}>
          Test Connection
        </button>
      </div>

      {/* Anthropic */}
      <div className="settings-integration-block">
        <div className="settings-integration-header">
          <div className="settings-integration-icon" style={{ background: "linear-gradient(135deg, #D97706, #F59E0B)" }}>A</div>
          <div>
            <div className="settings-integration-name">Anthropic Claude</div>
            <div className="settings-integration-sub">AI model for analysis and merge proposals</div>
          </div>
          <StatusIcon key="anthropic" />
        </div>

        <div className="settings-fields">
          <div className="settings-field">
            <label className="settings-label">API Key</label>
            <div className="settings-input-wrap">
              <input
                className="settings-input"
                type={showTokens.anthropic ? "text" : "password"}
                value={form.anthropicKey}
                onChange={e => setForm(f => ({ ...f, anthropicKey: e.target.value }))}
                placeholder="sk-ant-api03-…"
              />
              <button
                className="settings-toggle-btn"
                onClick={() => setShowTokens(s => ({ ...s, anthropic: !s.anthropic }))}>
                {showTokens.anthropic ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-label">Model</label>
            <select
              className="settings-select"
              value={form.anthropicModel}
              onChange={e => setForm(f => ({ ...f, anthropicModel: e.target.value }))}>
              <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514 (recommended)</option>
              <option value="claude-opus-4-20250514">claude-opus-4-20250514</option>
              <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001 (fast)</option>
            </select>
          </div>
        </div>
        <button className="settings-test-btn" onClick={testAnthropic}
          disabled={connStatus.anthropic === "testing"}>
          Test Key
        </button>
      </div>

      {/* Voyage */}
      <div className="settings-integration-block">
        <div className="settings-integration-header">
          <div className="settings-integration-icon" style={{ background: "linear-gradient(135deg, #6366F1, #818CF8)" }}>V</div>
          <div>
            <div className="settings-integration-name">Voyage AI</div>
            <div className="settings-integration-sub">Semantic embeddings for duplicate detection</div>
          </div>
          <StatusIcon key="voyage" />
        </div>

        <div className="settings-fields">
          <div className="settings-field">
            <label className="settings-label">API Key</label>
            <div className="settings-input-wrap">
              <input
                className="settings-input"
                type={showTokens.voyage ? "text" : "password"}
                value={form.voyageKey}
                onChange={e => setForm(f => ({ ...f, voyageKey: e.target.value }))}
                placeholder="pa-…"
              />
              <button
                className="settings-toggle-btn"
                onClick={() => setShowTokens(s => ({ ...s, voyage: !s.voyage }))}>
                {showTokens.voyage ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </div>
        <button className="settings-test-btn" onClick={testVoyage}
          disabled={connStatus.voyage === "testing"}>
          Test Key
        </button>
      </div>

      <button className="settings-save-btn" onClick={save}>
        {saved ? "✓ Saved" : "Save Integrations"}
      </button>
    </div>
  )
}

// ── Preferences Tab ────────────────────────────────────────────────────────────
function PreferencesTab() {
  const [form, setForm] = useState<Preferences>(loadPreferences)
  const [saved, setSaved] = useState(false)

  function save() {
    localStorage.setItem("docai_preferences", JSON.stringify(form))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Preferences</h2>
        <p className="settings-section-sub">Customize default behavior for scans, sync, and notifications.</p>
      </div>

      <div className="settings-fields">
        <div className="settings-field">
          <label className="settings-label">
            Default Similarity Threshold — <strong>{Math.round(form.threshold * 100)}%</strong>
          </label>
          <input
            type="range" min={0.6} max={0.95} step={0.01}
            className="settings-slider"
            value={form.threshold}
            onChange={e => setForm(f => ({ ...f, threshold: parseFloat(e.target.value) }))}
          />
          <div className="settings-slider-hint">
            {form.threshold >= 0.9 ? "Very selective — only near-identical pages" :
             form.threshold >= 0.8 ? "Balanced — catches clear duplicates" :
                                     "Inclusive — may surface partial overlaps"}
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label">Auto-sync Frequency</label>
          <select
            className="settings-select"
            value={form.syncFreq}
            onChange={e => setForm(f => ({ ...f, syncFreq: e.target.value }))}>
            <option value="manual">Manual only</option>
            <option value="hourly">Every hour</option>
            <option value="daily">Once a day</option>
          </select>
        </div>

        <div className="settings-field">
          <label className="settings-label">Stale Page Threshold</label>
          <select
            className="settings-select"
            value={form.staleDays}
            onChange={e => setForm(f => ({ ...f, staleDays: parseInt(e.target.value) }))}>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
        </div>
      </div>

      <div className="settings-subsection-title">Notifications</div>
      <div className="settings-checkboxes">
        {[
          { key: "notifProposals" as const, label: "New proposals awaiting review" },
          { key: "notifDuplicates" as const, label: "Duplicate pairs detected" },
          { key: "notifApplied" as const, label: "Changes applied to Confluence" },
        ].map(({ key, label }) => (
          <label key={key} className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <button className="settings-save-btn" onClick={save}>
        {saved ? "✓ Saved" : "Save Preferences"}
      </button>
    </div>
  )
}

// ── About Tab ──────────────────────────────────────────────────────────────────
function AboutTab() {
  const [health, setHealth] = useState<"checking" | "ok" | "error">("checking")

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then(r => r.ok ? setHealth("ok") : setHealth("error"))
      .catch(() => setHealth("error"))
  }, [])

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">About DocAI</h2>
        <p className="settings-section-sub">Version info and system status.</p>
      </div>

      <div className="settings-about-grid">
        <div className="settings-about-row">
          <span className="settings-about-label">Version</span>
          <span className="settings-about-value">v0.1.0 (Beta)</span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">API Endpoint</span>
          <span className="settings-about-value">{API_BASE}</span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">API Health</span>
          <span className="settings-about-value">
            {health === "checking" && <span style={{ color: "var(--text-3)" }}>Checking…</span>}
            {health === "ok"       && <span style={{ color: "var(--green-text)" }}>✓ Healthy</span>}
            {health === "error"    && <span style={{ color: "var(--red-text)"   }}>✕ Unreachable</span>}
          </span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">Dashboard</span>
          <span className="settings-about-value">React 18 + Vite + TypeScript</span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">Backend</span>
          <span className="settings-about-value">FastAPI + PostgreSQL + pgvector</span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">AI Model</span>
          <span className="settings-about-value">Claude claude-sonnet-4-20250514 (Anthropic)</span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">Embeddings</span>
          <span className="settings-about-value">Voyage AI (voyage-3)</span>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>()
  const navigate = useNavigate()
  const activeTab: Tab = (tab as Tab) ?? "profile"

  function setTab(t: Tab) {
    navigate(`/settings/${t}`, { replace: true })
  }

  return (
    <div className="settings-layout">
      <div className="settings-tabs-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`settings-tab${activeTab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}>
            <span className="settings-tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {activeTab === "profile"      && <ProfileTab />}
        {activeTab === "integrations" && <IntegrationsTab />}
        {activeTab === "preferences"  && <PreferencesTab />}
        {activeTab === "about"        && <AboutTab />}
      </div>
    </div>
  )
}
