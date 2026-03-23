from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.services.confluence_service import ConfluenceService

router = APIRouter()


class ConfluenceCredentials(BaseModel):
    base_url: str
    email: str
    api_token: str


@router.post("/spaces")
async def list_spaces(credentials: ConfluenceCredentials):
    """List all Confluence spaces the user has access to."""
    try:
        svc = ConfluenceService(
            base_url=credentials.base_url,
            api_token=credentials.api_token,
            email=credentials.email,
        )
        spaces = await svc.get_spaces()
        return {"spaces": spaces}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/spaces/{space_key}/pages")
async def list_pages(space_key: str, credentials: ConfluenceCredentials):
    """List all pages in a given Confluence space."""
    try:
        svc = ConfluenceService(
            base_url=credentials.base_url,
            api_token=credentials.api_token,
            email=credentials.email,
        )
        result = await svc.get_pages_in_space(space_key)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pages/{page_id}")
async def get_page(page_id: str, credentials: ConfluenceCredentials):
    """Fetch a single Confluence page with full content."""
    try:
        svc = ConfluenceService(
            base_url=credentials.base_url,
            api_token=credentials.api_token,
            email=credentials.email,
        )
        page = await svc.get_page(page_id)
        return page
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
