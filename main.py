import aiosqlite
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from services import db as db_service
from routers import ws_ingest, ws_live, history, config_api, export, health_check


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db = await aiosqlite.connect(db_service.DB_PATH)
    await db_service.init_db(app.state.db)
    db_service.start_retention_task(app)
    yield
    await app.state.db.close()


app = FastAPI(title="Locomotive Digital Twin", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws_ingest.router)
app.include_router(ws_live.router)
app.include_router(history.router)
app.include_router(config_api.router)
app.include_router(export.router)
app.include_router(health_check.router)
