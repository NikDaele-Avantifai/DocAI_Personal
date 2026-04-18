import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.page import Space, Page
from app.services.confluence_service import ConfluenceService

log = logging.getLogger(__name__)


def _extract_parent_id(page: dict[str, Any]) -> str | None:
    """
    Return the immediate parent ID for a page or folder.
    - v1 pages: use ancestors[-1]
    - v2 folders: use parentId (unless parentType is 'space', meaning top-level)
    """
    # v2 folder format
    if page.get("_is_folder"):
        parent_type = page.get("parentType", "space")
        parent_id = page.get("parentId")
        if parent_type != "space" and parent_id:
            return str(parent_id)
        return None

    # v1 page format
    ancestors = page.get("ancestors", [])
    if not ancestors:
        return None
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

    log.info("[build_tree] page_map has %d entries: %s",
             len(page_map),
             {pid: pages_dict["title"] for pid, pages_dict in page_map.items()})

    roots: list[dict[str, Any]] = []
    for node in page_map.values():
        parent_id = node.get("parent_id")
        if parent_id and parent_id in page_map:
            page_map[parent_id]["children"].append(node)
            log.info("[build_tree] '%s' (id=%s) → parent '%s' (id=%s) ✓",
                     node["title"], node["id"],
                     page_map[parent_id]["title"], parent_id)
        else:
            roots.append(node)
            if parent_id:
                log.warning("[build_tree] '%s' (id=%s) has parent_id=%s but that ID is NOT in page_map → placed at root",
                            node["title"], node["id"], parent_id)
            else:
                log.info("[build_tree] '%s' (id=%s) has no parent → root",
                         node["title"], node["id"])

    log.info("[build_tree] %d root nodes, %d total nodes", len(roots), len(page_map))
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

        # ── 2. Fetch all pages + folders ──────────────────────────────────
        raw_pages = await self.confluence.get_all_pages_in_space(space_key)

        # ── 2b. Back-fill any missing parents (e.g. Confluence Cloud folders
        #         that the v1 content API doesn't return by type) ───────────
        raw_pages = await self._fill_missing_parents(raw_pages)

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

            # Detect folders from both sources:
            # - _is_folder=True: set by _fetch_folders_v2 (v2 API)
            # - type="folder": returned by v1 API when fetching a folder by ID
            is_folder = bool(rp.get("_is_folder", False)) or rp.get("type") == "folder"
            stmt = pg_insert(Page).values(
                id=page_id,
                title=rp.get("title", "Untitled"),
                space_key=space_key,
                parent_id=_extract_parent_id(rp),
                word_count=0,
                is_folder=is_folder,
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
                    "is_folder": is_folder,
                    "last_modified": _extract_last_modified(rp),
                    "owner": _extract_owner(rp),
                    "url": page_url,
                    "version": rp.get("version", {}).get("number", 1),
                    "synced_at": now,
                },
            )
            await self.session.execute(stmt)

        # ── 5. Remove pages deleted from Confluence ────────────────────────
        confluence_ids = {str(rp["id"]) for rp in raw_pages}
        del_result = await self.session.execute(
            delete(Page).where(
                Page.space_key == space_key,
                Page.id.not_in(confluence_ids),
            )
        )
        deleted_count = del_result.rowcount

        await self.session.commit()

        return {
            "space_key": space_key,
            "space_name": space_name,
            "pages_synced": len(raw_pages),
            "pages_deleted": deleted_count,
            "last_synced": now.isoformat(),
        }

    async def _fill_missing_parents(
        self, raw_pages: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Detect parent IDs referenced by synced pages that are not themselves in the
        synced list (Confluence Cloud folder objects that the v1 type=page query skips).
        Fetches each missing item directly by ID and adds it to the list.
        Iterates until no new missing parents are found (handles arbitrary depth).
        """
        pages = list(raw_pages)
        known_ids: set[str] = {str(p["id"]) for p in pages}
        to_fetch: set[str] = set()

        for p in pages:
            pid = _extract_parent_id(p)
            if pid and pid not in known_ids:
                to_fetch.add(pid)

        while to_fetch:
            next_round: set[str] = set()
            for missing_id in to_fetch:
                log.info("[fill_missing_parents] fetching missing parent id=%s", missing_id)
                item = await self.confluence.get_content_by_id(missing_id)
                if item:
                    pages.append(item)
                    known_ids.add(missing_id)
                    # Check if this newly fetched item also has a missing parent
                    grandparent = _extract_parent_id(item)
                    if grandparent and grandparent not in known_ids:
                        next_round.add(grandparent)
                else:
                    log.warning("[fill_missing_parents] could not fetch id=%s", missing_id)
            to_fetch = next_round

        added = len(pages) - len(raw_pages)
        if added:
            log.info("[fill_missing_parents] added %d missing parent(s)", added)
        return pages

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
        from app.models.page_analysis import PageAnalysis

        result = await self.session.execute(
            select(Page).where(Page.space_key == space_key).order_by(Page.title)
        )
        pages = result.scalars().all()

        # Fetch the set of page IDs that have at least one analysis record
        analyzed_result = await self.session.execute(
            select(PageAnalysis.page_id).distinct()
            .where(PageAnalysis.page_id.in_([p.id for p in pages]))
        )
        analyzed_ids: set[str] = {row[0] for row in analyzed_result.all()}

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
                "is_folder": bool(p.is_folder),
                "is_healthy": getattr(p, "is_healthy", False),
                "last_fixed_at": getattr(p, "last_fixed_at", None),
                "health_checked_at": getattr(p, "health_checked_at", None),
                "has_been_analyzed": p.id in analyzed_ids,
            }
            for p in pages
        ]
        return _build_tree(flat)

    async def get_page_with_content(
        self,
        page_id: str,
        embedding_svc: Any | None = None,
    ) -> dict[str, Any]:
        """
        Fetch a page from Confluence (with full body content) and cache it locally.
        If embedding_svc is provided, immediately generates and stores the embedding
        so callers don't need a separate embed pass.
        Falls back to DB metadata if Confluence is unreachable.
        """
        try:
            raw = await self.confluence.get_page(page_id)
            content = raw.get("body", {}).get("storage", {}).get("value", "")
            word_count = len(content.split())

            # Preserve is_folder — fetch current value before upserting
            existing_is_folder = (await self.session.execute(
                select(Page.is_folder).where(Page.id == page_id)
            )).scalar_one_or_none()
            current_is_folder = existing_is_folder if existing_is_folder is not None else False

            # Update DB with content
            stmt = pg_insert(Page).values(
                id=page_id,
                title=raw.get("title", "Untitled"),
                space_key=raw.get("space", {}).get("key", ""),
                parent_id=_extract_parent_id(raw),
                content=content,
                word_count=word_count,
                is_folder=current_is_folder,
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
                    "title": raw.get("title", "Untitled"),
                    "content": content,
                    "word_count": word_count,
                    "is_folder": current_is_folder,
                    "version": raw.get("version", {}).get("number", 1),
                    "last_modified": _extract_last_modified(raw),
                    "owner": _extract_owner(raw),
                    "url": (
                        f"{self.confluence.base_url}/wiki{raw.get('_links', {}).get('webui', '')}"
                        if raw.get("_links", {}).get("webui")
                        else None
                    ),
                    "synced_at": datetime.now(timezone.utc),
                },
            )
            await self.session.execute(stmt)
            await self.session.commit()

            # Auto-embed immediately after storing content
            if embedding_svc and content.strip():
                try:
                    await embedding_svc.embed_page(page_id, self.session)
                    await self.session.commit()
                except Exception as embed_exc:
                    log.warning("get_page_with_content: auto-embed failed for %s: %s", page_id, embed_exc)

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
