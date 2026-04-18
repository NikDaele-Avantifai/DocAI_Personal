import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.page import Page
from app.models.page_analysis import PageAnalysis
from app.models.sweep import WorkspaceSweep

router = APIRouter()

GENERIC_TITLE_RE = re.compile(
    r"^(meeting notes?|untitled|draft|new page|home|welcome|todo|temp|test\d*|page \d+|notes?|overview|ddd|[a-z]{1,2}|test file\s*\d*|new file|document\s*\d*)$",
    re.IGNORECASE,
)
STALE_DAYS = 180
MIN_WORD_COUNT = 50

_VALID_SHORT = {"faq", "api", "hr", "qa", "ui", "ux", "db", "crm", "erp"}


def _classify_page(page: Page, has_open_issues: bool, ai_healthy: bool = False) -> list[str]:
    """Return a list of issue flags for a page using fast heuristics."""
    flags: list[str] = []
    title_stripped = (page.title or "").strip()

    # ── FOLDER: structural container, no content expected ──────────────────────
    if page.is_folder:
        # Only flag folders for bad naming — never for empty content, owner, or staleness
        if len(title_stripped) < 3 and title_stripped.lower() not in _VALID_SHORT:
            flags.append("generic_title")
        elif GENERIC_TITLE_RE.match(title_stripped):
            flags.append("generic_title")
        return flags

    # ── EMPTY PAGE: real page with no/minimal content ──────────────────────────
    if not page.content or (page.word_count or 0) < MIN_WORD_COUNT:
        flags.append("empty")
        # Still check title on empty pages, but skip stale/owner checks
        if len(title_stripped) < 3 and title_stripped.lower() not in _VALID_SHORT:
            flags.append("generic_title")
        elif GENERIC_TITLE_RE.match(title_stripped):
            flags.append("generic_title")
        return flags

    # ── NORMAL PAGE: has content, run all checks ───────────────────────────────
    if not page.owner:
        flags.append("no_owner")

    if len(title_stripped) < 3 and title_stripped.lower() not in _VALID_SHORT:
        flags.append("generic_title")
    elif GENERIC_TITLE_RE.match(title_stripped):
        flags.append("generic_title")

    if page.last_modified:
        try:
            lm = datetime.fromisoformat(page.last_modified.replace("Z", "+00:00"))
            now = datetime.now(tz=lm.tzinfo or timezone.utc)
            if (now - lm).days > STALE_DAYS:
                flags.append("stale")
        except (ValueError, AttributeError):
            pass

    if has_open_issues and not ai_healthy:
        flags.append("needs_review")

    return flags


@router.post("/run")
async def run_sweep(db: AsyncSession = Depends(get_db)):
    """
    Quick heuristic sweep across all pages — no AI calls, results in seconds.
    Persists results so the overview can track health over time.
    """
    pages = (await db.execute(select(Page))).scalars().all()

    # Subquery: latest analysis timestamp per page
    latest_subq = (
        select(PageAnalysis.page_id, func.max(PageAnalysis.analyzed_at).label("max_at"))
        .group_by(PageAnalysis.page_id)
        .subquery()
    )

    # Join to get only the latest analysis row per page
    latest_analyses = (await db.execute(
        select(PageAnalysis)
        .join(
            latest_subq,
            (PageAnalysis.page_id == latest_subq.c.page_id) &
            (PageAnalysis.analyzed_at == latest_subq.c.max_at),
        )
    )).scalars().all()

    pages_with_issues: set[str] = {
        a.page_id
        for a in latest_analyses
        if not a.is_healthy and a.issues and len(a.issues) > 0
    }

    # Pages the AI explicitly marked healthy — suppress needs_review for these
    pages_ai_healthy: set[str] = {
        a.page_id
        for a in latest_analyses
        if a.is_healthy
    }

    issue_counts: dict[str, int] = {
        "stale": 0,
        "empty": 0,
        "no_owner": 0,
        "generic_title": 0,
        "needs_review": 0,
    }
    at_risk: list[dict] = []
    healthy_count = 0

    for page in pages:
        flags = _classify_page(
            page,
            has_open_issues=page.id in pages_with_issues,
            ai_healthy=page.id in pages_ai_healthy,
        )
        if flags:
            for f in flags:
                if f in issue_counts:
                    issue_counts[f] += 1
            at_risk.append({
                "id": page.id,
                "title": page.title,
                "space_key": page.space_key,
                "flags": flags,
                "word_count": page.word_count,
                "last_modified": page.last_modified,
                "is_healthy": page.is_healthy,
                "is_folder": bool(page.is_folder),
                "ai_analyzed": page.id in pages_ai_healthy or page.id in pages_with_issues,
            })
        else:
            healthy_count += 1

    # Most issues first
    at_risk.sort(key=lambda p: len(p["flags"]), reverse=True)

    now = datetime.now(tz=timezone.utc)
    sweep = WorkspaceSweep(
        started_at=now,
        completed_at=now,
        status="completed",
        pages_scanned=len(pages),
        pages_healthy=healthy_count,
        pages_at_risk=len(at_risk),
        issue_counts=issue_counts,
        at_risk_pages=at_risk[:20],
    )
    db.add(sweep)
    await db.flush()

    return {
        "id": sweep.id,
        "status": "completed",
        "pages_scanned": sweep.pages_scanned,
        "pages_healthy": sweep.pages_healthy,
        "pages_at_risk": sweep.pages_at_risk,
        "issue_counts": sweep.issue_counts,
        "at_risk_pages": sweep.at_risk_pages,
        "completed_at": sweep.completed_at.isoformat(),
    }


@router.get("/latest")
async def get_latest_sweep(db: AsyncSession = Depends(get_db)):
    """Return the most recent completed sweep, or null if none exists."""
    row = (await db.execute(
        select(WorkspaceSweep)
        .where(WorkspaceSweep.status == "completed")
        .order_by(WorkspaceSweep.completed_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not row:
        return None

    return {
        "id": row.id,
        "status": row.status,
        "pages_scanned": row.pages_scanned,
        "pages_healthy": row.pages_healthy,
        "pages_at_risk": row.pages_at_risk,
        "issue_counts": row.issue_counts,
        "at_risk_pages": row.at_risk_pages,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }
