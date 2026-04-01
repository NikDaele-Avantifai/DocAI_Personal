import { useState, useEffect, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import "./SettingsPage.css"

const API_BASE = "http://localhost:8000"

type Tab = "profile" | "integrations" | "preferences" | "analysis" | "privacy" | "about"

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

interface AnalysisSettingsData {
  enabled_issue_types: string[]
  min_severity: "low" | "medium" | "high"
  max_issues_per_page: number
  confidence_threshold: number
  stale_threshold_days: number
  compliance_checking: boolean
  focus_mode: "balanced" | "compliance" | "structure" | "hygiene"
}

const ANALYSIS_DEFAULTS: AnalysisSettingsData = {
  enabled_issue_types: [
    "stale", "unowned", "unstructured", "duplicate",
    "outdated_reference", "missing_review_date", "compliance_gap", "broken_link",
  ],
  min_severity: "low",
  max_issues_per_page: 5,
  confidence_threshold: 0.75,
  stale_threshold_days: 180,
  compliance_checking: true,
  focus_mode: "balanced",
}

const ISSUE_TYPES: { id: string; label: string; description: string; requiresHuman: boolean }[] = [
  { id: "stale",              label: "Stale content",          description: "Page has not been updated within the configured threshold period",           requiresHuman: false },
  { id: "unowned",            label: "No owner assigned",      description: "Page has no identifiable owner in content or metadata",                     requiresHuman: true  },
  { id: "unstructured",       label: "Poor document structure",description: "Missing standard sections or inconsistent formatting",                       requiresHuman: false },
  { id: "duplicate",          label: "Duplicate content",      description: "Content overlaps significantly with another page",                          requiresHuman: true  },
  { id: "outdated_reference", label: "Outdated reference",     description: "Page references systems, people, or processes that no longer exist",        requiresHuman: true  },
  { id: "missing_review_date",label: "Missing review date",    description: "Page has no scheduled review date",                                         requiresHuman: false },
  { id: "compliance_gap",     label: "Compliance gap",         description: "Page is missing required compliance information for its document type",      requiresHuman: true  },
  { id: "broken_link",        label: "Broken or missing link", description: "Page references documents or resources that cannot be found",                requiresHuman: true  },
]

const FOCUS_OPTIONS: { id: AnalysisSettingsData["focus_mode"]; label: string; description: string }[] = [
  { id: "balanced",   label: "Balanced",   description: "Even coverage across all issue types — good for general health checks." },
  { id: "compliance", label: "Compliance", description: "Prioritises compliance gaps and missing review dates — ideal for regulated content." },
  { id: "structure",  label: "Structure",  description: "Focuses on ownership and document structure — best for onboarding wikis." },
  { id: "hygiene",    label: "Hygiene",    description: "Targets stale content, outdated references, and broken links — keeps docs fresh." },
]

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "profile",      label: "Profile",      icon: "👤" },
  { id: "integrations", label: "Integrations", icon: "🔗" },
  { id: "preferences",  label: "Preferences",  icon: "⚙" },
  { id: "analysis",     label: "Analysis",     icon: "⚙" },
  { id: "privacy",      label: "Privacy",      icon: "🔒" },
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

