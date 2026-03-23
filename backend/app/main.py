from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.routes import health, confluence, proposals, audit

app = FastAPI(
    title="DocAI API",
    version="0.1.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
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
