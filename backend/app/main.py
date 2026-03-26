from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.routes import health, confluence, proposals, audit, analyze, edit
from app.api.routes import sync
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