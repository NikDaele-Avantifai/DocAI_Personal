import { useState, useEffect, useRef } from "react"
import { apiClient } from "@/lib/api"
import { AdminOnly } from "@/components/AdminOnly"
import "./PrivacyPage.css"

// ── TOC definition ────────────────────────────────────────────────────────────

const TOC = [
  { id: "s1",  label: "Who we are" },
  { id: "s2",  label: "What data we collect" },
  { id: "s3",  label: "How we use your data" },
  { id: "s4",  label: "Legal basis for processing" },
  { id: "s5",  label: "Data storage and security" },
  { id: "s6",  label: "Sub-processors" },
  { id: "s7",  label: "Data retention" },
  { id: "s8",  label: "Your rights under GDPR" },
  { id: "s9",  label: "Cookies" },
  { id: "s10", label: "Changes to this policy" },
  { id: "s11", label: "Contact us" },
]

// ── Sticky TOC with IntersectionObserver ─────────────────────────────────────

function TableOfContents() {
  const [active, setActive] = useState("s1")

  useEffect(() => {
    const observers: IntersectionObserver[] = []
    TOC.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (!el) return
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActive(id) },
        { rootMargin: "-20% 0px -70% 0px" }
      )
      obs.observe(el)
      observers.push(obs)
    })
    return () => observers.forEach(o => o.disconnect())
  }, [])

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <nav className="pp-toc" aria-label="Page sections">
      <div className="pp-toc-label">Contents</div>
      {TOC.map(({ id, label }, i) => (
        <button
          key={id}
          className={`pp-toc-item${active === id ? " active" : ""}`}
          onClick={() => scrollTo(id)}>
          <span className="pp-toc-num">{i + 1}</span>
          {label}
        </button>
      ))}
    </nav>
  )
}

// ── Data export (used in Section 8) ──────────────────────────────────────────

