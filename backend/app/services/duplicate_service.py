"""
DuplicateService — semantic duplicate detection using pgvector cosine similarity.

Detection layers (applied in order):
  1. Exact match  — identical content_hash → severity="exact", similarity=1.0
  2. Semantic match — cosine similarity above threshold → severity="high" or "medium"

Requires pages to have embeddings stored (POST /api/duplicates/embed-all).
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import anthropic
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.page import Page

log = logging.getLogger(__name__)

HIGH_THRESHOLD    = 0.88   # Voyage-3 scores for clear duplicates
DEFAULT_THRESHOLD = 0.75   # Catches semantic duplicates with different wording


class DuplicateService:
    # ── Per-page scan ─────────────────────────────────────────────────────────

    async def find_duplicates_for_page(
        self,
        page_id: str,
        db: AsyncSession,
        threshold: float = DEFAULT_THRESHOLD,
        workspace_id: str = "",
    ) -> list[dict[str, Any]]:
        """
        Returns all pages (across all spaces in the same workspace) whose embedding
        is cosine-similar to the given page above the threshold.
        """
        result = await db.execute(select(Page).where(Page.id == page_id))
        page = result.scalar_one_or_none()
        if page is None:
            raise ValueError(f"Page {page_id} not found")
        if page.embedding is None:
            raise ValueError(
                f"Page {page_id} ({page.title}) has no embedding — run /embed-all first"
            )

        workspace_clause = ""
        if workspace_id:
            workspace_clause = "AND workspace_id = :workspace_id"

        query = text(f"""
            SELECT
                id,
                title,
                url,
                space_key,
                content_hash,
                CAST(1 - (embedding <=> CAST(:query_vec AS vector)) AS FLOAT) AS similarity
            FROM pages
            WHERE id        != :page_id
              AND embedding IS NOT NULL
              AND 1 - (embedding <=> CAST(:query_vec AS vector)) > :threshold
              {workspace_clause}
            ORDER BY similarity DESC
            LIMIT 20
        """)

        query_vec = "[" + ",".join(str(float(v)) for v in page.embedding) + "]"

        params: dict[str, Any] = {
            "query_vec": query_vec,
            "page_id": page_id,
            "threshold": threshold,
        }
        if workspace_id:
            params["workspace_id"] = workspace_id

        rows = (await db.execute(query, params)).all()

        return [
            {
                "id": row.id,
                "title": row.title,
                "url": row.url,
                "space_key": row.space_key,
                "content_hash": row.content_hash,
                "similarity": round(float(row.similarity), 4),
            }
            for row in rows
        ]

    # ── Full-workspace scan ───────────────────────────────────────────────────

    async def find_all_duplicates(
        self,
        db: AsyncSession,
        threshold: float = DEFAULT_THRESHOLD,
        space_key: str | None = None,
        workspace_id: str = "",
    ) -> list[dict[str, Any]]:
        """
        Scans every embedded page in the workspace and returns deduplicated duplicate pairs.
        """
        q = select(Page).where(Page.embedding.is_not(None))  # type: ignore[attr-defined]
        if workspace_id:
            q = q.where(Page.workspace_id == workspace_id)
        if space_key:
            q = q.where(Page.space_key == space_key)
        q = q.order_by(Page.id)

        pages = (await db.execute(q)).scalars().all()

        # ── Layer 1: exact duplicates via content_hash ─────────────────────
        seen: set[frozenset[str]] = set()
        pairs: list[dict[str, Any]] = []

        hash_index: dict[str, list[Page]] = {}
        for page in pages:
            if page.content_hash:
                hash_index.setdefault(page.content_hash, []).append(page)

        for group in hash_index.values():
            if len(group) < 2:
                continue
            for i, pa in enumerate(group):
                for pb in group[i + 1 :]:
                    key = frozenset([pa.id, pb.id])
                    if key in seen:
                        continue
                    seen.add(key)
                    pairs.append({
                        "page_a": {"id": pa.id, "title": pa.title, "url": pa.url, "space_key": pa.space_key},
                        "page_b": {"id": pb.id, "title": pb.title, "url": pb.url, "space_key": pb.space_key},
                        "similarity": 1.0,
                        "severity": "exact",
                    })

        # ── Layer 2: semantic duplicates via vector similarity ─────────────
        for page in pages:
            try:
                matches = await self.find_duplicates_for_page(
                    page.id, db, threshold, workspace_id=workspace_id
                )
            except ValueError:
                continue

            for match in matches:
                key = frozenset([page.id, match["id"]])
                if key in seen:
                    continue
                seen.add(key)

                similarity = match["similarity"]
                pairs.append({
                    "page_a": {"id": page.id, "title": page.title, "url": page.url, "space_key": page.space_key},
                    "page_b": {"id": match["id"], "title": match["title"], "url": match["url"], "space_key": match["space_key"]},
                    "similarity": similarity,
                    "severity": "high" if similarity >= HIGH_THRESHOLD else "medium",
                })

        pairs.sort(key=lambda x: (x["severity"] == "exact", x["similarity"]), reverse=True)
        return pairs

    # ── Merge proposal ────────────────────────────────────────────────────────

    async def generate_merge_proposal(
        self,
        page_a_id: str,
        page_b_id: str,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """Asks Claude to analyse both pages and returns a structured merge proposal."""
        page_a = (await db.execute(select(Page).where(Page.id == page_a_id))).scalar_one_or_none()
        page_b = (await db.execute(select(Page).where(Page.id == page_b_id))).scalar_one_or_none()

        if page_a is None:
            raise ValueError(f"Page {page_a_id} not found")
        if page_b is None:
            raise ValueError(f"Page {page_b_id} not found")

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

        prompt = f"""You are a documentation expert. Two Confluence pages cover overlapping topics and should be merged into one.

