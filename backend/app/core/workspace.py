"""
FastAPI dependency that resolves the current workspace from the Auth0 JWT.
On first request from a new user, auto-creates their workspace.
Injects workspace into every route that needs it.
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.core.auth import get_current_user
from app.models.workspace import Workspace


async def get_current_workspace(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(Workspace).where(Workspace.owner_sub == sub))
    workspace = result.scalar_one_or_none()

    if workspace is None:
        # Auto-create workspace on first login
        workspace = Workspace(
            owner_sub=sub,
            owner_email=user.get("email"),
        )
        db.add(workspace)
        await db.flush()  # get the ID without committing

    return workspace
