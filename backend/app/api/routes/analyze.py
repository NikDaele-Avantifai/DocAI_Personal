from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal
import anthropic
import json

from app.core.config import settings

router = APIRouter()
client = anthropic.Anthropic(api_key=settings.anthropic_api_key)


class AnalyzeRequest(BaseModel):
    url: str
    title: str | None = None
    content: str | None = None
    last_modified: str | None = None
    owner: str | None = None


class Issue(BaseModel):
    type: Literal["stale", "duplicate", "orphan", "unowned", "unstructured"]
    severity: Literal["low", "medium", "high"]
    title: str
    description: str
    suggestion: str


class AnalyzeResponse(BaseModel):
    page_title: str
    page_url: str
    issues: list[Issue]
    summary: str


SYSTEM_PROMPT = """You are DocAI, an expert documentation analyst for Confluence pages.

Your job is to analyze a Confluence page and identify documentation quality issues.

You must respond with ONLY a valid JSON object — no preamble, no markdown, no explanation.

Issue types you can detect:
- "stale": Page hasn't been updated recently or content references outdated information
- "duplicate": Content likely exists elsewhere or overlaps with other pages
- "orphan": Page appears isolated with no clear parent or links
- "unowned": No clear owner or responsible team identified
- "unstructured": Missing standard sections like Overview, Owner, Last Reviewed, or poor formatting

Severity levels:
- "high": Immediate attention needed, could cause real problems
- "medium": Should be addressed soon
- "low": Nice to have improvement

Response format (JSON only):
{
  "issues": [
    {
      "type": "stale",
      "severity": "high",
      "title": "Short title of the issue",
      "description": "1-2 sentences explaining what the problem is",
      "suggestion": "Concrete actionable suggestion to fix it"
    }
  ],
  "summary": "One sentence summary of the overall documentation health"
}

If the page looks healthy, return an empty issues array with a positive summary.
Return between 0 and 5 issues maximum. Be specific and accurate."""


@router.post("/", response_model=AnalyzeResponse)
async def analyze_page(body: AnalyzeRequest):
    """
    Analyze a Confluence page using Claude AI and return detected issues.
    """

    page_info = f"Page Title: {body.title or 'Unknown'}\nURL: {body.url}"

    if body.last_modified:
        page_info += f"\nLast Modified: {body.last_modified}"

    if body.owner:
        page_info += f"\nOwner: {body.owner}"

    if body.content:
        page_info += f"\n\nPage Content:\n{body.content}"
    else:
        page_info += "\n\nNote: No page content was available. Analyze based on metadata only."

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Please analyze this Confluence page:\n\n{page_info}"
            }
        ]
    )

    raw = message.content[0].text.strip()

    # Strip markdown code fences if Claude wraps in them
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    parsed = json.loads(raw)

    issues = [Issue(**issue) for issue in parsed.get("issues", [])]
    summary = parsed.get("summary", f"Analysis complete. Found {len(issues)} issue(s).")

    return AnalyzeResponse(
        page_title=body.title or "Untitled Page",
        page_url=body.url,
        issues=issues,
        summary=summary
    )