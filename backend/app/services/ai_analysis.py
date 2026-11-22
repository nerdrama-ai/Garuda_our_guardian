"""
AI Analysis Service — uses IBM Bob's OpenAI-compatible vision endpoint
to analyse a batch of JPEG frames and detect traffic incidents.

Configure via environment variables:
  BOB_API_KEY     — your IBM Bob API key (or leave blank for local Bob)
  BOB_BASE_URL    — Bob model gateway base URL (default: http://localhost:11434/v1)
  BOB_MODEL       — vision-capable model name exposed by the gateway
  AI_CONFIDENCE_THRESHOLD — minimum confidence to create an incident (default: 0.75)
"""
import base64
import json
import logging
import os
from typing import Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# --- Config from env -----------------------------------------------------------
BOB_BASE_URL = os.getenv("BOB_BASE_URL", "http://localhost:11434/v1")
BOB_API_KEY  = os.getenv("BOB_API_KEY", "bob")          # Bob accepts any non-empty string
BOB_MODEL    = os.getenv("BOB_MODEL", "granite3.2-vision:latest")
CONFIDENCE_THRESHOLD = float(os.getenv("AI_CONFIDENCE_THRESHOLD", "0.75"))

# Singleton async client
_client: Optional[AsyncOpenAI] = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=BOB_API_KEY,
            base_url=BOB_BASE_URL,
        )
    return _client


SYSTEM_PROMPT = """You are a traffic incident detector analysing dashcam footage.
You will receive 1–10 sequential JPEG frames captured 1 second apart from a moving vehicle.

Identify if any of the following incidents are occurring:
- accident: collision, impact, airbag deployment, vehicle rollover, vehicles stopped after crash
- red_light_violation: vehicle crossing stop line after signal is red
- wrong_way_driver: vehicle moving against normal traffic flow
- pothole: significant road surface depression or damage visible on the road
- none: normal traffic conditions, no incident detected

Respond ONLY with valid JSON in exactly this format — no markdown, no explanation:
{
  "incident": "accident|red_light_violation|wrong_way_driver|pothole|none",
  "confidence": 0.0,
  "reason": "one sentence describing what was observed"
}"""


async def analyse_frames(frames: list[bytes]) -> Optional[dict]:
    """
    Send up to 10 JPEG frames to IBM Bob vision model.
    Returns parsed JSON dict or None on failure.
    """
    if not frames:
        return None

    client = get_client()

    # Build the message content: system prompt + one image per frame
    content = []
    for i, frame_bytes in enumerate(frames):
        b64 = base64.b64encode(frame_bytes).decode("utf-8")
        content.append({
            "type": "text",
            "text": f"Frame {i + 1} of {len(frames)}:"
        })
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{b64}",
                "detail": "low",   # low detail = faster, cheaper, sufficient for incident detection
            },
        })

    content.append({
        "type": "text",
        "text": "Analyse these frames and return a JSON incident report.",
    })

    try:
        response = await client.chat.completions.create(
            model=BOB_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": content},
            ],
            max_tokens=200,
            temperature=0.1,
        )

        raw = response.choices[0].message.content.strip()
        logger.info(f"[ai] raw response: {raw}")

        # Strip markdown fences if the model wraps in ```json ... ```
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        result = json.loads(raw)

        # Validate required fields
        if "incident" not in result or "confidence" not in result:
            logger.warning(f"[ai] unexpected response shape: {result}")
            return None

        return result

    except json.JSONDecodeError as e:
        logger.warning(f"[ai] JSON parse error: {e} — raw: {raw!r}")
        return None
    except Exception as e:
        logger.error(f"[ai] analysis failed: {e}")
        return None


def should_create_incident(result: dict) -> bool:
    """Return True if the AI result crosses the confidence threshold."""
    return (
        result.get("incident") not in (None, "none")
        and float(result.get("confidence", 0)) >= CONFIDENCE_THRESHOLD
    )
