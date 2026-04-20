from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Snapshot(Base):
    """
    Pre-change state captured before every apply.
    Enables full rollback to the exact page content/title that existed before DocAI touched it.
    """
    __tablename__ = "snapshots"

    id: Mapped[str] = mapped_column(String, primary_key=True)          # UUID
    workspace_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    proposal_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    page_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String, nullable=False)

    # Original state — captured from Confluence immediately before the change
    page_title_before: Mapped[str] = mapped_column(String, nullable=False)
    page_body_before: Mapped[str | None] = mapped_column(Text, nullable=True)   # None for renames
    page_version_before: Mapped[int] = mapped_column(Integer, nullable=False)

    applied_by: Mapped[str | None] = mapped_column(String, nullable=True)
    applied_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Rollback state
    rolled_back: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rolled_back_by: Mapped[str | None] = mapped_column(String, nullable=True)
