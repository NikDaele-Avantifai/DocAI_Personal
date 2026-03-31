from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from app.db.database import Base

EMBEDDING_DIM = 1024  # Voyage-3 native dimension


class Space(Base):
    __tablename__ = "spaces"
    __table_args__ = (UniqueConstraint("key", name="uq_spaces_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False, default="")
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_synced: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    space_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    parent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_modified: Mapped[str | None] = mapped_column(String, nullable=True)
    owner: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    content_hash: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
