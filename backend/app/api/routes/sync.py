from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.services.confluence_service import ConfluenceService
from app.services.sync_service import SyncService

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


@router.post("/spaces")
async def sync_all_spaces(db: AsyncSession = Depends(get_db)):
    """Trigger a full sync of all Confluence spaces the configured user can access."""
    try:
        svc = SyncService(session=db, confluence=_get_confluence())
        return await svc.sync_all_spaces()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Sync failed: {exc}")


@router.post("/spaces/{space_key}")
async def sync_single_space(
    space_key: str,
    db: AsyncSession = Depends(get_db),
):
    """Trigger a sync of a single Confluence space."""
    try:
        svc = SyncService(session=db, confluence=_get_confluence())
        return await svc.sync_space(space_key)
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