PAGE A  (id: {page_a.id})
Title: {page_a.title}
Last modified: {page_a.last_modified or "unknown"}
Content (truncated to 3000 chars):
{(page_a.content or "")[:3000]}

PAGE B  (id: {page_b.id})
Title: {page_b.title}
Last modified: {page_b.last_modified or "unknown"}
Content (truncated to 3000 chars):
{(page_b.content or "")[:3000]}

Analyse both pages and return ONLY a JSON object with these exact keys (no markdown, no explanation):
{{
  "primary_page_id": "<id of the more complete / more authoritative page to keep>",
  "secondary_page_id": "<id of the page to be merged away>",
  "suggested_title": "<best title for the final merged page>",
  "merge_content": "<summary of what unique content from the secondary should be added to the primary>",
  "rationale": "<clear explanation of why these are duplicates and which is primary>"
}}"""

        msg = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw[raw.index("{"):]
        if raw.endswith("```"):
            raw = raw[: raw.rindex("}") + 1]

        try:
            analysis: dict[str, Any] = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Claude returned invalid JSON: {exc}\nRaw: {raw[:300]}")

        primary_id     = analysis.get("primary_page_id", page_a_id)
        primary_page   = page_a if primary_id == page_a_id else page_b
        secondary_page = page_b if primary_id == page_a_id else page_a

        proposal_id = str(uuid.uuid4())
        return {
            "id": proposal_id,
            "category": "duplication",
            "action": "merge",
            "source_page_id": secondary_page.id,
            "source_page_title": secondary_page.title,
            "target_page_id": primary_page.id,
            "target_page_title": primary_page.title,
            "new_content": analysis.get("suggested_title"),
            "rationale": analysis.get("rationale", "Semantic duplicate detected"),
            "note": analysis.get("merge_content", ""),
            "diff": json.dumps([
                {"type": "remove", "content": f"Merge '{secondary_page.title}' → '{primary_page.title}'"},
                {"type": "add",    "content": analysis.get("merge_content", "")},
            ]),
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_at": None,
            "reviewed_by": None,
            "applied_by": None,
        }

    async def generate_duplicate_proposal(
        self,
        page_a_id: str,
        page_b_id: str,
        action: str,  # "remove-block" | "consolidate-pages"
        db: AsyncSession,
    ) -> dict[str, Any]:
        """Creates a structured duplication proposal with Claude-identified duplicate content."""
        page_a = (await db.execute(select(Page).where(Page.id == page_a_id))).scalar_one_or_none()
        page_b = (await db.execute(select(Page).where(Page.id == page_b_id))).scalar_one_or_none()

        if page_a is None:
            raise ValueError(f"Page {page_a_id} not found")
        if page_b is None:
            raise ValueError(f"Page {page_b_id} not found")

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

        action_context = (
            "The user wants to remove the duplicate block from one page, keeping it only in the other."
            if action == "remove-block"
            else "The user wants to consolidate by archiving one page and keeping the other as the canonical source."
        )

        prompt = f"""You are a documentation expert. Two Confluence pages contain duplicate content.

{action_context}

PAGE A  (id: {page_a.id})
Title: {page_a.title}
Content (truncated to 3000 chars):
{(page_a.content or "")[:3000]}

PAGE B  (id: {page_b.id})
Title: {page_b.title}
Content (truncated to 3000 chars):
{(page_b.content or "")[:3000]}

Identify the overlapping/duplicate content and return ONLY a JSON object (no markdown, no explanation):
{{
  "pageA_duplicate_content": "<exact duplicate text excerpt from page A, max 400 chars>",
  "pageB_duplicate_content": "<exact duplicate text excerpt from page B, max 400 chars>",
  "recommendation": "keep-pageA" or "keep-pageB",
  "rationale": "<one sentence: which page to keep and why>"
}}"""

        msg = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw[raw.index("{"):]
        if raw.endswith("```"):
            raw = raw[: raw.rindex("}") + 1]

        try:
            analysis: dict[str, Any] = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Claude returned invalid JSON: {exc}\nRaw: {raw[:300]}")

        action_label = "Remove duplicate section" if action == "remove-block" else "Consolidate pages"
        proposal_id = str(uuid.uuid4())
        return {
            "id": proposal_id,
            "category": "duplication",
            "action": action,
            "action_label": action_label,
            "pageA": {
                "id": page_a.id,
                "title": page_a.title,
                "duplicateContent": analysis.get("pageA_duplicate_content", ""),
            },
            "pageB": {
                "id": page_b.id,
                "title": page_b.title,
                "duplicateContent": analysis.get("pageB_duplicate_content", ""),
            },
            "recommendation": analysis.get("recommendation", "keep-pageA"),
            "rationale": analysis.get("rationale", "Duplicate content detected"),
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_at": None,
            "reviewed_by": None,
            "applied_by": None,
            # Compatibility fields for the proposal list
            "source_page_id": page_a.id,
            "source_page_title": page_a.title,
            "proposed_by": "DocAI",
            "diff": "[]",
        }
