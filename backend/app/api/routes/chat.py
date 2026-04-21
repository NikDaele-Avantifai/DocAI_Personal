import json
import logging
from typing import AsyncGenerator

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.auth import get_current_user
from app.core.usage import check_limit, track_usage
from app.core.workspace import get_current_workspace
from app.db.database import get_db
from app.models.workspace import Workspace

router = APIRouter()
log = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    role: str = Field(..., max_length=50)
    content: str = Field(..., max_length=50000)

    @field_validator("role", "content", mode="before")
    @classmethod
    def strip_whitespace(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., max_length=50)
    context: dict = {}


SYSTEM_PROMPT = """You are DocAI Assistant — an AI built into the DocAI platform, which helps teams keep their Confluence documentation healthy.

Your two core jobs:
1. **Help users navigate and understand the DocAI platform** — the dashboard has: Overview (workspace health summary), Pages (browse all synced pages with health scores), Duplicate Detector (find near-identical pages), Proposals (AI-suggested actions like archiving or merging pages), Audit Log (history of applied changes), and Settings.
2. **Answer questions about the specific Confluence page the user is currently viewing** — when page content is provided to you, use it directly to answer questions. Do not say you lack access; the content is given to you in the context block below.

Tone: concise, direct, helpful. Use short paragraphs or bullet points. Never pad responses. If you can answer in two sentences, do so.

Rules:
- If page content is provided, answer questions about it using that content — summarise, quote, explain, compare sections, whatever the user needs.
- If no page content is available, say so briefly and suggest the user click "Analyze This Page" in the extension to load it.
- For navigation questions ("where do I find X?"), give the exact dashboard section name.
- Never invent page content or workspace stats you weren't given."""


def build_context_block(context: dict) -> str:
    parts = []

    # Dashboard route context
    if context.get("currentRoute") and context["currentRoute"] != "extension":
        route = context["currentRoute"]
        route_names = {
            "/overview": "Overview", "/pages": "Pages", "/duplicates": "Duplicate Detector",
            "/proposals": "Proposals", "/audit": "Audit Log", "/batch-rename": "Batch Rename",
            "/settings": "Settings",
        }
        parts.append(f"User is viewing: {route_names.get(route, route)} in the DocAI dashboard")

    # Workspace stats
    if context.get("pages"):
        parts.append(f"Total pages synced: {context['pages']}")
    if context.get("issues"):
        parts.append(f"Pending issues: {context['issues']}")
    if context.get("duplicates"):
        parts.append(f"Duplicates detected: {context['duplicates']}")

    # Current Confluence page
    if context.get("pageTitle"):
        parts.append(f"Confluence page title: {context['pageTitle']}")
    if context.get("pageUrl"):
        parts.append(f"Confluence page URL: {context['pageUrl']}")
    if context.get("pageOwner"):
        parts.append(f"Page owner: {context['pageOwner']}")
    if context.get("pageLastModified"):
        parts.append(f"Last modified: {context['pageLastModified']}")

    if context.get("pageContent"):
        content = context["pageContent"][:6000]  # cap to keep tokens sane
        parts.append(f"\n--- PAGE CONTENT (use this to answer questions) ---\n{content}\n--- END PAGE CONTENT ---")

    return "\n".join(parts)


async def stream_anthropic(messages: list[dict], context_block: str) -> AsyncGenerator[bytes, None]:
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    system = SYSTEM_PROMPT
    if context_block:
        system += f"\n\nWorkspace context:\n{context_block}"

    try:
        async with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=system,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                payload = json.dumps({"delta": text})
                yield f"data: {payload}\n\n".encode()

        yield b"data: [DONE]\n\n"
    except anthropic.AuthenticationError:
        yield b'data: {"delta": "Authentication error - check your Anthropic API key in Settings."}\n\n'
        yield b"data: [DONE]\n\n"
    except Exception as e:
        log.error("chat stream error: %s", e)
        yield f'data: {{"delta": "Error: {str(e)[:200]}"}}\n\n'.encode()
        yield b"data: [DONE]\n\n"


@router.post("")
async def chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: dict = Depends(get_current_user),
):
    """Stream a chat response using Claude via SSE."""
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Add it to backend/.env",
        )

    await check_limit(db, workspace, "chat")

    messages = [
        {"role": m.role, "content": m.content}
        for m in body.messages
        if m.role in ("user", "assistant") and m.content.strip()
    ]

    if not messages:
        raise HTTPException(status_code=422, detail="No messages provided")

    context_block = build_context_block(body.context)

    # Track usage before streaming — Claude call is considered made once we start
    await track_usage(db, workspace, user, "chat")
    await db.commit()

    return StreamingResponse(
        stream_anthropic(messages, context_block),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
