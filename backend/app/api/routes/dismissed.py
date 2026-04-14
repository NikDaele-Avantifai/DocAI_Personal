from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.db.database import get_db
from app.models.dismissed_issue import DismissedIssue

router = APIRouter()


class DismissRequest(BaseModel):
    issue_id: str
    issue_title: str
    exact_content: str | None = None


@router.post("/{page_id}/dismiss")
async def dismiss_issue(
    page_id: str,
    body: DismissRequest,
    db: AsyncSession = Depends(get_db),
):
    """Mark a human-review issue as valid/resolved so Claude won't re-raise it."""
    # Upsert: delete any existing record for this page+issue then insert fresh
    await db.execute(
        delete(DismissedIssue).where(
            DismissedIssue.page_id == page_id,
            DismissedIssue.issue_id == body.issue_id,
        )
    )
    record = DismissedIssue(
        page_id=page_id,
        issue_id=body.issue_id,
        issue_title=body.issue_title,
        exact_content=body.exact_content,
    )
    db.add(record)
    await db.commit()
    return {"dismissed": True, "page_id": page_id, "issue_id": body.issue_id}


@router.get("/{page_id}/dismissed")
async def list_dismissed(
    page_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Return all dismissed issues for a page."""
    result = await db.execute(
        select(DismissedIssue).where(DismissedIssue.page_id == page_id)
    )
    rows = result.scalars().all()
    return {
        "dismissed": [
            {
                "issue_id": r.issue_id,
                "issue_title": r.issue_title,
                "exact_content": r.exact_content,
                "dismissed_at": r.dismissed_at.isoformat(),
            }
            for r in rows
        ]
    }