function ExportButton() {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setExporting(true)
    setError(null)
    try {
      const data = await apiClient.get("/api/workspace/export").then(r => r.data)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `docai-export-${new Date().toISOString().split("T")[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed.")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="pp-export-wrap">
      <AdminOnly fallback={
        <p className="pp-export-note">Admin access required to export workspace data.</p>
      }>
        <button className="pp-export-btn" onClick={handleExport} disabled={exporting}>
          {exporting ? "Preparing export…" : "Export workspace data →"}
        </button>
        {error && <p className="pp-export-error">{error}</p>}
      </AdminOnly>
    </div>
  )
}

// ── Reusable section wrapper ──────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="pp-section">
      <h2 className="pp-section-title">{title}</h2>
      {children}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PrivacyPage() {
  return (
    <div className="pp-root">
      {/* Header */}
      <div className="pp-header">
        <div className="pp-header-meta">
          <span className="pp-updated-badge">Last updated: May 2026</span>
        </div>
        <h1 className="pp-title">Privacy &amp; Data</h1>
        <p className="pp-subtitle">How Avantifai collects, uses, and protects your data</p>
        <p className="pp-intro">
          DocAI is a documentation intelligence platform built for enterprise teams.
          We are committed to protecting the personal data of our users and processing
          it in compliance with the General Data Protection Regulation (GDPR).
        </p>
      </div>

      {/* Two-column layout */}
      <div className="pp-layout">
        <TableOfContents />

        <div className="pp-content">

          {/* 1 — Who we are */}
          <Section id="s1" title="1. Who we are">
            <p className="pp-body">
              Avantifai is a Belgian software company building AI-powered documentation tools
              for enterprise teams. Our flagship product, DocAI, connects to your Confluence
              workspace to analyze documentation health and propose improvements.
            </p>
            <div className="pp-info-block">
              <div className="pp-info-row"><span className="pp-info-key">Trading name</span><span className="pp-info-val">Avantifai</span></div>
              <div className="pp-info-row"><span className="pp-info-key">Privacy contact</span><span className="pp-info-val"><a href="mailto:privacy@avantifai.com">privacy@avantifai.com</a></span></div>
              <div className="pp-info-row"><span className="pp-info-key">Jurisdiction</span><span className="pp-info-val">Belgium, European Union</span></div>
            </div>
          </Section>

          {/* 2 — What data we collect */}
          <Section id="s2" title="2. What data we collect">
            <p className="pp-body">
              We collect the minimum data necessary to deliver the DocAI service.
            </p>
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Data type</th>
                    <th>Source</th>
                    <th>Purpose</th>
                    <th>Stored</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Account information", "Auth0 login", "User authentication", "Yes — Auth0"],
                    ["Email address", "Login provider", "Account identification", "Yes"],
                    ["Confluence page titles", "Confluence API", "Documentation analysis", "Yes — EU servers"],
                    ["Confluence page content", "Confluence API", "AI analysis only", "Temporarily — not persisted after analysis"],
                    ["Confluence metadata", "Confluence API", "Health scoring", "Yes — EU servers"],
                    ["Usage data", "Product activity", "Service improvement, billing", "Yes"],
                    ["IP address", "Request logs", "Security, rate limiting", "Yes — 30 days"],
                    ["Error logs", "Application", "Debugging", "Yes — Sentry, 90 days"],
                  ].map(([type, source, purpose, stored], i) => (
                    <tr key={i}>
                      <td><strong>{type}</strong></td>
                      <td>{source}</td>
                      <td>{purpose}</td>
                      <td>{stored}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pp-note">
              We never collect passwords, payment card data, or the contents of emails.
              Confluence API tokens are stored encrypted at rest and never transmitted
              in plain text after initial setup.
            </p>
          </Section>

          {/* 3 — How we use your data */}
          <Section id="s3" title="3. How we use your data">
            <div className="pp-subsections">
              <div className="pp-subsection">
                <h3 className="pp-subsection-title">3.1 Providing the service</h3>
                <p className="pp-body">
                  We use your Confluence workspace data to analyze documentation quality,
                  generate health scores, and propose improvements. Page content is sent to
                  our AI provider (Anthropic) for analysis and is not stored on Anthropic's
                  infrastructure after processing.
                </p>
              </div>
              <div className="pp-subsection">
                <h3 className="pp-subsection-title">3.2 Improving the product</h3>
                <p className="pp-body">
                  We use aggregated, anonymized usage data to understand how teams use DocAI
                  and improve the product. We do not sell or share individual usage data
                  with third parties.
                </p>
              </div>
              <div className="pp-subsection">
                <h3 className="pp-subsection-title">3.3 Security and fraud prevention</h3>
                <p className="pp-body">
                  We process IP addresses and usage patterns to detect and prevent abuse,
                  unauthorized access, and security threats.
                </p>
              </div>
              <div className="pp-subsection">
                <h3 className="pp-subsection-title">3.4 Communications</h3>
                <p className="pp-body">
                  We may send transactional emails (login links, workspace notifications)
                  using your email address. We do not send marketing emails without
                  explicit consent.
                </p>
              </div>
            </div>
          </Section>

          {/* 4 — Legal basis */}
          <Section id="s4" title="4. Legal basis for processing">
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Processing activity</th>
                    <th>Legal basis</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Account creation and authentication", "Contract performance (Art. 6(1)(b))"],
                    ["Confluence data analysis", "Contract performance (Art. 6(1)(b))"],
                    ["Security monitoring", "Legitimate interests (Art. 6(1)(f))"],
                    ["Usage analytics", "Legitimate interests (Art. 6(1)(f))"],
                    ["Error logging", "Legitimate interests (Art. 6(1)(f))"],
                    ["Transactional emails", "Contract performance (Art. 6(1)(b))"],
                  ].map(([activity, basis], i) => (
                    <tr key={i}>
                      <td>{activity}</td>
                      <td><span className="pp-legal-basis">{basis}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 5 — Storage and security */}
          <Section id="s5" title="5. Data storage and security">
            <h3 className="pp-subsection-title">Infrastructure</h3>
            <p className="pp-body">
              All customer data is stored on servers located in the European Union (Western Europe —
              Rotterdam and Frankfurt). We do not transfer personal data outside the EU/EEA except
              where strictly necessary for service operation, and only with appropriate safeguards
              in place (Standard Contractual Clauses where applicable).
            </p>
            <h3 className="pp-subsection-title" style={{ marginTop: "20px" }}>Security measures</h3>
            <ul className="pp-list">
              <li>All data is encrypted in transit (TLS 1.2+)</li>
              <li>Database encrypted at rest</li>
              <li>API credentials stored with AES-256 encryption</li>
              <li>Access controls and role-based permissions</li>
              <li>Security monitoring via Sentry</li>
              <li>Regular dependency security audits</li>
            </ul>
          </Section>

          {/* 6 — Sub-processors */}
          <Section id="s6" title="6. Sub-processors">
            <p className="pp-body">
              We use the following third-party sub-processors to deliver the DocAI service.
              All sub-processors located outside the EU/EEA operate under Standard Contractual
              Clauses.
            </p>
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Sub-processor</th>
                    <th>Purpose</th>
                    <th>Location</th>
                    <th>Privacy policy</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Auth0 (Okta)", "User authentication", "USA (SCCs apply)", "auth0.com/privacy"],
                    ["Railway", "Backend infrastructure & database", "EU West", "railway.app/legal/privacy"],
                    ["Vercel", "Frontend hosting", "USA (SCCs apply)", "vercel.com/legal/privacy-policy"],
                    ["Anthropic", "AI analysis of page content", "USA (SCCs apply)", "anthropic.com/privacy"],
                    ["Voyage AI", "Text embeddings", "USA (SCCs apply)", "voyageai.com/privacy"],
                    ["Sentry", "Error monitoring", "USA (SCCs apply)", "sentry.io/privacy"],
                    ["Atlassian", "Confluence API integration", "USA (SCCs apply)", "atlassian.com/legal/privacy-policy"],
                  ].map(([name, purpose, location, policy], i) => (
                    <tr key={i}>
                      <td><strong>{name}</strong></td>
                      <td>{purpose}</td>
                      <td>
                        <span className={location.includes("EU") ? "pp-loc-eu" : "pp-loc-intl"}>
                          {location}
                        </span>
                      </td>
                      <td><a href={`https://${policy}`} target="_blank" rel="noopener noreferrer" className="pp-link">{policy}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pp-note">
              SCCs = Standard Contractual Clauses, the EU-approved mechanism for lawful data
              transfers to third countries.
            </p>
          </Section>

          {/* 7 — Retention */}
          <Section id="s7" title="7. Data retention">
            <p className="pp-body">
              We retain your data for as long as your workspace is active, plus a period of
              2 years after account closure to comply with legal obligations and resolve any
              disputes.
            </p>
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Data type</th>
                    <th>Retention period</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Account data", "Duration of contract + 2 years"],
                    ["Confluence page metadata", "Duration of contract + 2 years"],
                    ["Usage logs", "2 years"],
                    ["Error logs", "90 days"],
                    ["IP address logs", "30 days"],
                    ["Backup data", "30 days after deletion request"],
                  ].map(([type, period], i) => (
                    <tr key={i}>
                      <td>{type}</td>
                      <td>{period}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 8 — Rights */}
          <Section id="s8" title="8. Your rights under GDPR">
            <div className="pp-rights-grid">
              {[
                {
                  title: "Right of Access",
                  article: "Art. 15",
                  body: "You can request a copy of all personal data we hold about you. We will respond within 30 days.",
                  action: null,
                },
                {
                  title: "Right to Rectification",
                  article: "Art. 16",
                  body: "You can request correction of inaccurate personal data. Update your profile in Settings or contact us.",
                  action: null,
                },
                {
                  title: "Right to Erasure",
                  article: "Art. 17",
                  body: "You can request deletion of your personal data. Contact privacy@avantifai.com and we will process your request within 30 days.",
                  action: null,
                },
                {
                  title: "Right to Portability",
                  article: "Art. 20",
                  body: "You can request your data in a machine-readable format. Use the export function below or contact us.",
                  action: "export",
                },
                {
                  title: "Right to Object",
                  article: "Art. 21",
                  body: "You can object to processing based on legitimate interests. Contact us to discuss your specific situation.",
                  action: null,
                },
                {
                  title: "Right to Restrict Processing",
                  article: "Art. 18",
                  body: "You can request restriction of processing in certain circumstances. Contact privacy@avantifai.com.",
                  action: null,
                },
              ].map(({ title, article, body, action }) => (
                <div key={title} className="pp-right-card">
                  <div className="pp-right-card-header">
                    <span className="pp-right-title">{title}</span>
                    <span className="pp-right-article">{article}</span>
                  </div>
                  <p className="pp-right-body">{body}</p>
                  {action === "export" && <ExportButton />}
                </div>
              ))}
            </div>
            <div className="pp-rights-footer">
              <p className="pp-body">
                To exercise any of these rights, contact us at{" "}
                <a href="mailto:privacy@avantifai.com" className="pp-link">privacy@avantifai.com</a>.
                We will respond within 30 days. You also have the right to lodge a complaint
                with the Belgian Data Protection Authority (GBA/APD) at{" "}
                <a href="https://www.gegevensbeschermingsautoriteit.be" target="_blank" rel="noopener noreferrer" className="pp-link">
                  gegevensbeschermingsautoriteit.be
                </a>.
              </p>
            </div>
          </Section>

          {/* 9 — Cookies */}
          <Section id="s9" title="9. Cookies">
            <p className="pp-body">DocAI uses minimal cookies necessary to provide the service.</p>
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Cookie</th>
                    <th>Purpose</th>
                    <th>Duration</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>auth_session</code></td>
                    <td>Keeps you logged in</td>
                    <td>Session</td>
                    <td><span className="pp-cookie-type necessary">Strictly necessary</span></td>
                  </tr>
                  <tr>
                    <td><code>docai_preferences</code></td>
                    <td>Saves your UI preferences</td>
                    <td>1 year</td>
                    <td><span className="pp-cookie-type functional">Functional</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="pp-note">
              We do not use advertising cookies or third-party tracking cookies.
            </p>
          </Section>

          {/* 10 — Changes */}
          <Section id="s10" title="10. Changes to this policy">
            <p className="pp-body">
              We may update this policy as our service evolves. We will notify workspace
              administrators by email of any material changes at least 30 days before they
              take effect. The "last updated" date at the top of this page reflects the most
              recent revision.
            </p>
          </Section>

          {/* 11 — Contact */}
          <Section id="s11" title="11. Contact us">
            <p className="pp-body">
              For any privacy-related questions, requests, or concerns:
            </p>
            <div className="pp-info-block">
              <div className="pp-info-row"><span className="pp-info-key">Email</span><span className="pp-info-val"><a href="mailto:privacy@avantifai.com" className="pp-link">privacy@avantifai.com</a></span></div>
              <div className="pp-info-row"><span className="pp-info-key">Response time</span><span className="pp-info-val">Within 30 days (GDPR requirement)</span></div>
              <div className="pp-info-row"><span className="pp-info-key">Company</span><span className="pp-info-val">Avantifai, Belgium, European Union</span></div>
              <div className="pp-info-row"><span className="pp-info-key">Security concerns</span><span className="pp-info-val"><a href="mailto:privacy@avantifai.com" className="pp-link">privacy@avantifai.com</a></span></div>
            </div>
          </Section>

        </div>
      </div>
    </div>
  )
}
