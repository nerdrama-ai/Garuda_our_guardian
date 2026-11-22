import { useState } from 'react'
import './RulesScreen.css'

/**
 * Default rules configuration for each incident type.
 * This mirrors the backend workflow engine's per-type logic and
 * lets the user control which incidents they care about.
 */
const DEFAULT_RULES = {
  accident: {
    enabled:     true,
    label:       'Accident',
    icon:        '💥',
    color:       '#ef4444',
    urgency:     'Critical',
    description: 'Detects vehicle collisions, impacts, airbag deployments, and rollovers.',
    notify:      true,
    autoEscalate:true,
    emergencyDial:true,
    broadcastRadius: 500,   // metres
    actions: [
      { id: 'push_self',    label: 'Push notification to me',          enabled: true  },
      { id: 'broadcast',    label: 'Broadcast to drivers within 500m', enabled: true  },
      { id: 'emergency_stub',label: 'Send to emergency alert webhook', enabled: true  },
      { id: 'save_clip',    label: 'Save 5s video clip',               enabled: true  },
    ],
    thresholdPct: 85,
  },
  wrong_way_driver: {
    enabled:     true,
    label:       'Wrong-Way Driver',
    icon:        '🚨',
    color:       '#f97316',
    urgency:     'Critical',
    description: 'Detects vehicles travelling against normal traffic flow.',
    notify:      true,
    autoEscalate:true,
    emergencyDial:false,
    broadcastRadius: 1000,
    actions: [
      { id: 'broadcast',     label: 'Broadcast alert to drivers within 1km', enabled: true  },
      { id: 'traffic_stub',  label: 'Report to traffic authority webhook',   enabled: true  },
      { id: 'save_clip',     label: 'Save 5s video clip',                    enabled: true  },
    ],
    thresholdPct: 85,
  },
  red_light_violation: {
    enabled:     true,
    label:       'Red Light Violation',
    icon:        '🔴',
    color:       '#eab308',
    urgency:     'Medium',
    description: 'Detects vehicles crossing the stop line after the signal turns red.',
    notify:      false,
    autoEscalate:false,
    emergencyDial:false,
    broadcastRadius: 0,
    actions: [
      { id: 'save_clip',    label: 'Save clip as evidence',              enabled: true  },
      { id: 'batch_report', label: 'Include in daily traffic report',    enabled: true  },
      { id: 'push_self',    label: 'Push notification to me',            enabled: false },
    ],
    thresholdPct: 85,
  },
  pothole: {
    enabled:     true,
    label:       'Pothole',
    icon:        '🕳️',
    color:       '#22c55e',
    urgency:     'Low',
    description: 'Detects significant road surface depressions or damage.',
    notify:      false,
    autoEscalate:false,
    emergencyDial:false,
    broadcastRadius: 0,
    actions: [
      { id: 'geo_dedup',    label: 'Geo-deduplicate (merge reports within 50m)', enabled: true  },
      { id: 'municipality', label: 'Report to municipality (after 3 reports)',   enabled: true  },
      { id: 'save_clip',    label: 'Save clip as evidence',                      enabled: true  },
      { id: 'push_self',    label: 'Push notification to me',                    enabled: false },
    ],
    thresholdPct: 85,
  },
}

const URGENCY_COLOR = { Critical: '#ef4444', Medium: '#eab308', Low: '#22c55e' }

