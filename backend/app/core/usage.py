"""
Usage tracking and limit enforcement.

Call track_usage() after every successful Claude API call.
Call check_limit() before every Claude API call.
"""
from datetime import datetime, timezone
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.usage import WorkspaceUsage, UsageEvent
from app.models.workspace import Workspace
from app.core.plans import get_limits


def _current_period() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def get_or_create_usage(
    db: AsyncSession,
    workspace_id: str,
) -> WorkspaceUsage:
    period = _current_period()
    result = await db.execute(
        select(WorkspaceUsage).where(
            WorkspaceUsage.workspace_id == workspace_id,
            WorkspaceUsage.period == period,
        )
    )
    usage = result.scalar_one_or_none()
    if usage is None:
        usage = WorkspaceUsage(workspace_id=workspace_id, period=period)
        db.add(usage)
        await db.flush()
    return usage


async def check_limit(
    db: AsyncSession,
    workspace: Workspace,
    action: str,  # "analysis", "chat", "rename", "duplication_scan"
) -> None:
    """
    Raises HTTP 402 if the trial has expired.
    Raises HTTP 429 if the workspace has hit its monthly limit.
    Returns normally if the action is allowed.
    """
    plan = workspace.effective_plan
    limits = get_limits(plan)

    if plan == "expired":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "trial_expired",
                "message": "Your 14-day trial has ended. Contact Avantifai to activate your plan.",
                "contact": "nikolaidaelemans@avantifai.com",
            }
        )

    usage = await get_or_create_usage(db, workspace.id)

    limit_map = {
        "analysis": (limits.analyses_per_month, usage.analyses_count),
        "chat": (limits.chat_per_month, usage.chat_count),
        "rename": (limits.rename_per_month, usage.rename_count),
        "duplication_scan": (limits.duplication_scans_per_month, usage.duplication_scans_count),
    }

    if action not in limit_map:
        return  # Unknown action — allow it, don't crash

    limit, current = limit_map[action]

    if limit is None:
        return  # Unlimited plan

    if limit == 0:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "plan_required",
                "message": "This feature requires an active plan.",
                "contact": "nikolaidaelemans@avantifai.com",
            }
        )

    if current >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "limit_reached",
                "action": action,
                "limit": limit,
                "used": current,
                "period": _current_period(),
                "message": f"Monthly {action} limit reached ({current}/{limit}). "
                           f"Upgrade your plan or wait until next month.",
                "upgrade_contact": "nikolaidaelemans@avantifai.com",
            }
        )


async def track_usage(
    db: AsyncSession,
    workspace: Workspace,
    user: dict,
    action: str,
    meta: str | None = None,
) -> None:
    """
    Increments the monthly counter and logs a usage event.
    Call this AFTER a successful Claude API call.
    """
    usage = await get_or_create_usage(db, workspace.id)

    if action == "analysis":
        usage.analyses_count += 1
    elif action == "chat":
        usage.chat_count += 1
    elif action == "rename":
        usage.rename_count += 1
    elif action == "duplication_scan":
        usage.duplication_scans_count += 1

    event = UsageEvent(
        workspace_id=workspace.id,
        user_sub=user.get("sub", "unknown"),
        user_email=user.get("email"),
        action=action,
        meta=meta,
    )
    db.add(event)


def get_usage_percentage(current: int, limit: int | None) -> float | None:
    if limit is None:
        return None  # Unlimited
    if limit == 0:
        return 100.0
    return round((current / limit) * 100, 1)
