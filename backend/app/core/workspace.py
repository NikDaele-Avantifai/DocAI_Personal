"""
FastAPI dependency that resolves the current workspace from the Auth0 JWT.
On first request from a new user, auto-creates their workspace with a 14-day trial,
or links them to an existing workspace if a pending invite exists for their email.
"""
import logging
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.auth import get_current_user
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceInvite

logger = logging.getLogger(__name__)


async def get_current_workspace(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    sub = user.get("sub")
    email = (user.get("email") or "").lower()

    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing sub claim",
        )

    from app.core.config import settings
    if settings.is_production and sub == "dev|local":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Dev bypass not allowed in production",
        )

    # 1. Check if user owns a workspace
    result = await db.execute(select(Workspace).where(Workspace.owner_sub == sub))
    workspace = result.scalar_one_or_none()

    if workspace is not None:
        return workspace

    # 2. Check if user is already a member of another workspace
    member_result = await db.execute(
        select(WorkspaceMember).where(WorkspaceMember.user_sub == sub)
    )
    member = member_result.scalar_one_or_none()

    if member is not None:
        ws_result = await db.execute(
            select(Workspace).where(Workspace.id == member.workspace_id)
        )
        ws = ws_result.scalar_one_or_none()
        if ws:
            return ws

    # 3. Check for a pending invite by email — accept it on first login
    if email:
        now = datetime.now(timezone.utc)
        invite_result = await db.execute(
            select(WorkspaceInvite).where(
                WorkspaceInvite.email == email,
                WorkspaceInvite.accepted == False,  # noqa: E712
                WorkspaceInvite.expires_at > now,
            )
        )
        invite = invite_result.scalar_one_or_none()

        if invite is not None:
            # Accept the invite — create member record
            new_member = WorkspaceMember(
                workspace_id=invite.workspace_id,
                user_sub=sub,
                user_email=email,
                role=invite.role,
                invited_by_sub=invite.invited_by_sub,
                invited_by_email=invite.invited_by_email,
            )
            db.add(new_member)

            invite.accepted = True
            invite.accepted_at = now
            await db.flush()

            ws_result = await db.execute(
                select(Workspace).where(Workspace.id == invite.workspace_id)
            )
            ws = ws_result.scalar_one_or_none()
            if ws:
                logger.info(
                    "Invite accepted: %s joined workspace %s as %s",
                    email, invite.workspace_id, invite.role,
                )
                return ws

    # 4. No workspace found — create a new owned workspace
    workspace = Workspace(
        owner_sub=sub,
        owner_email=user.get("email"),
        plan="trial",
        trial_ends_at=datetime.now(timezone.utc) + timedelta(days=14),
    )
    db.add(workspace)
    await db.flush()
    logger.info(
        "New workspace created for %s (sub: %s)",
        user.get("email", "unknown"),
        sub[:20],
    )

    return workspace
