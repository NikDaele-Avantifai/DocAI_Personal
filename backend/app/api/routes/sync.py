import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db, AsyncSessionLocal
from app.services.confluence_service import ConfluenceService
from app.services.embedding_service import EmbeddingService
from app.services.sync_service import SyncService

log = logging.getLogger(__name__)
_embed_svc = EmbeddingService()

router = APIRouter()


def _get_confluence() -> ConfluenceService:
    """Build a ConfluenceService from server-side credentials in config."""
    if not settings.atlassian_api_token or not settings.atlassian_mail:
        raise HTTPException(
            status_code=503,
            detail=(
                "Atlassian credentials not configured. "
                "Set ATLASSIAN_API_TOKEN and ATLASSIAN_MAIL in backend/.env"
            ),
        )
    return ConfluenceService(
        base_url=settings.atlassian_base_url,
        api_token=settings.atlassian_api_token,
        email=settings.atlassian_mail,
    )


async def _background_embed() -> None:
    """Fetch content for any un-fetched pages and embed them. Runs after sync."""
    confluence_svc = None
    if settings.atlassian_api_token and settings.atlassian_mail:
        confluence_svc = ConfluenceService(
            base_url=settings.atlassian_base_url,
            api_token=settings.atlassian_api_token,
            email=settings.atlassian_mail,
        )
    async with AsyncSessionLocal() as session:
        try:
            from sqlalchemy import select as sa_select
            from app.models.page import Page
            rows = (
                await session.execute(
                    sa_select(Page.id, Page.title).where(
                        (Page.content.is_(None)) | (Page.content == "")
                    )
                )
            ).all()
            if confluence_svc:
                sync_svc = SyncService(session=session, confluence=confluence_svc)
                for page_id, page_title in [(r.id, r.title) for r in rows]:
                    try:
                        await sync_svc.get_page_with_content(page_id, embedding_svc=_embed_svc)
                    except Exception as exc:
                        log.warning("background_embed: content fetch failed for %s: %s", page_id, exc)
            await _embed_svc.embed_all_pages(session)
        except Exception as exc:
            log.error("background_embed: unexpected error: %s", exc)


@router.post("/spaces")
async def sync_all_spaces(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger a full sync of all Confluence spaces the configured user can access."""
    try:
        svc = SyncService(session=db, confluence=_get_confluence())
        result = await svc.sync_all_spaces()
        background_tasks.add_task(_background_embed)
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
):
    """Trigger a sync of a single Confluence space."""
    try:
        svc = SyncService(session=db, confluence=_get_confluence())
        result = await svc.sync_space(space_key)
        background_tasks.add_task(_background_embed)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Sync failed: {exc}")


@router.get("/spaces")
async def list_synced_spaces(db: AsyncSession = Depends(get_db)):
    """Return all spaces that have been synced to the local database."""
    try:
        svc = SyncService(session=db, confluence=_get_confluence())
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
):
    """Return the full nested page tree for a synced space."""
    try:
        svc = SyncService(session=db, confluence=_get_confluence())
        tree = await svc.get_space_tree(space_key)
        return {"space_key": space_key, "tree": tree, "total": len(tree)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/debug/tree/{space_key}")
async def debug_tree(space_key: str, db: AsyncSession = Depends(get_db)):
    """
    Debug endpoint — dumps raw page rows for a space so parent/child IDs can be inspected.
    Returns every page's id, title, and parent_id as stored in the DB.
    """
    from sqlalchemy import select
    from app.models.page import Page
    result = await db.execute(
        select(Page.id, Page.title, Page.parent_id, Page.space_key)
        .where(Page.space_key == space_key)
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
):
    """Return a single page with full body content, fetched live from Confluence."""
    try:
        svc = SyncService(session=db, confluence=_get_confluence())
        return await svc.get_page_with_content(page_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch page: {exc}")
