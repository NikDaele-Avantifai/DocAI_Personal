from datetime import datetime
from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class AuditEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String, primary_key=True)          # UUID of proposal
    page_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    page_title: Mapped[str] = mapped_column(String, nullable=False)
    space_key: Mapped[str | None] = mapped_column(String, nullable=True)
    action: Mapped[str] = mapped_column(String, nullable=False)         # archive / add_summary / …
    decision: Mapped[str] = mapped_column(String, nullable=False)       # approved / rejected / applied
    reviewed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    applied_by: Mapped[str | None] = mapped_column(String, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot_id: Mapped[str | None] = mapped_column(String, nullable=True)  # FK → snapshots.id
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
