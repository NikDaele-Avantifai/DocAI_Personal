import { useState, useEffect, useRef } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import * as Sentry from "@sentry/react"
import "./SettingsPage.css"
import { apiClient, API_BASE } from '@/lib/api'
import { useWorkspace } from '@/contexts/WorkspaceContext'

type Tab = "overview" | "profile" | "integrations" | "preferences" | "analysis" | "privacy" | "about"

interface Profile {
  name: string
  email: string
  role: string
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

const OVERVIEW_ITEMS: { tab: Exclude<Tab, "overview">; label: string; description: string; icon: string }[] = [
  { tab: "profile",      label: "Profile",      description: "Your name, email, and role within DocAI.",                          icon: "◉" },
  { tab: "integrations", label: "Integrations", description: "Connect DocAI to your Atlassian Confluence workspace.",             icon: "⌁" },
  { tab: "preferences",  label: "Preferences",  description: "Similarity thresholds, sync frequency, and notifications.",        icon: "◎" },
  { tab: "analysis",     label: "Analysis",     description: "Issue detectors, confidence threshold, and focus mode.",           icon: "◈" },
  { tab: "privacy",      label: "Privacy",      description: "How DocAI handles your data and what stays on your device.",       icon: "⛨" },
  { tab: "about",        label: "About",        description: "Version info, API health status, and tech stack.",                 icon: "ℹ" },
]

function OverviewTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  return (
    <div className="settings-section" style={{ maxWidth: 700 }}>
      <div className="settings-section-header">
        <h2 className="settings-section-title">Settings</h2>
        <p className="settings-section-sub">Manage your workspace, integrations, and preferences.</p>
      </div>
      <div className="settings-overview-grid">
        {OVERVIEW_ITEMS.map(item => (
          <button
            key={item.tab}
            className="settings-overview-card"
            onClick={() => onNavigate(item.tab)}>
            <span className="settings-overview-icon">{item.icon}</span>
            <div className="settings-overview-card-body">
              <div className="settings-overview-card-label">{item.label}</div>
              <div className="settings-overview-card-desc">{item.description}</div>
            </div>
            <span className="settings-overview-arrow">›</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function loadProfile(): Profile {
  try { return { name: "User", email: "", role: "Admin", ...JSON.parse(localStorage.getItem("docai_profile") || "{}") } }
  catch { return { name: "User", email: "", role: "Admin" } }
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
  const { workspace, refetch } = useWorkspace()
  const [confForm, setConfForm] = useState({ base_url: "", email: "", api_token: "" })
  const [showToken, setShowToken] = useState(false)
  const [confSaving, setConfSaving] = useState(false)
  const [confSaved, setConfSaved] = useState(false)
  const [confError, setConfError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle")

  // Pre-populate form whenever workspace data is available or changes
  useEffect(() => {
    if (workspace) {
      setConfForm(f => ({
        ...f,
        base_url: workspace.confluence_base_url ?? "",
        email:    workspace.confluence_email    ?? "",
        // api_token always starts empty — never returned from API
        api_token: "",
      }))
    }
  }, [workspace?.id, workspace?.confluence_base_url, workspace?.confluence_email])

  const isConnected = workspace?.confluence_connected ?? false

  async function saveConfluence() {
    setConfSaving(true)
    setConfError(null)
    try {
      const payload: Record<string, string> = {
        base_url: confForm.base_url,
        email:    confForm.email,
      }
      // Only send api_token if user typed something new
      if (confForm.api_token.trim()) {
        payload.api_token = confForm.api_token
      }
      await apiClient.patch("/api/workspace/confluence", payload)
      await refetch()
      setConfSaved(true)
      // Clear token field after save — it is never returned by the API
      setConfForm(f => ({ ...f, api_token: "" }))
      setTimeout(() => setConfSaved(false), 2500)
    } catch (err: any) {
      setConfError(err?.response?.data?.detail ?? "Save failed")
    } finally {
      setConfSaving(false)
    }
  }

  async function testConfluence() {
    setTestStatus("testing")
    try {
      await apiClient.get("/api/sync/spaces")
      setTestStatus("ok")
    } catch {
      setTestStatus("error")
    }
  }

  function TestBadge() {
    if (testStatus === "testing") return <span className="conn-testing">⟳ Testing…</span>
    if (testStatus === "ok")      return <span className="conn-ok">✓ Connected</span>
    if (testStatus === "error")   return <span className="conn-error">✕ Failed</span>
    return null
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Integrations</h2>
        <p className="settings-section-sub">Connect DocAI to your Confluence workspace.</p>
      </div>

      <div className="settings-integration-block">
        <div className="settings-integration-header">
          <div className="settings-integration-icon">C</div>
          <div>
            <div className="settings-integration-name">Confluence</div>
            <div className="settings-integration-sub">Connect to your Atlassian Confluence workspace</div>
          </div>
          {isConnected
            ? <span className="conn-ok">✓ Connected</span>
            : <span className="conn-error">Not connected</span>}
        </div>

        <div className="settings-fields">
          <div className="settings-field">
            <label className="settings-label">Base URL</label>
            <input
              className="settings-input"
              value={confForm.base_url}
              onChange={e => setConfForm(f => ({ ...f, base_url: e.target.value }))}
              placeholder="https://yourorg.atlassian.net"
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">Email</label>
            <input
              className="settings-input"
              type="email"
              value={confForm.email}
              onChange={e => setConfForm(f => ({ ...f, email: e.target.value }))}
              placeholder="you@company.com"
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">
              API Token{isConnected ? " — leave blank to keep existing token" : ""}
            </label>
            <div className="settings-input-wrap">
              <input
                className="settings-input"
                type={showToken ? "text" : "password"}
                value={confForm.api_token}
                onChange={e => setConfForm(f => ({ ...f, api_token: e.target.value }))}
                placeholder={isConnected ? "••••••••••••• (saved)" : "ATATT3x…"}
              />
              <button
                className="settings-toggle-btn"
                onClick={() => setShowToken(v => !v)}>
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </div>

        {confError && <div className="settings-error-msg">{confError}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button
            className="settings-save-btn"
            style={{ marginTop: 0 }}
            onClick={saveConfluence}
            disabled={confSaving}>
            {confSaving ? "Saving…" : confSaved ? "✓ Confluence connection saved" : isConnected ? "Update connection" : "Save & Connect"}
          </button>
          <button
            className="settings-test-btn"
            onClick={testConfluence}
            disabled={testStatus === "testing" || !isConnected}>
            Test Connection
          </button>
          <TestBadge />
        </div>
      </div>
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
    apiClient.get('/api/settings/analysis')
      .then(r => r.data)
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
      apiClient.put('/api/settings/analysis', form)
        .then(r => r.data)
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
          <div data-tour="focus-mode" className="analysis-focus-group">
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
        <div className="settings-about-row">
          <span className="settings-about-label">Error Monitoring</span>
          <span className="settings-about-value">Sentry</span>
        </div>
      </div>

      <DiagnosticsSection />
    </div>
  )
}

function DiagnosticsSection() {
  const [triggered, setTriggered] = useState(false)

  function handleTest() {
    setTriggered(true)
    Sentry.captureException(new Error("Sentry test error from DocAI About page"))
    setTimeout(() => setTriggered(false), 3000)
  }

  return (
    <div className="settings-fields" style={{ marginTop: 4 }}>
      <div className="settings-subsection-title">Diagnostics</div>
      <div className="settings-field">
        <label className="settings-label">Error reporting</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="settings-test-btn" onClick={handleTest}>
            {triggered ? "✓ Test event sent" : "Send test error"}
          </button>
          <span className="settings-slider-hint">
            Sends a test event to Sentry to verify error reporting is working.
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const isOnboarding = (location.state as any)?.onboarding === true

  // When redirected from onboarding, land on the integrations tab
  const activeTab: Tab = (tab as Tab) ?? (isOnboarding ? "integrations" : "overview")

  function setTab(t: Tab) {
    navigate(t === "overview" ? "/settings" : `/settings/${t}`, { replace: true })
  }

  return (
    <div className="settings-layout">
      {isOnboarding && (
        <div className="settings-onboarding-banner">
          <strong>Connect Confluence to get started.</strong>
          {" "}Enter your Atlassian base URL, email, and API token below, then click Save.
        </div>
      )}

      <div className="settings-content">
        {activeTab === "overview"     && <OverviewTab onNavigate={setTab} />}
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
