"""
Batch operations — scan entire workspace and create bulk proposals.
Currently supports: rename (identify poorly-named pages and suggest better titles).
"""
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.auth import require_editor
from app.core.usage import check_limit, track_usage
from app.core.workspace import get_current_workspace
from app.db.database import get_db
from app.models.workspace import Workspace
from app.models.page import Page

router = APIRouter()
client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

# Share the in-memory proposal store from proposals.py
from app.api.routes.proposals import _proposals  # noqa: E402


# ── Constants ─────────────────────────────────────────────────────────────────

_VALID_SHORT = {"faq", "api", "hr", "qa", "ui", "ux", "db"}

_POOR_PATTERNS = {
    "untitled", "draft", "copy of", "new page", "test", "temp",
    "wip", "tbd", "page 1", "document",
}

_DATE_RE = re.compile(
    r"""^(
        \d{4}[-/]\d{2}([-/]\d{2})?
      | \d{1,2}[-/]\d{1,2}([-/]\d{2,4})?
      | (january|february|march|april|may|june|july|august|
         september|october|november|december)\s+\d{4}
      | (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d{4}
      | q[1-4]\s*\d{2,4}
    )$""",
    re.IGNORECASE | re.VERBOSE,
)


def _is_deterministic_poor(title: str) -> str | None:
    stripped = title.strip()
    if not stripped:
        return "Empty or whitespace-only title"

    low = stripped.lower()

    for pat in _POOR_PATTERNS:
        if low == pat or low.startswith(pat):
            return f"Matches poor naming pattern '{pat}'"

    words = stripped.split()
    if len(words) == 1 and len(stripped) < 5 and low not in _VALID_SHORT:
        return f"Single short word '{stripped}' gives no context"

    if _DATE_RE.match(stripped):
        return "Title is a date or date-like string"

    return None


# ── Prompt ────────────────────────────────────────────────────────────────────

RENAME_SYSTEM = """You are a documentation quality expert auditing Confluence page titles for an enterprise workspace.

CRITICAL RULES:
1. NEVER flag structural navigation pages. Pages titled 'Overview', 'Home', 'Index', 'Contents', 'Navigation', 'Getting Started', 'Introduction', 'Welcome' are intentional structural titles — do NOT flag them regardless of their content.
2. NEVER suggest 'Untitled Page' as a replacement. If you cannot determine a good title from the content, skip the page entirely.
3. Suggested titles must be specific and descriptive — a reader should know exactly what the page contains from the title alone.
4. Maximum 6 words. Title case. No special characters, no version numbers, no dates.
5. Folders cannot be renamed via the API — include them in results with a note but mark isFolder: true.

For each page, score title-to-content relevance 1-10. Flag if score < 4 OR deterministic=true.
Skip if: the title is a clear structural navigation term (see rule 1).

BAD suggestions: 'Untitled Page', 'Page Content', 'Document', 'General Information'
GOOD suggestions: 'API Token Authentication Guide', 'Q3 Deployment Runbook', 'GDPR Data Retention Policy'

FOLDER NAMING RULES:
Folders are structural containers with no content of their own.
When isFolder is true:
- Generate the suggested title based ONLY on the childTitles array provided
- The folder name should reflect the common theme or category of its children
- Examples: children ['API Authentication Doc', 'API Integration Guide', 'OAuth Setup'] → folder name 'API Documentation'
- Examples: children ['Q3 Sprint Retrospective', 'Q4 Sprint Retrospective', 'Meeting Notes'] → folder name 'Sprint Reviews'
- If childTitles is empty, set suggestedTitle to null and skip this folder
- Folder names should be 2-4 words maximum, broad enough to describe all children
- Never suggest a folder name that is identical to one of its children

Return ONLY a valid JSON array. If no pages need renaming, return [].

Format:
[
  {
    "pageId": "string",
    "currentTitle": "string",
    "suggestedTitle": "string — specific, max 6 words, title case",
    "reason": "One sentence: what is wrong with the current title.",
    "relevanceScore": 4,
    "isFolder": false
  }
]"""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _build_grouped_proposal(renames: list[dict[str, Any]], workspace_id: str) -> dict[str, Any]:
    pid = str(uuid.uuid4())
    return {
        "id": pid,
        "workspace_id": workspace_id,
        "action": "rename",
        "category": "rename",
        "source_page_id": renames[0]["pageId"] if renames else "",
        "source_page_title": f"Rename suggestions ({len(renames)} pages)",
        "rationale": f"DocAI identified {len(renames)} pages with poor or misleading titles.",
        "confidence": 85,
        "renames": renames,
        "diff": "[]",
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
        "reviewed_by": None,
    }


def _call_claude(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payload = json.dumps([
        {
            "pageId": p["id"],
            "title": p["title"],
            "space": p["space_key"] or "",
            "contentSnippet": p.get("contentSnippet") or (p.get("content") or "")[:400],
            "isFolder": p.get("is_folder", False),
            "isEmptyPage": p.get("_is_empty_page", False),
            "childTitles": p.get("childTitles", []),
            "deterministic": p.get("_deterministic", False),
            "deterministicReason": p.get("_det_reason", ""),
        }
        for p in pages
    ], ensure_ascii=False)

    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=RENAME_SYSTEM,
        messages=[{"role": "user", "content": f"Review these pages:\n{payload}"}],
    )

    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    return json.loads(raw)


