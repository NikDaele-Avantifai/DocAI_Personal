from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class PageAnalysis(Base):
    __tablename__ = "page_analyses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    page_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    page_version: Mapped[int] = mapped_column(Integer, nullable=False)

    # Current analysis results
    issues: Mapped[dict] = mapped_column(JSON, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_healthy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Resolved issues (issues that existed before but are now fixed)
    resolved_issues: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Fix-awareness context — what existed in the prior version
    previous_issues: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    previous_version: Mapped[int | None] = mapped_column(Integer, nullable=True)

    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
