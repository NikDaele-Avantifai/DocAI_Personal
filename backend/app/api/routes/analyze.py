from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Literal, Optional
import anthropic
import json
import re
import html as html_module

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.db.database import get_db
from app.models.page_analysis import PageAnalysis
from app.models.page import Page
from app.models.analysis_settings import AnalysisSettings, WorkspaceSettings
from datetime import datetime, timezone

router = APIRouter()
client = anthropic.Anthropic(api_key=settings.anthropic_api_key)


# ── Issue Taxonomy ─────────────────────────────────────────────────────────────

ISSUE_TAXONOMY: dict[str, dict] = {
    "stale": {
        "label": "Stale content",
        "description": "Page has not been updated within the configured threshold period",
        "fixable": True, "requires_human": False, "fix_action": "update_content",
        "severity_rules": {"high": "not updated in > 12 months", "medium": "not updated in 6-12 months", "low": "not updated in 3-6 months"},
    },
    "unowned": {
        "label": "No owner assigned",
        "description": "Page has no identifiable owner in content or metadata",
        "fixable": True, "requires_human": True,
        "human_reason": "Owner must be assigned by a person with knowledge of the team",
        "fix_action": "assign_owner",
        "severity_rules": {"high": "compliance-tagged page with no owner", "medium": "process document with no owner", "low": "general page with no owner"},
    },
    "unstructured": {
        "label": "Poor document structure",
        "description": "Missing standard sections or inconsistent formatting",
        "fixable": True, "requires_human": False, "fix_action": "restructure",
        "severity_rules": {"high": "no headings, wall of text", "medium": "some structure but missing key sections", "low": "minor formatting improvements needed"},
    },
    "duplicate": {
        "label": "Duplicate content",
        "description": "Content overlaps significantly with another page",
        "fixable": True, "requires_human": True,
        "human_reason": "Merging pages requires human decision on which to keep",
        "fix_action": "merge",
        "severity_rules": {"high": "> 85% similarity with another page", "medium": "60-85% similarity", "low": "significant section overlap"},
    },
    "outdated_reference": {
        "label": "Outdated reference",
        "description": "Page references systems, people, or processes that no longer exist",
        "fixable": True, "requires_human": True,
        "human_reason": "Requires knowledge of current systems to update correctly",
        "fix_action": "update_content",
        "severity_rules": {"high": "references a deprecated critical system", "medium": "references outdated process or tool", "low": "minor outdated terminology"},
    },
    "missing_review_date": {
        "label": "Missing review date",
        "description": "Page has no scheduled review date",
        "fixable": True, "requires_human": False, "fix_action": "add_review_date",
        "severity_rules": {"high": "compliance document with no review date", "medium": "process document with no review date", "low": "general page with no review date"},
    },
    "compliance_gap": {
        "label": "Compliance gap",
        "description": "Page is missing required compliance information for its document type",
        "fixable": False, "requires_human": True,
        "human_reason": "Compliance gaps require review by a qualified compliance officer — DocAI cannot generate compliance content autonomously",
        "severity_rules": {"high": "GDPR/regulatory required section missing", "medium": "recommended compliance section missing", "low": "minor compliance metadata missing"},
    },
    "broken_link": {
        "label": "Broken or missing link",
        "description": "Page references documents or resources that cannot be found",
        "fixable": False, "requires_human": True,
        "human_reason": "Cannot determine the correct replacement link without human input",
        "severity_rules": {"high": "critical process depends on broken link", "medium": "important reference is broken", "low": "minor reference link missing"},
    },
}


# ── Request / Response models ─────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    url: str
    title: str | None = None
    content: str | None = None
    last_modified: str | None = None
    owner: str | None = None
    page_id: str | None = None
    page_version: int | None = None


class IssueLocation(BaseModel):
    section: str
    quote: Optional[str] = None
    line_hint: str = "full_document"


