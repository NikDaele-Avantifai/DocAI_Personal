import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.workspace import get_current_workspace
from app.core.encryption import decrypt_token
from app.db.database import get_db, AsyncSessionLocal
from app.models.workspace import Workspace
from app.models.page import Page
from app.models.job import BackgroundJob
from app.services.confluence_service import ConfluenceService
from app.services.embedding_service import EmbeddingService
from app.services.sync_service import SyncService

log = logging.getLogger(__name__)
_embed_svc = EmbeddingService()

CONCURRENT_FETCHES = 10

router = APIRouter()


def _build_confluence(workspace: Workspace) -> ConfluenceService:
    """Build a ConfluenceService from workspace credentials, falling back to settings."""
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
            detail=(
                "Confluence credentials not configured. "
                "Set credentials in Settings or via ATLASSIAN_API_TOKEN and ATLASSIAN_MAIL in backend/.env"
            ),
        )
    return ConfluenceService(base_url=base_url, api_token=api_token, email=email)


def _build_confluence_from_values(
    base_url: str,
    email: str,
    api_token_enc: str | None,
) -> ConfluenceService:
    """Helper for building ConfluenceService from raw values (used in background tasks)."""
    api_token: str | None = None
    if api_token_enc:
        try:
            api_token = decrypt_token(api_token_enc)
        except Exception:
            api_token = None
    if not api_token:
        api_token = settings.atlassian_api_token
    if not api_token or not email:
        raise ValueError("Confluence credentials not available")
    return ConfluenceService(base_url=base_url, api_token=api_token, email=email)


async def _background_embed(workspace_id: str) -> None:
    """
    Fetch content for un-fetched pages and embed them.
    Runs concurrently (CONCURRENT_FETCHES at a time) with job progress tracking.
    """
    job_id = str(uuid.uuid4())

    # Find pages needing content
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                sa_select(Page.id, Page.title).where(
                    Page.workspace_id == workspace_id,
                    (Page.content.is_(None)) | (Page.content == "")
                )
            )
        ).all()

        if not rows:
            await _embed_svc.embed_all_pages(session)
            return

        job = BackgroundJob(
            id=job_id,
            workspace_id=workspace_id,
            job_type="embed",
            status="running",
            total=len(rows),
            completed=0,
            failed=0,
        )
        session.add(job)
        await session.commit()

    # Build Confluence service
    async with AsyncSessionLocal() as session:
        workspace = await session.get(Workspace, workspace_id)
        if not workspace:
            return
        try:
            confluence_svc = _build_confluence_from_values(
                base_url=workspace.confluence_base_url or settings.atlassian_base_url,
                email=workspace.confluence_email or settings.atlassian_mail,
                api_token_enc=workspace.confluence_api_token_enc,
            )
        except Exception:
            async with AsyncSessionLocal() as s:
                job = await s.get(BackgroundJob, job_id)
                if job:
                    job.status = "failed"
                    job.error = "Confluence credentials not available"
                    job.completed_at = datetime.now(timezone.utc)
                    s.add(job)
                    await s.commit()
            return

    page_ids = [r.id for r in rows]
    semaphore = asyncio.Semaphore(CONCURRENT_FETCHES)

    async def fetch_one(page_id: str) -> bool:
        async with semaphore:
            try:
                async with AsyncSessionLocal() as s:
                    svc = SyncService(
                        session=s,
                        confluence=confluence_svc,
                        workspace_id=workspace_id,
                    )
                    await svc.get_page_with_content(page_id, embedding_svc=_embed_svc)
                    return True
            except Exception as exc:
                log.warning("embed: content fetch failed for %s: %s", page_id, exc)
                return False

    results = await asyncio.gather(*[fetch_one(pid) for pid in page_ids])
    completed = sum(1 for r in results if r)
    failed = sum(1 for r in results if not r)

    # Final embedding pass over all pages with content
    async with AsyncSessionLocal() as session:
        await _embed_svc.embed_all_pages(session)

    # Record job outcome
    async with AsyncSessionLocal() as session:
        job = await session.get(BackgroundJob, job_id)
        if job:
            job.status = "completed" if failed == 0 else "completed_with_errors"
            job.completed = completed
            job.failed = failed
            job.completed_at = datetime.now(timezone.utc)
            session.add(job)
            await session.commit()

    log.info(
        "embed job %s complete: %d/%d pages fetched, %d failed",
        job_id, completed, len(page_ids), failed,
    )

    # Chunk pages for RAG retrieval
    try:
        from app.services.chunking_service import chunk_workspace
        async with AsyncSessionLocal() as chunk_session:
            result = await chunk_workspace(
                workspace_id=workspace_id,
                embedding_svc=_embed_svc,
                db=chunk_session,
                force=False,
            )
            log.info(
                "RAG chunking complete: %d/%d pages processed",
                result["processed"], result["total"],
            )
    except Exception as exc:
        log.error("RAG chunking failed (non-fatal): %s", exc)


