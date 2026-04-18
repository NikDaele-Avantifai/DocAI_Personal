from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.auth import get_current_user
from app.core.config import settings
from app.api.routes import health, confluence, proposals, audit, analyze, edit, stats, batch, rollback, duplicates
from app.api.routes import sync, chat, analysis_settings, sweep, dismissed
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

# ── Auth dependency (applied to all non-health routes) ────────────────────────
# When AUTH0_DOMAIN is empty (dev), get_current_user returns a synthetic user
# and no token is required.  Set AUTH0_DOMAIN in .env to enforce real tokens.
_auth = [Depends(get_current_user)]

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(health.router, tags=["health"])  # always public
app.include_router(confluence.router,       prefix="/api/confluence",  tags=["confluence"],  dependencies=_auth)
app.include_router(proposals.router,        prefix="/api/proposals",   tags=["proposals"],   dependencies=_auth)
app.include_router(audit.router,            prefix="/api/audit",       tags=["audit"],       dependencies=_auth)
app.include_router(analyze.router,          prefix="/api/analyze",     tags=["analyze"],     dependencies=_auth)
app.include_router(edit.router,             prefix="/api/edit",        tags=["edit"],        dependencies=_auth)
app.include_router(sync.router,             prefix="/api/sync",        tags=["sync"],        dependencies=_auth)
app.include_router(stats.router,            prefix="/api/stats",       tags=["stats"],       dependencies=_auth)
app.include_router(batch.router,            prefix="/api/batch",       tags=["batch"],       dependencies=_auth)
app.include_router(rollback.router,         prefix="/api/rollback",    tags=["rollback"],    dependencies=_auth)
app.include_router(duplicates.router,       prefix="/api/duplicates",  tags=["duplicates"],  dependencies=_auth)
app.include_router(chat.router,             prefix="/api/chat",        tags=["chat"],        dependencies=_auth)
app.include_router(analysis_settings.router,prefix="/api/settings",   tags=["settings"],    dependencies=_auth)
app.include_router(sweep.router,            prefix="/api/sweep",       tags=["sweep"],       dependencies=_auth)
app.include_router(dismissed.router,        prefix="/api/pages",       tags=["dismissed"],   dependencies=_auth)