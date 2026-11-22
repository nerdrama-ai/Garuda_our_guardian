from fastapi import APIRouter, HTTPException
from app import store

router = APIRouter()


@router.get("/incidents")
async def list_incidents(session_id: str):
    return {
        "total": len(store.incidents_by_session.get(session_id, [])),
        "items": store.get_incidents_for_session(session_id),
    }


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str):
    inc = store.get_incident_by_id(incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")
    return inc
