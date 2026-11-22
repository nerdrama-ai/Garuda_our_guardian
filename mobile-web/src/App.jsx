import { useState } from 'react'
import CameraScreen    from './screens/CameraScreen.jsx'
import IncidentScreen  from './screens/IncidentScreen.jsx'
import RulesScreen     from './screens/RulesScreen.jsx'
import './App.css'

export default function App() {
  const [activeTab,      setActiveTab]      = useState('camera')
  const [liveIncidents,  setLiveIncidents]  = useState([])
  const [sessionId,      setSessionId]      = useState(null)
  const [streaming,      setStreaming]      = useState(false)

  /** Called by CameraScreen whenever a WebSocket incident arrives. */
  const addIncident = (incident) => {
    setLiveIncidents(prev => [incident, ...prev])
  }

  const unreadCount = liveIncidents.length

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-left">
          <span className="logo">🦅</span>
          <span className="app-name">Garuda</span>
        </div>
        <div className="header-right">
          {streaming && (
            <span className="live-badge">
              <span className="live-dot" />
              LIVE
            </span>
          )}
        </div>
      </header>

      {/* ── Screen ── */}
      <main className="app-main">
        {activeTab === 'camera' && (
          <CameraScreen
            onIncident={addIncident}
            onSessionStart={(sid) => { setSessionId(sid); setStreaming(true)  }}
            onSessionStop={() => { setStreaming(false) }}
          />
        )}
        {activeTab === 'incidents' && (
          <IncidentScreen
            liveIncidents={liveIncidents}
            sessionId={sessionId}
          />
        )}
        {activeTab === 'rules' && (
          <RulesScreen />
        )}
      </main>

      {/* ── Bottom nav ── */}
      <nav className="app-nav">
        <button
          className={`nav-btn ${activeTab === 'camera' ? 'active' : ''}`}
          onClick={() => setActiveTab('camera')}
        >
          <span className="nav-icon">📷</span>
          <span className="nav-label">Camera</span>
        </button>

        <button
          className={`nav-btn ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setActiveTab('incidents')}
        >
          <span className="nav-icon">🚨</span>
          <span className="nav-label">
            Incidents
            {unreadCount > 0 && (
              <span className="badge">{unreadCount}</span>
            )}
          </span>
        </button>

        <button
          className={`nav-btn ${activeTab === 'rules' ? 'active' : ''}`}
          onClick={() => setActiveTab('rules')}
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">Rules</span>
        </button>
      </nav>
    </div>
  )
}
