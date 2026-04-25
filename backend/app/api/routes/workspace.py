import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.auth import get_current_user, require_admin
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceInvite
from app.core.encryption import encrypt_token

router = APIRouter()


# ── Request models ─────────────────────────────────────────────────────────────

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


class InviteMemberRequest(BaseModel):
    email: str = Field(..., max_length=254)
    role: str = Field(default="viewer")

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, v):
        return str(v).strip().lower()

    @field_validator("role", mode="before")
    @classmethod
    def validate_role(cls, v):
        if v not in ("admin", "viewer"):
            raise ValueError("Role must be admin or viewer")
        return v


class UpdateMemberRoleRequest(BaseModel):
    role: str = Field(...)

    @field_validator("role", mode="before")
    @classmethod
    def validate_role(cls, v):
        if v not in ("admin", "viewer"):
            raise ValueError("Role must be admin or viewer")
        return v


# ── Workspace info ─────────────────────────────────────────────────────────────

@router.get("/")
async def get_workspace(
    workspace: Workspace = Depends(get_current_workspace),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sub = user.get("sub")

    # Owners are always admin of their own workspace.
    # Members get the role stored in workspace_members.
    if workspace.owner_sub == sub:
        user_role = "admin"
    else:
        member_result = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.user_sub == sub,
            )
        )
        member = member_result.scalar_one_or_none()
        user_role = member.role if member else "viewer"

    return {
        "id": workspace.id,
        "owner_email": workspace.owner_email,
        "confluence_connected": workspace.confluence_connected,
        "onboarding_completed": workspace.onboarding_completed,
        "confluence_base_url": workspace.confluence_base_url,
        "confluence_email": workspace.confluence_email,
        # Never return confluence_api_token_enc
        "plan": workspace.plan,
        "effective_plan": workspace.effective_plan,
        "trial_ends_at": (
            workspace.trial_ends_at.isoformat() if workspace.trial_ends_at else None
        ),
        "user_role": user_role,
        "user_roles": [user_role],
        "is_owner": workspace.owner_sub == sub,
    }


@router.patch("/confluence")
async def update_confluence_settings(
    body: ConfluenceUpdateRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _user: dict = Depends(require_admin),
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
    _user: dict = Depends(require_admin),
):
    workspace.onboarding_completed = True
    db.add(workspace)
    return {"ok": True}


# ── Member management ──────────────────────────────────────────────────────────

@router.get("/members")
async def list_members(
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """List all members and pending invites for this workspace."""
    members_result = await db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
    )
    members = members_result.scalars().all()

    now = datetime.now(timezone.utc)
    invites_result = await db.execute(
        select(WorkspaceInvite).where(
            WorkspaceInvite.workspace_id == workspace.id,
            WorkspaceInvite.accepted == False,  # noqa: E712
            WorkspaceInvite.expires_at > now,
        )
    )
    invites = invites_result.scalars().all()

    return {
        "owner": {
            "email": workspace.owner_email,
            "role": "admin",
            "is_owner": True,
        },
        "members": [
            {
                "id": m.id,
                "email": m.user_email,
                "role": m.role,
                "joined_at": m.joined_at.isoformat(),
                "invited_by": m.invited_by_email,
            }
            for m in members
        ],
        "pending_invites": [
            {
                "id": i.id,
                "email": i.email,
                "role": i.role,
                "expires_at": i.expires_at.isoformat(),
                "invited_by": i.invited_by_email,
            }
            for i in invites
        ],
    }


@router.post("/members/invite")
async def invite_member(
    body: InviteMemberRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: dict = Depends(require_admin),
):
    """
    Create a pending invite for a new member.
    Accepted automatically when they first log in.

    IMPORTANT: After creating the invite, also add the email to the Auth0
    Action allowlist manually. This is a manual step until Auth0 Management
    API integration is added.
    """
    email = body.email

    # Check if already the owner
    if workspace.owner_email and workspace.owner_email.lower() == email:
        raise HTTPException(status_code=409, detail="This user is the workspace owner.")

    # Check if already a member
    existing = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_email == email,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"{email} is already a member of this workspace.",
        )

    # Delete any existing (expired) invite for this email and re-create
    await db.execute(
        sql_delete(WorkspaceInvite).where(
            WorkspaceInvite.workspace_id == workspace.id,
            WorkspaceInvite.email == email,
        )
    )

    invite = WorkspaceInvite(
        workspace_id=workspace.id,
        email=email,
        role=body.role,
        token=str(uuid.uuid4()),
        invited_by_sub=user.get("sub", ""),
        invited_by_email=user.get("email"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invite)
    await db.flush()

    return {
        "ok": True,
        "invite": {
            "email": email,
            "role": body.role,
            "expires_at": invite.expires_at.isoformat(),
        },
        "next_step": (
            f"Add {email} to the Auth0 allowlist in the DocAI_Login Action, "
            f"then share the app URL with them. They will be automatically "
            f"added to your workspace on first login."
        ),
    }


@router.patch("/members/{member_id}/role")
async def update_member_role(
    member_id: int,
    body: UpdateMemberRoleRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _user: dict = Depends(require_admin),
):
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.id == member_id,
            WorkspaceMember.workspace_id == workspace.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.role = body.role
    db.add(member)
    return {"ok": True, "email": member.user_email, "role": body.role}


@router.delete("/members/{member_id}")
async def remove_member(
    member_id: int,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _user: dict = Depends(require_admin),
):
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.id == member_id,
            WorkspaceMember.workspace_id == workspace.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Member not found")

    await db.execute(
        sql_delete(WorkspaceMember).where(WorkspaceMember.id == member_id)
    )
    return {"ok": True}


@router.delete("/invites/{invite_id}")
async def cancel_invite(
    invite_id: int,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _user: dict = Depends(require_admin),
):
    result = await db.execute(
        select(WorkspaceInvite).where(
            WorkspaceInvite.id == invite_id,
            WorkspaceInvite.workspace_id == workspace.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Invite not found")

    await db.execute(
        sql_delete(WorkspaceInvite).where(WorkspaceInvite.id == invite_id)
    )
    return {"ok": True}
