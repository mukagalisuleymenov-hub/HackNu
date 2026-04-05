"""HTTP endpoints for telemetry history: GET /api/history and GET /api/history/replay (SSE)."""

import asyncio
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from services import db

router = APIRouter()


def _default_range() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    return (now - timedelta(hours=1)).isoformat(), now.isoformat()


@router.get("/api/history")
async def history(
    request: Request,
    from_: str = Query(None, alias="from"),
    to: str = None,
    locomotive_id: str = None,
):
    from_ts, to_ts = (from_, to) if from_ and to else _default_range()
    frames = await db.query_frames(request.app.state.db, from_ts, to_ts, locomotive_id)
    return frames


@router.get("/api/history/replay")
async def history_replay(
    request: Request,
    from_: str = Query(None, alias="from"),
    to: str = None,
    speed: float = 1.0,
):
    from_ts, to_ts = (from_, to) if from_ and to else _default_range()
    frames = await db.query_frames(request.app.state.db, from_ts, to_ts)
    delay = 1.0 / max(speed, 0.01)

    async def event_stream():
        for frame in frames:
            yield f"data: {json.dumps(frame)}\n\n"
            await asyncio.sleep(delay)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
