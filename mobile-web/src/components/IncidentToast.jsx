import './IncidentToast.css'

const TYPE_META = {
  accident:            { icon: '💥', label: 'Accident detected!',         color: '#ef4444' },
  wrong_way_driver:    { icon: '🚨', label: 'Wrong-way driver detected!',  color: '#f97316' },
  red_light_violation: { icon: '🔴', label: 'Red light violation!',        color: '#eab308' },
  pothole:             { icon: '🕳️', label: 'Pothole reported',            color: '#22c55e' },
}

export default function IncidentToast({ incident, onDismiss }) {
  const meta = TYPE_META[incident.incident_type] || {
    icon: '⚠️',
    label: incident.incident_type,
    color: '#94a3b8',
  }

  return (
    <div className="toast" style={{ '--t-color': meta.color }} onClick={onDismiss}>
      <div className="toast-icon">{meta.icon}</div>
      <div className="toast-body">
        <p className="toast-title">{meta.label}</p>
        <p className="toast-reason">{incident.reason}</p>
      </div>
      <button className="toast-close" onClick={onDismiss}>✕</button>
    </div>
  )
}
