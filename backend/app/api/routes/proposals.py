from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Literal
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import select

from app.core.config import settings
from app.db.database import get_db
from app.models.audit import AuditEntry
from app.models.page import Page
from app.models.snapshot import Snapshot
from app.services.confluence_service import ConfluenceService

router = APIRouter()

# In-memory store for now — replace with PostgreSQL in next phase
_proposals: dict[str, dict] = {}


class CreateProposalRequest(BaseModel):
    action: Literal["archive", "merge", "restructure", "update_owner", "add_summary", "retag"]
    source_page_id: str
    source_page_title: str
    target_page_id: str | None = None
    target_page_title: str | None = None
    rationale: str
    diff: str | None = None


class ReviewProposalRequest(BaseModel):
    status: Literal["approved", "rejected"]
    reviewed_by: str
    note: str | None = None


@router.get("/")
async def list_proposals(status: str | None = None):
    proposals = list(_proposals.values())
    if status:
        proposals = [p for p in proposals if p["status"] == status]
    return {"proposals": proposals, "total": len(proposals)}


@router.post("/")
async def create_proposal(body: CreateProposalRequest):
    proposal_id = str(uuid.uuid4())
    proposal = {
        "id": proposal_id,
        **body.model_dump(),
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
        "reviewed_at": None,
        "reviewed_by": None,
    }
    _proposals[proposal_id] = proposal
    return proposal


@router.patch("/{proposal_id}/review")
async def review_proposal(
    proposal_id: str,
    body: ReviewProposalRequest,
    db: AsyncSession = Depends(get_db),
):
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")

    proposal = _proposals[proposal_id]
    if proposal["status"] != "pending":
        raise HTTPException(status_code=400, detail="Proposal already reviewed")

    proposal["status"] = body.status
    proposal["reviewed_by"] = body.reviewed_by
    proposal["reviewed_at"] = datetime.now(timezone.utc).isoformat()
    if body.note:
        proposal["note"] = body.note

    # Write to audit log
    stmt = pg_insert(AuditEntry).values(
        id=proposal_id,
        page_id=proposal.get("source_page_id", ""),
        page_title=proposal.get("source_page_title", "Unknown Page"),
        space_key=proposal.get("space_key"),
        action=proposal.get("action", ""),
        decision=body.status,
        reviewed_by=body.reviewed_by,
        rationale=proposal.get("rationale"),
        note=body.note,
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={"decision": body.status, "reviewed_by": body.reviewed_by, "note": body.note,
              "updated_at": datetime.now(timezone.utc)},
    )
    await db.execute(stmt)

    return proposal


@router.get("/{proposal_id}")
async def get_proposal(proposal_id: str):
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return _proposals[proposal_id]


class ApplyProposalRequest(BaseModel):
    applied_by: str = "Dashboard User"
    content_override: str | None = None  # user-edited content takes precedence over AI-generated


@router.post("/{proposal_id}/apply")
async def apply_proposal(
    proposal_id: str,
    body: ApplyProposalRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Apply an approved proposal to Confluence using server-side credentials from config.
    If content_override is provided, it is used instead of the AI-generated new_content.
    """
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")

    proposal = _proposals[proposal_id]
    if proposal["status"] not in ("approved", "pending"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot apply a proposal with status '{proposal['status']}'",
        )

    if not settings.atlassian_api_token or not settings.atlassian_mail:
        raise HTTPException(
            status_code=503,
            detail="Atlassian credentials not configured. Set ATLASSIAN_API_TOKEN and ATLASSIAN_MAIL in backend/.env",
        )

    svc = ConfluenceService(
        base_url=settings.atlassian_base_url,
        api_token=settings.atlassian_api_token,
        email=settings.atlassian_mail,
    )

    action = proposal.get("action")
    page_id = proposal["source_page_id"]
    snapshot_id: str | None = None

    try:
        if action == "archive":
            # Archives are not automatically reversible — no snapshot
            await svc.archive_page(page_id)

        elif action == "rename":
            new_title = body.content_override or proposal.get("new_content")
            if not new_title:
                raise HTTPException(status_code=400, detail="No suggested title found on this proposal.")

            # Fetch current state for snapshot, then rename in one pass
            current = await svc.get_page(page_id)
            original_title = current.get("title", proposal["source_page_title"])
            original_body  = current.get("body", {}).get("storage", {}).get("value", "")
            original_ver   = current.get("version", {}).get("number", 1)

            snap = Snapshot(
                id=str(uuid.uuid4()),
                proposal_id=proposal_id,
                page_id=page_id,
                action=action,
                page_title_before=original_title,
                page_body_before=None,       # body is untouched by rename
                page_version_before=original_ver,
                applied_by=body.applied_by,
                applied_at=datetime.now(timezone.utc),
            )
            db.add(snap)
            snapshot_id = snap.id

            # Update title, preserve existing body (already in storage format)
            await svc.update_page(page_id, new_title, original_body, original_ver, "storage")

        else:
            new_content = body.content_override or proposal.get("new_content")
            if not new_content:
                raise HTTPException(
                    status_code=400,
                    detail="This proposal has no generated content to apply. Use /api/edit/generate first.",
                )

            # Fetch current state for snapshot
            current = await svc.get_page(page_id)
            original_title = current.get("title", proposal["source_page_title"])
            original_body  = current.get("body", {}).get("storage", {}).get("value", "")
            original_ver   = current.get("version", {}).get("number", 1)

            snap = Snapshot(
                id=str(uuid.uuid4()),
                proposal_id=proposal_id,
                page_id=page_id,
                action=action,
                page_title_before=original_title,
                page_body_before=original_body,
                page_version_before=original_ver,
                applied_by=body.applied_by,
                applied_at=datetime.now(timezone.utc),
            )
            db.add(snap)
            snapshot_id = snap.id

            await svc.update_page(page_id, original_title, new_content, original_ver)

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Confluence API error: {exc}")

    proposal["status"] = "applied"
    proposal["applied_at"] = datetime.now(timezone.utc).isoformat()
    proposal["applied_by"] = body.applied_by

    # Stamp last_fixed_at on the page record
    page_row = await db.execute(select(Page).where(Page.id == page_id))
    page_record = page_row.scalar_one_or_none()
    if page_record is not None:
        page_record.last_fixed_at = datetime.now(timezone.utc)

    # Upsert audit entry with snapshot link
    stmt = pg_insert(AuditEntry).values(
        id=proposal_id,
        page_id=proposal.get("source_page_id", ""),
        page_title=proposal.get("source_page_title", "Unknown Page"),
        space_key=proposal.get("space_key"),
        action=proposal.get("action", ""),
        decision="applied",
        reviewed_by=proposal.get("reviewed_by"),
        applied_by=body.applied_by,
        rationale=proposal.get("rationale"),
        note=proposal.get("note"),
        snapshot_id=snapshot_id,
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={
            "decision": "applied",
            "applied_by": body.applied_by,
            "snapshot_id": snapshot_id,
            "updated_at": datetime.now(timezone.utc),
        },
    )
    await db.execute(stmt)

    return {
        "success": True,
        "message": "Changes applied to Confluence successfully.",
        "proposal": proposal,
        "snapshot_id": snapshot_id,
    }
