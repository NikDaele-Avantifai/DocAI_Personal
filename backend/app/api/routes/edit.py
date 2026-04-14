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
    # v2: exact verbatim text that has the issue (from exactContent field)
    issue_exact_content: str | None = None


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


TARGETED_FIX_SYSTEM_PROMPT = """You are DocAI. Your only task is to apply ONE precise, surgical fix to a Confluence page.

STRICT RULES — you must follow every one:
1. Read the issue description carefully and change only the minimum text required to fix it.
2. Do NOT rename section headings unless the issue is specifically about the heading text.
3. Do NOT switch bullet style (keep * as *, keep # as #) unless the issue requires it.
4. Do NOT reorder, add, or remove sections or paragraphs.
5. Do NOT add, remove, or change blank lines except where the fix directly requires it.
6. Do NOT change capitalisation, wording, tone, or formatting of any content unrelated to the fix.
7. Return the FULL page content with the one change applied — everything else must be character-for-character identical to the input.
8. If a section is truly irrelevant to the content of the page, you can delete it. Proposal would be just to delete it — if so just return 'delete' as variable.

Think of it as a find-and-replace: you find the exact broken text and swap it for the corrected text. Nothing else moves.

Use Confluence wiki markup — the same format as the input. Formatting rules:
- Headings: h1. h2. h3. (match the original heading level exactly, e.g. "h2. Section Title")
- Bold: *text*
- Italic: _italic_
- Underline: +text+
- Strikethrough: -text-
- Bullet list items: * item (one asterisk + space, one per line)
- Numbered list items: # item (one hash + space, one per line)
- Tables: ||heading1||heading2|| for header rows, |cell1|cell2| for data rows
- Never use markdown syntax (**, __, ##) outside of the conventions above.
- Never change formatting of content outside the targeted section.
- Code blocks: use {code}your code here{code} for any code examples, command-line snippets, or technical syntax. Never convert code blocks to plain paragraphs.
- Preserve existing {code} blocks exactly — do not unwrap them or convert their content to plain text.

Respond with ONLY a valid JSON object:
{
  "new_content": "Full page content with ONLY the targeted change applied",
  "rationale": "One sentence: exactly which text was changed and what it was changed to",
  "confidence": 85
}"""

# Used when exactContent is known — Claude returns ONLY the replacement for the snippet.
# Python does the substitution server-side. This is the safest mode because Claude
# never sees or can touch the rest of the page.
SNIPPET_FIX_SYSTEM_PROMPT = """You are DocAI. You will be shown a short text snippet that has an issue. Return ONLY the corrected replacement for that snippet.

CRITICAL RULES:
1. DELETION IS A VALID FIX: If the snippet is placeholder text, redundant, incorrect, or should simply be removed — return an empty string as the replacement. Do NOT invent new content to fill the gap.
2. Return ONLY the replacement text for the snippet — not the surrounding page, not explanations inside the text.
3. If the suggested fix says to remove, delete, or omit the content, return an empty string ("").
4. Write in Confluence wiki markup. Formatting rules:
   - Headings: h2. h3. (match original level)
   - Bold: *text*, Italic: _text_, Underline: +text+
   - Bullets: * item, Numbered: # item
   - Tables: ||heading|| / |cell|
   - Never use markdown (**, ##, __)
   - Code blocks: use {code}your code here{code} for any code examples, command-line snippets, or technical syntax. Never convert code blocks to plain paragraphs.
   - Preserve existing {code} blocks exactly — do not unwrap them or convert their content to plain text.

Respond with ONLY a valid JSON object:
{
  "replacement": "the corrected text, or empty string if content should be deleted",
  "rationale": "One sentence explaining what was wrong and what was done (e.g. 'Removed placeholder text \"test\"')",
  "confidence": 85
}"""


