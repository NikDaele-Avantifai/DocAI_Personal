"""
Batch operations — scan entire workspace and create bulk proposals.
Currently supports: rename (identify poorly-named pages and suggest better titles).
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.models.page import Page

router = APIRouter()
client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

# Share the in-memory proposal store from proposals.py
from app.api.routes.proposals import _proposals  # noqa: E402


# ── Prompt ───────────────────────────────────────────────────────────────────

RENAME_SYSTEM = """You are a documentation quality expert auditing Confluence page titles.

Identify pages with POOR titles and suggest specific, professional alternatives.

A title is POOR if it is:
- A placeholder: "Untitled", "New Page", "Copy of ...", "Draft", "Test"
- Too vague to be useful: just "Notes", "Meeting", "TODO", "WIP", "TBD", "Misc", "Page", "Temp"
- Only a date or number without context: "2024-01-15", "Q1", "123", "Mar meeting"
- Shorter than 4 characters
- Meaningless abbreviations without context: "HR Q1", "TBD doc", "FYI"
- Clearly auto-generated or accidental

For each poor title, infer a better one using the space name and word count as context signals.
A good title: specific (not generic), 3-7 words, professional, describes the document's purpose.

Return ONLY a valid JSON array. Include ONLY pages that genuinely need renaming. If everything looks fine, return [].

Format (no other text):
[
  {
    "page_id": "string",
    "current_title": "string",
    "suggested_title": "string",
    "rationale": "One sentence: why the current title is poor and why the suggestion is better.",
    "confidence": 0-100
  }
]"""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _build_proposal(page_id: str, page_title: str, space_key: str | None,
                    suggested: str, rationale: str, confidence: int) -> dict[str, Any]:
    pid = str(uuid.uuid4())
    return {
        "id": pid,
        "action": "rename",
        "source_page_id": page_id,
        "source_page_title": page_title,
        "space_key": space_key,
        "new_content": suggested,        # suggested title stored here (mirrors edit flow)
        "page_version": None,            # fetched from Confluence at apply time
        "rationale": rationale,
        "confidence": confidence,
        "diff": json.dumps([
            {"type": "remove", "content": page_title},
            {"type": "add",    "content": suggested},
        ]),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
        "reviewed_by": None,
    }


def _call_claude(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Send a batch of page metadata to Claude and return rename suggestions."""
    payload = json.dumps([
        {
            "id": p["id"],
            "title": p["title"],
            "space": p["space_key"] or "",
            "word_count": p["word_count"],
        }
        for p in pages
    ], ensure_ascii=False)

    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=RENAME_SYSTEM,
        messages=[{"role": "user", "content": f"Review these page titles:\n{payload}"}],
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
    space_key: str | None = None   # None = all synced spaces
    min_confidence: int = 70       # only create proposals above this threshold


@router.post("/rename")
async def batch_rename(
    body: BatchRenameRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Scan all synced pages (or a single space) for poorly-named pages.
    Uses Claude to suggest better titles and creates proposals for each.
    """
    # 1. Load pages from DB
    q = select(Page)
    if body.space_key:
        q = q.where(Page.space_key == body.space_key)
    rows = (await db.execute(q)).scalars().all()

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No synced pages found. Run a Confluence sync first.",
        )

    pages = [
        {
            "id": p.id,
            "title": p.title,
            "space_key": p.space_key,
            "word_count": p.word_count,
        }
        for p in rows
    ]

    # 2. Call Claude in batches of 200 pages
    BATCH = 200
    suggestions: list[dict[str, Any]] = []
    for i in range(0, len(pages), BATCH):
        chunk = pages[i : i + BATCH]
        try:
            results = _call_claude(chunk)
            suggestions.extend(results)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AI analysis failed: {exc}")

    # 3. Build a lookup so we can attach space_key to each suggestion
    page_map = {p["id"]: p for p in pages}

    # 4. Create proposals for suggestions above confidence threshold
    created: list[str] = []
    for s in suggestions:
        if s.get("confidence", 0) < body.min_confidence:
            continue
        page = page_map.get(s["page_id"])
        if not page:
            continue
        proposal = _build_proposal(
            page_id=s["page_id"],
            page_title=s["current_title"],
            space_key=page["space_key"],
            suggested=s["suggested_title"],
            rationale=s["rationale"],
            confidence=int(s["confidence"]),
        )
        _proposals[proposal["id"]] = proposal
        created.append(proposal["id"])

    return {
        "pages_scanned": len(pages),
        "pages_flagged": len(suggestions),
        "proposals_created": len(created),
        "proposal_ids": created,
        "skipped_low_confidence": len(suggestions) - len(created),
    }


@router.get("/rename/preview")
async def preview_rename_candidates(
    space_key: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Return raw page list that would be scanned — useful for UI to show count before scanning.
    """
    q = select(Page.id, Page.title, Page.space_key, Page.word_count)
    if space_key:
        q = q.where(Page.space_key == space_key)
    rows = (await db.execute(q)).all()
    return {"total": len(rows), "space_key": space_key}
