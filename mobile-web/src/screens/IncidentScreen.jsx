import { useState, useEffect, useCallback, useRef } from 'react'
import './IncidentScreen.css'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

/** Metadata for each incident type — drives icons, labels, colours. */
const TYPE_META = {
  accident:            { icon: '💥', label: 'Accident',          color: '#ef4444', urgency: 'critical' },
  wrong_way_driver:    { icon: '🚨', label: 'Wrong-Way Driver',  color: '#f97316', urgency: 'critical' },
  red_light_violation: { icon: '🔴', label: 'Red Light',         color: '#eab308', urgency: 'medium'   },
  pothole:             { icon: '🕳️', label: 'Pothole',           color: '#22c55e', urgency: 'low'      },
}

/** How long ago a unix-seconds timestamp was. */
function timeAgo(ts) {
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 5)    return 'just now'
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

/** Merge live WS incidents (pushed by App) with API-polled incidents, dedup by id. */
function mergeIncidents(live, polled) {
  const seen  = new Set()
  const merged = []
  for (const inc of [...live, ...polled]) {
    const key = inc.incident_id || inc.id || JSON.stringify(inc)
    if (!seen.has(key)) { seen.add(key); merged.push(inc) }
  }
  return merged.sort((a, b) => (b.detected_at || 0) - (a.detected_at || 0))
}

/**
 * Group an incident list by incident type.
 * Returns [{ type, meta, items }] sorted critical-first.
 */
function groupByType(incidents) {
  const map = {}
  for (const inc of incidents) {
    const t = inc.incident_type || inc.type || 'unknown'
    if (!map[t]) map[t] = []
    map[t].push(inc)
  }
  const urgencyOrder = { critical: 0, medium: 1, low: 2 }
  return Object.entries(map)
    .map(([type, items]) => ({ type, meta: TYPE_META[type] || { icon: '⚠️', label: type, color: '#94a3b8', urgency: 'low' }, items }))
    .sort((a, b) => (urgencyOrder[a.meta.urgency] ?? 3) - (urgencyOrder[b.meta.urgency] ?? 3))
}

// ── Incident card ──────────────────────────────────────────────────────────────

