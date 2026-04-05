"""WebSocket endpoint /ws/ingest — receives telemetry frames from the simulator."""

import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from services.ws_manager import manager
from services import db

router = APIRouter()


@router.websocket("/ws/ingest")
async def ws_ingest(ws: WebSocket):
    await ws.accept()
    app = ws.scope["app"]
    print("✓ Simulator connected")
    try:
        while True:
            raw = await ws.receive_text()
            frame = json.loads(raw)
            await db.insert_frame(app.state.db, frame)
            await manager.broadcast(frame)
    except WebSocketDisconnect:
        print("✗ Simulator disconnected")
