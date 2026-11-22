from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import sessions, stream, incidents, demo

app = FastAPI(title="Garuda API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(stream.router)
app.include_router(incidents.router)
app.include_router(demo.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "garuda-backend"}
