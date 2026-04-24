"""
FastAPI dependency that resolves the current workspace from the Auth0 JWT.
On first request from a new user, auto-creates their workspace with a 14-day trial.
"""
import logging
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.auth import get_current_user
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)


async def get_current_workspace(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing sub claim",
        )

    # Reject dev bypass sub in production
    from app.core.config import settings
    if settings.is_production and sub == "dev|local":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Dev bypass not allowed in production",
        )

    result = await db.execute(select(Workspace).where(Workspace.owner_sub == sub))
    workspace = result.scalar_one_or_none()

    if workspace is None:
        # Auto-create workspace on first real login
        workspace = Workspace(
            owner_sub=sub,
            owner_email=user.get("email"),
            plan="trial",
            trial_ends_at=datetime.now(timezone.utc) + timedelta(days=14),
        )
        db.add(workspace)
        await db.flush()  # get the ID without committing
        logger.info(
            "New workspace created for %s (sub: %s)",
            user.get("email", "unknown"),
            sub[:20],  # Never log full sub
        )

    return workspace
