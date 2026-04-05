"""GET/PUT /api/config/thresholds — reads and overwrites telemetry_config.json. PUT requires Basic auth."""

import json
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBasic, HTTPBasicCredentials

CONFIG_PATH = "telemetry_config.json"

router = APIRouter()
_security = HTTPBasic()

_AUTH_USER = os.getenv("AUTH_USER", "admin").encode()
_AUTH_PASS = os.getenv("AUTH_PASS", "admin").encode()


def _verify(creds: HTTPBasicCredentials = Depends(_security)):
    ok = secrets.compare_digest(creds.username.encode(), _AUTH_USER) and \
         secrets.compare_digest(creds.password.encode(), _AUTH_PASS)
    if not ok:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )


@router.get("/api/config/thresholds")
async def get_thresholds():
    with open(CONFIG_PATH) as f:
        return json.load(f)


@router.put("/api/config/thresholds", dependencies=[Depends(_verify)])
async def put_thresholds(body: dict):
    with open(CONFIG_PATH, "w") as f:
        json.dump(body, f, indent=2)
    return {"status": "updated"}
