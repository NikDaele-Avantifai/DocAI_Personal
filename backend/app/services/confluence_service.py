import httpx
from typing import Any


class ConfluenceService:
    """
    Thin wrapper around the Confluence REST API v2.
    Each user authenticates with their own API token — we never store tokens,
    they are passed per-request from the extension/dashboard.
    """

    def __init__(self, base_url: str, api_token: str, email: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        # For Atlassian Cloud, Basic auth with email + token is required
        self._auth = (email, api_token)

    async def get_spaces(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/wiki/rest/api/space",
                auth=self._auth,
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            return response.json().get("results", [])

    async def get_pages_in_space(
        self, space_key: str, limit: int = 100, start: int = 0
    ) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/wiki/rest/api/content",
                auth=self._auth,
                params={
                    "spaceKey": space_key,
                    "type": "page",
                    "status": "current",
                    "limit": limit,
                    "start": start,
                    "expand": "version,history,metadata.labels",
                },
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            return response.json()

    async def get_page(self, page_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/wiki/rest/api/content/{page_id}",
                auth=self._auth,
                params={"expand": "body.storage,version,history,ancestors"},
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            return response.json()

    async def update_page(
        self,
        page_id: str,
        title: str,
        body: str,
        current_version: int,
        representation: str = "wiki",
    ) -> dict[str, Any]:
        payload = {
            "version": {"number": current_version + 1},
            "title": title,
            "type": "page",
            "body": {
                "storage": {
                    "value": body,
                    "representation": representation,
                }
            },
        }
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{self.base_url}/wiki/rest/api/content/{page_id}",
                auth=self._auth,
                json=payload,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            response.raise_for_status()
            return response.json()

    async def _get_space_id(self, space_key: str) -> str | None:
        """Resolve a space key to its numeric ID via the v2 API."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(
                    f"{self.base_url}/wiki/api/v2/spaces",
                    auth=self._auth,
                    params={"keys": space_key, "limit": 1},
                    headers={"Accept": "application/json"},
                )
                if not resp.is_success:
                    return None
                results = resp.json().get("results", [])
                return str(results[0]["id"]) if results else None
            except Exception:
                return None

    async def _fetch_folders_v2(self, space_id: str) -> list[dict[str, Any]]:
        """
        Fetch all folders in a space using the Confluence Cloud v2 API.
        Each folder dict is tagged with '_is_folder': True for downstream handling.
        """
        from urllib.parse import urlparse, parse_qs

        folders: list[dict[str, Any]] = []
        cursor: str | None = None

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                params: dict[str, Any] = {"space-id": space_id, "limit": 250}
                if cursor:
                    params["cursor"] = cursor

                resp = await client.get(
                    f"{self.base_url}/wiki/api/v2/folders",
                    auth=self._auth,
                    params=params,
                    headers={"Accept": "application/json"},
                )
                if not resp.is_success:
                    import logging
                    logging.getLogger(__name__).warning(
                        "_fetch_folders_v2: v2 folders endpoint returned %s for space_id=%s — "
                        "folders will be picked up via _fill_missing_parents instead",
                        resp.status_code, space_id,
                    )
                    break  # v2 folders not available on this instance

                data = resp.json()
                results: list[dict[str, Any]] = data.get("results", [])
                for r in results:
                    r["_is_folder"] = True
                folders.extend(results)

                next_link = data.get("_links", {}).get("next", "")
                if not next_link or not results:
                    break
                qs = parse_qs(urlparse(next_link).query)
                cursor = (qs.get("cursor") or [None])[0]
                if not cursor:
                    break

        return folders

    async def _fetch_pages_v1(self, space_key: str) -> list[dict[str, Any]]:
        """Paginate through all pages in a space using the v1 API."""
        items: list[dict[str, Any]] = []
        start = 0
        limit = 100

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                response = await client.get(
                    f"{self.base_url}/wiki/rest/api/content",
                    auth=self._auth,
                    params={
                        "spaceKey": space_key,
                        "type": "page",
                        "status": "current",
                        "limit": limit,
                        "start": start,
                        "expand": "version,history,ancestors,metadata.labels",
                    },
                    headers={"Accept": "application/json"},
                )
                response.raise_for_status()
                data = response.json()
                results: list[dict[str, Any]] = data.get("results", [])
                items.extend(results)
                if len(results) < limit:
                    break
                start += limit
        return items

    async def get_all_pages_in_space(self, space_key: str) -> list[dict[str, Any]]:
        """
        Fetch all pages (v1 API) + all folders (v2 API) in a space.
        Confluence Cloud folders are a separate content type only accessible via v2.
        """
        pages = await self._fetch_pages_v1(space_key)

        space_id = await self._get_space_id(space_key)
        folders: list[dict[str, Any]] = []
        if space_id:
            folders = await self._fetch_folders_v2(space_id)

        return pages + folders

    async def get_content_by_id(self, content_id: str) -> dict[str, Any] | None:
        """
        Fetch any content item (page, folder, etc.) by its ID using the v1 API.
        Returns None if the item doesn't exist or can't be fetched.
        """
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                response = await client.get(
                    f"{self.base_url}/wiki/rest/api/content/{content_id}",
                    auth=self._auth,
                    params={"expand": "version,ancestors"},
                    headers={"Accept": "application/json"},
                )
                if not response.is_success:
                    return None
                return response.json()
            except Exception:
                return None

    async def rename_page(self, page_id: str, new_title: str) -> dict[str, Any]:
        """
        Rename a page: fetch current body + version, then update with the new title.
        The body is left untouched so only the title changes in Confluence.
        """
        current = await self.get_page(page_id)
        current_version = current.get("version", {}).get("number", 1)
        current_body = current.get("body", {}).get("storage", {}).get("value", "")
        return await self.update_page(
            page_id=page_id,
            title=new_title,
            body=current_body,
            current_version=current_version,
            representation="storage",
        )

    async def rename_page_v2(self, page_id: str, new_title: str) -> dict[str, Any]:
        """
        Rename a page using the Confluence v2 API.
        Fetches the current version first, then PUTs the new title with version+1.
        """
        async with httpx.AsyncClient(timeout=20.0) as client:
            get_resp = await client.get(
                f"{self.base_url}/wiki/api/v2/pages/{page_id}",
                auth=self._auth,
                headers={"Accept": "application/json"},
            )
            get_resp.raise_for_status()
            current_version = get_resp.json().get("version", {}).get("number", 1)

            response = await client.put(
                f"{self.base_url}/wiki/api/v2/pages/{page_id}",
                auth=self._auth,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                json={
                    "id": page_id,
                    "status": "current",
                    "title": new_title,
                    "version": {
                        "number": current_version + 1,
                        "message": "Renamed by DocAI",
                    },
                },
            )
            response.raise_for_status()
            return response.json()

    async def archive_page(self, page_id: str) -> bool:
        """Move a page to the archive by updating its status."""
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{self.base_url}/wiki/rest/api/content/{page_id}",
                auth=self._auth,
            )
            return response.status_code == 204

    async def restore_page(
        self,
        page_id: str,
        title: str,
        body: str,
        version: int,
        space_key: str,
    ) -> dict[str, Any]:
        """Restore a trashed page back to current status.

        Confluence moves deleted pages to trash (status='trashed'). Both the GET
        and the PUT must include ?status=trashed — without it, Confluence looks
        for a 'current' page, finds nothing, and returns 404.
        """
        async with httpx.AsyncClient(timeout=20.0) as client:
            # PUT needs ?status=trashed so Confluence targets the trashed copy.
            # The caller is expected to pass the current trashed version number.
            response = await client.put(
                f"{self.base_url}/wiki/rest/api/content/{page_id}",
                auth=self._auth,
                params={"status": "trashed"},
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                json={
                    "id": page_id,
                    "type": "page",
                    "status": "current",
                    "title": title,
                    "version": {"number": version + 1},
                    "space": {"key": space_key},
                    "body": {
                        "storage": {
                            "value": body,
                            "representation": "storage",
                        }
                    },
                },
            )
            response.raise_for_status()
            return response.json()
