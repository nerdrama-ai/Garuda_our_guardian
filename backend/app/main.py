import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api import sessions, stream, incidents, demo

app = FastAPI(title="Garuda API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve crash-clip videos from the repo's crashclips/ directory
_clips_dir = os.path.join(os.path.dirname(__file__), "..", "..", "crashclips")
_clips_dir = os.path.normpath(_clips_dir)
if os.path.isdir(_clips_dir):
    app.mount("/clips", StaticFiles(directory=_clips_dir), name="clips")

app.include_router(sessions.router)
app.include_router(stream.router)
app.include_router(incidents.router)
app.include_router(demo.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "garuda-backend"}
