from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.db.database import get_db
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.models.dismissed_issue import DismissedIssue

router = APIRouter()


class DismissRequest(BaseModel):
    issue_id: str = Field(..., max_length=500)
    issue_title: str = Field(..., max_length=500)
    exact_content: str | None = Field(None, max_length=50000)

    @field_validator("issue_id", "issue_title", mode="before")
    @classmethod
    def strip_whitespace(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


@router.post("/{page_id}/dismiss")
async def dismiss_issue(
    page_id: str,
    body: DismissRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Mark a human-review issue as valid/resolved so Claude won't re-raise it."""
    # Upsert: delete any existing record for this workspace+page+issue then insert fresh
    await db.execute(
        delete(DismissedIssue).where(
            DismissedIssue.workspace_id == workspace.id,
            DismissedIssue.page_id == page_id,
            DismissedIssue.issue_id == body.issue_id,
        )
    )
    record = DismissedIssue(
        workspace_id=workspace.id,
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
    workspace: Workspace = Depends(get_current_workspace),
):
    """Return all dismissed issues for a page."""
    result = await db.execute(
        select(DismissedIssue).where(
            DismissedIssue.workspace_id == workspace.id,
            DismissedIssue.page_id == page_id,
        )
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