# Keywords that indicate a fix requires information DocAI cannot access.
# If any of these appear in the combined issue text, the issue is flagged
# as needing human input rather than an AI-generated proposal.
_NEEDS_HUMAN_SIGNALS = [
    "email", "e-mail",
    "phone", "telephone",
    "mailing address", "postal address", "physical address",
    "contact information", "contact details", "contact email",
    "point of contact",
    "identify who", "identify the owner", "identify the team",
    "identify the responsible", "identify the person",
    "assign owner", "assign the owner", "ownership",
    "placeholder", "example.com", "@example",
    "tbd", "to be determined",
    "correct url", "internal url", "internal link",
    "data controller", "data processor",
    "business owner", "department head", "account manager",
]


def _is_auto_fixable(title: str, description: str, suggestion: str) -> bool:
    """
    Return True if DocAI can produce a correct fix automatically.
    Return False when the fix requires context that is not in the page
    (e.g. the correct email address, who the owner is, internal links).
    """
    combined = f"{title} {description} {suggestion}".lower()
    return not any(signal in combined for signal in _NEEDS_HUMAN_SIGNALS)


class Issue(BaseModel):
    type: str
    severity: Literal["low", "medium", "high"]
    title: str
    description: str
    suggestion: Optional[str] = None
    location: Optional[IssueLocation] = None
    fixable: bool = True
    requires_human: bool = False
    needs_human_intervention: bool = False  # set post-parse; not expected from Claude
    human_action_needed: Optional[str] = None
    confidence: float = 1.0


class ResolvedIssue(BaseModel):
    title: str
    resolution: str


class AnalyzeResponse(BaseModel):
    page_title: str
    page_url: str
    issues: list[Issue]
    summary: str
    is_healthy: bool = False
    resolved_issues: list[ResolvedIssue] = []
    cached: bool = False


# ── System prompt builder ──────────────────────────────────────────────────────

def _build_system_prompt(analysis_settings: AnalysisSettings) -> str:
    enabled = analysis_settings.enabled_issue_types
    min_sev = analysis_settings.min_severity
    focus = analysis_settings.focus_mode
    max_issues = analysis_settings.max_issues_per_page
    confidence_threshold = analysis_settings.confidence_threshold

    # Build issue type descriptions from taxonomy (only enabled types)
    issue_lines = []
    for issue_type, meta in ISSUE_TAXONOMY.items():
        if issue_type not in enabled:
            continue
        human_note = f" (requires human intervention: {meta['human_reason']})" if meta.get("requires_human") else ""
        issue_lines.append(f'- "{issue_type}": {meta["description"]}{human_note}')
    issue_types_block = "\n".join(issue_lines) if issue_lines else "- No issue types currently enabled."

    focus_instruction = {
        "balanced": "Apply balanced judgment across all issue types.",
        "compliance": "Prioritize compliance_gap and missing_review_date issues. Elevate severity for compliance-related findings.",
        "structure": "Prioritize unstructured and unowned issues. Focus on document organisation and ownership.",
        "hygiene": "Prioritize stale, outdated_reference, and broken_link issues. Focus on keeping content current and accurate.",
    }.get(focus, "Apply balanced judgment across all issue types.")

    severity_filter = {
        "low": "Report issues of ALL severity levels (low, medium, high).",
        "medium": "Only report issues with severity 'medium' or 'high'. Omit low-severity findings.",
        "high": "Only report issues with severity 'high'. Omit low and medium findings.",
    }.get(min_sev, "Report issues of ALL severity levels.")

    return f"""You are DocAI, an expert documentation analyst for Confluence pages.

Your job is to analyze a Confluence page and identify documentation quality issues.

You must respond with ONLY a valid JSON object — no preamble, no markdown, no explanation.

Issue types you can detect:
{issue_types_block}

Focus mode: {focus_instruction}

Severity levels:
- "high": Immediate attention needed, could cause real problems
- "medium": Should be addressed soon
- "low": Nice to have improvement

Severity filter: {severity_filter}

Confidence: Only report issues where your confidence is at least {confidence_threshold:.0%}. If you are not sufficiently confident an issue exists, omit it.

FIX AWARENESS:
When previous issues are provided, you MUST compare the current content against each prior issue:
- If the current content clearly addresses the issue → mark it as RESOLVED (put in resolved_issues, NOT in issues)
- If the issue still clearly exists in the current content → keep it in issues
- Only re-report an issue if strong evidence remains in the current content
- A page SHOULD be marked is_healthy: true when all prior issues are resolved and no new ones exist
- Healthy pages are the GOAL — reward progress explicitly

HEALTHY PAGE CRITERIA (return is_healthy: true when all met):
- Has a clear owner or responsible team identified
- Has been reviewed or updated within a reasonable timeframe
- Has clear structure with headings and logical sections
- No duplicate or orphaned content detected

For each issue include a "location" object pinpointing WHERE in the document the problem is.

Response format (JSON only):
{{
  "issues": [
    {{
      "type": "stale",
      "severity": "high",
      "title": "Short title of the issue",
      "description": "1-2 sentences explaining what the problem is",
      "suggestion": "Concrete actionable suggestion to fix it",
      "confidence": 0.9,
      "location": {{
        "section": "exact section heading this issue relates to, or 'document' if it applies to the whole page",
        "quote": "exact verbatim substring copied from the page content (max 100 chars) that best illustrates the issue, or null if structural",
        "line_hint": "beginning|middle|end|full_document"
      }}
    }}
  ],
  "summary": "One sentence summary of the overall documentation health",
  "is_healthy": false,
  "resolved_issues": [
    {{
      "title": "Name of the issue that was fixed",
      "resolution": "One sentence describing how it was resolved in the current content"
    }}
  ]
}}

Rules for location.quote:
- It MUST be an exact verbatim substring copied from the provided page content
- Keep it under 100 characters — copy the most diagnostic phrase
- If the issue is about missing content, set quote to null
- If the issue applies to the whole document, set section to "document", quote to null, line_hint to "full_document"

Return between 0 and {max_issues} issues maximum. Be specific and accurate.
If the page is healthy, return empty issues array, is_healthy: true, and a positive summary."""


