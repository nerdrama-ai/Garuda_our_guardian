# Garuda — Our Guardian 🦅

> AI-powered real-time traffic incident detection and response system.

Garuda uses live mobile camera feeds to detect traffic incidents — accidents, red-light violations, wrong-way drivers, and potholes — the moment they happen. Incidents are flagged automatically, a 5-second clip is saved as evidence, and the right response workflow is triggered instantly.

---

## What It Does

| Incident Type | Detection | Response |
|---|---|---|
| Accident | AI detects collision / impact frames | Alert emergency services, notify nearby users |
| Red Light Violation | Detects vehicle crossing line after red | Log evidence for traffic authority |
| Wrong-Way Driver | Detects vehicle moving against traffic | Immediate push alert to users in area |
| Pothole | Detects road surface anomaly | Deduplicated geo report to municipality |

---

## High-Level Architecture

```
Mobile App (Camera)
    │  1 frame/sec JPEG over WebSocket
    ▼
Stream Ingestion Service
    │  Rolling 30s frame buffer (Redis)
    ▼
AI Analysis Worker  (Gemini 1.5 Flash — multimodal vision)
    │  Incident detected → confidence > 0.85
    ▼
Clip Assembler  (ffmpeg: frames → 5s H.264 MP4)
    │
    ├──► S3 / GCS (video storage)
    └──► Incident Service (REST API)
              │
              ├──► PostgreSQL (incidents DB)
              ├──► FCM Push Notification → Mobile App
              └──► Workflow Engine (per-type response actions)
```

---

## Repository Structure

```
docs/
  architecture.md       — Full system design and component breakdown
  backend-plan.md       — Backend scope, API surface, tech stack (Anoop's area)
  incident-workflows.md — Per-incident response workflow rules
backend/                — Python FastAPI backend (to be scaffolded)
mobile/                 — React Native / Flutter app (parallel team)
```

---

## Team Branches

| Branch | Owner | Scope |
|---|---|---|
| `anoop.kp/backend-stream-ingestion` | Anoop | Backend API, AI workers, ingestion, clip assembly |

---

## Quick Start (Backend)

> Prerequisites: Python 3.11+, Redis, ffmpeg, PostgreSQL

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

---

## Status

🚧 **Hackathon in progress** — planning phase, branching out per team member.
