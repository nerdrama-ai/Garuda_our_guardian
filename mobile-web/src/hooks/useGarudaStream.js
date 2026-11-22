/**
 * useGarudaStream — connects to the backend WebSocket and handles
 * either live camera capture or video-file playback at 1fps.
 *
 * "Video file mode" is the hackathon substitute for a real dashcam
 * livestream: the user picks a local video file, the hook plays it
 * through a hidden <video> element, and captures + sends one JPEG
 * frame per second — exactly the same wire protocol as live camera.
 */
import { useRef, useState, useCallback } from 'react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
const WS_URL = BACKEND_URL.replace(/^http/, 'ws')

/**
 * @param {{ onIncident: (incident: object) => void }} opts
 */
export function useGarudaStream({ onIncident, onSessionStart, onSessionStop }) {
  const wsRef       = useRef(null)
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const intervalRef = useRef(null)

  const [sessionId,  setSessionId]  = useState(null)
  const [streaming,  setStreaming]  = useState(false)
  const [frameCount, setFrameCount] = useState(0)
  const [error,      setError]      = useState(null)
  /** 'camera' | 'file' */
  const [sourceMode, setSourceMode] = useState('file')

  // ─── helpers ────────────────────────────────────────────────────────────────

  const captureAndSend = useCallback(() => {
    const ws     = wsRef.current
    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video || !ws || ws.readyState !== WebSocket.OPEN) return

    const w = video.videoWidth  || 640
    const h = video.videoHeight || 480
    canvas.width  = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)
    canvas.toBlob((blob) => {
      if (blob && ws.readyState === WebSocket.OPEN) {
        blob.arrayBuffer().then(buf => ws.send(buf))
        setFrameCount(c => c + 1)
      }
    }, 'image/jpeg', 0.7)
  }, [])

  const openWebSocket = useCallback((sid) => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}/stream/${sid}`)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'init', lat: 12.9716, lng: 77.5946, fps: 1 }))
        resolve(ws)
      }
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === 'incident') onIncident(msg)
        } catch { /* non-JSON frame ack — ignore */ }
      }
      ws.onerror  = () => { setError('WebSocket error — is the backend running?'); reject() }
      ws.onclose  = () => { setStreaming(false); clearInterval(intervalRef.current) }
    })
  }, [onIncident])

  const registerSession = useCallback(async () => {
    const res = await fetch(`${BACKEND_URL}/sessions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ device_token: 'demo-web-token', lat: 12.9716, lng: 77.5946 }),
    })
    if (!res.ok) throw new Error(`Session registration failed: ${res.status}`)
    const data = await res.json()
    return data.session_id
  }, [])

  // ─── start (file mode) ──────────────────────────────────────────────────────

  /**
   * Starts streaming from a user-selected video file.
   * The video is played in a hidden <video> element and frames
   * are extracted at 1fps — identical wire protocol to live camera.
   *
   * @param {File} file  The video file chosen by the user
   */
  const startFromFile = useCallback(async (file) => {
    setError(null)
    setFrameCount(0)
    try {
      const sid = await registerSession()
      setSessionId(sid)

      // Load video file into the <video> element
      const video = videoRef.current
      if (!video) throw new Error('Video element not ready')
      video.src = URL.createObjectURL(file)
      video.muted = true
      video.loop  = true  // loop so the stream runs until stopped
      await video.play()

      await openWebSocket(sid)

      setStreaming(true)
      onSessionStart?.(sid)
      intervalRef.current = setInterval(captureAndSend, 1000)
    } catch (err) {
      if (err?.message) setError(err.message)
      setStreaming(false)
    }
  }, [registerSession, openWebSocket, captureAndSend, onSessionStart])

  // ─── start (live camera mode) ────────────────────────────────────────────────

  const startFromCamera = useCallback(async () => {
    setError(null)
    setFrameCount(0)
    try {
      const sid = await registerSession()
      setSessionId(sid)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      const video = videoRef.current
      if (!video) throw new Error('Video element not ready')
      video.srcObject = stream
      await video.play()

      await openWebSocket(sid)

      setStreaming(true)
      onSessionStart?.(sid)
      intervalRef.current = setInterval(captureAndSend, 1000)
    } catch (err) {
      if (err?.message) setError(err.message)
      setStreaming(false)
    }
  }, [registerSession, openWebSocket, captureAndSend, onSessionStart])

  // ─── stop ────────────────────────────────────────────────────────────────────

  const stopStream = useCallback(() => {
    clearInterval(intervalRef.current)
    if (wsRef.current) wsRef.current.close()

    const video = videoRef.current
    if (video) {
      // Live camera cleanup
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop())
        video.srcObject = null
      }
      // File cleanup
      if (video.src && video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src)
        video.src = ''
      }
      video.pause()
    }
    setStreaming(false)
    setFrameCount(0)
    setSessionId(null)
    onSessionStop?.()
  }, [onSessionStop])

  return {
    videoRef,
    canvasRef,
    sessionId,
    streaming,
    frameCount,
    error,
    sourceMode,
    setSourceMode,
    startFromFile,
    startFromCamera,
    stopStream,
  }
}
