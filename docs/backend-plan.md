# Backend Plan — Anoop's Scope

Branch: `anoop.kp/backend-stream-ingestion`

This document covers everything that lives on the backend server — the part the mobile team does **not** need to touch. The mobile app treats the backend as a black box: send frames in, receive incidents out.

---

## Scope Summary

| # | Component | Status |
|---|---|---|
| 1 | WebSocket stream ingestion endpoint | 🔲 To build |
| 2 | Redis rolling frame buffer | 🔲 To build |
| 3 | Celery task queue setup | 🔲 To build |
| 4 | AI analysis worker (Gemini Vision) | 🔲 To build |
| 5 | Clip assembler (ffmpeg → S3) | 🔲 To build |
| 6 | Incident REST API | 🔲 To build |
| 7 | Workflow engine (per-type actions) | 🔲 To build |
| 8 | FCM push notification dispatch | 🔲 To build |

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Web framework | **FastAPI** (Python 3.11) | Async, WebSocket support built-in |
| Task queue | **Celery 5** + Redis broker | Retry, priority, dead-letter queue |
| Frame buffer | **Redis 7** (Lists + TTL) | Rolling 30s window per session |
| AI model | **Google Gemini 1.5 Flash** | `google-generativeai` SDK, multimodal |
| Video assembly | **ffmpeg** (subprocess wrapper) | Installed on server, not a Python lib |
| Object storage | **AWS S3** (or GCS) | `boto3` for upload, presigned URLs |
| Database | **PostgreSQL 15** | `SQLAlchemy` async ORM + `alembic` migrations |
| Push notifications | **Firebase Cloud Messaging** | `firebase-admin` SDK |
| Auth | **JWT** (PyJWT) | Sessions authenticated via token in WS URL |
| Container | **Docker + docker-compose** | Local dev + server deployment |

---

## Project Structure

```
backend/
├── app/
│   ├── main.py                 # FastAPI app entry point
│   ├── config.py               # Settings (env vars via pydantic-settings)
│   ├── db/
│   │   ├── models.py           # SQLAlchemy ORM models
│   │   └── session.py          # Async DB session factory
│   ├── api/
│   │   ├── sessions.py         # POST /sessions
│   │   ├── stream.py           # WS /stream/{session_id}
│   │   └── incidents.py        # CRUD /incidents
│   ├── workers/
│   │   ├── celery_app.py       # Celery instance + config
│   │   ├── ai_analysis.py      # Gemini vision task
│   │   └── clip_assembler.py   # ffmpeg + S3 upload task
│   ├── services/
│   │   ├── redis_buffer.py     # Frame push/pull helpers
│   │   ├── gemini.py           # Gemini API wrapper
│   │   ├── s3.py               # S3 upload + presign
│   │   ├── fcm.py              # FCM push dispatch
│   │   └── workflow.py         # Per-incident action router
│   └── schemas/
│       ├── session.py          # Pydantic schemas for sessions
│       └── incident.py         # Pydantic schemas for incidents
├── alembic/                    # DB migrations
├── tests/
│   ├── test_stream.py
│   ├── test_ai_worker.py
│   └── test_incidents_api.py
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

---

## API Reference

### Session Management

#### `POST /sessions`
Start a new streaming session. Mobile calls this on app launch.

**Request:**
```json
{
  "device_token": "fcm_token_here",
  "lat": 12.9716,
  "lng": 77.5946
}
```

**Response:**
```json
{
  "session_id": "uuid-v4",
  "ws_url": "wss://api.garuda.app/stream/uuid-v4?token=jwt"
}
```

---

#### `PATCH /sessions/{session_id}/location`
Update GPS position during a session (mobile calls this every 30s).

**Request:**
```json
{ "lat": 12.9720, "lng": 77.5950 }
```

---

### Stream Ingestion

#### `WS /stream/{session_id}?token={jwt}`
Live frame ingestion WebSocket.

**Client → Server (binary):**
Each message is a raw JPEG byte payload. The backend timestamps it on receipt.

Optionally, before switching to binary mode, client sends one JSON handshake:
```json
{ "type": "init", "lat": 12.9716, "lng": 77.5946, "fps": 1 }
```

**Server → Client (JSON, async):**
```json
{ "type": "incident", "incident_id": "uuid", "incident_type": "accident" }
```
This is a lightweight signal — mobile uses `incident_id` to call `GET /incidents/{id}`.

---

### Incidents

#### `GET /incidents?session_id={id}&limit=20&offset=0`
List incidents for a session, newest first.

**Response:**
```json
{
  "total": 3,
  "items": [
    {
      "id": "uuid",
      "type": "red_light_violation",
      "reason": "Vehicle passed stop line 2s after signal turned red",
      "confidence": 0.91,
      "clip_url": "https://s3.../clip.mp4",
      "thumbnail_url": "https://s3.../thumb.jpg",
      "timestamp": "2026-11-22T07:09:00Z",
      "location": { "lat": 12.9716, "lng": 77.5946 },
      "status": "open"
    }
  ]
}
```

---

#### `GET /incidents/{id}`
Get a single incident with full detail.

---

#### `POST /incidents/{id}/action`
Trigger a manual action on an incident.

**Request:**
```json
{
  "action": "escalate | dismiss | resolve",
  "note": "optional operator note"
}
```

---

#### `GET /incidents/{id}/clip`
Redirect (302) to presigned S3 URL for the 5s video clip.

---

## Database Schema

```sql
-- Sessions
CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL,
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    started_at  TIMESTAMPTZ DEFAULT now(),
    last_seen   TIMESTAMPTZ,
    is_active   BOOLEAN DEFAULT TRUE
);

