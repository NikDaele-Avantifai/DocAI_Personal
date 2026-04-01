from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.routes import health, confluence, proposals, audit, analyze, edit, stats, batch, rollback, duplicates
from app.api.routes import sync, chat, analysis_settings
from app.db.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="DocAI API",
    version="0.1.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# In production, lock this down to your actual frontend domain
origins = (
    ["*"]
    if not settings.is_production
    else ["https://app.docai.io"]  # update with real domain
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(health.router, tags=["health"])
app.include_router(confluence.router, prefix="/api/confluence", tags=["confluence"])
app.include_router(proposals.router, prefix="/api/proposals", tags=["proposals"])
app.include_router(audit.router, prefix="/api/audit", tags=["audit"])
app.include_router(analyze.router, prefix="/api/analyze", tags=["analyze"])
app.include_router(edit.router, prefix="/api/edit", tags=["edit"])
app.include_router(sync.router, prefix="/api/sync", tags=["sync"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(batch.router, prefix="/api/batch", tags=["batch"])
app.include_router(rollback.router, prefix="/api/rollback", tags=["rollback"])
app.include_router(duplicates.router, prefix="/api/duplicates", tags=["duplicates"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(analysis_settings.router, prefix="/api/settings", tags=["settings"])