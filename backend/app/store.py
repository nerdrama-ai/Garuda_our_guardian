"""
In-memory store for the hackathon demo.
Replaces Redis + PostgreSQL — zero external dependencies.
"""
import uuid
import time
from collections import defaultdict, deque
from typing import Dict, List, Any, Optional

# sessions: { session_id -> session_dict }
sessions: Dict[str, Dict] = {}

# frame buffer: { session_id -> deque of last 30 frames }
frame_buffers: Dict[str, deque] = defaultdict(lambda: deque(maxlen=30))

# incidents: { session_id -> [ incident_dict, ... ] }
incidents_by_session: Dict[str, List[Dict]] = defaultdict(list)
all_incidents: List[Dict] = []

# active websocket connections: { session_id -> WebSocket }
active_ws: Dict[str, Any] = {}

# frame counters
frame_counters: Dict[str, int] = defaultdict(int)


def create_session(device_token: str, lat: float, lng: float) -> Dict:
    sid = str(uuid.uuid4())
    sessions[sid] = {
        "id": sid,
        "device_token": device_token,
        "lat": lat,
        "lng": lng,
        "started_at": time.time(),
        "is_active": True,
    }
    return sessions[sid]


def get_session(session_id: str) -> Optional[Dict]:
    return sessions.get(session_id)


def push_frame(session_id: str, frame_data: bytes, lat: float, lng: float) -> int:
    seq = frame_counters[session_id]
    frame_buffers[session_id].append({
        "seq": seq,
        "ts": time.time(),
        "jpeg": frame_data,
        "lat": lat,
        "lng": lng,
    })
    frame_counters[session_id] += 1
    return seq


def create_incident(
    session_id: str,
    incident_type: str,
    confidence: float,
    reason: str,
    lat: float,
    lng: float,
) -> Dict:
    session = sessions.get(session_id, {})
    inc = {
        "incident_id": str(uuid.uuid4()),
        "session_id": session_id,
        "incident_type": incident_type,
        "confidence": confidence,
        "reason": reason,
        "clip_url": None,
        "thumbnail_url": None,
        "lat": lat or session.get("lat", 12.9716),
        "lng": lng or session.get("lng", 77.5946),
        "detected_at": time.time(),
        "status": "open",
    }
    incidents_by_session[session_id].append(inc)
    all_incidents.append(inc)
    return inc


def get_incidents_for_session(session_id: str) -> List[Dict]:
    return list(reversed(incidents_by_session.get(session_id, [])))


def get_incident_by_id(incident_id: str) -> Optional[Dict]:
    for inc in all_incidents:
        if inc["incident_id"] == incident_id:
            return inc
    return None
