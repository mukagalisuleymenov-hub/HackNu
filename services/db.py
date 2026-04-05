import asyncio
import json
import aiosqlite
from datetime import datetime, timedelta, timezone

DB_PATH = "telemetry.db"


async def init_db(db: aiosqlite.Connection):
    await db.execute("""
        CREATE TABLE IF NOT EXISTS telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            locomotive_id TEXT NOT NULL,
            locomotive_type TEXT NOT NULL,
            raw_json TEXT NOT NULL,
            health_index REAL,
            health_category TEXT
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            locomotive_id TEXT NOT NULL,
            code TEXT,
            severity TEXT,
            message TEXT,
            value REAL
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_ts ON telemetry(timestamp)")
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_loco_ts ON telemetry(locomotive_id, timestamp)"
    )
    await db.commit()


async def insert_frame(db: aiosqlite.Connection, frame: dict):
    await db.execute(
        """INSERT INTO telemetry
           (timestamp, locomotive_id, locomotive_type, raw_json, health_index, health_category)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            frame.get("timestamp"),
            frame.get("locomotive_id"),
            frame.get("locomotive_type"),
            json.dumps(frame),
            frame.get("health_index"),
            frame.get("health_category"),
        ),
    )
    for alert in frame.get("alerts", []):
        await db.execute(
            """INSERT INTO alerts
               (timestamp, locomotive_id, code, severity, message, value)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                frame.get("timestamp"),
                frame.get("locomotive_id"),
                alert.get("code"),
                alert.get("severity"),
                alert.get("message"),
                alert.get("value"),
            ),
        )
    await db.commit()


async def query_frames(
    db: aiosqlite.Connection,
    from_ts: str,
    to_ts: str,
    locomotive_id: str = None,
) -> list[dict]:
    if locomotive_id:
        cursor = await db.execute(
            """SELECT raw_json FROM telemetry
               WHERE timestamp >= ? AND timestamp <= ? AND locomotive_id = ?
               ORDER BY timestamp""",
            (from_ts, to_ts, locomotive_id),
        )
    else:
        cursor = await db.execute(
            """SELECT raw_json FROM telemetry
               WHERE timestamp >= ? AND timestamp <= ?
               ORDER BY timestamp""",
            (from_ts, to_ts),
        )
    rows = await cursor.fetchall()
    return [json.loads(row[0]) for row in rows]


async def _retention_loop(app):
    """Deletes rows older than 72 hours; runs every hour."""
    while True:
        await asyncio.sleep(3600)
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
        await app.state.db.execute(
            "DELETE FROM telemetry WHERE timestamp < ?", (cutoff,)
        )
        await app.state.db.execute(
            "DELETE FROM alerts WHERE timestamp < ?", (cutoff,)
        )
        await app.state.db.commit()


def start_retention_task(app):
    asyncio.create_task(_retention_loop(app))
