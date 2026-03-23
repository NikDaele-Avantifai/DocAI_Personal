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
    ) -> dict[str, Any]:
        payload = {
            "version": {"number": current_version + 1},
            "title": title,
            "type": "page",
            "body": {
                "storage": {
                    "value": body,
                    "representation": "storage",
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

    async def archive_page(self, page_id: str) -> bool:
        """Move a page to the archive by updating its status."""
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{self.base_url}/wiki/rest/api/content/{page_id}",
                auth=self._auth,
            )
            return response.status_code == 204
