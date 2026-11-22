import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app import store
from app.services.ai_analysis import analyse_frames, should_create_incident

router = APIRouter()
logger = logging.getLogger(__name__)

# Analyse every N frames
AI_BATCH_SIZE = int(__import__('os').getenv("AI_BATCH_SIZE", "10"))


async def run_ai_analysis(session_id: str, websocket: WebSocket):
    """
    Pull the last AI_BATCH_SIZE frames from the buffer, send to IBM Bob vision,
    and if an incident is detected create it and push to the WebSocket.
    """
    session = store.get_session(session_id)
    if not session:
        return

    # Grab the latest frames from the rolling buffer
    buffer = list(store.frame_buffers[session_id])
    if not buffer:
        return

    # Take up to AI_BATCH_SIZE most recent frames
    batch = buffer[-AI_BATCH_SIZE:]
    frame_bytes_list = [f["jpeg"] for f in batch]
    lat = batch[-1].get("lat", session.get("lat", 12.9716))
    lng = batch[-1].get("lng", session.get("lng", 77.5946))

    logger.info(f"[ai] analysing {len(frame_bytes_list)} frames for session={session_id}")

    result = await analyse_frames(frame_bytes_list)

    if result is None:
        logger.info(f"[ai] no result for session={session_id}")
        return

    logger.info(f"[ai] result for session={session_id}: {result}")

    if not should_create_incident(result):
        logger.info(f"[ai] below threshold or none — skipping incident creation")
        return

    # Create incident in store
    incident = store.create_incident(
        session_id=session_id,
        incident_type=result["incident"],
        confidence=float(result["confidence"]),
        reason=result["reason"],
        lat=lat,
        lng=lng,
    )

    logger.info(f"[ai] incident created: {incident['incident_id']} type={incident['incident_type']}")

    # Push notification over WebSocket if still connected
    try:
        await websocket.send_text(json.dumps({
            "type": "incident",
            **incident,
        }))
    except Exception as e:
        logger.warning(f"[ai] failed to push incident to ws: {e}")


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
        # Optional JSON init handshake
        try:
            first = await asyncio.wait_for(websocket.receive(), timeout=2.0)
            if first.get("text"):
                init = json.loads(first["text"])
                logger.info(f"[stream] session={session_id} init={init}")
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
                logger.info(f"[stream] session={session_id} frame={frame_count} size={len(frame_data)}B")

                # Every AI_BATCH_SIZE frames → trigger AI analysis in background
                if frame_count % AI_BATCH_SIZE == 0:
                    asyncio.create_task(run_ai_analysis(session_id, websocket))

            elif message.get("text"):
                try:
                    msg = json.loads(message["text"])
                    if msg.get("type") == "location":
                        session["lat"] = msg.get("lat", session["lat"])
                        session["lng"] = msg.get("lng", session["lng"])
                except Exception:
                    pass

    except WebSocketDisconnect:
        logger.info(f"[stream] session={session_id} disconnected after {frame_count} frames")
    finally:
        store.active_ws.pop(session_id, None)
