from datetime import datetime
from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class DismissedIssue(Base):
    __tablename__ = "dismissed_issues"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    page_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    issue_id: Mapped[str] = mapped_column(String, nullable=False)      # 8-char id from Claude
    issue_title: Mapped[str] = mapped_column(String, nullable=False)   # human-readable fallback key
    exact_content: Mapped[str | None] = mapped_column(Text, nullable=True)  # verbatim text, for matching
    dismissed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
