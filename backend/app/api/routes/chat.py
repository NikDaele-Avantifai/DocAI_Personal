import json
import logging
from typing import AsyncGenerator

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings, CHAT_MODEL, CHAT_MAX_TOKENS
from app.core.auth import require_editor
from app.core.usage import check_limit, track_usage
from app.core.workspace import get_current_workspace
from app.db.database import get_db
from app.models.workspace import Workspace
from app.services.embedding_service import EmbeddingService
from app.services.retrieval_service import retrieve, RetrievedChunk

router = APIRouter()
log = logging.getLogger(__name__)

_embedding_svc = EmbeddingService()


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


RAG_SYSTEM_PROMPT = """You are DocAI Assistant — an AI with direct access to this company's Confluence documentation.

Your primary job: answer questions about the company's internal documentation accurately and helpfully.

When documentation context is provided:
- Answer using ONLY the provided documentation
- Always cite the source page name when you reference specific information
- Always include the space name when mentioning a page, format as: "PageTitle (SpaceName)"
- If multiple pages are relevant, synthesise across them
- If the answer is not in the documentation, say clearly: "I don't see that covered in your documentation."
- Never guess or use general knowledge when the question is about company-specific information

When no documentation context is found:
- Say the topic wasn't found in the indexed documentation
- Suggest the user sync their Confluence workspace if they haven't recently
- You can still answer general DocAI platform questions

DocAI platform navigation:
- Overview: workspace health score and at-risk pages
- Pages: browse all synced Confluence pages
- Duplicates: semantic duplicate detection
- Proposals: AI-proposed fixes awaiting approval
- Audit Log: history of all changes
- Batch Rename: bulk title improvement
- Settings → Integrations: connect Confluence

Tone: concise, direct. Use bullet points for lists. Never pad responses."""


def _build_rag_context(chunks: list[RetrievedChunk]) -> str:
    """Format retrieved chunks into a context block for Claude."""
    if not chunks:
        return ""

    parts = ["DOCUMENTATION CONTEXT (use this to answer the question):"]
    parts.append("=" * 60)

    seen_pages: dict[str, list[str]] = {}
    for chunk in chunks:
        display_space = chunk.space_name or chunk.space_key
        key = f"{chunk.page_title} [{display_space}]"
        if key not in seen_pages:
            seen_pages[key] = []
        seen_pages[key].append(chunk.content)

    for page_key, contents in seen_pages.items():
        parts.append(f"\nSource: {page_key}")
        parts.append("-" * 40)
        for content in contents:
            parts.append(content)

    parts.append("=" * 60)
    return "\n".join(parts)


def _build_dashboard_context(context: dict) -> str:
    """Build context block from dashboard state (existing behaviour)."""
    parts = []

    if context.get("currentRoute") and context["currentRoute"] != "extension":
        route = context["currentRoute"]
        route_names = {
            "/overview": "Overview", "/pages": "Pages",
            "/duplicates": "Duplicate Detector", "/proposals": "Proposals",
            "/audit": "Audit Log", "/batch-rename": "Batch Rename",
            "/settings": "Settings",
        }
        parts.append(f"User is viewing: {route_names.get(route, route)}")

    if context.get("pages"):
        parts.append(f"Total pages synced: {context['pages']}")
    if context.get("issues"):
        parts.append(f"Pending issues: {context['issues']}")
    if context.get("duplicates"):
        parts.append(f"Duplicates detected: {context['duplicates']}")
    if context.get("pageTitle"):
        parts.append(f"Currently viewing page: {context['pageTitle']}")

    if context.get("pageContent"):
        content = context["pageContent"][:4000]
        parts.append(
            f"\n--- CURRENT PAGE CONTENT ---\n{content}\n--- END ---"
        )

    return "\n".join(parts)


def _extract_sources(chunks: list[RetrievedChunk]) -> list[dict]:
    """Deduplicated source list for the frontend to display."""
    seen: set[str] = set()
    sources = []
    for chunk in chunks:
        if chunk.page_id not in seen:
            seen.add(chunk.page_id)
            sources.append({
                "page_id": chunk.page_id,
                "title": chunk.page_title,
                "space_key": chunk.space_key,
                "space_name": chunk.space_name or chunk.space_key,
                "url": chunk.page_url,
                "owner": chunk.page_owner,
            })
    return sources


async def stream_anthropic(
    messages: list[dict],
    rag_context: str,
    dashboard_context: str,
    sources: list[dict],
) -> AsyncGenerator[bytes, None]:
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    system = RAG_SYSTEM_PROMPT

    if rag_context:
        system += f"\n\n{rag_context}"

    if dashboard_context:
        system += f"\n\nDashboard state:\n{dashboard_context}"

    try:
        async with client.messages.stream(
            model=CHAT_MODEL,
            max_tokens=CHAT_MAX_TOKENS,
            system=system,
            messages=messages,
        ) as stream:
            if sources:
                sources_payload = json.dumps({"sources": sources})
                yield f"data: {sources_payload}\n\n".encode()

            async for text in stream.text_stream:
                payload = json.dumps({"delta": text})
                yield f"data: {payload}\n\n".encode()

        yield b"data: [DONE]\n\n"

    except anthropic.AuthenticationError:
        yield b'data: {"delta": "Authentication error - check Anthropic API key."}\n\n'
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
    user: dict = Depends(require_editor),
):
    """Stream a RAG-augmented chat response using Claude via SSE."""
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured.",
        )

    await check_limit(db, workspace, "chat")

    messages = [
        {"role": m.role, "content": m.content}
        for m in body.messages
        if m.role in ("user", "assistant") and m.content.strip()
    ]

    if not messages:
        raise HTTPException(status_code=422, detail="No messages provided")

    last_user_message = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"),
        ""
    )

    chunks: list[RetrievedChunk] = []
    if last_user_message and workspace.confluence_connected:
        try:
            chunks = await retrieve(
                query=last_user_message,
                workspace_id=workspace.id,
                embedding_svc=_embedding_svc,
                db=db,
            )
        except Exception as exc:
            log.warning("chat: RAG retrieval failed (non-fatal): %s", exc)
            chunks = []

    rag_context = _build_rag_context(chunks)
    dashboard_context = _build_dashboard_context(body.context)
    sources = _extract_sources(chunks)

    await track_usage(db, workspace, user, "chat")
    await db.commit()

    return StreamingResponse(
        stream_anthropic(messages, rag_context, dashboard_context, sources),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
