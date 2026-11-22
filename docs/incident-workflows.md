# Incident Workflows — Garuda

Each incident type detected by the AI triggers a distinct response workflow. This document defines what happens after `POST /incidents` is called — the **Workflow Engine** reads the `type` field and routes to the appropriate handler.

---

## Incident Types

| Type | Trigger | Urgency |
|---|---|---|
| `accident` | Collision, impact, vehicle rollover detected | 🔴 Critical |
| `wrong_way_driver` | Vehicle moving against traffic flow | 🔴 Critical |
| `red_light_violation` | Vehicle crosses stop line on red | 🟡 Medium |
| `pothole` | Significant road surface depression | 🟢 Low |

---

## Workflow: `accident`

**Goal:** Get emergency help to the scene as fast as possible.

```
1. IMMEDIATE (synchronous, before API response returns)
   └─ Send FCM push to session device:
      "⚠️ Accident detected. Are you okay? [I'm Fine] [Call Emergency]"

2. ASYNC (background task, within 5s)
   ├─ Log incident to DB with status = "escalated"
   ├─ Broadcast push to all active sessions within 500m radius:
   │   "⚠️ Accident reported nearby. Proceed with caution."
   └─ [Stub for hackathon] POST to emergency alert webhook
      Body: { incident_id, clip_url, lat, lng, timestamp }

3. MANUAL ACTIONS available via app
   ├─ "Call Emergency" → deep-link to dialer with 112 / 911
   ├─ "Share Location" → opens share sheet with incident URL
   └─ "Mark Resolved" → status = "resolved", stops re-alerting
```

**DB status transitions:**
```
detected → escalated → (resolved | dismissed)
```

---

## Workflow: `wrong_way_driver`

**Goal:** Warn other drivers in the area immediately.

```
1. IMMEDIATE
   └─ Broadcast push to all active sessions within 1km on same road:
      "🚨 Wrong-way driver reported ahead. Stay alert."

2. ASYNC
   ├─ Log incident to DB with status = "escalated"
   └─ [Stub] POST to traffic authority webhook
      Body: { incident_id, clip_url, lat, lng, timestamp, direction_estimate }

3. MANUAL ACTIONS
   ├─ "Report to Police" → stub webhook call
   └─ "Mark Resolved" → stops broadcast alerts
```

**Deduplication:** If same GPS cell sees `wrong_way_driver` again within 2 minutes, suppress repeat broadcast but update the existing incident with a new clip URL (the latest evidence).

---

## Workflow: `red_light_violation`

**Goal:** Collect evidence for traffic authorities. No real-time action needed.

```
1. ASYNC (all background)
   ├─ Log incident to DB with status = "open"
   ├─ Attach clip_url and thumbnail_url as evidence
   └─ [Stub] Enqueue to daily batch report for traffic authority
      Format: CSV row { timestamp, lat, lng, clip_url, confidence, reason }

2. MANUAL ACTIONS
   ├─ "Submit Evidence" → stub POST to traffic portal API
   └─ "Dismiss" → status = "dismissed"
```

**Aggregation:** Multiple `red_light_violation` incidents at the same GPS cell within 1 hour are grouped into a single "hotspot" record — do not spam the evidence queue.

---

## Workflow: `pothole`

**Goal:** Report to municipal road authority with geo deduplication.

```
1. ASYNC (all background)
   ├─ Check DB: existing open pothole within 50m radius?
   │   ├─ YES → increment report_count on existing record, update last_seen
   │   └─ NO  → create new incident, status = "open"
   └─ [Stub] If report_count >= 3, POST to municipality API
      Body: { lat, lng, report_count, first_seen, last_seen, latest_clip_url }

2. MANUAL ACTIONS
   └─ "Report to Municipality" → manual trigger of municipality POST stub
```

**No push notification** for potholes — not actionable in real time by the reporter.

---

## Workflow Engine Implementation

The workflow engine in `app/services/workflow.py` is a simple dispatch table:

```python
WORKFLOW_HANDLERS = {
    "accident":             handle_accident,
    "wrong_way_driver":     handle_wrong_way_driver,
    "red_light_violation":  handle_red_light_violation,
    "pothole":              handle_pothole,
}

async def run_workflow(incident: Incident) -> None:
    handler = WORKFLOW_HANDLERS.get(incident.type)
    if handler:
        await handler(incident)
```

Each handler is an async function that:
1. Updates `incidents.status` and `incidents.workflow_state` in Postgres
2. Calls the appropriate services (FCM, webhook stubs, geo queries)
3. Logs to `incident_actions` table for audit trail

---

## Webhook Stubs (Hackathon Placeholders)

For the hackathon, external integrations are stubbed — they log the payload and return 200. Post-hackathon these would be replaced with real endpoints.

| Integration | Stub Behaviour |
|---|---|
| Emergency alert | `POST /dev/stub/emergency` → logs JSON |
| Traffic authority | `POST /dev/stub/traffic` → logs JSON |
| Municipality | `POST /dev/stub/municipality` → logs JSON |

---

## Status State Machine (all incident types)

```
           ┌──────────────┐
           │   detected   │  (created by AI worker)
           └──────┬───────┘
                  │  workflow runs
                  ▼
           ┌──────────────┐
           │    open      │  (default post-workflow)
           └──────┬───────┘
        ┌─────────┴──────────┐
        ▼                    ▼
 ┌────────────┐      ┌───────────────┐
 │ escalated  │      │   dismissed   │
 └─────┬──────┘      └───────────────┘
       │
       ▼
 ┌────────────┐
 │  resolved  │
 └────────────┘
```
