from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.core.encryption import encrypt_token

router = APIRouter()


class ConfluenceUpdateRequest(BaseModel):
    base_url: str | None = Field(None, max_length=2048)
    email: str | None = Field(None, max_length=254)
    api_token: str | None = Field(None, max_length=500)

    @field_validator("base_url", mode="before")
    @classmethod
    def clean_base_url(cls, v):
        if v is None:
            return v
        v = str(v).strip().rstrip("/")
        if v and not v.startswith("https://"):
            raise ValueError("Base URL must start with https://")
        return v

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, v):
        if v is None:
            return v
        return str(v).strip().lower()

    @field_validator("api_token", mode="before")
    @classmethod
    def clean_api_token(cls, v):
        if v is None:
            return v
        v = str(v).strip()
        return v if v else None


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
    body: ConfluenceUpdateRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """
    Updates Confluence connection settings.
    api_token is optional — omit or leave blank to keep existing encrypted token.
    """
    if body.base_url is not None:
        workspace.confluence_base_url = body.base_url
    if body.email is not None:
        workspace.confluence_email = body.email
    if body.api_token:
        workspace.confluence_api_token_enc = encrypt_token(body.api_token)
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
