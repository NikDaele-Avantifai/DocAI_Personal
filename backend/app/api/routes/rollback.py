from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.core.workspace import get_current_workspace
from app.core.encryption import decrypt_token
from app.db.database import get_db
from app.models.workspace import Workspace
from app.models.snapshot import Snapshot
from app.models.audit import AuditEntry
from app.services.confluence_service import ConfluenceService

router = APIRouter()


def _build_confluence(workspace: Workspace) -> ConfluenceService:
    base_url = workspace.confluence_base_url or settings.atlassian_base_url
    email = workspace.confluence_email or settings.atlassian_mail
    api_token: str | None = None

    if workspace.confluence_api_token_enc:
        try:
            api_token = decrypt_token(workspace.confluence_api_token_enc)
        except Exception:
            api_token = None

    if not api_token:
        api_token = settings.atlassian_api_token

    if not api_token or not email:
        raise HTTPException(
            status_code=503,
            detail="Confluence credentials not configured. Set credentials in Settings.",
        )
    return ConfluenceService(base_url=base_url, api_token=api_token, email=email)


class RollbackRequest(BaseModel):
    rolled_back_by: str = "Dashboard User"


@router.post("/{snapshot_id}")
async def rollback_change(
    snapshot_id: str,
    body: RollbackRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """
    Restore a Confluence page to its pre-change state using a stored snapshot.
    Marks the snapshot as rolled back and updates the audit entry.
    """
    snapshot = await db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if snapshot.workspace_id != workspace.id:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if snapshot.rolled_back:
        raise HTTPException(status_code=400, detail="This change has already been rolled back")

    svc = _build_confluence(workspace)

    try:
        if snapshot.action == "rename":
            await svc.rename_page_v2(snapshot.page_id, snapshot.page_title_before)

        elif snapshot.action == "consolidate-pages":
            import httpx as _httpx
            base_url = workspace.confluence_base_url or settings.atlassian_base_url
            email = workspace.confluence_email or settings.atlassian_mail
            api_token: str | None = None
            if workspace.confluence_api_token_enc:
                try:
                    api_token = decrypt_token(workspace.confluence_api_token_enc)
                except Exception:
                    api_token = None
            if not api_token:
                api_token = settings.atlassian_api_token

            async with _httpx.AsyncClient(timeout=20.0) as _client:
                trashed_resp = await _client.get(
                    f"{base_url.rstrip('/')}/wiki/rest/api/content/{snapshot.page_id}",
                    auth=(email, api_token),
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

    snapshot.rolled_back = True
    snapshot.rolled_back_at = datetime.now(timezone.utc)
    snapshot.rolled_back_by = body.rolled_back_by

    stmt = pg_insert(AuditEntry).values(
        id=snapshot.proposal_id,
        workspace_id=workspace.id,
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
