from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.db.database import get_db
from app.models.snapshot import Snapshot
from app.models.audit import AuditEntry
from app.services.confluence_service import ConfluenceService

router = APIRouter()


class RollbackRequest(BaseModel):
    rolled_back_by: str = "Dashboard User"


@router.post("/{snapshot_id}")
async def rollback_change(
    snapshot_id: str,
    body: RollbackRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Restore a Confluence page to its pre-change state using a stored snapshot.
    Marks the snapshot as rolled back and updates the audit entry.
    """
    snapshot = await db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if snapshot.rolled_back:
        raise HTTPException(status_code=400, detail="This change has already been rolled back")

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

    try:
        if snapshot.action == "rename":
            # Restore old title via v2 API
            await svc.rename_page_v2(snapshot.page_id, snapshot.page_title_before)

        elif snapshot.action == "consolidate-pages":
            # Page is in Confluence trash — normal get_page 404s.
            # Fetch via ?status=trashed to get the current version and space key.
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=20.0) as _client:
                trashed_resp = await _client.get(
                    f"{settings.atlassian_base_url.rstrip('/')}/wiki/rest/api/content/{snapshot.page_id}",
                    auth=(settings.atlassian_mail, settings.atlassian_api_token),
                    params={"status": "trashed", "expand": "version,space"},
                    headers={"Accept": "application/json"},
                )
            if not trashed_resp.is_success:
                raise HTTPException(
                    status_code=502,
                    detail=f"Could not fetch trashed page {snapshot.page_id}: {trashed_resp.status_code} {trashed_resp.text[:200]}",
                )
            trashed_data = trashed_resp.json()
            current_version = trashed_data.get("version", {}).get("number", snapshot.page_version_before)
            space_key = trashed_data.get("space", {}).get("key", "")

            restore_body = snapshot.page_body_before or ""
            await svc.restore_page(
                page_id=snapshot.page_id,
                title=snapshot.page_title_before,
                body=restore_body,
                version=current_version,
                space_key=space_key,
            )
        else:
            current = await svc.get_page(snapshot.page_id)
            current_version = current.get("version", {}).get("number", 1)

            # For renames the body was untouched — restore original title, keep current body
            # For content edits — restore original title + original body
            if snapshot.page_body_before is None:
                restore_body = current.get("body", {}).get("storage", {}).get("value", "")
            else:
                restore_body = snapshot.page_body_before

            await svc.update_page(
                page_id=snapshot.page_id,
                title=snapshot.page_title_before,
                body=restore_body,
                current_version=current_version,
                representation="storage",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Confluence API error: {exc}")

    # Mark snapshot as rolled back
    snapshot.rolled_back = True
    snapshot.rolled_back_at = datetime.now(timezone.utc)
    snapshot.rolled_back_by = body.rolled_back_by

    # Update audit entry decision to "rolled_back"
    stmt = pg_insert(AuditEntry).values(
        id=snapshot.proposal_id,
        page_id=snapshot.page_id,
        page_title=snapshot.page_title_before,
        space_key=None,
        action=snapshot.action,
        decision="rolled_back",
        reviewed_by=None,
        applied_by=snapshot.applied_by,
        rationale=None,
        note=f"Rolled back by {body.rolled_back_by}",
        snapshot_id=snapshot_id,
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={
            "decision": "rolled_back",
            "note": f"Rolled back by {body.rolled_back_by}",
            "updated_at": datetime.now(timezone.utc),
        },
    )
    await db.execute(stmt)

    return {
        "success": True,
        "message": f"Page '{snapshot.page_title_before}' restored to its pre-change state.",
        "snapshot_id": snapshot_id,
        "page_id": snapshot.page_id,
        "restored_title": snapshot.page_title_before,
    }