@router.post("/spaces")
async def sync_all_spaces(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Trigger a full sync of all Confluence spaces the configured user can access."""
    try:
        svc = SyncService(session=db, confluence=_build_confluence(workspace), workspace_id=workspace.id)
        result = await svc.sync_all_spaces()
        background_tasks.add_task(_background_embed, workspace.id)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Sync failed: {exc}")


@router.post("/spaces/{space_key}")
async def sync_single_space(
    space_key: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Trigger a sync of a single Confluence space."""
    try:
        svc = SyncService(session=db, confluence=_build_confluence(workspace), workspace_id=workspace.id)
        result = await svc.sync_space(space_key)
        background_tasks.add_task(_background_embed, workspace.id)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Sync failed: {exc}")


@router.get("/jobs/latest")
async def get_latest_job(
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Returns the latest embed job for this workspace. Frontend polls this during sync."""
    job = (await db.execute(
        sa_select(BackgroundJob)
        .where(BackgroundJob.workspace_id == workspace.id)
        .order_by(BackgroundJob.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not job:
        return None

    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "total": job.total,
        "completed": job.completed,
        "failed": job.failed,
        "progress_pct": round((job.completed / job.total * 100) if job.total > 0 else 0),
        "created_at": job.created_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


@router.get("/spaces")
async def list_synced_spaces(
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Return all spaces that have been synced to the local database."""
    try:
        svc = SyncService(session=db, confluence=_build_confluence(workspace), workspace_id=workspace.id)
        spaces = await svc.get_all_synced_spaces()
        return {"spaces": spaces, "total": len(spaces)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/spaces/{space_key}/tree")
async def get_space_tree(
    space_key: str,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Return the full nested page tree for a synced space."""
    try:
        svc = SyncService(session=db, confluence=_build_confluence(workspace), workspace_id=workspace.id)
        tree = await svc.get_space_tree(space_key)
        return {"space_key": space_key, "tree": tree, "total": len(tree)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/debug/tree/{space_key}")
async def debug_tree(
    space_key: str,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        sa_select(Page.id, Page.title, Page.parent_id, Page.space_key)
        .where(Page.workspace_id == workspace.id, Page.space_key == space_key)
        .order_by(Page.title)
    )
    rows = result.all()
    ids_in_db = {r.id for r in rows}
    return {
        "space_key": space_key,
        "total": len(rows),
        "pages": [
            {
                "id": r.id,
                "title": r.title,
                "parent_id": r.parent_id,
                "parent_in_db": r.parent_id in ids_in_db if r.parent_id else None,
            }
            for r in rows
        ],
    }


@router.get("/pages/{page_id}")
async def get_page_with_content(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Return a single page with full body content, fetched live from Confluence."""
    try:
        svc = SyncService(session=db, confluence=_build_confluence(workspace), workspace_id=workspace.id)
        return await svc.get_page_with_content(page_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch page: {exc}")
