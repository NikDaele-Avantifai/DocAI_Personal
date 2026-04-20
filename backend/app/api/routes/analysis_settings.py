from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from app.db.database import get_db
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.models.analysis_settings import WorkspaceSettings, AnalysisSettings

router = APIRouter()


async def _get_or_create(db: AsyncSession, workspace_id: str) -> WorkspaceSettings:
    result = await db.execute(
        select(WorkspaceSettings).where(WorkspaceSettings.workspace_id == workspace_id).limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = WorkspaceSettings(workspace_id=workspace_id, settings={})
        db.add(row)
        await db.flush()
    return row


@router.get("/analysis", response_model=AnalysisSettings)
async def get_analysis_settings(
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    row = await _get_or_create(db, workspace.id)
    defaults = AnalysisSettings()
    return AnalysisSettings(**{**defaults.model_dump(), **row.settings})


@router.put("/analysis", response_model=AnalysisSettings)
async def update_analysis_settings(
    body: AnalysisSettings,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    row = await _get_or_create(db, workspace.id)
    row.settings = body.model_dump()
    return body
