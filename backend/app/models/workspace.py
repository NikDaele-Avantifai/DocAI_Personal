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

    # Subscription plan
    plan: Mapped[str] = mapped_column(
        String, nullable=False, default="trial"
    )
    # Trial expiry — None means not on trial
    trial_ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now()
    )

    @property
    def is_trial_expired(self) -> bool:
        if self.plan != "trial":
            return False
        if self.trial_ends_at is None:
            return True
        from datetime import timezone
        return datetime.now(timezone.utc) > self.trial_ends_at

    @property
    def effective_plan(self) -> str:
        """Returns 'expired' if trial is over, otherwise the plan name."""
        if self.plan == "trial" and self.is_trial_expired:
            return "expired"
        return self.plan
