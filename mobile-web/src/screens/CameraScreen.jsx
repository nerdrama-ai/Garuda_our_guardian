import { useState, useRef } from 'react'
import { useGarudaStream } from '../hooks/useGarudaStream.js'
import IncidentToast from '../components/IncidentToast.jsx'
import './CameraScreen.css'

export default function CameraScreen({ onIncident, onSessionStart, onSessionStop }) {
  const [toast,      setToast]     = useState(null)
  const [pickedFile, setPickedFile] = useState(null)
  const fileInputRef = useRef(null)

  const handleIncident = (incident) => {
    setToast(incident)
    onIncident(incident)
    setTimeout(() => setToast(null), 5000)
  }

  const {
    videoRef, canvasRef,
    sessionId, streaming, frameCount, error,
    sourceMode, setSourceMode,
    startFromFile, startFromCamera, stopStream,
  } = useGarudaStream({
    onIncident:    handleIncident,
    onSessionStart,
    onSessionStop,
  })

  // ── file picker ────────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) setPickedFile(file)
  }

  const handleStart = () => {
    if (sourceMode === 'file') {
      if (!pickedFile) { fileInputRef.current?.click(); return }
      startFromFile(pickedFile)
    } else {
      startFromCamera()
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="camera-screen">

      {/* ── Video viewport ── */}
      <div className="camera-viewport">
        <video ref={videoRef} className="camera-video" muted playsInline />
        <canvas ref={canvasRef} className="camera-canvas-hidden" />

        {!streaming && (
          <div className="camera-overlay">
            <div className="camera-idle-icon">
              {sourceMode === 'file' ? '🎬' : '📷'}
            </div>
            <p className="camera-idle-text">
              {sourceMode === 'file'
                ? pickedFile ? `📂 ${pickedFile.name}` : 'Pick a dashcam video to stream'
                : 'Tap Start to open live camera'}
            </p>
          </div>
        )}

        {streaming && (
          <div className="camera-hud">
            <div className="hud-pill">
              <span className="hud-dot" />
              {frameCount} frames · 1fps
            </div>
            <div className="hud-pill hud-ai">
              🤖 AI watching
            </div>
            {sourceMode === 'file' && (
              <div className="hud-pill hud-file-badge">📂 video file</div>
            )}
          </div>
        )}

        {/* Viewfinder corners */}
        <div className="corner tl" />
        <div className="corner tr" />
        <div className="corner bl" />
        <div className="corner br" />
      </div>

      {/* ── Controls ── */}
      <div className="camera-controls">
        {error && <div className="error-banner">⚠️ {error}</div>}

        {/* Source mode toggle — only shown when not streaming */}
        {!streaming && (
          <div className="source-toggle">
            <button
              className={`source-btn ${sourceMode === 'file' ? 'active' : ''}`}
              onClick={() => setSourceMode('file')}
            >
              🎬 Video File
            </button>
            <button
              className={`source-btn ${sourceMode === 'camera' ? 'active' : ''}`}
              onClick={() => setSourceMode('camera')}
            >
              📷 Live Camera
            </button>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="file-input-hidden"
          onChange={handleFileChange}
        />

        {/* File pick button (file mode, not streaming) */}
        {!streaming && sourceMode === 'file' && (
          <button
            className="pick-file-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            {pickedFile ? `📂 ${pickedFile.name}` : '📂 Choose dashcam video…'}
          </button>
        )}

        <button
          className={`stream-btn ${streaming ? 'stop' : 'start'}`}
          onClick={streaming ? stopStream : handleStart}
          disabled={!streaming && sourceMode === 'file' && !pickedFile}
        >
          {streaming ? '⏹ Stop Streaming' : '▶ Start Streaming'}
        </button>

      </div>

      {/* Toast notification */}
      {toast && <IncidentToast incident={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
