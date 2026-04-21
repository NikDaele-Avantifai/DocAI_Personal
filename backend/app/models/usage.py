from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base


class WorkspaceUsage(Base):
    """Monthly aggregate usage per workspace. One row per workspace per month."""
    __tablename__ = "workspace_usage"
    __table_args__ = (
        UniqueConstraint("workspace_id", "period", name="uq_usage_workspace_period"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    period: Mapped[str] = mapped_column(String, nullable=False)  # "2025-04"

    analyses_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chat_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rename_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duplication_scans_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now()
    )


class UsageEvent(Base):
    """Per-user event log. Used for admin usage breakdown."""
    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_sub: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_email: Mapped[str | None] = mapped_column(String, nullable=True)
    # action: "analysis", "chat", "rename", "duplication_scan", "sweep"
    action: Mapped[str] = mapped_column(String, nullable=False)
    # metadata: page_id, page_title, tokens_used, etc.
    meta: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
