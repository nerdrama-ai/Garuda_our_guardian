# Mobile Web App — Garuda

Branch: `anoop.kp/mobile-web-frontend`  
App path: `mobile-web/`  
Stack: React 18 · Vite · plain CSS (no framework)

---

## Overview

The Garuda mobile web app is a Progressive Web App (PWA) that runs in the browser on a phone. It is the **camera-side client** — its only job is to send frames to the backend and display what comes back.

The app has three screens, accessible via a bottom navigation bar:

| Tab | Screen | Purpose |
|---|---|---|
| 📷 Camera | `CameraScreen` | Stream frames to backend |
| 🚨 Incidents | `IncidentScreen` | View all detected incidents |
| ⚙️ Rules | `RulesScreen` | Configure per-type settings |

---

## Screen 1 — Camera (Streaming)

**File:** [`src/screens/CameraScreen.jsx`](../mobile-web/src/screens/CameraScreen.jsx)  
**Hook:** [`src/hooks/useGarudaStream.js`](../mobile-web/src/hooks/useGarudaStream.js)

### Source modes

The app supports two frame sources, switchable via a toggle before streaming starts:

| Mode | How it works |
|---|---|
| **🎬 Video File** (default) | User picks a local dashcam/MP4 file. The file plays in a hidden `<video>` element. Frames are captured at 1fps and sent over WebSocket — identical wire protocol to live camera. |
| **📷 Live Camera** | Opens `getUserMedia({facingMode:'environment'})` and captures the rear camera at 1fps. |

**Video file mode is the hackathon demo path.** It lets the judges reproduce any incident scenario by uploading a prepared dashcam clip without needing a physical rear-facing camera.

### Streaming protocol

1. `POST /sessions` → receives `session_id`
2. `WS /stream/{session_id}` opened
3. JSON init handshake: `{"type":"init","lat":…,"lng":…,"fps":1}`
4. Every 1 second: `canvas.toBlob(…,'image/jpeg',0.7)` → `ws.send(ArrayBuffer)`
5. Server pushes back: `{"type":"incident","incident_id":"…","incident_type":"…"}` → incident toast shown

### Streaming HUD

When active, an overlay shows:
- 🔴 pulsing dot + frame counter (`42 frames · 1fps`)
- Session UUID prefix
- `📂 video file` badge if in file mode

### Demo inject panel

While streaming, four buttons let you manually trigger each incident type against the current session via `POST /demo/inject`. This calls the backend's demo endpoint, which synthesises a fake incident and returns it over the WebSocket — useful for demoing without waiting for the AI worker.

---

## Screen 2 — Incidents

**File:** [`src/screens/IncidentScreen.jsx`](../mobile-web/src/screens/IncidentScreen.jsx)

### Data sources

The incidents screen combines **two data sources**:

| Source | Mechanism | Latency |
|---|---|---|
| **Live (WebSocket)** | Pushed by `App.jsx` as the WebSocket delivers `type=incident` messages | Immediate |
| **Polled (REST)** | `GET /incidents?session_id=…&limit=100` every **10 seconds** | ≤10s |

Both lists are merged and deduplicated by `incident_id`. The combined list is what's displayed. This means incidents appear instantly when first detected, and historical incidents from previous sessions (or detected before the page loaded) catch up via polling.

### Grouping by incident type

Incidents are grouped into collapsible sections, sorted by urgency:

| Priority | Type | Group colour |
|---|---|---|
| 1 — Critical | Accident | 🔴 Red |
| 2 — Critical | Wrong-Way Driver | 🟠 Orange |
| 3 — Medium | Red Light Violation | 🟡 Yellow |
| 4 — Low | Pothole | 🟢 Green |

Each group shows a count badge. Tap the group header to collapse/expand it.

### Type filter chips

If multiple incident types are present, a horizontal chip bar appears at the top to filter to a single type.

### Incident cards

Each card shows:
- Incident type icon + label (coloured by type)
- Time since detection (`just now`, `3m ago`, etc.)
- Status pill: `open` / `escalated` / `resolved` / `dismissed`
- AI reason text
- Confidence percentage
- **▶ View clip** link (if `clip_url` is present in the backend response)
- Action buttons:
  - `🔺 Escalate` (open → escalated)
  - `✕ Dismiss` (open → dismissed)
  - `✔ Resolve` (escalated → resolved)
  
Actions call `POST /incidents/{id}/action` and immediately re-poll the list.

### Manual refresh

A `↻ Refresh` button in the header triggers an immediate poll. The header also shows "updated Xs ago" for transparency.

---

## Screen 3 — Rules (Incident Settings)

