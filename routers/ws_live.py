"""WebSocket endpoint /ws/live — broadcasts live telemetry to frontend clients."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from services.ws_manager import manager

router = APIRouter()


@router.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await manager.connect(ws)
    print(f"✓ Frontend client connected ({len(manager.clients)} total)")
    try:
        while True:
            await ws.receive_text()  # keep-alive; ignore client messages
    except WebSocketDisconnect:
        manager.disconnect(ws)
        print(f"✗ Frontend client disconnected ({len(manager.clients)} total)")
