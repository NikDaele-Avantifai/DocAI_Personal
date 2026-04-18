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

        elif action == "remove-block":
            # Duplication proposal: remove duplicate content from the non-recommended page
            recommendation = proposal.get("recommendation", "keep-pageA")
            page_a_data = proposal.get("pageA", {})
            page_b_data = proposal.get("pageB", {})
            non_rec = page_b_data if recommendation == "keep-pageA" else page_a_data
            non_rec_id = non_rec.get("id", page_id)
            dup_content = non_rec.get("duplicateContent", "")
            page_id = non_rec_id  # override for audit/snapshot

            current = await svc.get_page(non_rec_id)
            original_title = current.get("title", proposal.get("source_page_title", ""))
            original_body = current.get("body", {}).get("storage", {}).get("value", "")
            original_ver = current.get("version", {}).get("number", 1)

            new_body = original_body.replace(dup_content, "", 1) if dup_content and dup_content in original_body else original_body

            snap = Snapshot(
                id=str(uuid.uuid4()),
                proposal_id=proposal_id,
                page_id=non_rec_id,
                action=action,
                page_title_before=original_title,
                page_body_before=original_body,
                page_version_before=original_ver,
                applied_by=body.applied_by,
                applied_at=datetime.now(timezone.utc),
            )
            db.add(snap)
            snapshot_id = snap.id

            await svc.update_page(non_rec_id, original_title, new_body, original_ver, "storage")

        elif action == "consolidate-pages":
            # Duplication proposal: archive the non-recommended page
            recommendation = proposal.get("recommendation", "keep-pageA")
            page_a_data = proposal.get("pageA", {})
            page_b_data = proposal.get("pageB", {})
            non_rec = page_b_data if recommendation == "keep-pageA" else page_a_data
            non_rec_id = non_rec.get("id", page_id)
            page_id = non_rec_id  # override for audit/snapshot

            # Snapshot content before archiving so rollback is possible
            current = await svc.get_page(non_rec_id)
            original_title = current.get("title", non_rec.get("title", ""))
            original_body = current.get("body", {}).get("storage", {}).get("value", "")
            original_ver = current.get("version", {}).get("number", 1)
            original_space = current.get("space", {}).get("key", "")
            # Store space_key for rollback
            proposal.setdefault("_archived_space_key", original_space)

            snap = Snapshot(
                id=str(uuid.uuid4()),
                proposal_id=proposal_id,
                page_id=non_rec_id,
                action=action,
                page_title_before=original_title,
                page_body_before=original_body,
                page_version_before=original_ver,
                applied_by=body.applied_by,
                applied_at=datetime.now(timezone.utc),
            )
            db.add(snap)
            snapshot_id = snap.id

            await svc.archive_page(non_rec_id)

        elif action == "rename":
            new_title = body.content_override or proposal.get("new_content")
            if not new_title:
                raise HTTPException(status_code=400, detail="No suggested title found on this proposal.")

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
                page_body_before=None,       # body is untouched by rename
                page_version_before=original_ver,
                applied_by=body.applied_by,
                applied_at=datetime.now(timezone.utc),
            )
            db.add(snap)
            snapshot_id = snap.id

            # Use v2 API for rename — handles version correctly
            await svc.rename_page_v2(page_id, new_title)

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


