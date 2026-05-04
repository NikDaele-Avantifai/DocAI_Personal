import json
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.usage import UsageEvent

CLAUDE_RATES = {
    "claude-sonnet-4-6": {"input": 0.000003, "output": 0.000015},
    "claude-sonnet-4-20250514": {"input": 0.000003, "output": 0.000015},
    "claude-haiku-4-5": {"input": 0.00000025, "output": 0.00000125},
    "claude-haiku-4-5-20251001": {"input": 0.00000025, "output": 0.00000125},
}

VOYAGE_RATES = {
    "voyage-3": {"per_token": 0.00000006},
    "voyage-3-lite": {"per_token": 0.00000002},
    "rerank-2": {"per_query": 0.00000050},
}

EUR_USD_RATE = 0.92  # update monthly


async def track_claude_usage(
    workspace_id: str,
    user_sub: str,
    action: str,
    input_tokens: int,
    output_tokens: int,
    model: str,
    db: AsyncSession,
) -> None:
    rate = CLAUDE_RATES.get(model, CLAUDE_RATES["claude-sonnet-4-6"])
    cost_usd = (input_tokens * rate["input"]) + (output_tokens * rate["output"])

    event = UsageEvent(
        workspace_id=workspace_id,
        user_sub=user_sub,
        action=action,
        meta=json.dumps({
            "provider": "anthropic",
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost_usd, 6),
            "cost_eur": round(cost_usd * EUR_USD_RATE, 6),
        }),
    )
    db.add(event)


async def track_voyage_usage(
    workspace_id: str,
    user_sub: str,
    action: str,
    tokens: int,
    model: str,
    db: AsyncSession,
) -> None:
    rate = VOYAGE_RATES.get(model, VOYAGE_RATES["voyage-3"])
    cost_usd = tokens * rate["per_token"]

    event = UsageEvent(
        workspace_id=workspace_id,
        user_sub=user_sub,
        action=action,
        meta=json.dumps({
            "provider": "voyage",
            "model": model,
            "tokens": tokens,
            "cost_usd": round(cost_usd, 6),
            "cost_eur": round(cost_usd * EUR_USD_RATE, 6),
        }),
    )
    db.add(event)
