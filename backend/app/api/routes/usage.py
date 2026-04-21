# NOTE: /api/usage/ is intended for the workspace admin only.
# RBAC enforcement (admin-only gate) is tracked for the next sprint.
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone
from calendar import monthrange

from app.db.database import get_db
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.models.usage import WorkspaceUsage, UsageEvent
from app.core.plans import get_limits
from app.core.usage import get_or_create_usage, get_usage_percentage, _current_period

router = APIRouter()


@router.get("/")
async def get_usage(
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Current month usage + limits + percentages. Shown on usage dashboard."""
    usage = await get_or_create_usage(db, workspace.id)
    limits = get_limits(workspace.effective_plan)
    period = _current_period()

    def pct(current, limit):
        return get_usage_percentage(current, limit)

    return {
        "plan": workspace.plan,
        "effective_plan": workspace.effective_plan,
        "period": period,
        "trial_ends_at": workspace.trial_ends_at.isoformat() if workspace.trial_ends_at else None,
        "is_trial_expired": workspace.is_trial_expired,
        "usage": {
            "analyses": {
                "used": usage.analyses_count,
                "limit": limits.analyses_per_month,
                "percentage": pct(usage.analyses_count, limits.analyses_per_month),
            },
            "chat": {
                "used": usage.chat_count,
                "limit": limits.chat_per_month,
                "percentage": pct(usage.chat_count, limits.chat_per_month),
            },
            "rename": {
                "used": usage.rename_count,
                "limit": limits.rename_per_month,
                "percentage": pct(usage.rename_count, limits.rename_per_month),
            },
            "duplication_scans": {
                "used": usage.duplication_scans_count,
                "limit": limits.duplication_scans_per_month,
                "percentage": pct(usage.duplication_scans_count, limits.duplication_scans_per_month),
            },
        },
        "features": {
            "compliance_tagging": limits.compliance_tagging,
            "jira_integration": limits.jira_integration,
            "dedicated_support": limits.dedicated_support,
            "sla": limits.sla,
            "max_spaces": limits.max_spaces,
            "max_users": limits.max_users,
        },
    }


@router.get("/events")
async def get_usage_events(
    period: str | None = Query(None, description="YYYY-MM format, defaults to current month"),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    """Per-user event breakdown for admin usage view."""
    target_period = period or _current_period()
    year, month = map(int, target_period.split("-"))
    _, last_day = monthrange(year, month)
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)

    events_result = await db.execute(
        select(UsageEvent)
        .where(
            UsageEvent.workspace_id == workspace.id,
            UsageEvent.created_at >= start,
            UsageEvent.created_at <= end,
        )
        .order_by(UsageEvent.created_at.desc())
        .limit(limit)
    )
    rows = events_result.scalars().all()

    # Group by user for summary — never expose user_sub
    user_summary: dict = {}
    for e in rows:
        key = e.user_email or e.user_sub
        if key not in user_summary:
            user_summary[key] = {
                "user_email": e.user_email,
                "analyses": 0, "chat": 0,
                "rename": 0, "duplication_scan": 0, "sweep": 0,
            }
        if e.action in user_summary[key]:
            user_summary[key][e.action] += 1

    return {
        "period": target_period,
        "events": [
            {
                "user_email": e.user_email,
                "action": e.action,
                "meta": e.meta,
                "created_at": e.created_at.isoformat(),
            }
            for e in rows
        ],
        "by_user": list(user_summary.values()),
    }