@router.get("/{proposal_id}/snapshot")
async def get_proposal_snapshot(
    proposal_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Return the snapshot metadata for an applied proposal (for rollback display)."""
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")

    result = await db.execute(
        select(Snapshot).where(Snapshot.proposal_id == proposal_id)
    )
    snap = result.scalar_one_or_none()
    if snap is None:
        raise HTTPException(status_code=404, detail="No snapshot found for this proposal")

    return {
        "id": snap.id,
        "proposal_id": snap.proposal_id,
        "page_id": snap.page_id,
        "page_title_before": snap.page_title_before,
        "page_version_before": snap.page_version_before,
        "action": snap.action,
        "applied_by": snap.applied_by,
        "applied_at": snap.applied_at.isoformat() if snap.applied_at else None,
        "rolled_back": snap.rolled_back,
        "rolled_back_at": snap.rolled_back_at.isoformat() if snap.rolled_back_at else None,
        "rolled_back_by": snap.rolled_back_by,
    }


class RollbackRequest(BaseModel):
    rolled_back_by: str = "Dashboard User"


@router.post("/{proposal_id}/rollback")
async def rollback_proposal(
    proposal_id: str,
    body: RollbackRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Roll back an applied duplication fix using its snapshot.
    - remove-block: restores the original page body
    - consolidate-pages: restores the archived page to current status
    """
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")

    proposal = _proposals[proposal_id]
    if proposal["status"] != "applied":
        raise HTTPException(status_code=400, detail="Only applied proposals can be rolled back")

    result = await db.execute(
        select(Snapshot).where(Snapshot.proposal_id == proposal_id)
    )
    snap = result.scalar_one_or_none()
    if snap is None:
        raise HTTPException(status_code=404, detail="No snapshot found — cannot rollback")
    if snap.rolled_back:
        raise HTTPException(status_code=400, detail="This change has already been rolled back")

    if not settings.atlassian_api_token or not settings.atlassian_mail:
        raise HTTPException(
            status_code=503,
            detail="Atlassian credentials not configured",
        )

    svc = ConfluenceService(
        base_url=settings.atlassian_base_url,
        api_token=settings.atlassian_api_token,
        email=settings.atlassian_mail,
    )

    action = snap.action

    try:
        if action == "rename":
            if not snap.page_title_before:
                raise HTTPException(status_code=400, detail="No title snapshot available to restore")
            try:
                await svc.rename_page_v2(snap.page_id, snap.page_title_before)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Confluence rename rollback failed: {exc}")

        elif action == "remove-block":
            # Restore original body content
            if not snap.page_body_before:
                raise HTTPException(status_code=400, detail="No body snapshot available to restore")
            current = await svc.get_page(snap.page_id)
            current_ver = current.get("version", {}).get("number", snap.page_version_before)
            await svc.update_page(
                snap.page_id, snap.page_title_before,
                snap.page_body_before, current_ver, "storage",
            )

        elif action == "consolidate-pages":
            # Restore archived page to current status
            if not snap.page_body_before:
                raise HTTPException(status_code=400, detail="No content snapshot available to restore")
            space_key = proposal.get("_archived_space_key", "")
            await svc.restore_page(
                snap.page_id, snap.page_title_before,
                snap.page_body_before, snap.page_version_before, space_key,
            )

        else:
            raise HTTPException(status_code=400, detail=f"Rollback not supported for action '{action}'")

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Confluence rollback failed: {exc}")

    now = datetime.now(timezone.utc)
    snap.rolled_back = True
    snap.rolled_back_at = now
    snap.rolled_back_by = body.rolled_back_by
    await db.commit()

    proposal["status"] = "pending"
    proposal["rolled_back_at"] = now.isoformat()

    return {
        "success": True,
        "message": "Change rolled back successfully.",
        "proposal_id": proposal_id,
        "rolled_back_at": now.isoformat(),
    }


class ApplyRenameItemRequest(BaseModel):
    page_id: str
    suggested_title: str
    applied_by: str = "Dashboard User"


@router.post("/{proposal_id}/apply-rename")
async def apply_rename_item(
    proposal_id: str,
    body: ApplyRenameItemRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Apply a single rename from a grouped rename proposal using the Confluence v2 API.
    """
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")

    proposal = _proposals[proposal_id]
    if proposal.get("action") != "rename":
        raise HTTPException(status_code=400, detail="Not a rename proposal")

    if not settings.atlassian_api_token or not settings.atlassian_mail:
        raise HTTPException(
            status_code=503,
            detail="Atlassian credentials not configured",
        )

    svc = ConfluenceService(
        base_url=settings.atlassian_base_url,
        api_token=settings.atlassian_api_token,
        email=settings.atlassian_mail,
    )

    renames = proposal.get("renames", [])
    rename_item = next((r for r in renames if r.get("pageId") == body.page_id), None)

    # Confluence does not expose a folder rename API — block at the backend
    if rename_item and rename_item.get("isFolder"):
        raise HTTPException(
            status_code=400,
            detail="Confluence folders cannot be renamed via the API. Rename this folder manually in Confluence.",
        )

    # Fetch current title for snapshot (needed for rollback)
    try:
        current_page = await svc.get_page(body.page_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Confluence API error fetching page: {exc}")

    original_title = current_page.get("title", body.page_id)
    original_ver = current_page.get("version", {}).get("number", 1)

    # Snapshot the current title so rollback can restore it
    snap = Snapshot(
        id=str(uuid.uuid4()),
        proposal_id=proposal_id,
        page_id=body.page_id,
        action="rename",
        page_title_before=original_title,
        page_body_before=None,
        page_version_before=original_ver,
        applied_by=body.applied_by,
        applied_at=datetime.now(timezone.utc),
    )
    db.add(snap)

    try:
        result = await svc.rename_page_v2(body.page_id, body.suggested_title)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Confluence API error: {exc}")

    # Mark this specific rename as applied in the proposal's renames list
    for r in renames:
        if r.get("pageId") == body.page_id:
            r["applied"] = True
            r["appliedTitle"] = body.suggested_title
            break

    # Upsert audit entry with snapshot link so rollback works
    stmt = pg_insert(AuditEntry).values(
        id=str(uuid.uuid4()),
        page_id=body.page_id,
        page_title=body.suggested_title,
        space_key=proposal.get("space_key"),
        action="rename",
        decision="applied",
        reviewed_by=None,
        applied_by=body.applied_by,
        rationale=proposal.get("rationale"),
        note=None,
        snapshot_id=snap.id,
    ).on_conflict_do_nothing()
    await db.execute(stmt)
    await db.commit()

    return {
        "success": True,
        "pageId": body.page_id,
        "newTitle": body.suggested_title,
        "confluenceVersion": result.get("version", {}).get("number"),
        "snapshotId": snap.id,
    }
