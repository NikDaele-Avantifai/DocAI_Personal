from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.page import Space, Page
from app.models.audit import AuditEntry

router = APIRouter()


@router.get("/")
async def get_stats(db: AsyncSession = Depends(get_db)):
    # DB counts
    pages_total = (await db.execute(select(func.count()).select_from(Page))).scalar() or 0
    spaces_total = (await db.execute(select(func.count()).select_from(Space))).scalar() or 0
    applied_count = (await db.execute(
        select(func.count()).select_from(AuditEntry).where(AuditEntry.decision == "applied")
    )).scalar() or 0
    reviewed_count = (await db.execute(
        select(func.count()).select_from(AuditEntry)
    )).scalar() or 0

    # In-memory proposal counts
    from app.api.routes.proposals import _proposals
    pending = sum(1 for p in _proposals.values() if p["status"] == "pending")
    approved_pending_apply = sum(
        1 for p in _proposals.values() if p["status"] == "approved"
    )

    # Recent audit activity (last 8 entries)
    recent_rows = (await db.execute(
        select(AuditEntry).order_by(AuditEntry.updated_at.desc()).limit(8)
    )).scalars().all()

    recent_activity = [
        {
            "id": e.id,
            "page_title": e.page_title,
            "space_key": e.space_key,
            "action": e.action,
            "decision": e.decision,
            "reviewed_by": e.reviewed_by,
            "updated_at": e.updated_at.isoformat() if e.updated_at else None,
        }
        for e in recent_rows
    ]

    return {
        "pages_total": pages_total,
        "spaces_total": spaces_total,
        "proposals_pending": pending,
        "proposals_awaiting_apply": approved_pending_apply,
        "changes_applied": applied_count,
        "decisions_made": reviewed_count,
        "recent_activity": recent_activity,
    }
