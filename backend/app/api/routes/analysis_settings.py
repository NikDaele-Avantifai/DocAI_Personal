from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime

from app.db.database import get_db
from app.models.analysis_settings import WorkspaceSettings, AnalysisSettings

router = APIRouter()


async def _get_or_create(db: AsyncSession) -> WorkspaceSettings:
    result = await db.execute(select(WorkspaceSettings).limit(1))
    row = result.scalar_one_or_none()
    if row is None:
        row = WorkspaceSettings(settings={}, updated_at=datetime.utcnow())
        db.add(row)
        await db.flush()
    return row


@router.get("/analysis", response_model=AnalysisSettings)
async def get_analysis_settings(db: AsyncSession = Depends(get_db)):
    row = await _get_or_create(db)
    defaults = AnalysisSettings()
    return AnalysisSettings(**{**defaults.model_dump(), **row.settings})


@router.put("/analysis", response_model=AnalysisSettings)
async def update_analysis_settings(
    body: AnalysisSettings,
    db: AsyncSession = Depends(get_db),
):
    row = await _get_or_create(db)
    row.settings = body.model_dump()
    row.updated_at = datetime.utcnow()
    return body
