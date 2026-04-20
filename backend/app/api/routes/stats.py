from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.models.page import Space, Page
from app.models.audit import AuditEntry
from app.models.page_analysis import PageAnalysis

router = APIRouter()


@router.get("/")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    wid = workspace.id

    # DB counts scoped to workspace
    pages_total = (await db.execute(
        select(func.count()).select_from(Page).where(Page.workspace_id == wid)
    )).scalar() or 0
    spaces_total = (await db.execute(
        select(func.count()).select_from(Space).where(Space.workspace_id == wid)
    )).scalar() or 0
    pages_healthy = (await db.execute(
        select(func.count()).select_from(Page).where(
            Page.workspace_id == wid,
            Page.is_healthy == True  # noqa: E712
        )
    )).scalar() or 0
    applied_count = (await db.execute(
        select(func.count()).select_from(AuditEntry).where(
            AuditEntry.workspace_id == wid,
            AuditEntry.decision == "applied",
        )
    )).scalar() or 0
    reviewed_count = (await db.execute(
        select(func.count()).select_from(AuditEntry).where(AuditEntry.workspace_id == wid)
    )).scalar() or 0

    # In-memory proposal counts — filter by workspace
    from app.api.routes.proposals import _proposals
    pending = sum(
        1 for p in _proposals.values()
        if p.get("workspace_id") == wid and p["status"] == "pending"
    )
    approved_pending_apply = sum(
        1 for p in _proposals.values()
        if p.get("workspace_id") == wid and p["status"] == "approved"
    )

    # Most recent sync time
    last_space = (await db.execute(
        select(Space).where(Space.workspace_id == wid).order_by(Space.last_synced.desc()).limit(1)
    )).scalar_one_or_none()
    last_sync = last_space.last_synced.isoformat() if (last_space and last_space.last_synced) else None

    # Recent audit activity (last 8 entries)
    recent_rows = (await db.execute(
        select(AuditEntry).where(AuditEntry.workspace_id == wid)
        .order_by(AuditEntry.updated_at.desc()).limit(8)
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
        "pages_healthy": pages_healthy,
        "proposals_pending": pending,
        "proposals_awaiting_apply": approved_pending_apply,
        "changes_applied": applied_count,
        "decisions_made": reviewed_count,
        "last_sync": last_sync,
        "recent_activity": recent_activity,
    }
