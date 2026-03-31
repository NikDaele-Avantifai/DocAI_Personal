import json
import logging
from typing import AsyncGenerator

import anthropic
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter()
log = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: dict = {}


SYSTEM_PROMPT = """You are DocAI Assistant, an expert in documentation management and Confluence.
You help users understand their documentation health, explain detected issues, suggest improvements, and answer questions about their workspace.
You have access to context about the current page being viewed and the overall workspace health.
Be concise, professional, and actionable. Use bullet points for lists. Keep responses focused and avoid unnecessary filler.

When discussing issues, always suggest a concrete next action the user can take in the DocAI dashboard."""


def build_context_block(context: dict) -> str:
    parts = []
    if context.get("currentRoute"):
        route = context["currentRoute"]
        route_names = {
            "/overview": "Overview", "/pages": "Pages", "/duplicates": "Duplicate Detector",
            "/proposals": "Proposals", "/audit": "Audit Log", "/batch-rename": "Batch Rename",
            "/settings": "Settings",
        }
        parts.append(f"Current page: {route_names.get(route, route)}")
    if context.get("pages"):
        parts.append(f"Total pages synced: {context['pages']}")
    if context.get("issues"):
        parts.append(f"Pending issues: {context['issues']}")
    if context.get("duplicates"):
        parts.append(f"Duplicates detected: {context['duplicates']}")
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
async def chat(body: ChatRequest):
    """Stream a chat response using Claude via SSE."""
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Add it to backend/.env",
        )

    messages = [
        {"role": m.role, "content": m.content}
        for m in body.messages
        if m.role in ("user", "assistant") and m.content.strip()
    ]

    if not messages:
        raise HTTPException(status_code=422, detail="No messages provided")

    context_block = build_context_block(body.context)

    return StreamingResponse(
        stream_anthropic(messages, context_block),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
