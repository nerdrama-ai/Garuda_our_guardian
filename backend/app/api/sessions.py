from fastapi import APIRouter
from pydantic import BaseModel
from app import store

router = APIRouter()


class SessionCreate(BaseModel):
    device_token: str
    lat: float = 12.9716
    lng: float = 77.5946


@router.post("/sessions")
async def create_session(body: SessionCreate):
    session = store.create_session(body.device_token, body.lat, body.lng)
    return {
        "session_id": session["id"],
        "ws_url": f"ws://localhost:8000/stream/{session['id']}",
    }


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    session = store.get_session(session_id)
    if not session:
        from fastapi import HTTPException
        raise HTTPException(404, "Session not found")
    return session
