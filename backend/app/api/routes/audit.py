from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.models.audit import AuditEntry

router = APIRouter()


def _entry_dict(e: AuditEntry) -> dict:
    return {
        "id": e.id,
        "page_id": e.page_id,
        "page_title": e.page_title,
        "space_key": e.space_key,
        "action": e.action,
        "decision": e.decision,
        "reviewed_by": e.reviewed_by,
        "applied_by": e.applied_by,
        "rationale": e.rationale,
        "note": e.note,
        "snapshot_id": e.snapshot_id,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


@router.get("/")
async def list_audit_entries(
    decision: str | None = Query(None, description="Filter: approved, rejected, applied"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    q = select(AuditEntry).where(
        AuditEntry.workspace_id == workspace.id
    ).order_by(AuditEntry.updated_at.desc())
    if decision:
        q = q.where(AuditEntry.decision == decision)

    total_q = select(func.count()).select_from(AuditEntry).where(
        AuditEntry.workspace_id == workspace.id
    )
    if decision:
        total_q = total_q.where(AuditEntry.decision == decision)

    total = (await db.execute(total_q)).scalar() or 0
    rows = (await db.execute(q.offset(offset).limit(limit))).scalars().all()

    return {"entries": [_entry_dict(e) for e in rows], "total": total}
