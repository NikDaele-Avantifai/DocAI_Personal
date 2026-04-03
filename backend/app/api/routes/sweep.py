import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.page import Page
from app.models.page_analysis import PageAnalysis
from app.models.sweep import WorkspaceSweep

router = APIRouter()

GENERIC_TITLE_RE = re.compile(
    r"^(meeting notes?|untitled|draft|new page|home|welcome|todo|temp|test|page \d+|notes?|overview)$",
    re.IGNORECASE,
)
STALE_DAYS = 180
MIN_WORD_COUNT = 50


def _classify_page(page: Page, has_open_issues: bool) -> list[str]:
    """Return a list of issue flags for a page using fast heuristics."""
    flags: list[str] = []

    if not page.content or page.word_count < MIN_WORD_COUNT:
        flags.append("empty")

    if not page.owner:
        flags.append("no_owner")

    if GENERIC_TITLE_RE.match(page.title.strip()):
        flags.append("generic_title")

    if page.last_modified:
        try:
            lm = datetime.fromisoformat(page.last_modified.replace("Z", "+00:00"))
            now = datetime.now(tz=lm.tzinfo or timezone.utc)
            if (now - lm).days > STALE_DAYS:
                flags.append("stale")
        except (ValueError, AttributeError):
            pass

    if has_open_issues:
        flags.append("needs_review")

    return flags


@router.post("/run")
async def run_sweep(db: AsyncSession = Depends(get_db)):
    """
    Quick heuristic sweep across all pages — no AI calls, results in seconds.
    Persists results so the overview can track health over time.
    """
    pages = (await db.execute(select(Page))).scalars().all()

    # Pages that have at least one open issue from a prior AI analysis
    analyses = (await db.execute(select(PageAnalysis))).scalars().all()
    pages_with_issues: set[str] = {
        a.page_id
        for a in analyses
        if a.issues and (
            (isinstance(a.issues, list) and len(a.issues) > 0)
            or (isinstance(a.issues, dict) and len(a.issues.get("issues", [])) > 0)
        )
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
        flags = _classify_page(page, page.id in pages_with_issues)
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
