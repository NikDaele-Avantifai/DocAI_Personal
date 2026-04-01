from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field
from sqlalchemy import Integer, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.db.database import Base


class WorkspaceSettings(Base):
    __tablename__ = "workspace_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    settings: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


ALL_ISSUE_TYPES = [
    "stale", "unowned", "unstructured", "duplicate",
    "outdated_reference", "missing_review_date",
    "compliance_gap", "broken_link",
]


class AnalysisSettings(BaseModel):
    enabled_issue_types: list[str] = Field(default_factory=lambda: list(ALL_ISSUE_TYPES))
    min_severity: Literal["low", "medium", "high"] = "low"
    max_issues_per_page: int = Field(default=5, ge=1, le=10)
    confidence_threshold: float = Field(default=0.75, ge=0.5, le=1.0)
    stale_threshold_days: int = Field(default=180, ge=30)
    compliance_checking: bool = True
    focus_mode: Literal["balanced", "compliance", "structure", "hygiene"] = "balanced"
