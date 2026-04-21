from contextlib import asynccontextmanager
import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.security_middleware import SecurityHeadersMiddleware, RequestSizeLimitMiddleware
from app.core.rate_limit import auth_limiter, api_limiter
from app.api.routes import (
    health, confluence, proposals, audit, analyze, edit,
    stats, batch, rollback, duplicates, sync, chat,
    analysis_settings, sweep, dismissed, workspace
)
from app.db.database import init_db

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if settings.is_production:
        logger.info("DocAI API starting in PRODUCTION mode")
    else:
        logger.warning("DocAI API starting in DEVELOPMENT mode — auth enforcement relaxed")
    yield


app = FastAPI(
    title="DocAI API",
    version="0.1.0",
    # Docs disabled in production — enforced by APP_ENV=production in Railway
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
    openapi_url="/openapi.json" if not settings.is_production else None,
    lifespan=lifespan,
)

# ── Security headers — must be added before CORS ──────────────────────────────
app.add_middleware(
    SecurityHeadersMiddleware,
    is_production=settings.is_production
)

# ── Request size limit — 10MB max ─────────────────────────────────────────────
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=10 * 1024 * 1024)

# ── CORS ──────────────────────────────────────────────────────────────────────
origins = (
    ["http://localhost:3000", "http://localhost:5173"]
    if not settings.is_production
    else ["https://app.avantifai.com"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    max_age=600,  # Cache preflight for 10 minutes
)

# ── IP rate limiting on all routes ────────────────────────────────────────────
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    # Skip rate limiting for health checks
    if request.url.path in ("/health", "/"):
        return await call_next(request)

    ip = auth_limiter.get_client_ip(request)

    try:
        api_limiter.check(ip)
    except Exception:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please slow down."},
            headers={"Retry-After": "60"}
        )

    return await call_next(request)

# ── Auth dependency (applied to all non-health routes) ────────────────────────
_auth = [Depends(get_current_user)]

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(health.router, tags=["health"])
app.include_router(confluence.router,        prefix="/api/confluence",  tags=["confluence"],  dependencies=_auth)
app.include_router(proposals.router,         prefix="/api/proposals",   tags=["proposals"],   dependencies=_auth)
app.include_router(audit.router,             prefix="/api/audit",       tags=["audit"],       dependencies=_auth)
app.include_router(analyze.router,           prefix="/api/analyze",     tags=["analyze"],     dependencies=_auth)
app.include_router(edit.router,              prefix="/api/edit",        tags=["edit"],        dependencies=_auth)
app.include_router(sync.router,              prefix="/api/sync",        tags=["sync"],        dependencies=_auth)
app.include_router(stats.router,             prefix="/api/stats",       tags=["stats"],       dependencies=_auth)
app.include_router(batch.router,             prefix="/api/batch",       tags=["batch"],       dependencies=_auth)
app.include_router(rollback.router,          prefix="/api/rollback",    tags=["rollback"],    dependencies=_auth)
app.include_router(duplicates.router,        prefix="/api/duplicates",  tags=["duplicates"],  dependencies=_auth)
app.include_router(chat.router,              prefix="/api/chat",        tags=["chat"],        dependencies=_auth)
app.include_router(analysis_settings.router, prefix="/api/settings",   tags=["settings"],    dependencies=_auth)
app.include_router(sweep.router,             prefix="/api/sweep",       tags=["sweep"],       dependencies=_auth)
app.include_router(dismissed.router,         prefix="/api/pages",       tags=["dismissed"],   dependencies=_auth)
app.include_router(workspace.router,         prefix="/api/workspace",   tags=["workspace"],   dependencies=_auth)


# ── Global exception handler — never leak stack traces in production ───────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled exception on %s %s: %s",
        request.method, request.url.path, exc,
        exc_info=True
    )
    if settings.is_production:
        return JSONResponse(
            status_code=500,
            content={"detail": "An internal error occurred."}
        )
    # In development, return the actual error for debugging
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)}
    )
