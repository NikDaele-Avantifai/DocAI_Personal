"""
Admin monitoring endpoints — internal use only, not customer-facing.

Authentication: X-Admin-Token header (set ADMIN_SECRET_TOKEN in Railway env).
These routes are NOT protected by Auth0 — the admin token handles its own auth.
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.workspace import Workspace
from app.models.usage import WorkspaceUsage
from app.core.config import settings
from app.core.usage import _current_period

router = APIRouter()


def verify_admin(x_admin_token: str = Header(...)):
    if not settings.admin_secret_token:
        raise HTTPException(status_code=503, detail="Admin endpoint not configured")
    if x_admin_token != settings.admin_secret_token:
        raise HTTPException(status_code=403, detail="Invalid admin token")


class PlanUpdateRequest(BaseModel):
    plan: str


@router.get("/workspaces")
async def list_all_workspaces(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_admin),
):
    """Shows all workspaces, their plan, and current month usage."""
    period = _current_period()
    workspaces = (await db.execute(select(Workspace))).scalars().all()

    result = []
    for ws in workspaces:
        usage = (await db.execute(
            select(WorkspaceUsage).where(
                WorkspaceUsage.workspace_id == ws.id,
                WorkspaceUsage.period == period,
            )
        )).scalar_one_or_none()

        result.append({
            "id": ws.id,
            "owner_email": ws.owner_email,
            "plan": ws.plan,
            "effective_plan": ws.effective_plan,
            "confluence_connected": ws.confluence_connected,
            "confluence_base_url": ws.confluence_base_url,
            "onboarding_completed": ws.onboarding_completed,
            "trial_ends_at": ws.trial_ends_at.isoformat() if ws.trial_ends_at else None,
            "is_trial_expired": ws.is_trial_expired,
            "created_at": ws.created_at.isoformat(),
            "current_month_usage": {
                "analyses": usage.analyses_count if usage else 0,
                "chat": usage.chat_count if usage else 0,
                "rename": usage.rename_count if usage else 0,
                "duplication_scans": usage.duplication_scans_count if usage else 0,
            },
        })

    return {
        "period": period,
        "total_workspaces": len(result),
        "workspaces": sorted(result, key=lambda x: x["created_at"], reverse=True),
    }


@router.patch("/workspaces/{workspace_id}/plan")
async def update_workspace_plan(
    workspace_id: str,
    body: PlanUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_admin),
):
    """
    Manually set a workspace plan. Use this when a customer pays.
    Body: { "plan": "starter" | "growth" | "scale" | "trial" }
    """
    valid_plans = {"starter", "growth", "scale", "trial"}
    if body.plan not in valid_plans:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan. Must be one of: {sorted(valid_plans)}",
        )

    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    workspace.plan = body.plan
    if body.plan != "trial":
        workspace.trial_ends_at = None  # Clear trial expiry on paid plan
    db.add(workspace)

    return {"ok": True, "workspace_id": workspace_id, "plan": body.plan}


@router.get("/stats")
async def admin_stats(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_admin),
):
    """High-level stats for your monitoring dashboard."""
    period = _current_period()

    total_workspaces = (await db.execute(
        select(func.count()).select_from(Workspace)
    )).scalar()

    connected = (await db.execute(
        select(func.count()).select_from(Workspace).where(
            Workspace.confluence_connected == True  # noqa: E712
        )
    )).scalar()

    by_plan = (await db.execute(
        select(Workspace.plan, func.count()).group_by(Workspace.plan)
    )).all()

    total_analyses = (await db.execute(
        select(func.sum(WorkspaceUsage.analyses_count)).where(
            WorkspaceUsage.period == period
        )
    )).scalar() or 0

    total_chat = (await db.execute(
        select(func.sum(WorkspaceUsage.chat_count)).where(
            WorkspaceUsage.period == period
        )
    )).scalar() or 0

    return {
        "period": period,
        "total_workspaces": total_workspaces,
        "confluence_connected": connected,
        "by_plan": {plan: count for plan, count in by_plan},
        "current_month": {
            "total_analyses": total_analyses,
            "total_chat_messages": total_chat,
        },
    }