-- Incidents
CREATE TABLE incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID REFERENCES sessions(id),
    type            TEXT NOT NULL,       -- accident, red_light_violation, etc.
    confidence      FLOAT NOT NULL,
    reason          TEXT NOT NULL,
    clip_url        TEXT,
    thumbnail_url   TEXT,
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    detected_at     TIMESTAMPTZ DEFAULT now(),
    status          TEXT DEFAULT 'open', -- open, escalated, resolved, dismissed
    workflow_state  JSONB DEFAULT '{}'
);

-- Incident Actions (audit log)
CREATE TABLE incident_actions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID REFERENCES incidents(id),
    action      TEXT NOT NULL,
    note        TEXT,
    actor       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## Environment Variables

```env
# App
SECRET_KEY=...
DEBUG=false

# Database
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/garuda

# Redis
REDIS_URL=redis://localhost:6379/0

# Gemini
GEMINI_API_KEY=...

# AWS S3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=garuda-clips
S3_REGION=ap-south-1

# Firebase
FIREBASE_CREDENTIALS_JSON=path/to/serviceAccount.json

# Thresholds
AI_CONFIDENCE_THRESHOLD=0.85
INCIDENT_DEDUP_WINDOW_SECONDS=30
FRAME_BUFFER_SIZE=30
AI_BATCH_SIZE=10
```

---

## Development Milestones

### Milestone 1 — Frame Ingestion (Day 1)
- [ ] FastAPI app scaffold + Docker compose (FastAPI + Redis + Postgres)
- [ ] `POST /sessions` endpoint
- [ ] `WS /stream/{session_id}` — accept frames, push to Redis buffer
- [ ] Manual test: Python script sending JPEG frames over WebSocket

### Milestone 2 — AI Detection (Day 1–2)
- [ ] Celery worker setup
- [ ] Gemini API wrapper (`services/gemini.py`)
- [ ] `ai_analysis` task: pull 10 frames from Redis, call Gemini, parse response
- [ ] Deduplication lock in Redis

### Milestone 3 — Clip Assembly (Day 2)
- [ ] `clip_assembler` task: pull frames, run ffmpeg, upload to S3
- [ ] Thumbnail extraction (frame at peak confidence)
- [ ] Presigned URL generation

### Milestone 4 — Incident API + Notifications (Day 2)
- [ ] `POST /incidents` (internal, called by worker)
- [ ] `GET /incidents` + `GET /incidents/{id}` (mobile-facing)
- [ ] FCM push notification on incident creation
- [ ] Workflow engine stub (logs action per type)

### Milestone 5 — Polish + Integration (Day 3)
- [ ] `POST /incidents/{id}/action` (manual escalate/dismiss/resolve)
- [ ] JWT auth on WS + REST
- [ ] Integration test with mobile team's test client
- [ ] Deploy to server (DigitalOcean / EC2)
