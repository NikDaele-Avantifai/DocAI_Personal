from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class WorkspaceSweep(Base):
    __tablename__ = "workspace_sweeps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="running")

    pages_scanned: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pages_healthy: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pages_at_risk: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # {"stale": N, "empty": N, "no_owner": N, "generic_title": N, "needs_review": N}
    issue_counts: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})

    # Top at-risk pages: [{id, title, space_key, flags, word_count, last_modified}]
    at_risk_pages: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
