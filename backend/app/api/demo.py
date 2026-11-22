"""
Demo inject endpoint — simulates an AI-detected incident for live demos.
POST /demo/inject  { session_id, incident_type }
"""
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app import store

router = APIRouter()

INCIDENT_REASONS = {
    "accident": "Rear-end collision detected — sudden deceleration and impact frames observed.",
    "wrong_way_driver": "Vehicle detected traveling opposite to traffic flow on a one-way road segment.",
    "red_light_violation": "Vehicle crossed the stop line approximately 2 seconds after signal turned red.",
    "pothole": "Significant road surface depression detected, approximately 30 cm diameter.",
}

INCIDENT_CONFIDENCE = {
    "accident": 0.94,
    "wrong_way_driver": 0.91,
    "red_light_violation": 0.88,
    "pothole": 0.86,
}


class InjectRequest(BaseModel):
    session_id: str
    incident_type: str


@router.post("/demo/inject")
async def inject_incident(body: InjectRequest):
    session = store.get_session(body.session_id)
    if not session:
        raise HTTPException(404, f"Session {body.session_id} not found")

    if body.incident_type not in INCIDENT_REASONS:
        raise HTTPException(400, f"Unknown incident type: {body.incident_type}. Valid: {list(INCIDENT_REASONS)}")

    incident = store.create_incident(
        session_id=body.session_id,
        incident_type=body.incident_type,
        confidence=INCIDENT_CONFIDENCE[body.incident_type],
        reason=INCIDENT_REASONS[body.incident_type],
        lat=session.get("lat", 12.9716),
        lng=session.get("lng", 77.5946),
    )

    # Push notification to live WebSocket if connected
    ws = store.active_ws.get(body.session_id)
    if ws:
        try:
            await ws.send_text(json.dumps({
                "type": "incident",
                **incident,
            }))
        except Exception:
            pass

    return incident