**File:** [`src/screens/RulesScreen.jsx`](../mobile-web/src/screens/RulesScreen.jsx)

The Rules screen is the **user-facing configuration** for each incident type. It answers the question: *"What should Garuda do when it sees an X?"*

### Per-type settings

Each incident type has its own expandable card with:

#### Master toggle
Enables or disables detection for this incident type entirely. Disabled types are visually dimmed.

#### Confidence threshold (slider)
Sets the minimum AI confidence score (50–99%) required before an incident is logged. Default: **85%** (matches `AI_CONFIDENCE_THRESHOLD` on the backend).

- Lower → more detections, more false positives
- Higher → fewer detections, higher precision

#### Notification toggles
- **Push notification to me** — whether the device shows an alert when this type fires
- **Auto-escalate** — automatically set status to `escalated` on creation
- **Show 'Call Emergency' button** (accident only)

#### Response action toggles
Each type has a list of response actions (from the workflow engine) that can be individually enabled:

| Action | Types |
|---|---|
| `push_self` | Push notification to the detecting device | accident, wrong-way, (opt-in) red-light, pothole |
| `broadcast` | Push to all sessions within N metres | accident (500m), wrong-way (1km) |
| `save_clip` | Save 5-second H.264 clip to S3 | all |
| `emergency_stub` | POST to emergency alert webhook | accident |
| `traffic_stub` | POST to traffic authority webhook | wrong-way |
| `batch_report` | Add to daily CSV report | red-light |
| `geo_dedup` | Merge pothole reports within 50m | pothole |
| `municipality` | POST to municipality API after 3 reports | pothole |

### Persistence

Rules are saved to `localStorage` as `garuda_rules` JSON. They survive page refreshes.

**Future:** `PATCH /sessions/{id}/rules` would sync these to the backend so the AI worker can filter accordingly before sending results.

### Defaults

| Type | Notify | Auto-Escalate | Key Actions On |
|---|---|---|---|
| Accident | ✅ | ✅ | broadcast, emergency_stub, save_clip |
| Wrong-Way Driver | ✅ | ✅ | broadcast, traffic_stub, save_clip |
| Red Light | ❌ | ❌ | save_clip, batch_report |
| Pothole | ❌ | ❌ | geo_dedup, municipality, save_clip |

---

## Architecture Fit

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Mobile Web App (this doc)                       │
│                                                                     │
│  CameraScreen                                                       │
│    ├── Video file (hackathon) or live camera (production)           │
│    ├── 1fps JPEG frames → WS /stream/{session_id}                   │
│    └── WS pushback → IncidentToast                                  │
│                                                                     │
│  IncidentScreen                                                     │
│    ├── liveIncidents (from WS via App state)                        │
│    ├── polledIncidents (GET /incidents every 10s)                   │
│    ├── merged + deduped                                             │
│    └── grouped by type (collapsible)                                │
│                                                                     │
│  RulesScreen                                                        │
│    ├── Master enable/disable per type                               │
│    ├── Confidence threshold slider                                  │
│    ├── Notification preferences                                     │
│    └── Per-action toggles → localStorage                            │
└─────────────────────────────────────────────────────────────────────┘
              │                              ▲
      WS frames                      incidents + actions
              │                              │
              ▼                              │
      Backend (FastAPI)  ──────────────────►─┘
        /sessions
        /stream/{id}
        /incidents
        /incidents/{id}/action
        /demo/inject
```

---

## Running Locally

```bash
cd mobile-web
npm install
npm run dev        # → http://localhost:5173
```

Point `VITE_BACKEND_URL` at your backend:

```bash
VITE_BACKEND_URL=http://192.168.1.x:8000 npm run dev
```

Build for production:

```bash
npm run build      # outputs to dist/
```

---

## File Map

```
mobile-web/
├── index.html                       PWA shell
├── vite.config.js
├── package.json
└── src/
    ├── main.jsx                     Entry point
    ├── App.jsx                      Root — tab state, session state
    ├── App.css                      Shell layout (header, nav)
    ├── index.css                    Global design tokens
    ├── hooks/
    │   └── useGarudaStream.js       WS + 1fps capture hook
    ├── screens/
    │   ├── CameraScreen.jsx         Frame streaming UI
    │   ├── CameraScreen.css
    │   ├── IncidentScreen.jsx       Incident list (polled + live)
    │   ├── IncidentScreen.css
    │   ├── RulesScreen.jsx          Per-incident settings
    │   └── RulesScreen.css
    └── components/
        ├── IncidentToast.jsx        In-app alert banner
        └── IncidentToast.css
```
