from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.core.encryption import encrypt_token

router = APIRouter()


@router.get("/")
async def get_workspace(workspace: Workspace = Depends(get_current_workspace)):
    return {
        "id": workspace.id,
        "owner_email": workspace.owner_email,
        "confluence_connected": workspace.confluence_connected,
        "onboarding_completed": workspace.onboarding_completed,
        "confluence_base_url": workspace.confluence_base_url,
        "confluence_email": workspace.confluence_email,
        # Never return confluence_api_token_enc
    }


@router.patch("/confluence")
async def update_confluence_settings(
    body: dict,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """
    Accepts: { base_url, email, api_token }
    Encrypts the token before storing.
    """
    if "base_url" in body:
        workspace.confluence_base_url = body["base_url"].rstrip("/")
    if "email" in body:
        workspace.confluence_email = body["email"]
    if "api_token" in body and body["api_token"]:
        workspace.confluence_api_token_enc = encrypt_token(body["api_token"])
        workspace.confluence_connected = True
    db.add(workspace)
    return {"ok": True}


@router.post("/onboarding/complete")
async def complete_onboarding(
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    workspace.onboarding_completed = True
    db.add(workspace)
    return {"ok": True}