// ── Sub-components ──────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle-row">
      <span className="toggle-label">{label}</span>
      <div className={`toggle-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <div className="toggle-thumb" />
      </div>
    </label>
  )
}

function Slider({ value, onChange, min = 50, max = 99, label }) {
  return (
    <div className="slider-row">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{value}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="threshold-slider"
      />
      <div className="slider-hints">
        <span>{min}% (more detections)</span>
        <span>{max}% (fewer, higher confidence)</span>
      </div>
    </div>
  )
}

function IncidentRuleCard({ type, rule, onChange }) {
  const [expanded, setExpanded] = useState(false)

  const updateAction = (actionId, enabled) => {
    onChange({
      ...rule,
      actions: rule.actions.map(a => a.id === actionId ? { ...a, enabled } : a),
    })
  }

  return (
    <div
      className={`rule-card ${rule.enabled ? '' : 'disabled'}`}
      style={{ '--rule-color': rule.color }}
    >
      {/* Card header */}
      <div className="rule-card-header">
        <div className="rule-card-left">
          <span className="rule-icon">{rule.icon}</span>
          <div className="rule-title-block">
            <span className="rule-title">{rule.label}</span>
            <span
              className="rule-urgency"
              style={{ color: URGENCY_COLOR[rule.urgency] || '#94a3b8' }}
            >
              {rule.urgency}
            </span>
          </div>
        </div>
        <div className="rule-card-right">
          <div
            className={`master-toggle ${rule.enabled ? 'on' : ''}`}
            onClick={() => onChange({ ...rule, enabled: !rule.enabled })}
          >
            <div className="toggle-thumb" />
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="rule-description">{rule.description}</p>

      {/* Expand / collapse */}
      <button
        className="rule-expand-btn"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? '▲ Hide settings' : '▼ Configure settings'}
      </button>

      {expanded && (
        <div className="rule-settings">

          {/* Confidence threshold */}
          <Slider
            label="Detection confidence threshold"
            value={rule.thresholdPct}
            onChange={v => onChange({ ...rule, thresholdPct: v })}
          />

          {/* Notification toggles */}
          <div className="rule-section-label">Notifications</div>
          <Toggle
            label="Push notification to me on detection"
            checked={rule.notify}
            onChange={v => onChange({ ...rule, notify: v })}
          />
          <Toggle
            label="Auto-escalate (mark status = escalated)"
            checked={rule.autoEscalate}
            onChange={v => onChange({ ...rule, autoEscalate: v })}
          />
          {rule.emergencyDial !== undefined && (
            <Toggle
              label="Show 'Call Emergency' button on detection"
              checked={rule.emergencyDial}
              onChange={v => onChange({ ...rule, emergencyDial: v })}
            />
          )}

          {/* Per-action toggles */}
          <div className="rule-section-label">Response actions</div>
          {rule.actions.map(action => (
            <Toggle
              key={action.id}
              label={action.label}
              checked={action.enabled}
              onChange={v => updateAction(action.id, v)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main screen ─────────────────────────────────────────────────────────────────

/**
 * RulesScreen
 *
 * Lets the user configure which incident types Garuda should act on
 * and what actions to take for each. Settings are persisted to
 * localStorage so they survive page refreshes.
 *
 * In production these would sync to the backend via
 * PATCH /sessions/{id}/rules so the server can filter the
 * AI analysis accordingly.
 */
export default function RulesScreen() {
  const [rules, setRules] = useState(() => {
    try {
      const saved = localStorage.getItem('garuda_rules')
      return saved ? JSON.parse(saved) : DEFAULT_RULES
    } catch {
      return DEFAULT_RULES
    }
  })
  const [saved, setSaved] = useState(false)

  const updateRule = (type, updated) => {
    setRules(prev => ({ ...prev, [type]: updated }))
    setSaved(false)
  }

  const handleSave = () => {
    try {
      localStorage.setItem('garuda_rules', JSON.stringify(rules))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch { /* storage full — ignore */ }
  }

  const handleReset = () => {
    setRules(DEFAULT_RULES)
    localStorage.removeItem('garuda_rules')
    setSaved(false)
  }

  const enabledCount = Object.values(rules).filter(r => r.enabled).length

  return (
    <div className="rules-screen">

      {/* Header */}
      <div className="rules-header">
        <div className="rules-header-top">
          <div>
            <p className="rules-title">Incident Rules</p>
            <p className="rules-sub">
              {enabledCount} of {Object.keys(rules).length} types active
            </p>
          </div>
          <div className="rules-header-actions">
            <button className="reset-btn" onClick={handleReset}>Reset</button>
            <button className={`save-btn ${saved ? 'saved' : ''}`} onClick={handleSave}>
              {saved ? '✔ Saved' : 'Save'}
            </button>
          </div>
        </div>
        <p className="rules-desc">
          Control which incident types Garuda monitors and what actions it takes when each is detected.
        </p>
      </div>

      {/* Rule cards */}
      <div className="rules-list">
        {Object.entries(rules).map(([type, rule]) => (
          <IncidentRuleCard
            key={type}
            type={type}
            rule={rule}
            onChange={updated => updateRule(type, updated)}
          />
        ))}
      </div>

      {/* Footer note */}
      <div className="rules-footer">
        <p>Settings are saved locally. In production they would sync to the backend session.</p>
      </div>
    </div>
  )
}
