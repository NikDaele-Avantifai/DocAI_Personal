"""
Admin monitoring endpoints — internal use only, not customer-facing.

Authentication: X-Admin-Token header (set ADMIN_SECRET_TOKEN in Railway env).
These routes are NOT protected by Auth0 — the admin token handles its own auth.
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, delete as sql_delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.workspace import Workspace
from app.models.usage import WorkspaceUsage, UsageEvent
from app.models.workspace_member import WorkspaceMember
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


@router.get("/workspaces/{workspace_id}")
async def get_workspace_detail(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_admin),
):
    """Full workspace detail with token usage aggregation."""
    workspace = (await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )).scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    period = _current_period()

    usage = (await db.execute(
        select(WorkspaceUsage).where(
            WorkspaceUsage.workspace_id == workspace_id,
            WorkspaceUsage.period == period,
        )
    )).scalar_one_or_none()

    # Last 3 months
    now = datetime.now(timezone.utc)
    monthly_trend = []
    for i in range(3):
        month = now.month - i
        year = now.year
        if month <= 0:
            month += 12
            year -= 1
        p = f"{year}-{month:02d}"
        u = (await db.execute(
            select(WorkspaceUsage).where(
                WorkspaceUsage.workspace_id == workspace_id,
                WorkspaceUsage.period == p,
            )
        )).scalar_one_or_none()
        monthly_trend.append({
            "period": p,
            "analyses": u.analyses_count if u else 0,
            "chat": u.chat_count if u else 0,
            "rename": u.rename_count if u else 0,
            "duplication_scans": u.duplication_scans_count if u else 0,
        })

    # Token/cost aggregation from usage_events meta
    events = (await db.execute(
        select(UsageEvent).where(UsageEvent.workspace_id == workspace_id)
    )).scalars().all()

    claude_input_tokens = 0
    claude_output_tokens = 0
    claude_cost_usd = 0.0
    voyage_tokens = 0
    voyage_cost_usd = 0.0

    for event in events:
        if not event.meta:
            continue
        try:
            meta = json.loads(event.meta)
            provider = meta.get("provider")
            if provider == "anthropic":
                claude_input_tokens += meta.get("input_tokens", 0)
                claude_output_tokens += meta.get("output_tokens", 0)
                claude_cost_usd += meta.get("cost_usd", 0)
            elif provider == "voyage":
                voyage_tokens += meta.get("tokens", 0)
                voyage_cost_usd += meta.get("cost_usd", 0)
        except Exception:
            continue

    EUR_USD_RATE = 0.92

    members = (await db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)
    )).scalars().all()

    return {
        "id": workspace.id,
        "owner_email": workspace.owner_email,
        "owner_sub": workspace.owner_sub,
        "plan": workspace.plan,
        "effective_plan": workspace.effective_plan,
        "trial_ends_at": workspace.trial_ends_at.isoformat() if workspace.trial_ends_at else None,
        "is_trial_expired": workspace.is_trial_expired,
        "confluence_connected": workspace.confluence_connected,
        "confluence_base_url": workspace.confluence_base_url,
        "confluence_email": workspace.confluence_email,
        "onboarding_completed": workspace.onboarding_completed,
        "created_at": workspace.created_at.isoformat(),
        "updated_at": workspace.updated_at.isoformat(),
        "current_month_usage": {
            "period": period,
            "analyses": usage.analyses_count if usage else 0,
            "chat": usage.chat_count if usage else 0,
            "rename": usage.rename_count if usage else 0,
            "duplication_scans": usage.duplication_scans_count if usage else 0,
        },
        "monthly_trend": monthly_trend,
        "token_usage": {
            "claude_input_tokens": claude_input_tokens,
            "claude_output_tokens": claude_output_tokens,
            "claude_cost_usd": round(claude_cost_usd, 4),
            "claude_cost_eur": round(claude_cost_usd * EUR_USD_RATE, 4),
            "voyage_tokens": voyage_tokens,
            "voyage_cost_usd": round(voyage_cost_usd, 4),
            "voyage_cost_eur": round(voyage_cost_usd * EUR_USD_RATE, 4),
            "total_cost_usd": round(claude_cost_usd + voyage_cost_usd, 4),
            "total_cost_eur": round((claude_cost_usd + voyage_cost_usd) * EUR_USD_RATE, 4),
        },
        "team_members": [
            {
                "id": m.id,
                "email": m.user_email,
                "role": m.role,
                "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            }
            for m in members
        ],
    }


class EmailUpdateRequest(BaseModel):
    email: str


@router.patch("/workspaces/{workspace_id}/email")
async def update_workspace_email(
    workspace_id: str,
    body: EmailUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_admin),
):
    if not body.email or "@" not in body.email:
        raise HTTPException(status_code=400, detail="Invalid email address")

    workspace = (await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )).scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    workspace.owner_email = body.email
    db.add(workspace)
    return {"ok": True, "workspace_id": workspace_id, "email": body.email}


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace_admin(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_admin),
):
    """Hard delete with cascade across all tables."""
    from app.models.page import Page, Space
    from app.models.audit import AuditEntry
    from app.models.sweep import WorkspaceSweep
    from app.models.page_analysis import PageAnalysis
    from app.models.snapshot import Snapshot
    from app.models.dismissed_issue import DismissedIssue
    from app.models.analysis_settings import WorkspaceSettings
    from app.models.job import BackgroundJob
    from app.models.workspace_member import WorkspaceInvite

    workspace = (await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )).scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    for model in [
        UsageEvent, WorkspaceUsage, WorkspaceMember, WorkspaceInvite,
        DismissedIssue, Snapshot, PageAnalysis, AuditEntry,
        WorkspaceSweep, Page, Space, WorkspaceSettings, BackgroundJob,
    ]:
        await db.execute(sql_delete(model).where(model.workspace_id == workspace_id))

    await db.execute(sql_delete(Workspace).where(Workspace.id == workspace_id))
    return {"ok": True, "deleted": workspace_id}


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
