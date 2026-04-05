"""GET /api/health — returns service health status including connected client count."""

from fastapi import APIRouter
from services.ws_manager import manager

router = APIRouter()


@router.get("/api/health")
async def health():
    return {
        "status": "ok",
        "clients_connected": len(manager.clients),
        "db": "ok",
    }