# ── HTML → plain text (mirrors stripHtml in ContentViewer.tsx) ────────────────

def _strip_html_for_analysis(html_content: str) -> str:
    """Convert Confluence HTML to plain text before sending to Claude.
    Must mirror the stripHtml logic in ContentViewer.tsx so that Claude's
    verbatim quotes can be found in the displayed text."""
    text = re.sub(r'<br\s*/?>', '\n', html_content, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</li>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</h[1-6]>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = html_module.unescape(text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_user_message(
    body: AnalyzeRequest,
    previous_analysis: PageAnalysis | None,
    analysis_settings: AnalysisSettings | None = None,
) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    stale_days = analysis_settings.stale_threshold_days if analysis_settings else 180

    page_info = (
        f"Today's date: {today}\n"
        f"Stale content threshold: {stale_days} days\n"
        f"Page Title: {body.title or 'Unknown'}\nURL: {body.url}"
    )

    if body.last_modified:
        page_info += f"\nLast Modified: {body.last_modified}"
    if body.owner:
        page_info += f"\nOwner: {body.owner}"
    if body.page_version:
        page_info += f"\nCurrent Version: v{body.page_version}"

    if body.content:
        plain_content = _strip_html_for_analysis(body.content)
        page_info += f"\n\nPage Content:\n{plain_content}"
    else:
        page_info += "\n\nNote: No page content was available. Analyze based on metadata only."

    msg = f"Please analyze this Confluence page:\n\n{page_info}"

    # Attach fix-awareness context if a previous analysis exists at an older version
    if previous_analysis and previous_analysis.issues:
        prev_issues: list[dict] = previous_analysis.issues
        msg += f"""

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX-AWARENESS CONTEXT
This page was previously analyzed at version v{previous_analysis.page_version}.
The following issues were detected then. For EACH one, check whether the current
content (v{body.page_version}) has addressed it.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Previously detected issues:"""

        for issue in prev_issues:
            sev = issue.get("severity", "low").upper()
            title = issue.get("title", "Unknown issue")
            desc = issue.get("description", "")
            suggestion = issue.get("suggestion", "")
            msg += f"""
• [{sev}] {title}
  Was: {desc}
  Fix suggested: {suggestion}"""

        msg += """

Instructions:
1. For each prior issue: look for evidence in the CURRENT content.
2. If you find the issue is clearly GONE → add it to "resolved_issues".
3. If it STILL exists → include it in "issues" as normal.
4. If ALL issues are resolved and no new ones exist → set is_healthy: true.
5. Do NOT re-report issues that are clearly fixed — this would undermine trust in the tool.
"""

    return msg


# ── Validate and clean parsed Claude output ───────────────────────────────────

def _validate_and_clean(raw: dict, analysis_settings: AnalysisSettings) -> dict:
    """
    Post-process the parsed JSON from Claude:
    - Remove issues whose type is not in the enabled set
    - Remove issues below the min_severity threshold
    - Remove issues below the confidence threshold
    - Enrich issues with taxonomy metadata (fixable, requires_human, human_action_needed)
    - Cap issues at max_issues_per_page
    """
    severity_rank = {"low": 0, "medium": 1, "high": 2}
    min_rank = severity_rank.get(analysis_settings.min_severity, 0)
    enabled = set(analysis_settings.enabled_issue_types)

    cleaned_issues = []
    for issue in raw.get("issues", []):
        issue_type = issue.get("type", "")
        severity = issue.get("severity", "low")
        confidence = float(issue.get("confidence", 1.0))

        # Filter by enabled types
        if issue_type not in enabled:
            continue

        # Filter by severity
        if severity_rank.get(severity, 0) < min_rank:
            continue

        # Filter by confidence threshold
        if confidence < analysis_settings.confidence_threshold:
            continue

        # Enrich from taxonomy
        taxonomy_entry = ISSUE_TAXONOMY.get(issue_type, {})
        issue["fixable"] = taxonomy_entry.get("fixable", True)
        issue["requires_human"] = taxonomy_entry.get("requires_human", False)
        if issue["requires_human"]:
            issue["needs_human_intervention"] = True
            issue["human_action_needed"] = taxonomy_entry.get("human_reason")
        else:
            issue["needs_human_intervention"] = False
            issue["human_action_needed"] = None

        cleaned_issues.append(issue)

    # Cap at max_issues_per_page
    cleaned_issues = cleaned_issues[:analysis_settings.max_issues_per_page]
    raw["issues"] = cleaned_issues
    return raw


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("/", response_model=AnalyzeResponse)
async def analyze_page(
    body: AnalyzeRequest,
    force_refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """
    Analyze a Confluence page using Claude AI and return detected issues.

    Fix-aware: if the page has been analyzed before at an older version, Claude
    receives that prior analysis as context and can mark issues as resolved.

    Results are cached by (page_id, page_version). Pass force_refresh=true to
    bypass the cache but still use the fix-awareness context.
    """

    # ── Load analysis settings from DB ────────────────────────────────────────
    analysis_settings: AnalysisSettings
    try:
        settings_result = await db.execute(select(WorkspaceSettings).limit(1))
        settings_row = settings_result.scalar_one_or_none()
        if settings_row and settings_row.settings:
            defaults = AnalysisSettings()
            analysis_settings = AnalysisSettings(**{**defaults.model_dump(), **settings_row.settings})
        else:
            analysis_settings = AnalysisSettings()
    except Exception:
        analysis_settings = AnalysisSettings()

    # ── Cache lookup ──────────────────────────────────────────────────────────
    if body.page_id and body.page_version is not None and not force_refresh:
        result = await db.execute(
            select(PageAnalysis)
            .where(
                PageAnalysis.page_id == body.page_id,
                PageAnalysis.page_version == body.page_version,
            )
            .order_by(PageAnalysis.analyzed_at.desc())
            .limit(1)
        )
        cached_row = result.scalar_one_or_none()
        if cached_row:
            issues = [Issue(**issue) for issue in cached_row.issues]
            resolved = [ResolvedIssue(**r) for r in (cached_row.resolved_issues or [])]
            return AnalyzeResponse(
                page_title=body.title or "Untitled Page",
                page_url=body.url,
                issues=issues,
                summary=cached_row.summary or f"Analysis complete. Found {len(issues)} issue(s).",
                is_healthy=cached_row.is_healthy,
                resolved_issues=resolved,
                cached=True,
            )

    # ── Fetch previous analysis for fix-awareness context ────────────────────
    previous_analysis: PageAnalysis | None = None
    if body.page_id and body.page_version is not None:
        prev_result = await db.execute(
            select(PageAnalysis)
            .where(
                PageAnalysis.page_id == body.page_id,
                PageAnalysis.page_version < body.page_version,
            )
            .order_by(PageAnalysis.analyzed_at.desc())
            .limit(1)
        )
        previous_analysis = prev_result.scalar_one_or_none()

    # ── Claude call ───────────────────────────────────────────────────────────
    system_prompt = _build_system_prompt(analysis_settings)
    user_message = _build_user_message(body, previous_analysis, analysis_settings)

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1536,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}]
    )

    raw = message.content[0].text.strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    parsed = json.loads(raw)

    # ── Validate and clean using settings ─────────────────────────────────────
    parsed = _validate_and_clean(parsed, analysis_settings)

    issues = [Issue(**raw_issue) for raw_issue in parsed.get("issues", [])]
    resolved = [ResolvedIssue(**r) for r in parsed.get("resolved_issues", [])]
    summary = parsed.get("summary", f"Analysis complete. Found {len(issues)} issue(s).")

    # is_healthy: only true when Claude says so AND there are genuinely no issues
    is_healthy = bool(parsed.get("is_healthy", False)) and len(issues) == 0

    # ── Store in cache ────────────────────────────────────────────────────────
    if body.page_id and body.page_version is not None:
        record = PageAnalysis(
            page_id=body.page_id,
            page_version=body.page_version,
            issues=[issue.model_dump() for issue in issues],
            summary=summary,
            is_healthy=is_healthy,
            resolved_issues=[r.model_dump() for r in resolved] if resolved else None,
            previous_issues=previous_analysis.issues if previous_analysis else None,
            previous_version=previous_analysis.page_version if previous_analysis else None,
        )
        db.add(record)

        # Update Page.is_healthy so the tree can reflect the current state
        page_row = await db.execute(select(Page).where(Page.id == body.page_id))
        page = page_row.scalar_one_or_none()
        if page is not None:
            page.is_healthy = is_healthy

    return AnalyzeResponse(
        page_title=body.title or "Untitled Page",
        page_url=body.url,
        issues=issues,
        summary=summary,
        is_healthy=is_healthy,
        resolved_issues=resolved,
        cached=False,
    )


# ── Mark as reviewed ──────────────────────────────────────────────────────────

@router.post("/mark-reviewed/{page_id}", response_model=dict)
async def mark_page_reviewed(
    page_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually mark a page as reviewed and healthy.
    Useful for pages that are healthy but haven't been re-analyzed yet,
    or to clear stale-content flags after a manual review.
    """
    page_row = await db.execute(select(Page).where(Page.id == page_id))
    page = page_row.scalar_one_or_none()

    if page is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Page not found")

    page.is_healthy = True

    # Also store a "reviewed" analysis record so the UI can show it
    record = PageAnalysis(
        page_id=page_id,
        page_version=page.version,
        issues=[],
        summary="Page manually marked as reviewed — no issues at time of review.",
        is_healthy=True,
        resolved_issues=None,
        previous_issues=None,
        previous_version=None,
    )
    db.add(record)

    return {"page_id": page_id, "is_healthy": True, "message": "Page marked as reviewed"}