# ── Routes ───────────────────────────────────────────────────────────────────

class BatchRenameRequest(BaseModel):
    space_key: str | None = Field(None, max_length=500)
    min_confidence: int = Field(70, ge=0, le=100)

    @field_validator("space_key", mode="before")
    @classmethod
    def strip_whitespace(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


@router.post("/rename")
async def batch_rename(
    body: BatchRenameRequest,
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: dict = Depends(require_editor),
):
    wid = workspace.id
    q = select(Page).where(Page.workspace_id == wid)
    if body.space_key:
        q = q.where(Page.space_key == body.space_key)
    rows = (await db.execute(q)).scalars().all()

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No synced pages found. Run a Confluence sync first.",
        )

    pages = []
    for p in rows:
        det_reason = _is_deterministic_poor(p.title or "")
        pages.append({
            "id": p.id,
            "title": p.title or "",
            "space_key": p.space_key,
            "word_count": p.word_count,
            "content": p.content or "",
            "is_folder": bool(p.is_folder),
            "_deterministic": det_reason is not None,
            "_det_reason": det_reason or "",
        })

    # Build parent→children map for folder enrichment (scoped to workspace)
    all_pages = (await db.execute(
        select(Page).where(Page.workspace_id == wid)
    )).scalars().all()
    children_map: dict[str, list[str]] = {}
    for p in all_pages:
        if p.parent_id:
            children_map.setdefault(p.parent_id, []).append(p.title or "")

    for p in pages:
        if p.get("is_folder"):
            child_titles = children_map.get(p["id"], [])
            p["childTitles"] = child_titles[:10]
            if child_titles:
                p["contentSnippet"] = f"Folder containing: {', '.join(child_titles[:5])}"
                if not p.get("_deterministic"):
                    det = _is_deterministic_poor(p["title"])
                    if det:
                        p["_deterministic"] = True
                        p["_det_reason"] = det
            else:
                p["_skip"] = True

        if not p.get("is_folder"):
            is_empty = (p.get("word_count") or 0) < 10 and not p.get("content", "").strip()
            if is_empty and not p.get("_deterministic"):
                p["_skip"] = True
                p["_skip_reason"] = "empty_content_acceptable_title"
            elif is_empty and p.get("_deterministic"):
                p["_is_empty_page"] = True

    empty_bad_title_pages = [
        p for p in pages
        if not p.get("_skip") and not p.get("is_folder") and p.get("_is_empty_page")
    ]

    pages_to_scan = [p for p in pages if not p.get("_skip") and not p.get("_is_empty_page")]
    skipped_empty_pages = sum(1 for p in pages if p.get("_skip") and not p.get("is_folder"))
    skipped_empty_folders = sum(1 for p in pages if p.get("_skip") and p.get("is_folder"))

    await check_limit(db, workspace, "rename")

    BATCH = 50
    suggestions: list[dict[str, Any]] = []
    for i in range(0, len(pages_to_scan), BATCH):
        chunk = pages_to_scan[i : i + BATCH]
        try:
            results = _call_claude(chunk)
            suggestions.extend(results)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AI analysis failed: {exc}")

    await track_usage(db, workspace, user, "rename", meta=body.space_key)

    _bad_titles = {"untitled page", "untitled", "page", "document", "general information", "page content", "cannot determine from empty content"}
    suggestions = [
        s for s in suggestions
        if s.get("suggestedTitle")
        and s.get("suggestedTitle", "").lower() not in _bad_titles
        and s.get("suggestedTitle", "") != s.get("currentTitle", "")
    ]

    for p in empty_bad_title_pages:
        suggestions.append({
            "pageId": p["id"],
            "currentTitle": p["title"],
            "suggestedTitle": None,
            "reason": f"Empty page with placeholder title '{p['title']}' — add content or delete this page.",
            "relevanceScore": 1,
            "isFolder": False,
            "isEmptyPage": True,
            "requiresHuman": True,
        })

    if not suggestions:
        return {
            "pages_scanned": len(pages),
            "pages_flagged": 0,
            "skipped_empty_pages": skipped_empty_pages,
            "skipped_empty_folders": skipped_empty_folders,
            "proposals_created": 0,
            "proposal_ids": [],
            "skipped_low_confidence": 0,
        }

    page_map = {p["id"]: p for p in pages}
    for s in suggestions:
        page = page_map.get(s.get("pageId", ""), {})
        s.setdefault("isFolder", page.get("is_folder", False))

    proposal = _build_grouped_proposal(suggestions, wid)
    _proposals[proposal["id"]] = proposal

    return {
        "pages_scanned": len(pages),
        "pages_flagged": len(suggestions),
        "skipped_empty_pages": skipped_empty_pages,
        "skipped_empty_folders": skipped_empty_folders,
        "proposals_created": 1,
        "proposal_ids": [proposal["id"]],
        "skipped_low_confidence": 0,
    }


@router.get("/rename/preview")
async def preview_rename_candidates(
    space_key: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
):
    q = select(Page.id, Page.title, Page.space_key, Page.word_count).where(
        Page.workspace_id == workspace.id
    )
    if space_key:
        q = q.where(Page.space_key == space_key)
    rows = (await db.execute(q)).all()
    return {"total": len(rows), "space_key": space_key}
