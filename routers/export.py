"""GET /api/export?from=&to=&format=csv — streams telemetry history as a CSV download."""

import csv
import io
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from services import db

router = APIRouter()


def _default_range() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    return (now - timedelta(hours=1)).isoformat(), now.isoformat()


@router.get("/api/export")
async def export(
    request: Request,
    from_: str = Query(None, alias="from"),
    to: str = None,
    format: str = "csv",
):
    from_ts, to_ts = (from_, to) if from_ and to else _default_range()
    frames = await db.query_frames(request.app.state.db, from_ts, to_ts)

    def generate():
        fixed_cols = [
            "timestamp", "locomotive_id", "locomotive_type",
            "health_index", "health_category",
        ]
        # Collect all data keys preserving insertion order
        seen: set[str] = set()
        data_keys: list[str] = []
        for frame in frames:
            for k in frame.get("data", {}):
                if k not in seen:
                    data_keys.append(k)
                    seen.add(k)

        buf = io.StringIO()
        writer = csv.DictWriter(
            buf, fieldnames=fixed_cols + data_keys, extrasaction="ignore"
        )
        writer.writeheader()
        yield buf.getvalue()

        for frame in frames:
            buf.seek(0)
            buf.truncate()
            row = {
                "timestamp": frame.get("timestamp"),
                "locomotive_id": frame.get("locomotive_id"),
                "locomotive_type": frame.get("locomotive_type"),
                "health_index": frame.get("health_index"),
                "health_category": frame.get("health_category"),
            }
            row.update(frame.get("data", {}))
            writer.writerow(row)
            yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=telemetry.csv"},
    )
