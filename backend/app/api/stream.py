import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app import store

router = APIRouter()

# Simple AI simulation: every 10 frames, randomly detect an incident
INCIDENT_POOL = [
    ("accident",            0.94, "Rear-end collision detected — sudden deceleration and impact frames observed."),
    ("wrong_way_driver",    0.91, "Vehicle traveling opposite to traffic flow on a one-way road segment."),
    ("red_light_violation", 0.88, "Vehicle crossed stop line approximately 2 seconds after signal turned red."),
    ("pothole",             0.86, "Significant road surface depression detected, approximately 30cm diameter."),
]


@router.websocket("/stream/{session_id}")
async def websocket_stream(websocket: WebSocket, session_id: str):
    session = store.get_session(session_id)
    if not session:
        await websocket.close(code=4004)
        return

    await websocket.accept()
    store.active_ws[session_id] = websocket
    frame_count = 0

    try:
        # Read the JSON init handshake (optional)
        try:
            first = await asyncio.wait_for(websocket.receive(), timeout=2.0)
            if first.get("text"):
                init = json.loads(first["text"])
                print(f"[stream] session={session_id} init={init}")
        except (asyncio.TimeoutError, Exception):
            pass

        while True:
            message = await websocket.receive()

            if message.get("bytes"):
                frame_data = message["bytes"]
                lat = session.get("lat", 12.9716)
                lng = session.get("lng", 77.5946)
                store.push_frame(session_id, frame_data, lat, lng)
                frame_count += 1
                print(f"[stream] session={session_id} frame={frame_count} size={len(frame_data)}B")

            elif message.get("text"):
                try:
                    msg = json.loads(message["text"])
                    if msg.get("type") == "location":
                        session["lat"] = msg.get("lat", session["lat"])
                        session["lng"] = msg.get("lng", session["lng"])
                except Exception:
                    pass

    except WebSocketDisconnect:
        print(f"[stream] session={session_id} disconnected after {frame_count} frames")
    finally:
        store.active_ws.pop(session_id, None)
