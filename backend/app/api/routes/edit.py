from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal
import anthropic
import json
import difflib
import uuid
from datetime import datetime

from app.core.config import settings
from app.api.routes.proposals import _proposals

router = APIRouter()
client = anthropic.Anthropic(api_key=settings.anthropic_api_key)


class GenerateEditRequest(BaseModel):
    page_id: str
    page_title: str
    content: str
    page_version: int = 1
    edit_type: Literal["restructure", "add_summary", "rewrite", "remove_section"]
    remove_section_hint: str | None = None
    space: str | None = None


EDIT_TYPE_LABELS = {
    "restructure":    "Restructure",
    "add_summary":    "Add Summary",
    "rewrite":        "Rewrite",
    "remove_section": "Remove Section",
}

EDIT_SYSTEM_PROMPT = """You are DocAI, an expert technical writer improving Confluence documentation.

Given a Confluence page and an edit type, produce an improved version of the page.

Edit types:
- "restructure": Reorganize with clear headings (h1./h2./h3.), logical sections, and proper hierarchy. Preserve ALL information — do not delete any content.
- "add_summary": Prepend an Overview section with: a 2-3 sentence description, Owner field, Last Reviewed date (use today), and Purpose. Keep the rest of the page unchanged.
- "rewrite": Rewrite for clarity, conciseness, and professionalism. Fix grammar, remove jargon, and improve readability. Preserve all factual content.
- "remove_section": Remove ONLY the section(s) matching the provided hint. Keep everything else intact.

Format the output in Confluence wiki markup:
- h1. for top-level headings
- h2. for subheadings
- h3. for sub-subheadings
- * for bullet list items
- # for numbered list items
- *bold* for bold text
- _italic_ for italic text
- ||heading||heading|| / |cell|cell| for tables

Respond with ONLY a valid JSON object — no preamble, no markdown fences, no explanation.

Response format:
{
  "new_content": "Full page content in Confluence wiki markup",
  "rationale": "1-2 sentences explaining what was changed and why",
  "confidence": 85
}

Do not invent new facts. Confidence 0-100 based on how clear the improvement is."""


def _build_user_message(request: GenerateEditRequest) -> str:
    msg = f"Edit type: {request.edit_type}\n"
    msg += f"Page title: {request.page_title}\n"
    if request.space:
        msg += f"Space: {request.space}\n"
    if request.remove_section_hint:
        msg += f"Section to remove: {request.remove_section_hint}\n"
    msg += f"\nCurrent page content:\n{request.content}"
    return msg


def _generate_diff_lines(old_content: str, new_content: str) -> list[dict]:
    old_lines = old_content.splitlines()
    new_lines = new_content.splitlines()

    diff = list(difflib.unified_diff(old_lines, new_lines, lineterm="", n=3))

    result = []
    for line in diff:
        if line.startswith("@@"):
            result.append({"type": "hunk", "content": line})
        elif line.startswith("+"):
            result.append({"type": "add", "content": line[1:]})
        elif line.startswith("-"):
            result.append({"type": "remove", "content": line[1:]})
        elif line.startswith(" "):
            result.append({"type": "context", "content": line[1:]})

    # If no diff lines were produced (identical content), signal that
    if not result:
        result.append({"type": "context", "content": "(No changes detected)"})

    return result


@router.post("/generate")
async def generate_edit(body: GenerateEditRequest):
    """
    Use Claude to generate an improved version of a page, then store it as a proposal.
    Returns the created proposal including the diff for the dashboard to display.
    """
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=EDIT_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": _build_user_message(body),
            }
        ],
    )

    raw = message.content[0].text.strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Claude returned invalid JSON: {exc}",
        )

    new_content: str = parsed.get("new_content", "")
    rationale: str = parsed.get("rationale", "No rationale provided.")
    confidence: int = int(parsed.get("confidence", 80))

    diff_lines = _generate_diff_lines(body.content, new_content)

    proposal_id = str(uuid.uuid4())
    action = body.edit_type if body.edit_type != "remove_section" else "restructure"

    proposal = {
        "id": proposal_id,
        "action": action,
        "action_label": EDIT_TYPE_LABELS[body.edit_type],
        "source_page_id": body.page_id,
        "source_page_title": body.page_title,
        "target_page_id": None,
        "target_page_title": None,
        "rationale": rationale,
        "diff": json.dumps(diff_lines),
        "new_content": new_content,
        "page_version": body.page_version,
        "space": body.space,
        "confidence": confidence,
        "status": "pending",
        "proposed_by": "DocAI",
        "created_at": datetime.utcnow().isoformat(),
        "reviewed_at": None,
        "reviewed_by": None,
    }

    _proposals[proposal_id] = proposal

    # Return with diff already parsed so the dashboard can render it immediately
    return {**proposal, "diff": diff_lines}
