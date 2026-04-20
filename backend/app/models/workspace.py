from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(
        String, primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    # Auth0 sub — stable unique identifier per user
    owner_sub: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    owner_email: Mapped[str | None] = mapped_column(String, nullable=True)

    # Confluence connection (API token for now, OAuth later)
    confluence_base_url: Mapped[str | None] = mapped_column(String, nullable=True)
    confluence_email: Mapped[str | None] = mapped_column(String, nullable=True)
    # Stored encrypted — use encrypt_token/decrypt_token helpers
    confluence_api_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Onboarding state
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    confluence_connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now()
    )