def _build_user_message(request: GenerateEditRequest) -> str:
    today = datetime.utcnow().strftime("%Y-%m-%d")

    if request.edit_type == "targeted_fix" and request.issue_title:
        # ── Snippet mode: exactContent is known ──────────────────────────────
        # We send ONLY the broken snippet to Claude and get back just its replacement.
        # Python does the substitution. Claude never sees the rest of the page,
        # so it cannot accidentally modify code blocks, headings, or other content.
        if request.issue_exact_content:
            msg = f"Issue: {request.issue_title}\n"
            if request.issue_description:
                msg += f"Detail: {request.issue_description}\n"
            if request.issue_suggestion:
                msg += f"Suggested fix: {request.issue_suggestion}\n"
            else:
                msg += "Suggested fix: Remove this content entirely.\n"
            msg += f"\nSnippet to fix:\n{request.issue_exact_content}"
            return msg

        # ── Full-page mode: no exactContent, Claude must locate the issue ────
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
        msg += f"\n=== CURRENT PAGE CONTENT (Confluence wiki markup) ===\n{_html_to_wiki(request.content)}"
        return msg

    msg = f"Today's date: {today}\n"
    msg += f"Edit type: {request.edit_type}\n"
    msg += f"Page title: {request.page_title}\n"
    if request.space:
        msg += f"Space: {request.space}\n"
    if request.remove_section_hint:
        msg += f"Section to remove: {request.remove_section_hint}\n"
    # Combined mode: apply the improvement AND fix detected issues in one pass
    if request.issue_title and request.issue_description:
        msg += "\n=== ALSO FIX THESE DETECTED ISSUES (apply alongside the edit type above) ===\n"
        msg += f"Issues: {request.issue_title}\n"
        msg += f"Details: {request.issue_description}\n"
        if request.issue_suggestion:
            msg += f"Suggested fixes: {request.issue_suggestion}\n"
    msg += f"\nCurrent page content (Confluence wiki markup):\n{_html_to_wiki(request.content)}"
    return msg


def _html_to_wiki(text: str) -> str:
    """
    Convert Confluence storage-format HTML to wiki-markup-like plain text so that
    diffs between the old HTML page and the new wiki-markup content are readable.
    """
    # Strip Confluence CDATA markers before any other processing
    text = text.replace('<![CDATA[', '')
    text = text.replace(']]>', '')
    # Preserve Confluence code blocks as wiki {code} macros
    def _replace_code_block(m):
        inner = m.group(1).strip()
        return f'\n{{code}}\n{inner}\n{{code}}\n'

    text = re.sub(
        r'<ac:structured-macro[^>]*ac:name=["\']code["\'][^>]*>.*?<ac:plain-text-body>(.*?)</ac:plain-text-body>.*?</ac:structured-macro>',
        _replace_code_block,
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Handle plain-text-body elements outside of code macros
    text = re.sub(
        r'<ac:plain-text-body>(.*?)</ac:plain-text-body>',
        lambda m: f'\n{m.group(1).strip()}\n',
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Remove Confluence line-number spans before generic tag stripping
    text = re.sub(
        r'<span[^>]*(?:class="[^"]*(?:linenumber|ds-line-number)[^"]*"|data-ds--line-number)[^>]*>.*?</span>',
        '',
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
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
    is_targeted = body.edit_type == "targeted_fix" and bool(body.issue_title)
    use_snippet_mode = is_targeted and bool(body.issue_exact_content)

    if use_snippet_mode:
        system_prompt = SNIPPET_FIX_SYSTEM_PROMPT
    elif is_targeted:
        system_prompt = TARGETED_FIX_SYSTEM_PROMPT
    else:
        system_prompt = EDIT_SYSTEM_PROMPT

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

    rationale: str = parsed.get("rationale", "No rationale provided.")
    confidence: int = int(parsed.get("confidence", 80))

    is_deletion = False
    if use_snippet_mode:
        # Snippet mode: Claude returns only the replacement text for the snippet.
        # We do the substitution server-side so nothing else in the page changes.
        replacement: str = parsed.get("replacement", "")
        # Empty replacement = deletion
        is_deletion = replacement.strip() == ""
        wiki_content = _html_to_wiki(body.content)
        exact = body.issue_exact_content or ""
        if exact and exact in wiki_content:
            new_content = wiki_content.replace(exact, replacement, 1)
        else:
            # Fallback: exact string not found verbatim — try a stripped comparison
            stripped_exact = exact.strip()
            stripped_wiki = wiki_content
            if stripped_exact and stripped_exact in stripped_wiki:
                new_content = stripped_wiki.replace(stripped_exact, replacement, 1)
            else:
                # Cannot locate the exact content — return the page unchanged so
                # the diff shows nothing rather than garbling the document.
                new_content = wiki_content
                is_deletion = False
                rationale = f"[Snippet not found in page — no change applied] {rationale}"
    else:
        raw_new_content: str = parsed.get("new_content", "")
        # Claude signals "delete this section" by returning the literal string "delete"
        is_deletion = raw_new_content.strip().lower() == "delete"
        new_content = "" if is_deletion else raw_new_content

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
        "is_deletion": is_deletion,
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