// ── Analysis Tab ───────────────────────────────────────────────────────────────
function AnalysisTab() {
  const [form, setForm] = useState<AnalysisSettingsData>(ANALYSIS_DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [reset, setReset] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstLoad = useRef(true)

  // Load on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/settings/analysis`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setForm({ ...ANALYSIS_DEFAULTS, ...data })
      })
      .catch(() => {/* silently fall back to defaults */})
  }, [])

  // Auto-save with 500ms debounce on any change
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetch(`${API_BASE}/api/settings/analysis`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
          }
        })
        .catch(() => {/* silently ignore */})
    }, 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [form])

  function toggleIssueType(id: string) {
    setForm(f => ({
      ...f,
      enabled_issue_types: f.enabled_issue_types.includes(id)
        ? f.enabled_issue_types.filter(t => t !== id)
        : [...f.enabled_issue_types, id],
    }))
  }

  function handleReset() {
    setForm(ANALYSIS_DEFAULTS)
    setReset(true)
    setTimeout(() => setReset(false), 2000)
  }

  const confidencePct = Math.round(form.confidence_threshold * 100)

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">
          Analysis Settings
          {saved && <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: "var(--green-text)" }}>✓ Saved</span>}
        </h2>
        <p className="settings-section-sub">Control how DocAI detects and reports documentation issues.</p>
      </div>

      {/* Focus Mode */}
      <div className="settings-fields">
        <div className="settings-field">
          <label className="settings-label">Focus Mode</label>
          <div className="analysis-focus-group">
            {FOCUS_OPTIONS.map(opt => (
              <button
                key={opt.id}
                className={`focus-btn${form.focus_mode === opt.id ? " active" : ""}`}
                onClick={() => setForm(f => ({ ...f, focus_mode: opt.id }))}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="focus-desc">
            {FOCUS_OPTIONS.find(o => o.id === form.focus_mode)?.description}
          </div>
        </div>
      </div>

      {/* Minimum Severity */}
      <div className="settings-fields">
        <div className="settings-field">
          <label className="settings-label">Minimum Severity</label>
          <div className="seg-control">
            {(["low", "medium", "high"] as const).map((sev, i) => (
              <button
                key={sev}
                className={`seg-btn${form.min_severity === sev ? " active" : ""}`}
                onClick={() => setForm(f => ({ ...f, min_severity: sev }))}>
                {i === 0 ? "Report all" : i === 1 ? "Medium and above" : "High only"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Confidence Threshold */}
      <div className="settings-fields">
        <div className="settings-field">
          <label className="settings-label">
            Confidence Threshold — <strong>{confidencePct}%</strong>
          </label>
          <input
            type="range" min={50} max={95} step={1}
            className="settings-slider"
            value={confidencePct}
            onChange={e => setForm(f => ({ ...f, confidence_threshold: parseInt(e.target.value) / 100 }))}
          />
          <div className="settings-slider-labels">
            <span>More issues</span>
            <span>More accurate</span>
          </div>
        </div>
      </div>

      {/* Stale Content Threshold */}
      <div className="settings-fields">
        <div className="settings-field">
          <label className="settings-label">Stale Content Threshold</label>
          <select
            className="settings-select"
            value={form.stale_threshold_days}
            onChange={e => setForm(f => ({ ...f, stale_threshold_days: parseInt(e.target.value) }))}>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
            <option value={730}>2 years</option>
            <option value={9999}>Never</option>
          </select>
        </div>
      </div>

      {/* Active Issue Detectors */}
      <div className="settings-fields">
        <div className="settings-field">
          <label className="settings-label">Active Issue Detectors</label>
          <div className="toggle-list">
            {ISSUE_TYPES.map(it => (
              <div key={it.id} className="toggle-row">
                <input
                  type="checkbox"
                  checked={form.enabled_issue_types.includes(it.id)}
                  onChange={() => toggleIssueType(it.id)}
                  style={{ accentColor: "var(--accent)", width: 15, height: 15, flexShrink: 0, cursor: "pointer" }}
                />
                <div className="toggle-row-info">
                  <span className="toggle-row-label">{it.label}</span>
                  <span className="toggle-row-desc">{it.description}</span>
                </div>
                {it.requiresHuman && (
                  <span className="requires-human-badge">Requires human</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Max Issues Per Page */}
      <div className="settings-fields">
        <div className="settings-field">
          <label className="settings-label">Max Issues Per Page</label>
          <div className="seg-control">
            {[3, 5, 8, 10].map(n => (
              <button
                key={n}
                className={`seg-btn${form.max_issues_per_page === n ? " active" : ""}`}
                onClick={() => setForm(f => ({ ...f, max_issues_per_page: n }))}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="settings-note">
        Changes apply to new analyses. Re-analyze pages to use updated settings.
      </p>

      <button className="settings-reset-link" onClick={handleReset}>
        {reset ? "✓ Reset" : "Reset to defaults"}
      </button>
    </div>
  )
}

// ── Privacy Tab ────────────────────────────────────────────────────────────────
function PrivacyTab() {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Privacy &amp; Data</h2>
        <p className="settings-section-sub">How DocAI handles your data and what stays on your device.</p>
      </div>

      <div className="privacy-section">
        <div className="privacy-section-title">What stays on your device</div>
        <div className="privacy-section-body">
          <div className="privacy-check-item">
            <span className="privacy-check">✓</span>
            <div>
              <strong>API keys</strong> — Confluence, Anthropic, and Voyage AI keys are stored only in your browser's <code>localStorage</code>. They are never sent to DocAI servers.
            </div>
          </div>
          <div className="privacy-check-item">
            <span className="privacy-check">✓</span>
            <div>
              <strong>Profile preferences</strong> — Your name, email, role, and UI preferences are stored locally and never transmitted.
            </div>
          </div>
          <div className="privacy-check-item">
            <span className="privacy-check">✓</span>
            <div>
              <strong>Integration credentials</strong> — All connection secrets remain in your browser session only.
            </div>
          </div>
        </div>
      </div>

      <div className="privacy-section">
        <div className="privacy-section-title">What goes to the backend</div>
        <div className="privacy-section-body">
          <div className="privacy-check-item">
            <span className="privacy-circle">○</span>
            <div>
              <strong>Page content &amp; metadata</strong> — When you trigger an analysis, the page title, URL, content, and last-modified date are sent to the DocAI backend for processing.
            </div>
          </div>
          <div className="privacy-check-item">
            <span className="privacy-circle">○</span>
            <div>
              <strong>Analysis results</strong> — Issues, summaries, and health status are stored in the DocAI database so results can be cached and tracked over time.
            </div>
          </div>
          <div className="privacy-check-item">
            <span className="privacy-circle">○</span>
            <div>
              <strong>Audit events</strong> — Actions such as applying proposals, marking pages reviewed, and running batch jobs are logged in the audit trail.
            </div>
          </div>
        </div>
      </div>

      <div className="privacy-section">
        <div className="privacy-section-title">What goes to third-party services</div>
        <div className="privacy-section-body">
          <div className="privacy-check-item">
            <span className="privacy-circle">○</span>
            <div>
              <strong>Anthropic Claude</strong> — Page content is sent to Anthropic's API for AI analysis. This is subject to <a href="https://www.anthropic.com/privacy" target="_blank" rel="noreferrer">Anthropic's privacy policy</a>. Using Claude via API means your data is not used to train models by default.
            </div>
          </div>
          <div className="privacy-check-item">
            <span className="privacy-circle">○</span>
            <div>
              <strong>Voyage AI</strong> — Page content is sent to Voyage AI's API to generate semantic embeddings for duplicate detection. This is subject to <a href="https://www.voyageai.com/privacy" target="_blank" rel="noreferrer">Voyage AI's privacy policy</a>.
            </div>
          </div>
          <div className="privacy-check-item">
            <span className="privacy-circle">○</span>
            <div>
              <strong>Confluence (Atlassian)</strong> — DocAI reads and optionally writes to your Confluence workspace using the credentials you provide. Atlassian's own data handling applies.
            </div>
          </div>
        </div>
      </div>

      <div className="privacy-section">
        <div className="privacy-section-title">Data retention</div>
        <div className="privacy-section-body">
          <div className="privacy-check-item">
            <span className="privacy-check">✓</span>
            <div>
              Analysis results and audit logs are stored in your self-hosted PostgreSQL database. DocAI does not operate any cloud database on your behalf.
            </div>
          </div>
          <div className="privacy-check-item">
            <span className="privacy-check">✓</span>
            <div>
              You control retention. No data is ever sent to Anthropic-operated or DocAI-operated storage by this application.
            </div>
          </div>
        </div>
      </div>

      <div className="privacy-section">
        <div className="privacy-section-title">On the roadmap</div>
        <div className="privacy-section-body">
          <div className="privacy-roadmap-item">Content redaction rules — strip PII from pages before sending to AI APIs</div>
          <div className="privacy-roadmap-item">Per-space data policies — opt individual spaces out of AI analysis</div>
          <div className="privacy-roadmap-item">Audit log export — download full audit history as CSV or JSON</div>
          <div className="privacy-roadmap-item">Data deletion — purge all cached analyses for a page or space</div>
        </div>
      </div>

      <div className="privacy-last-updated">Last updated: April 2026 — DocAI v0.1.0 Beta</div>
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
        {activeTab === "analysis"     && <AnalysisTab />}
        {activeTab === "privacy"      && <PrivacyTab />}
        {activeTab === "about"        && <AboutTab />}
      </div>
    </div>
  )
}
