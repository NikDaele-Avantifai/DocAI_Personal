from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base


class WorkspaceMember(Base):
    """
    Maps a user (Auth0 sub) to a workspace with a specific role.
    The workspace owner is NOT in this table — they own the workspace directly.
    This table covers additional members invited by the owner.
    """
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "user_sub",
            name="uq_workspace_members_workspace_user"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_sub: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_email: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False, default="viewer")  # "admin" or "viewer"
    invited_by_sub: Mapped[str] = mapped_column(String, nullable=False)
    invited_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WorkspaceInvite(Base):
    """
    Pending invitation. Created by admin, consumed on first login.
    Expires after 7 days.
    """
    __tablename__ = "workspace_invites"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "email",
            name="uq_workspace_invites_workspace_email"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="viewer")
    token: Mapped[str] = mapped_column(String, nullable=False, unique=True)  # UUID, used in invite link
    invited_by_sub: Mapped[str] = mapped_column(String, nullable=False)
    invited_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