function IncidentCard({ incident, meta, onAction }) {
  const [actioning, setActioning] = useState(false)

  const handleAction = async (action) => {
    setActioning(true)
    await onAction(incident, action)
    setActioning(false)
  }

  const id      = incident.incident_id || incident.id
  const reason  = incident.reason  || '—'
  const conf    = incident.confidence != null ? `${Math.round(incident.confidence * 100)}%` : null
  const status  = incident.status || 'open'
  const hasClip = !!(incident.clip_url)
  const ts      = incident.detected_at

  return (
    <div className="incident-card" style={{ '--inc-color': meta.color }}>
      <div className="incident-icon">{meta.icon}</div>
      <div className="incident-body">
        <div className="incident-top">
          <span className="incident-type">{meta.label}</span>
          <div className="incident-top-right">
            {ts && <span className="incident-time">{timeAgo(ts)}</span>}
            <span className={`status-pill status-${status}`}>{status}</span>
          </div>
        </div>

        <p className="incident-reason">{reason}</p>

        <div className="incident-meta">
          {conf && (
            <span className="confidence-pill">{conf} confidence</span>
          )}
          {hasClip && (
            <a href={incident.clip_url} target="_blank" rel="noreferrer" className="clip-link">
              ▶ View clip
            </a>
          )}
        </div>

        {/* Action buttons — only for open/escalated incidents */}
        {(status === 'open' || status === 'escalated') && (
          <div className="incident-actions">
            {status === 'open' && (
              <button
                className="action-btn escalate"
                disabled={actioning}
                onClick={() => handleAction('escalate')}
              >
                🔺 Escalate
              </button>
            )}
            <button
              className="action-btn dismiss"
              disabled={actioning}
              onClick={() => handleAction('dismiss')}
            >
              ✕ Dismiss
            </button>
            {status === 'escalated' && (
              <button
                className="action-btn resolve"
                disabled={actioning}
                onClick={() => handleAction('resolve')}
              >
                ✔ Resolve
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main screen ────────────────────────────────────────────────────────────────

/**
 * IncidentScreen
 *
 * Receives `liveIncidents` pushed via WebSocket by App.jsx (immediate),
 * and independently polls GET /incidents for the full list every 10s
 * (async background refresh). Both are merged, deduped, and grouped
 * by incident type.
 *
 * @param {{ liveIncidents: object[], sessionId: string|null }} props
 */
export default function IncidentScreen({ liveIncidents = [], sessionId }) {
  const [polled,       setPolled]       = useState([])
  const [loading,      setLoading]      = useState(false)
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [filterType,   setFilterType]   = useState('all')
  const [expandedType, setExpandedType] = useState(null)
  const pollRef = useRef(null)

  // ── Polling ─────────────────────────────────────────────────────────────────

  const fetchIncidents = useCallback(async () => {
    setLoading(true)
    try {
      const params = sessionId ? `?session_id=${sessionId}&limit=100` : '?limit=100'
      const res = await fetch(`${BACKEND_URL}/incidents${params}`)
      if (res.ok) {
        const data = await res.json()
        setPolled(data.items || data || [])
        setLastUpdated(Date.now())
      }
    } catch { /* backend may not be up yet — silent fail */ }
    setLoading(false)
  }, [sessionId])

  useEffect(() => {
    fetchIncidents()
    pollRef.current = setInterval(fetchIncidents, 10_000)
    return () => clearInterval(pollRef.current)
  }, [fetchIncidents])

  // ── Action handler ───────────────────────────────────────────────────────────

  const handleAction = async (incident, action) => {
    const id = incident.incident_id || incident.id
    if (!id) return
    try {
      await fetch(`${BACKEND_URL}/incidents/${id}/action`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      // Refresh list immediately after action
      await fetchIncidents()
    } catch { /* silent */ }
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const all     = mergeIncidents(liveIncidents, polled)
  const visible = filterType === 'all' ? all : all.filter(i => (i.incident_type || i.type) === filterType)
  const grouped = groupByType(visible)
  const typeKeys = [...new Set(all.map(i => i.incident_type || i.type || 'unknown'))]

  // ── Empty state ───────────────────────────────────────────────────────────────

  if (all.length === 0) {
    return (
      <div className="incidents-empty">
        <div className="empty-icon">🛡️</div>
        <p className="empty-title">No incidents detected</p>
        <p className="empty-sub">Start the camera to begin monitoring</p>
        {loading && <span className="poll-spinner">Checking backend…</span>}
      </div>
    )
  }

  // ── Normal state ──────────────────────────────────────────────────────────────

  return (
    <div className="incidents-screen">

      {/* Header bar */}
      <div className="incidents-header">
        <div className="incidents-header-top">
          <span className="incidents-count">
            {all.length} incident{all.length !== 1 ? 's' : ''}
          </span>
          <div className="header-actions">
            {loading && <span className="poll-spinner">↻</span>}
            {lastUpdated && (
              <span className="last-updated">
                updated {timeAgo(lastUpdated / 1000)}
              </span>
            )}
            <button className="refresh-btn" onClick={fetchIncidents} disabled={loading}>
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Type filter chips */}
        {typeKeys.length > 1 && (
          <div className="type-filters">
            <button
              className={`filter-chip ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              All
            </button>
            {typeKeys.map(t => {
              const m = TYPE_META[t] || { icon: '⚠️', label: t, color: '#94a3b8' }
              const count = all.filter(i => (i.incident_type || i.type) === t).length
              return (
                <button
                  key={t}
                  className={`filter-chip ${filterType === t ? 'active' : ''}`}
                  style={{ '--chip-color': m.color }}
                  onClick={() => setFilterType(filterType === t ? 'all' : t)}
                >
                  {m.icon} {m.label}
                  <span className="chip-count">{count}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Grouped list */}
      <div className="incidents-list">
        {grouped.map(({ type, meta, items }) => (
          <div key={type} className="incident-group">
            {/* Group header — tap to collapse */}
            <button
              className="group-header"
              style={{ '--inc-color': meta.color }}
              onClick={() => setExpandedType(expandedType === type ? null : type)}
            >
              <span className="group-icon">{meta.icon}</span>
              <span className="group-label">{meta.label}</span>
              <span className="group-count">{items.length}</span>
              <span className="group-chevron">
                {expandedType === type ? '▲' : '▼'}
              </span>
            </button>

            {/* Collapsible cards */}
            {expandedType !== type && (
              <div className="group-items">
                {items.map((inc, idx) => (
                  <IncidentCard
                    key={inc.incident_id || inc.id || idx}
                    incident={inc}
                    meta={meta}
                    onAction={handleAction}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
