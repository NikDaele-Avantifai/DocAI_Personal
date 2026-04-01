from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal
import anthropic
import json
import difflib
import uuid
import re
import html as html_module
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
    edit_type: Literal["restructure", "add_summary", "rewrite", "remove_section", "targeted_fix"]
    remove_section_hint: str | None = None
    space: str | None = None
    # Populated when fixing a specific detected issue (enables targeted-fix mode)
    issue_title: str | None = None
    issue_description: str | None = None
    issue_suggestion: str | None = None


EDIT_TYPE_LABELS = {
    "restructure":    "Restructure",
    "add_summary":    "Add Summary",
    "rewrite":        "Rewrite",
    "remove_section": "Remove Section",
    "targeted_fix":   "Targeted Fix",
}

EDIT_SYSTEM_PROMPT = """You are DocAI, an expert technical writer improving Confluence documentation.

Given a Confluence page and an edit type, produce an improved version of the page.

IMPORTANT — TITLE RULE:
The page title is set separately in Confluence. Do NOT include the page title as a heading (h1. or otherwise) at the top of new_content. Start the content directly with the first section or overview text.

Edit types:
- "restructure": Reorganize with clear headings (h2./h3.), logical sections, and proper hierarchy. Preserve ALL information — do not delete any content.
- "add_summary": Prepend an Overview section with: a 2-3 sentence description, Owner field, Last Reviewed date (use today's date provided in the request), and Purpose. Keep the rest of the page unchanged.
- "rewrite": Rewrite for clarity, conciseness, and professionalism. Fix grammar, remove jargon, and improve readability. Preserve all factual content.
- "remove_section": Remove ONLY the section(s) matching the provided hint. Keep everything else intact.

DATE RULE:
Today's date is provided in each request. Use it when writing or updating any review dates, "Last Reviewed", or "Next Review" fields. Never use a past year as "current".

Format the output in Confluence wiki markup:
- h2. for top-level section headings (do NOT use h1. — the page title is h1)
- h3. for sub-sections
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


TARGETED_FIX_SYSTEM_PROMPT = """You are DocAI. Your only task is to apply ONE precise, targeted fix to a Confluence page.

STRICT RULES — follow every one of these:
1. Change ONLY what the issue description requires. Read it carefully.
2. Do NOT rename section headings unless the issue is specifically about renaming.
3. Do NOT switch bullet style (keep * as *, keep # as #) unless the issue requires it.
4. Do NOT reorder sections or paragraphs.
5. Do NOT add, remove, or change blank lines except where the fix directly requires it.
6. Do NOT change capitalisation, wording, or formatting of any content unrelated to the issue.
7. Return the FULL page with the one fix applied — everything else must remain identical.

Use the SAME Confluence wiki markup style as the input. Do not introduce a different markup style.

Do not invent new facts. Confidence 0-100 based on how confident you are the fix is correct.

Respond with ONLY a valid JSON object:
{
  "new_content": "Full page content with ONLY the targeted change applied",
  "rationale": "One sentence: exactly what was changed and why",
  "confidence": 85
}"""


def _build_user_message(request: GenerateEditRequest) -> str:
    today = datetime.utcnow().strftime("%Y-%m-%d")

    if request.edit_type == "targeted_fix" and request.issue_title:
        msg = f"Today's date: {today}\n"
        msg += f"Page title: {request.page_title}\n"
        if request.space:
            msg += f"Space: {request.space}\n"
        msg += "\n=== ISSUE TO FIX ===\n"
        msg += f"Issue: {request.issue_title}\n"
        if request.issue_description:
            msg += f"Detail: {request.issue_description}\n"
        if request.issue_suggestion:
            msg += f"Suggested fix: {request.issue_suggestion}\n"
        # Convert HTML input to wiki markup so Claude echoes wiki markup back
        msg += f"\n=== CURRENT PAGE CONTENT (Confluence wiki markup) ===\n{_html_to_wiki(request.content)}"
        return msg

    msg = f"Today's date: {today}\n"
    msg += f"Edit type: {request.edit_type}\n"
    msg += f"Page title: {request.page_title}\n"
    if request.space:
        msg += f"Space: {request.space}\n"
    if request.remove_section_hint:
        msg += f"Section to remove: {request.remove_section_hint}\n"
    msg += f"\nCurrent page content (Confluence wiki markup):\n{_html_to_wiki(request.content)}"
    return msg


def _html_to_wiki(text: str) -> str:
    """
    Convert Confluence storage-format HTML to wiki-markup-like plain text so that
    diffs between the old HTML page and the new wiki-markup content are readable.
    """
    # Block-level elements → newlines with heading markers
    text = re.sub(r'<h([1-6])[^>]*>', lambda m: f'\nh{m.group(1)}. ', text, flags=re.IGNORECASE)
    text = re.sub(r'</h[1-6]>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</?p[^>]*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<li[^>]*>', '\n* ', text, flags=re.IGNORECASE)
    text = re.sub(r'</li>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'</?[ou]l[^>]*>', '\n', text, flags=re.IGNORECASE)
    # Inline formatting → wiki markup equivalents
    text = re.sub(r'<strong[^>]*>(.*?)</strong>', r'*\1*', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'<b[^>]*>(.*?)</b>', r'*\1*', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'<em[^>]*>(.*?)</em>', r'_\1_', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'<i[^>]*>(.*?)</i>', r'_\1_', text, flags=re.IGNORECASE | re.DOTALL)
    # Strip any remaining tags
    text = re.sub(r'<[^>]+>', '', text)
    # Decode HTML entities (&amp; &lt; &nbsp; etc.)
    text = html_module.unescape(text)
    # Normalise whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _generate_diff_lines(old_content: str, new_content: str) -> list[dict]:
    # Normalise the old HTML content to wiki-markup-like text so the diff
    # compares semantically equivalent representations, not raw HTML vs markup.
    old_lines = _html_to_wiki(old_content).splitlines()
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
    system_prompt = (
        TARGETED_FIX_SYSTEM_PROMPT
        if body.edit_type == "targeted_fix" and body.issue_title
        else EDIT_SYSTEM_PROMPT
    )

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=system_prompt,
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
    action = (
        "restructure" if body.edit_type == "remove_section"
        else body.edit_type
    )

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
