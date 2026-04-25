from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional
import anthropic
import json
import uuid as _uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.auth import require_admin
from app.core.usage import check_limit, track_usage
from app.db.database import get_db
from app.core.workspace import get_current_workspace
from app.models.workspace import Workspace
from app.models.page_analysis import PageAnalysis
from app.models.page import Page
from app.models.analysis_settings import AnalysisSettings, WorkspaceSettings
from app.models.dismissed_issue import DismissedIssue
from app.api.routes.edit import _html_to_wiki
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
    url: str = Field(..., max_length=2048)
    title: str | None = Field(None, max_length=500)
    content: str | None = Field(None, max_length=50000)
    last_modified: str | None = Field(None, max_length=500)
    owner: str | None = Field(None, max_length=500)
    page_id: str | None = Field(None, max_length=500)
    page_version: int | None = Field(None, ge=1, le=100000)

    @field_validator("url", "title", "owner", "page_id", mode="before")
    @classmethod
    def strip_whitespace(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


class IssueLocation(BaseModel):
    section: str
    quote: Optional[str] = None
    line_hint: str = "full_document"


# Keywords that indicate a fix requires information DocAI cannot access.
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
    combined = f"{title} {description} {suggestion}".lower()
    return not any(signal in combined for signal in _NEEDS_HUMAN_SIGNALS)


class Issue(BaseModel):
    # ── v2 fields (new schema) ────────────────────────────────────────────────
    id: str = ""
    type: str = "general-issue"           # "text-issue" | "general-issue"
    category: str = ""                    # internal taxonomy: stale, unowned, etc.
    severity: Literal["low", "medium", "high"]
    title: str
    explanation: str = ""                 # why this is an issue (v2 name)
    exactContent: Optional[str] = None   # verbatim text from the page
    suggestedFix: Optional[str] = None   # exact replacement text only
    affectedElement: Optional[str] = None  # paragraph|heading|list-item|blockquote|table-cell
    # ── v1 backward-compat fields (populated by _validate_and_clean) ─────────
    description: str = ""                 # = explanation
    suggestion: Optional[str] = None      # = suggestedFix
    location: Optional[IssueLocation] = None  # built from exactContent
    # ── Internal flags ────────────────────────────────────────────────────────
    fixable: bool = True
    requires_human: bool = False
    needs_human_intervention: bool = False
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

    issue_lines = []
    for issue_type, meta in ISSUE_TAXONOMY.items():
        if issue_type not in enabled:
            continue
        human_note = f" (requires human: {meta['human_reason']})" if meta.get("requires_human") else ""
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — CLASSIFY THE DOCUMENT TYPE:
Before raising any issue, classify this page into one of:
- "technical-reference": API docs, SDK guides, endpoint references, token/auth specs, HTTP header tables, code examples
- "process-document": runbooks, SOPs, how-to guides, step-by-step workflows
- "policy-document": compliance policies, security policies, governance rules
- "meeting-notes": meeting minutes, decision logs, retrospectives
- "knowledge-base": general informational articles, FAQs, overviews
- "empty-or-stub": page with little or no meaningful content

Apply context-aware judgment based on the document type:
- TECHNICAL REFERENCE DOCUMENTS: NEVER flag code examples, API endpoints, token formats, HTTP headers, command syntax, or configuration snippets as issues. These are intentional technical content, not problems.
- PROCESS DOCUMENTS: structure and completeness matter; missing steps are valid issues.
- POLICY DOCUMENTS: owner, review date, and compliance sections are critical.
- MEETING NOTES / KNOWLEDGE BASE: apply a lighter touch; informal structure is expected.
- EMPTY OR STUB: flag as unstructured only if no content is present whatsoever.

CHARITABLE INTERPRETATION — before raising any issue, ask:
"Could this content be intentional given the document type?" If yes, do not raise it.

MINIMUM VIABLE ISSUES — only raise an issue if it would:
(a) genuinely confuse a reader trying to use the document, OR
(b) create a real compliance or operational risk.
Do NOT raise cosmetic, stylistic, or subjective issues.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HARD EXCLUSIONS — NEVER raise issues about these, regardless of document type:

1. Authentication header syntax in technical docs:
   WRONG: Flagging "Authorization: token" as incomplete because it should be "Authorization: Bearer"
   REASON: This page IS the documentation for how the auth system works. The token format shown IS the correct format for this system. DocAI cannot know what authentication scheme the company uses — do not apply generic HTTP auth standards to documentation examples.

2. Internal URLs and endpoints:
   WRONG: Flagging "http://api.internal.com/v1/auth" as broken or needing verification
   REASON: Internal URLs are intentionally internal. DocAI cannot resolve them. Do not flag internal hostnames.

3. Placeholder examples that are clearly intentional:
   WRONG: Flagging "Authorization: token abc123" as incomplete
   REASON: "abc123" is an example token, not a real one. Placeholder values in code examples are intentional.

4. Technical specifications that differ from common standards:
   WRONG: Suggesting a company change their API auth format to match a different standard
   REASON: DocAI is a documentation quality tool, not an architecture review tool. Never suggest changing how a system works — only flag documentation quality problems.

THE TEST: Ask "Is this a problem with the DOCUMENTATION, or a problem with the SYSTEM being documented?"
If it's a system design choice → NOT your job → do not flag it.
If it's genuinely confusing or incorrect documentation → flag it.

EXPLICIT SIGNALS TO ALWAYS FLAG:
- Any text containing 'deleted last year', 'no longer exists', 'was removed', 'deprecated',
  'no longer available', 'has been shut down' — these are outdated_reference issues and
  must always be flagged regardless of document type.
- 'Updated by: nobody', 'Author: unknown', 'Owner: TBD' — always flag as unowned.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ISSUE CATEGORIES YOU CAN DETECT:
{issue_types_block}

Focus mode: {focus_instruction}
Severity filter: {severity_filter}
Confidence threshold: Only report issues where your confidence is at least {confidence_threshold:.0%}.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ISSUE OBJECT FORMAT — every issue must follow this exact shape:
{{
  "id": "<8-char unique string, e.g. first 8 chars of a uuid4>",
  "type": "text-issue",
  "category": "<one of the categories above: stale|unowned|unstructured|outdated_reference|missing_review_date|compliance_gap|broken_link>",
  "severity": "high",
  "title": "Short title of the issue (max 10 words)",
  "explanation": "Why this is a problem, in 1-2 sentences. Be specific about what is wrong.",
  "exactContent": "The exact verbatim substring from the page that has the issue — copied character-for-character, no changes",
  "suggestedFix": "The exact replacement text ONLY — nothing else in the document changes",
  "affectedElement": "paragraph",
  "confidence": 0.9
}}

CONFLUENCE RENDERING ARTEFACTS — NEVER FLAG THESE AS ISSUES:
The page content you receive has been extracted from Confluence storage-format HTML. The following patterns are normal rendering artefacts, not documentation problems:
- Empty lines at the very start or end of a code block (Confluence adds a blank line 1 and a blank trailing line around all code block content)
- "]]>" appearing in or near code blocks (CDATA marker from Confluence's plain-text-body elements)
- Line numbers or numbering prefixes inside code blocks (e.g. "1", "2", "3" on their own lines — these are injected by the Confluence renderer)
- Code blocks that appear to have only whitespace on line 1 or the last line
- ']]>' or '<![CDATA[' appearing anywhere in the content — these are XML markers from Confluence's code block storage format, not page content. Never flag them, never include them in exactContent, never reference them in any issue.
Do NOT raise any issue whose root cause is one of the above patterns. Do NOT suggest that code examples be "properly formatted" when the only problem is an empty first/last line from Confluence rendering.

RULES — follow every one:
- The confluence page is something separate than the content and is present, do not add the page name into the content.

1. TYPE FIELD:
   - Use "text-issue" when the issue is tied to a specific piece of text in the page.
   - Use "general-issue" when the issue is about the document as a whole (missing owner, no review date, wrong structure, etc.).

2. exactContent RULES (CRITICAL):
   - Must be copied VERBATIM from the page content provided — not paraphrased, not summarized, not trimmed.
   - Copy it character-for-character, including punctuation and spacing.
   - Keep it to the minimum diagnostic phrase — the shortest substring that uniquely identifies the problem.
   - If type is "general-issue", set exactContent to null.
   - If the issue is about missing content (something that SHOULD be there but isn't), set exactContent to null and use type "general-issue".

3. suggestedFix RULES (CRITICAL):
   - Must contain ONLY the replacement for exactContent — nothing else.
   - If the issue is "Last Updated: August 2023" being outdated, suggestedFix is "Last Updated: April 2026" — not the full sentence, not the paragraph.
   - If the issue is a placeholder word like "test", suggestedFix is the corrected word — nothing else.
   - Set suggestedFix to null when: (a) type is "general-issue", OR (b) the correct fix requires information DocAI does not have (correct email address, correct person name, correct internal URL, etc.).

4. affectedElement: classify which HTML element type contains the issue:
   - "paragraph": inside a <p> block
   - "heading": inside an <h1>–<h6> element
   - "list-item": inside a <li> element
   - "blockquote": inside a <blockquote>
   - "table-cell": inside a <td> or <th>
   - null: if type is "general-issue"

5. SURGICAL PRECISION:
   - Never propose adding new sections, restructuring content, or changing anything outside exactContent.
   - One issue = one specific problem = one minimum fix.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX AWARENESS:
When previous issues are provided, compare current content against each prior issue:
- Issue clearly gone → add to resolved_issues (not issues)
- Issue still exists → keep in issues
- ALL resolved + no new issues → set is_healthy: true

HEALTHY PAGE CRITERIA (is_healthy: true when all met):
- Clear owner or responsible team identified
- Reviewed or updated within a reasonable timeframe
- Clear structure with headings and logical sections
- No duplicate or orphaned content
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FULL RESPONSE FORMAT (JSON only, no markdown):
{{
  "issues": [ /* 0–{max_issues} issue objects using the format above */ ],
  "summary": "One sentence summary of overall documentation health.",
  "is_healthy": false,
  "resolved_issues": [
    {{
      "title": "Name of the issue that was fixed",
      "resolution": "One sentence: how it was resolved in the current content."
    }}
  ]
}}

Return between 0 and {max_issues} issues. If the page is healthy, return empty issues, is_healthy: true, positive summary."""


# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_user_message(
    body: AnalyzeRequest,
    previous_analysis: PageAnalysis | None,
    analysis_settings: AnalysisSettings | None = None,
    dismissed: list[dict] | None = None,
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
        plain_content = _html_to_wiki(body.content)
        page_info += f"\n\nPage Content:\n{plain_content}"
    else:
        page_info += "\n\nNote: No page content was available. Analyze based on metadata only."

    msg = f"Please analyze this Confluence page:\n\n{page_info}"

    if dismissed:
        msg += "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        msg += "\nUSER-DISMISSED ISSUES — DO NOT REPORT THESE AGAIN:"
        msg += "\nThe user has reviewed each item below and confirmed it is correct or not an issue."
        msg += "\nYou must not raise any issue that matches one of these by title or by its exact content.\n"
        for d in dismissed:
            msg += f"\n• Title: {d['issue_title']}"
            if d.get("exact_content"):
                msg += f"\n  Content: {d['exact_content']}"
        msg += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

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
    severity_rank = {"low": 0, "medium": 1, "high": 2}
    min_rank = severity_rank.get(analysis_settings.min_severity, 0)
    enabled = set(analysis_settings.enabled_issue_types)
    _TAXONOMY_CATEGORIES = set(ISSUE_TAXONOMY.keys())

    cleaned_issues = []
    for issue in raw.get("issues", []):
        category = issue.get("category", "")
        severity = issue.get("severity", "low")
        confidence = float(issue.get("confidence", 1.0))

        if category in _TAXONOMY_CATEGORIES and category not in enabled:
            continue
        if severity_rank.get(severity, 0) < min_rank:
            continue
        if confidence < analysis_settings.confidence_threshold:
            continue

        if not issue.get("id"):
            issue["id"] = str(_uuid.uuid4())[:8]

        taxonomy_entry = ISSUE_TAXONOMY.get(category, {})
        issue["fixable"] = taxonomy_entry.get("fixable", True)
        issue["requires_human"] = taxonomy_entry.get("requires_human", False)

        is_text_issue = issue.get("type", "general-issue") == "text-issue"
        has_fix = issue.get("suggestedFix") is not None
        needs_human = taxonomy_entry.get("requires_human", False) or (is_text_issue and not has_fix)
        issue["needs_human_intervention"] = needs_human
        issue["human_action_needed"] = (
            taxonomy_entry.get("human_reason") or "Manual review required"
        ) if needs_human else None

        if not issue.get("description"):
            issue["description"] = issue.get("explanation", issue.get("title", ""))
        if not issue.get("suggestion"):
            issue["suggestion"] = issue.get("suggestedFix")
        if not issue.get("location") and issue.get("exactContent"):
            issue["location"] = {
                "section": "document",
                "quote": issue["exactContent"],
                "line_hint": "middle",
            }

        cleaned_issues.append(issue)

    cleaned_issues = cleaned_issues[:analysis_settings.max_issues_per_page]
    raw["issues"] = cleaned_issues
    return raw


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("/", response_model=AnalyzeResponse)
async def analyze_page(
    body: AnalyzeRequest,
    force_refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: dict = Depends(require_admin),
):
    wid = workspace.id

    # ── Load analysis settings from DB ────────────────────────────────────────
    analysis_settings: AnalysisSettings
    try:
        settings_result = await db.execute(
            select(WorkspaceSettings).where(WorkspaceSettings.workspace_id == wid).limit(1)
        )
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
                PageAnalysis.workspace_id == wid,
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
                PageAnalysis.workspace_id == wid,
                PageAnalysis.page_id == body.page_id,
                PageAnalysis.page_version < body.page_version,
            )
            .order_by(PageAnalysis.analyzed_at.desc())
            .limit(1)
        )
        previous_analysis = prev_result.scalar_one_or_none()

    # ── Load dismissed issues for this page ───────────────────────────────────
    dismissed_list: list[dict] = []
    if body.page_id:
        dismissed_result = await db.execute(
            select(DismissedIssue).where(
                DismissedIssue.workspace_id == wid,
                DismissedIssue.page_id == body.page_id,
            )
        )
        dismissed_list = [
            {"issue_title": r.issue_title, "exact_content": r.exact_content}
            for r in dismissed_result.scalars().all()
        ]

    # ── Usage gate ────────────────────────────────────────────────────────────
    await check_limit(db, workspace, "analysis")

    # ── Claude call ───────────────────────────────────────────────────────────
    system_prompt = _build_system_prompt(analysis_settings)
    user_message = _build_user_message(body, previous_analysis, analysis_settings, dismissed_list)

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
    parsed = _validate_and_clean(parsed, analysis_settings)

    # ── Track usage after successful Claude call ──────────────────────────────
    await track_usage(db, workspace, user, "analysis", meta=body.page_id)

    issues = [Issue(**raw_issue) for raw_issue in parsed.get("issues", [])]
    resolved = [ResolvedIssue(**r) for r in parsed.get("resolved_issues", [])]
    summary = parsed.get("summary", f"Analysis complete. Found {len(issues)} issue(s).")

    high_or_medium = [i for i in issues if i.severity in ('high', 'medium')]
    is_healthy = bool(parsed.get("is_healthy", False)) and len(high_or_medium) == 0

    # ── Store in cache ────────────────────────────────────────────────────────
    if body.page_id and body.page_version is not None:
        record = PageAnalysis(
            workspace_id=wid,
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

        page_row = await db.execute(
            select(Page).where(Page.workspace_id == wid, Page.id == body.page_id)
        )
        page = page_row.scalar_one_or_none()
        if page is not None:
            page.is_healthy = is_healthy
            if is_healthy:
                page.health_checked_at = datetime.now(timezone.utc)

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
    workspace: Workspace = Depends(get_current_workspace),
):
    wid = workspace.id
    page_row = await db.execute(
        select(Page).where(Page.workspace_id == wid, Page.id == page_id)
    )
    page = page_row.scalar_one_or_none()

    if page is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Page not found")

    page.is_healthy = True

    record = PageAnalysis(
        workspace_id=wid,
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
