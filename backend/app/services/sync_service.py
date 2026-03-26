from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.page import Space, Page
from app.services.confluence_service import ConfluenceService


def _extract_parent_id(page: dict[str, Any]) -> str | None:
    """Return the immediate parent page ID from the ancestors array, or None."""
    ancestors = page.get("ancestors", [])
    if not ancestors:
        return None
    # ancestors[-1] is the immediate parent; ancestors[0] is the root
    return str(ancestors[-1]["id"])


def _extract_owner(page: dict[str, Any]) -> str | None:
    try:
        return page["version"]["by"]["displayName"]
    except (KeyError, TypeError):
        pass
    try:
        return page["history"]["lastUpdated"]["by"]["displayName"]
    except (KeyError, TypeError):
        return None


def _extract_last_modified(page: dict[str, Any]) -> str | None:
    try:
        return page["version"]["when"]
    except (KeyError, TypeError):
        return None


def _build_tree(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert a flat list of page dicts into a nested children tree."""
    page_map: dict[str, dict[str, Any]] = {}
    for p in pages:
        page_map[p["id"]] = {**p, "children": []}

    roots: list[dict[str, Any]] = []
    for page_id, node in page_map.items():
        parent_id = node.get("parent_id")
        if parent_id and parent_id in page_map:
            page_map[parent_id]["children"].append(node)
        else:
            roots.append(node)

    return roots


class SyncService:
    def __init__(self, session: AsyncSession, confluence: ConfluenceService):
        self.session = session
        self.confluence = confluence

    # ── public API ────────────────────────────────────────────────────────────

    async def sync_all_spaces(self) -> dict[str, Any]:
        """Fetch all accessible Confluence spaces and sync each one."""
        spaces = await self.confluence.get_spaces()
        results = []
        for space_raw in spaces:
            key = space_raw.get("key", "")
            if not key:
                continue
            result = await self.sync_space(key, _space_raw=space_raw)
            results.append(result)
        return {"spaces_synced": len(results), "details": results}

    async def sync_space(
        self,
        space_key: str,
        _space_raw: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Sync a single Confluence space: upsert space metadata and all its pages.
        """
        # ── 1. Resolve space metadata ──────────────────────────────────────
        if _space_raw is None:
            all_spaces = await self.confluence.get_spaces()
            _space_raw = next(
                (s for s in all_spaces if s.get("key") == space_key), {}
            )

        space_name = _space_raw.get("name", space_key)
        webui = _space_raw.get("_links", {}).get("webui", f"/spaces/{space_key}")
        space_url = f"{self.confluence.base_url}/wiki{webui}"

        # ── 2. Fetch all pages ─────────────────────────────────────────────
        raw_pages = await self.confluence.get_all_pages_in_space(space_key)

        # ── 3. Upsert space ────────────────────────────────────────────────
        now = datetime.now(timezone.utc)
        stmt = pg_insert(Space).values(
            key=space_key,
            name=space_name,
            url=space_url,
            page_count=len(raw_pages),
            last_synced=now,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_spaces_key",
            set_={
                "name": space_name,
                "url": space_url,
                "page_count": len(raw_pages),
                "last_synced": now,
            },
        )
        await self.session.execute(stmt)

        # ── 4. Upsert pages ────────────────────────────────────────────────
        for rp in raw_pages:
            page_id = str(rp["id"])
            links = rp.get("_links", {})
            webui_page = links.get("webui", "")
            page_url = f"{self.confluence.base_url}/wiki{webui_page}" if webui_page else None

            stmt = pg_insert(Page).values(
                id=page_id,
                title=rp.get("title", "Untitled"),
                space_key=space_key,
                parent_id=_extract_parent_id(rp),
                word_count=0,
                last_modified=_extract_last_modified(rp),
                owner=_extract_owner(rp),
                url=page_url,
                version=rp.get("version", {}).get("number", 1),
                synced_at=now,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "title": rp.get("title", "Untitled"),
                    "space_key": space_key,
                    "parent_id": _extract_parent_id(rp),
                    "last_modified": _extract_last_modified(rp),
                    "owner": _extract_owner(rp),
                    "url": page_url,
                    "version": rp.get("version", {}).get("number", 1),
                    "synced_at": now,
                },
            )
            await self.session.execute(stmt)

        await self.session.commit()

        return {
            "space_key": space_key,
            "space_name": space_name,
            "pages_synced": len(raw_pages),
            "last_synced": now.isoformat(),
        }

    async def get_all_synced_spaces(self) -> list[dict[str, Any]]:
        """Return all spaces that have been synced, with metadata."""
        result = await self.session.execute(select(Space).order_by(Space.name))
        spaces = result.scalars().all()
        return [
            {
                "key": s.key,
                "name": s.name,
                "url": s.url,
                "page_count": s.page_count,
                "last_synced": s.last_synced.isoformat() if s.last_synced else None,
            }
            for s in spaces
        ]

    async def get_space_tree(self, space_key: str) -> list[dict[str, Any]]:
        """Return pages for a space as a nested tree."""
        result = await self.session.execute(
            select(Page).where(Page.space_key == space_key).order_by(Page.title)
        )
        pages = result.scalars().all()

        flat = [
            {
                "id": p.id,
                "title": p.title,
                "space_key": p.space_key,
                "parent_id": p.parent_id,
                "url": p.url,
                "word_count": p.word_count,
                "last_modified": p.last_modified,
                "owner": p.owner,
                "version": p.version,
            }
            for p in pages
        ]
        return _build_tree(flat)

    async def get_page_with_content(self, page_id: str) -> dict[str, Any]:
        """
        Fetch a page from Confluence (with full body content) and cache it locally.
        Falls back to DB metadata if Confluence is unreachable.
        """
        try:
            raw = await self.confluence.get_page(page_id)
            content = raw.get("body", {}).get("storage", {}).get("value", "")
            word_count = len(content.split())

            # Update DB with content
            stmt = pg_insert(Page).values(
                id=page_id,
                title=raw.get("title", "Untitled"),
                space_key=raw.get("space", {}).get("key", ""),
                parent_id=_extract_parent_id(raw),
                content=content,
                word_count=word_count,
                last_modified=_extract_last_modified(raw),
                owner=_extract_owner(raw),
                url=(
                    f"{self.confluence.base_url}/wiki{raw.get('_links', {}).get('webui', '')}"
                    if raw.get("_links", {}).get("webui")
                    else None
                ),
                version=raw.get("version", {}).get("number", 1),
                synced_at=datetime.now(timezone.utc),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "content": content,
                    "word_count": word_count,
                    "synced_at": datetime.now(timezone.utc),
                },
            )
            await self.session.execute(stmt)
            await self.session.commit()

            return {
                "id": page_id,
                "title": raw.get("title", "Untitled"),
                "space_key": raw.get("space", {}).get("key", ""),
                "content": content,
                "word_count": word_count,
                "last_modified": _extract_last_modified(raw),
                "owner": _extract_owner(raw),
                "version": raw.get("version", {}).get("number", 1),
                "url": (
                    f"{self.confluence.base_url}/wiki{raw.get('_links', {}).get('webui', '')}"
                    if raw.get("_links", {}).get("webui")
                    else None
                ),
            }
        except Exception:
            # Fall back to what's in the DB
            result = await self.session.execute(select(Page).where(Page.id == page_id))
            page = result.scalar_one_or_none()
            if page is None:
                raise
            return {
                "id": page.id,
                "title": page.title,
                "space_key": page.space_key,
                "content": page.content or "",
                "word_count": page.word_count,
                "last_modified": page.last_modified,
                "owner": page.owner,
                "version": page.version,
                "url": page.url,
            }
