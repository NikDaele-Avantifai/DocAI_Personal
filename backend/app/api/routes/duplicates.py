import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from typing import Literal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.auth import get_current_user
from app.core.usage import check_limit, track_usage
from app.core.workspace import get_current_workspace
from app.core.encryption import decrypt_token
from app.db.database import get_db
from app.models.workspace import Workspace
from app.models.page import Page
from app.services.embedding_service import EmbeddingService
from app.services.duplicate_service import DuplicateService
from app.services.confluence_service import ConfluenceService
from app.services.sync_service import SyncService
from app.api.routes.proposals import _proposals

router = APIRouter()
log = logging.getLogger(__name__)

_embed_svc     = EmbeddingService()
_duplicate_svc = DuplicateService()


def _build_confluence(workspace: Workspace) -> ConfluenceService | None:
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
        return None
    return ConfluenceService(base_url=base_url, api_token=api_token, email=email)


# ── Embedding endpoints ───────────────────────────────────────────────────────

@router.post("/embed-all")
async def embed_all(
    force: bool = Query(False, description="Clear all existing embeddings and re-embed from scratch"),
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    wid = workspace.id
    confluence = _build_confluence(workspace)
    fetched = 0
    fetch_failed = 0

    if confluence:
        sync_svc = SyncService(session=db, confluence=confluence, workspace_id=wid)
        rows = (
            await db.execute(
                select(Page.id, Page.title).where(
                    Page.workspace_id == wid,
                    (Page.content.is_(None)) | (Page.content == "")
                )
            )
        ).all()

        pages_to_fetch = [(r.id, r.title) for r in rows]
        log.info("embed-all: fetching content for %d pages without content", len(pages_to_fetch))

        for page_id, page_title in pages_to_fetch:
            try:
                await sync_svc.get_page_with_content(page_id, embedding_svc=_embed_svc)
                fetched += 1
            except Exception as exc:
                log.warning("embed-all: could not fetch content for %s (%s): %s", page_id, page_title, exc)
                fetch_failed += 1
    else:
        log.warning("embed-all: no Confluence credentials — skipping content fetch")

    try:
        result = await _embed_svc.embed_all_pages(db, force=force)
        result["content_fetched"] = fetched
        result["content_fetch_failed"] = fetch_failed
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}")


@router.post("/embed/{page_id}")
async def embed_single(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Fetches content (if missing) then embeds a single page."""
    confluence = _build_confluence(workspace)
    if confluence:
        row = (
            await db.execute(
                select(Page.content).where(
                    Page.workspace_id == workspace.id,
                    Page.id == page_id,
                )
            )
        ).scalar_one_or_none()
        if row is not None and not (row or "").strip():
            try:
                await SyncService(db, confluence, workspace_id=workspace.id).get_page_with_content(page_id)
            except Exception:
                pass

    try:
        success = await _embed_svc.embed_page(page_id, db)
        if not success:
            raise HTTPException(status_code=422, detail="Page has no content or was not found")
        return {"success": True, "page_id": page_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}")


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def embedding_status(
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Returns how many pages have embeddings vs total."""
    total = (await db.execute(
        select(Page).where(Page.workspace_id == workspace.id)
    )).scalars().all()
    embedded = [p for p in total if p.embedding is not None]
    spaces_result = {}
    for p in total:
        if p.space_key not in spaces_result:
            spaces_result[p.space_key] = {"total": 0, "embedded": 0}
        spaces_result[p.space_key]["total"] += 1
        if p.embedding is not None:
            spaces_result[p.space_key]["embedded"] += 1
    return {
        "total_pages": len(total),
        "embedded_pages": len(embedded),
        "missing_embeddings": len(total) - len(embedded),
        "by_space": spaces_result,
    }


# ── Scan endpoints ────────────────────────────────────────────────────────────

@router.get("/scan")
async def scan_all_duplicates(
    space_key: str | None = Query(None),
    threshold: float = Query(0.85, ge=0.5, le=0.99),
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Scans all embedded pages for duplicates. Run /embed-all first."""
    try:
        pairs = await _duplicate_svc.find_all_duplicates(db, threshold=threshold, space_key=space_key, workspace_id=workspace.id)
        return {"pairs": pairs, "total": len(pairs), "threshold": threshold, "space_key": space_key}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}")


@router.get("/scan/{page_id}")
async def scan_single_page(
    page_id: str,
    threshold: float = Query(0.85, ge=0.5, le=0.99),
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    try:
        matches = await _duplicate_svc.find_duplicates_for_page(page_id, db, threshold, workspace_id=workspace.id)
        return {"page_id": page_id, "matches": matches, "total": len(matches)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}")


# ── Merge proposal ────────────────────────────────────────────────────────────

class ProposeMergeRequest(BaseModel):
    page_a_id: str = Field(..., max_length=500)
    page_b_id: str = Field(..., max_length=500)

    @field_validator("page_a_id", "page_b_id", mode="before")
    @classmethod
    def strip_whitespace(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


class ProposeDuplicateRequest(BaseModel):
    page_a_id: str = Field(..., max_length=500)
    page_b_id: str = Field(..., max_length=500)
    action: Literal["remove-block", "consolidate-pages"]

    @field_validator("page_a_id", "page_b_id", mode="before")
    @classmethod
    def strip_whitespace(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


@router.post("/propose-duplicate")
async def propose_duplicate(
    body: ProposeDuplicateRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: dict = Depends(get_current_user),
):
    """Creates a structured duplication proposal with Claude-identified duplicate content."""
    existing = next(
        (p for p in _proposals.values()
         if p.get("workspace_id") == workspace.id
         and p.get("category") == "duplication"
         and {p.get("pageA", {}).get("id"), p.get("pageB", {}).get("id")} == {body.page_a_id, body.page_b_id}
         and p.get("action") == body.action),
        None,
    )
    if existing:
        return {"proposal": existing, "already_exists": True}

    await check_limit(db, workspace, "duplication_scan")

    try:
        proposal = await _duplicate_svc.generate_duplicate_proposal(
            body.page_a_id, body.page_b_id, body.action, db
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Proposal generation failed: {exc}")

    await track_usage(db, workspace, user, "duplication_scan", meta=f"{body.page_a_id},{body.page_b_id}")
    proposal["workspace_id"] = workspace.id
    _proposals[proposal["id"]] = proposal
    return {"proposal": proposal, "already_exists": False}


@router.post("/propose-merge")
async def propose_merge(
    body: ProposeMergeRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: dict = Depends(get_current_user),
):
    """Asks Claude to analyse two pages and creates a merge proposal in the Approvals queue."""
    existing = next(
        (p for p in _proposals.values()
         if p.get("workspace_id") == workspace.id
         and p.get("action") == "merge"
         and {p.get("source_page_id"), p.get("target_page_id")} == {body.page_a_id, body.page_b_id}),
        None,
    )
    if existing:
        return {"proposal": existing, "already_exists": True}

    await check_limit(db, workspace, "duplication_scan")

    try:
        proposal = await _duplicate_svc.generate_merge_proposal(body.page_a_id, body.page_b_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Proposal generation failed: {exc}")

    await track_usage(db, workspace, user, "duplication_scan", meta=f"{body.page_a_id},{body.page_b_id}")
    proposal["workspace_id"] = workspace.id
    _proposals[proposal["id"]] = proposal
    return {"proposal": proposal, "already_exists": False}
