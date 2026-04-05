"""Pydantic schemas for telemetry frames and alerts matching the WebSocket message format."""

from typing import Any, Optional
from pydantic import BaseModel


class AlertModel(BaseModel):
    code: str
    severity: str
    message: str
    value: Optional[float] = None


class TelemetryFrame(BaseModel):
    type: str
    timestamp: str
    locomotive_id: str
    locomotive_type: str
    data: dict[str, Any]
    alerts: list[AlertModel] = []
    health_index: Optional[float] = None
    health_category: Optional[str] = None
