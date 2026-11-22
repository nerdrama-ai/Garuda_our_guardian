# System Architecture — Garuda

## Design Philosophy

The mobile app is a **dumb camera** — it streams frames and receives push notifications. All intelligence, state, and storage live on the backend server. This keeps the mobile app lightweight, ensures incidents are captured even if the app crashes mid-session, and allows the AI model to be upgraded without a mobile release.

---

## Chosen Approach: 1fps Frame Streaming over WebSocket

We evaluated two approaches:

| Approach | Latency | Complexity | Verdict |
|---|---|---|---|
| Frontend sends 1fps frames over WebSocket | ~5–10s | Medium | ✅ **Chosen** |
| Frontend uploads 1-minute MP4 chunks | ~60–120s | Low | ❌ Too slow |

**Why streaming wins:** For accident and wrong-way driver detection, a 60-second blind window is unacceptable. Streaming at 1fps gives us near-real-time detection while keeping bandwidth low (~30–80 KB/frame compressed JPEG).

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Mobile App                           │
│   Camera → JPEG frame every 1s → WebSocket → GPS metadata  │
└─────────────────────────┬───────────────────────────────────┘
                          │  WebSocket  ws://.../stream/{session_id}
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Stream Ingestion Service (FastAPI)             │
│   • Accepts WebSocket connections                           │
│   • Timestamps each frame                                   │
│   • Pushes frames to Redis rolling buffer (30s / 30 frames) │
│   • Every 10 frames → enqueue AI analysis task             │
└──────────┬──────────────────────────────┬───────────────────┘
           │  Redis List (frames)          │  Celery Task Queue
           ▼                              ▼
┌──────────────────┐          ┌────────────────────────────────┐
│   Redis Cache    │          │      AI Analysis Worker        │
│  (frame buffer,  │◄─────────│  (Celery + Gemini 1.5 Flash)  │
│   session meta)  │          │  Receives 10-frame batch       │
└──────────────────┘          │  Returns: incident type,       │
                              │  confidence, reason, frame_idx  │
                              └───────────────┬────────────────┘
                                              │  confidence > 0.85?
                                              ▼
                              ┌────────────────────────────────┐
                              │       Clip Assembler           │
                              │  Pulls ±2.5s frames from buffer│
                              │  ffmpeg → 5s H.264 MP4         │
                              │  Upload → S3 / GCS             │
                              └───────────────┬────────────────┘
                                              │
                                              ▼
                              ┌────────────────────────────────┐
                              │       Incident Service         │
                              │  POST /incidents               │
                              │  Persist → PostgreSQL          │
                              │  Trigger workflow engine       │
                              │  Send FCM push notification    │
                              └───────────────┬────────────────┘
                                              │
                              ┌───────────────┴────────────────┐
                              │      Workflow Engine           │
                              │  accident  → emergency alert   │
                              │  red_light → evidence log      │
                              │  wrong_way → area broadcast    │
                              │  pothole   → geo dedup + report│
                              └────────────────────────────────┘
```

---

## Component Details

### Stream Ingestion Service

- **Runtime:** Python, FastAPI + `websockets`
- **Responsibility:** Accept one WebSocket connection per mobile session. Assign a `session_id` (UUID). Receive binary JPEG frames, attach a UTC timestamp and sequence number, store in Redis as a list keyed by `frames:{session_id}`.
- **Buffer policy:** Keep the last 30 entries (30 seconds). Older frames are popped automatically via list trim after each push.
- **Batch dispatch:** After every 10th frame, push a task `{session_id, start_seq, end_seq}` to the Celery queue.
- **Reconnect handling:** Sessions expire from Redis after 5 minutes of inactivity. Mobile reconnects with same `session_id` to resume.

### Frame Buffer (Redis)

- **Data structure:** `RPUSH frames:{session_id}` + `LTRIM frames:{session_id} -30 -1`
- **Each entry:** `{seq: int, ts: ISO8601, jpeg_b64: string, lat: float, lng: float}`
- **TTL:** Key expires 5 minutes after last write

### AI Analysis Worker (Celery)

- **Model:** Gemini 1.5 Flash (multimodal — accepts image arrays)
- **Input:** 10 sequential JPEG frames, 1 second apart
- **Prompt structure:**
  ```
  You are a traffic incident detector. Analyze these 10 sequential frames
  captured 1 second apart from a dashcam/phone camera mounted in a vehicle.

  Identify if any of the following incidents are occurring:
  - accident: collision, impact, airbag deployment, vehicle rollover
  - red_light_violation: vehicle crossing stop line after signal is red
  - wrong_way_driver: vehicle traveling opposite to traffic flow
  - pothole: significant road surface depression or damage
  - none: normal traffic conditions

  Return ONLY valid JSON:
  {
    "incident": "accident|red_light_violation|wrong_way_driver|pothole|none",
    "confidence": 0.0-1.0,
    "reason": "one sentence description of what was observed",
    "frame_index": 0-9
  }
  ```
- **Threshold:** Only proceed if `confidence >= 0.85`
- **Deduplication:** Check Redis for `incident_lock:{session_id}:{incident_type}` with 30s TTL to avoid firing the same incident type repeatedly for the same event

### Clip Assembler

- **Trigger:** Incident detected at `frame_index` N
- **Window:** Pull frames `[N-2, N+2]` from buffer (5 frames = 5 seconds)
- **Encoding:** `ffmpeg -framerate 1 -i frame_%d.jpg -c:v libx264 -pix_fmt yuv420p clip.mp4`
- **Upscaling option:** `-vf "fps=24,minterpolate"` to generate smoother 24fps output from 1fps source
- **Upload:** `boto3` / GCS client → `incidents/{session_id}/{uuid}.mp4`
- **Returns:** Presigned URL valid for 7 days

### Incident Service (REST API)

See [`backend-plan.md`](./backend-plan.md) for full API surface.

- Writes to PostgreSQL `incidents` table
- Calls Workflow Engine with incident type
- Dispatches FCM push notification to `session.device_token`

### Workflow Engine

See [`incident-workflows.md`](./incident-workflows.md) for per-type logic.

---

## Data Flow: Frame to Incident (Happy Path)

```
t=0s   Mobile sends frame #1
t=1s   Mobile sends frame #2
...
t=9s   Mobile sends frame #10 → Celery task enqueued
t=10s  Gemini analyzes 10 frames → "accident", confidence=0.94
t=10s  Clip assembler pulls frames 7–11 from buffer
t=11s  ffmpeg encodes 5s MP4 → uploaded to S3
t=12s  POST /incidents created in DB
t=12s  FCM push → "⚠️ Accident detected nearby"
```

**End-to-end latency: ~12 seconds from event to notification.**

---

## Scalability Notes

- Each WebSocket connection is stateful to one ingestion worker. Use sticky sessions on the load balancer.
- Celery workers are stateless and horizontally scalable.
- Redis Cluster or Redis Sentinel for HA on the buffer.
- S3 lifecycle policy: archive clips to Glacier after 90 days.

---

## Security

- WebSocket connections authenticated via JWT (`?token=...` in URL)
- S3 clips served via presigned URLs only — never publicly listed
- Incident API requires `Authorization: Bearer <token>` header
- GPS coordinates stored but never exposed in public endpoints
