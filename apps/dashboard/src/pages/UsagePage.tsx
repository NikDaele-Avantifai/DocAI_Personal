import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton, SkeletonRow } from '../components/Skeleton'
import './UsagePage.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type Plan = 'trial' | 'starter' | 'growth' | 'scale' | 'expired'

interface UsageMetric {
  used: number
  limit: number | null
  percentage: number | null
}

interface UsageData {
  plan: Plan
  effective_plan: string
  period: string
  trial_ends_at: string | null
  is_trial_expired: boolean
  usage: {
    analyses: UsageMetric
    chat: UsageMetric
    rename: UsageMetric
    duplication_scans: UsageMetric
  }
  features: {
    compliance_tagging: boolean
    jira_integration: boolean
    dedicated_support: boolean
    sla: boolean
    max_spaces: number | null
    max_users: number | null
  }
}

interface UsageEvent {
  user_email: string
  action: string
  meta: string | null
  created_at: string
}

interface ByUser {
  user_email: string
  analyses: number
  chat: number
  rename: number
  duplication_scan: number
  sweep: number
}

interface EventsData {
  period: string
  events: UsageEvent[]
  by_user: ByUser[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPeriod(period: string): string {
  if (!period) return ''
  const [year, month] = period.split('-')
  if (!year || !month) return period
  const date = new Date(parseInt(year), parseInt(month) - 1, 1)
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function daysUntil(iso: string | null): number {
  if (!iso) return 0
  const diff = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

function barColor(percentage: number | null): string {
  if (percentage === null) return 'rgba(135, 186, 208, 0.30)'
  if (percentage >= 100) return 'var(--red-text)'
  if (percentage >= 80)  return 'var(--amber-text)'
  return '#87BAD0'
}

function barWidth(percentage: number | null): string {
  if (percentage === null) return '30%'
  return `${Math.min(100, percentage)}%`
}

function metricSub(metric: UsageMetric): { text: string; warn: boolean; danger: boolean } {
  if (metric.percentage === null) return { text: 'Unlimited on your plan', warn: false, danger: false }
  const remaining = (metric.limit ?? 0) - metric.used
  if (metric.percentage >= 100) return { text: 'Limit reached — upgrade to continue', warn: false, danger: true }
  if (metric.percentage >= 80)  return { text: `⚠ Running low — ${remaining} remaining`, warn: true, danger: false }
  return { text: `${remaining} remaining this month`, warn: false, danger: false }
}

function actionPillClass(action: string): string {
  switch (action) {
    case 'analysis':        return 'usage-action-pill usage-pill-analysis'
    case 'chat':            return 'usage-action-pill usage-pill-chat'
    case 'rename':          return 'usage-action-pill usage-pill-rename'
    case 'duplication_scan': return 'usage-action-pill usage-pill-duplication'
    case 'sweep':           return 'usage-action-pill usage-pill-sweep'
    default:                return 'usage-action-pill usage-pill-default'
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'analysis':        return 'Analysis'
    case 'chat':            return 'Chat'
    case 'rename':          return 'Rename'
    case 'duplication_scan': return 'Duplication'
    case 'sweep':           return 'Sweep'
    default:                return action
  }
}

function planBadgeClass(plan: Plan): string {
  return `usage-plan-badge usage-plan-badge-${plan}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function UsagePage() {
  const { isTokenReady } = useAuth()
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [events, setEvents] = useState<EventsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isTokenReady) return
    setLoading(true)
    setError(null)

    Promise.all([
      apiClient.get<UsageData>('/api/usage/'),
      apiClient.get<EventsData>('/api/usage/events'),
    ])
      .then(([usageRes, eventsRes]) => {
        setUsage(usageRes.data)
        setEvents(eventsRes.data)
      })
      .catch((err) => {
        if (err?.response?.status === 402) {
          setExpired(true)
        } else {
          setError(err?.response?.data?.detail ?? 'Failed to load usage data.')
        }
      })
      .finally(() => setLoading(false))
  }, [isTokenReady])

  // ── Expired full-page state ──
  if (expired) {
    return (
      <div className="usage-expired-wrap">
        <div className="usage-expired-card">
          <div className="usage-expired-icon">⚠</div>
          <div className="usage-expired-title">Your trial has ended</div>
          <div className="usage-expired-desc">
            Contact us to activate your plan and restore access.
          </div>
          <a
            className="usage-expired-btn"
            href="mailto:nikolaidaelemans@avantifai.com">
            Contact Avantifai →
          </a>
        </div>
      </div>
    )
  }

  // ── Error state ──
  if (!loading && error) {
    return (
      <div className="usage-page">
        <div className="usage-empty-state">
          <div className="usage-empty-icon">⚠</div>
          <div className="usage-empty-title">Could not load usage data</div>
          <div className="usage-empty-desc">{error}</div>
        </div>
      </div>
    )
  }

  // ── Loading state ──
  if (loading || !usage) {
    return (
      <div className="usage-page">
        <div className="usage-header">
          <div className="usage-header-left">
            <Skeleton width={180} height={22} borderRadius={4} />
            <Skeleton width={100} height={12} borderRadius={4} style={{ marginTop: 4 }} />
          </div>
          <Skeleton width={80} height={24} borderRadius={99} />
        </div>

        <div className="usage-skeleton-metrics">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="usage-skeleton-metric">
              <Skeleton height={11} width="50%" />
              <Skeleton height={30} width="60%" />
              <Skeleton height={3} width="100%" borderRadius={99} />
              <Skeleton height={11} width="70%" />
            </div>
          ))}
        </div>

        <div className="usage-grid">
          <div className="usage-card">
            <div className="usage-card-head">
              <Skeleton height={14} width={160} />
              <Skeleton height={20} width={40} borderRadius={10} />
            </div>
            {[0, 1, 2, 3, 4].map(i => <SkeletonRow key={i} />)}
          </div>
          <div className="usage-card">
            <div className="usage-card-head">
              <Skeleton height={14} width={100} />
              <Skeleton height={20} width={60} borderRadius={10} />
            </div>
            {[0, 1, 2, 3].map(i => <SkeletonRow key={i} />)}
          </div>
        </div>
      </div>
    )
  }

  const plan = usage.plan
  const daysLeft = daysUntil(usage.trial_ends_at)

  const METERS: { key: keyof typeof usage.usage; label: string }[] = [
    { key: 'analyses',         label: 'Page Analyses' },
    { key: 'chat',             label: 'Chat Messages' },
    { key: 'rename',           label: 'Batch Renames' },
    { key: 'duplication_scans', label: 'Duplication Scans' },
  ]

  const features = usage.features
  const featureList = [
    { label: 'Compliance Tagging', enabled: features.compliance_tagging },
    { label: 'Jira Integration',   enabled: features.jira_integration },
    { label: 'Dedicated Support',  enabled: features.dedicated_support },
    { label: 'SLA Guarantee',      enabled: features.sla },
    {
      label: features.max_spaces ? `Max ${features.max_spaces} spaces` : 'Unlimited spaces',
      enabled: true,
    },
    {
      label: features.max_users ? `Max ${features.max_users} users` : 'Unlimited users',
      enabled: true,
    },
  ]

  return (
    <div className="usage-page">

      {/* ── Header ── */}
      <div className="usage-header">
        <div className="usage-header-left">
          <div className="usage-title">Usage &amp; Quota</div>
          <div className="usage-subtitle">{formatPeriod(usage.period)}</div>
        </div>
        <div className={planBadgeClass(plan)}>
          {plan.charAt(0).toUpperCase() + plan.slice(1)}
        </div>
      </div>

      {/* ── Trial / expired banner ── */}
      {plan === 'trial' && (
        usage.is_trial_expired ? (
          <div className="usage-banner usage-banner-expired">
            <div className="usage-banner-left">
              <div className="usage-banner-msg">⚠ Trial expired — your workspace is paused.</div>
              <div className="usage-banner-sub">Activate a plan to restore access.</div>
            </div>
            <a
              className="usage-banner-btn"
              href="mailto:nikolaidaelemans@avantifai.com">
              Activate Plan →
            </a>
          </div>
        ) : (
          <div className="usage-banner usage-banner-trial">
            <div className="usage-banner-left">
              <div className="usage-banner-msg">
                ⏳ <strong>Trial active</strong> · {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
              </div>
              <div className="usage-banner-sub">Upgrade to keep access after your trial ends.</div>
            </div>
            <a
              className="usage-banner-btn"
              href="mailto:nikolaidaelemans@avantifai.com">
              Contact Sales
            </a>
          </div>
        )
      )}

      {/* ── Usage meters ── */}
      <div className="usage-metrics">
        {METERS.map(({ key, label }) => {
          const m = usage.usage[key]
          const sub = metricSub(m)
          return (
            <div key={key} className="usage-metric">
              <div className="usage-metric-label">{label}</div>
              <div className="usage-metric-value-row">
                <span className="usage-metric-value">{m.used}</span>
                {m.limit === null ? (
                  <span className="usage-metric-infinity">∞</span>
                ) : (
                  <span className="usage-metric-denom">/{m.limit}</span>
                )}
              </div>
              <div className="usage-metric-bar">
                <div
                  className="usage-metric-bar-fill"
                  style={{
                    width: barWidth(m.percentage),
                    background: barColor(m.percentage),
                  }}
                />
              </div>
              <div
                className="usage-metric-sub"
                style={sub.danger ? { color: 'var(--red-text)' } : sub.warn ? { color: 'var(--amber-text)' } : undefined}>
                {sub.text}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Two-column grid ── */}
      <div className="usage-grid">

        {/* ── Activity card ── */}
        <div className="usage-card">
          <div className="usage-card-head">
            <div className="usage-card-title">Activity This Month</div>
            <div className="usage-card-badge">
              {events?.events.length ?? 0} events
            </div>
          </div>

          {!events || events.events.length === 0 ? (
            <div className="usage-empty-state">
              <div className="usage-empty-icon">📊</div>
              <div className="usage-empty-title">No activity yet</div>
              <div className="usage-empty-desc">
                Actions will appear here as your team uses DocAI.
              </div>
            </div>
          ) : (
            <table className="usage-activity-table">
              <thead className="usage-activity-thead">
                <tr>
                  <th>Action</th>
                  <th>Page / Context</th>
                  <th>User</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {events.events.map((ev, i) => (
                  <tr key={i} className="usage-activity-row">
                    <td>
                      <span className={actionPillClass(ev.action)}>
                        {actionLabel(ev.action)}
                      </span>
                    </td>
                    <td>
                      <span className="usage-activity-meta" title={ev.meta ?? ''}>
                        {ev.meta ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className="usage-activity-user" title={ev.user_email}>
                        {ev.user_email}
                      </span>
                    </td>
                    <td>
                      <span className="usage-activity-time">
                        {relativeTime(ev.created_at)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Team usage card ── */}
        <div className="usage-card">
          <div className="usage-card-head">
            <div className="usage-card-title">Team Usage</div>
            <div className="usage-card-badge">{formatPeriod(usage.period)}</div>
          </div>

          {!events || events.by_user.length === 0 ? (
            <div className="usage-empty-state">
              <div className="usage-empty-icon">📊</div>
              <div className="usage-empty-title">No activity yet</div>
              <div className="usage-empty-desc">
                Actions will appear here as your team uses DocAI.
              </div>
            </div>
          ) : (
            <div className="usage-team-list">
              {events.by_user.map((u, i) => {
                const stats: string[] = []
                if (u.analyses > 0)         stats.push(`${u.analyses} analyses`)
                if (u.chat > 0)             stats.push(`${u.chat} chats`)
                if (u.rename > 0)           stats.push(`${u.rename} renames`)
                if (u.duplication_scan > 0) stats.push(`${u.duplication_scan} duplications`)
                if (u.sweep > 0)            stats.push(`${u.sweep} sweeps`)

                return (
                  <div key={i} className="usage-team-row">
                    <span className="usage-team-email" title={u.user_email}>
                      {u.user_email}
                    </span>
                    <div className="usage-team-stats">
                      {stats.map((s, j) => (
                        <span key={j} className="usage-team-stat">{s}</span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Plan features ── */}
          <div className="usage-features">
            <div className="usage-features-label">Plan features</div>
            <div className="usage-features-grid">
              {featureList.map((f, i) => (
                <div key={i} className="usage-feature-item">
                  {f.enabled
                    ? <span className="usage-feature-check">✓</span>
                    : <span className="usage-feature-cross">✗</span>}
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
