"""
EmbeddingService — generates and stores 1024-dim vector embeddings for Confluence pages.

Embedding strategy (tried in order):
  1. Voyage AI voyage-3   (1024 dims — set VOYAGE_API_KEY in .env; free tier at voyageai.com)
  2. OpenAI text-embedding-3-small  (1536 dims → trimmed to 1024)
  3. fastembed BAAI/bge-small-en-v1.5 (384 dims → padded to 1024; no API key, auto-downloads ~90 MB)
  4. Deterministic hash vector  (last resort — NOT useful for similarity search)
"""

import asyncio
import hashlib
import logging
import struct
from typing import Any

import httpx
from openai import AsyncOpenAI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.page import Page, EMBEDDING_DIM

log = logging.getLogger(__name__)

OPENAI_MODEL   = "text-embedding-3-small"
VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings"
VOYAGE_MODEL   = "voyage-3"
LOCAL_MODEL    = "BAAI/bge-small-en-v1.5"   # 384 dims

# Module-level cache so the model is loaded once per process
_fastembed_model: Any = None


def _load_fastembed() -> Any:
    global _fastembed_model
    if _fastembed_model is None:
        from fastembed import TextEmbedding  # type: ignore[import]
        log.info("fastembed: loading %s (first call downloads ~90 MB)…", LOCAL_MODEL)
        _fastembed_model = TextEmbedding(LOCAL_MODEL)
        log.info("fastembed: model ready")
    return _fastembed_model


class EmbeddingService:
    # ── Core embedding ────────────────────────────────────────────────────────

    async def generate_embedding(self, text: str) -> list[float]:
        """Returns a EMBEDDING_DIM-dim embedding, trying providers in priority order."""

        # 1. Voyage AI (native 1024 dims — preferred)
        if settings.voyage_api_key:
            try:
                return await self._voyage_embed(text)
            except Exception as exc:
                log.warning("Voyage embed failed (%s) — trying OpenAI", exc)

        # 2. OpenAI (1536 dims, trimmed to 1024)
        if settings.openai_api_key and not settings.openai_api_key.startswith("sk-..."):
            try:
                return await self._openai_embed(text)
            except Exception as exc:
                log.warning("OpenAI embed failed (%s) — trying local model", exc)

        # 3. Local fastembed (384 dims, padded to 1024)
        try:
            return await self._local_embed(text)
        except Exception as exc:
            log.warning("Local embed failed (%s) — using hash fallback", exc)

        log.warning("All embedding providers failed — using hash fallback (NOT suitable for similarity search)")
        return self._hash_embedding(text)

    async def _voyage_embed(self, text: str) -> list[float]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                VOYAGE_API_URL,
                headers={
                    "Authorization": f"Bearer {settings.voyage_api_key}",
                    "Content-Type": "application/json",
                },
                json={"input": [text], "model": VOYAGE_MODEL},
            )
            resp.raise_for_status()
            embedding: list[float] = resp.json()["data"][0]["embedding"]

        # voyage-3 natively produces 1024 dims — guard against API changes
        if len(embedding) > EMBEDDING_DIM:
            embedding = embedding[:EMBEDDING_DIM]
        elif len(embedding) < EMBEDDING_DIM:
            embedding = embedding + [0.0] * (EMBEDDING_DIM - len(embedding))
        return embedding

    async def _openai_embed(self, text: str) -> list[float]:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.embeddings.create(
            model=OPENAI_MODEL,
            input=text,
            encoding_format="float",
            dimensions=EMBEDDING_DIM,  # text-embedding-3-small supports custom dims
        )
        return response.data[0].embedding

    async def _local_embed(self, text: str) -> list[float]:
        """fastembed BAAI/bge-small-en-v1.5 — 384 dims padded to EMBEDDING_DIM.
        Padding with zeros preserves cosine similarity since zero elements don't
        contribute to dot product or magnitude."""
        loop = asyncio.get_event_loop()

        def _run() -> list[float]:
            model = _load_fastembed()
            results = list(model.embed([text]))
            vec: list[float] = [float(v) for v in results[0]]
            vec += [0.0] * (EMBEDDING_DIM - len(vec))
            return vec

        return await loop.run_in_executor(None, _run)

    def _hash_embedding(self, text: str) -> list[float]:
        """Deterministic fallback — NOT suitable for real similarity search."""
        seed = hashlib.sha256(text.encode("utf-8")).digest()
        floats: list[float] = []
        for i in range(EMBEDDING_DIM):
            h = hashlib.sha256(seed + i.to_bytes(4, "big")).digest()
            val = struct.unpack("I", h[:4])[0]
            floats.append((val / 2_147_483_648.0) - 1.0)
        magnitude = sum(v ** 2 for v in floats) ** 0.5
        return [v / magnitude for v in floats] if magnitude > 0 else floats

    # ── DB helpers ────────────────────────────────────────────────────────────

    @staticmethod
    def _content_hash(content: str) -> str:
        return hashlib.md5(content.encode("utf-8")).hexdigest()

    async def embed_page(self, page_id: str, db: AsyncSession) -> bool:
        result = await db.execute(select(Page).where(Page.id == page_id))
        page = result.scalar_one_or_none()
        if page is None:
            log.warning("embed_page: page %s not found", page_id)
            return False

        page_title = page.title
        page_content = page.content or ""

        if not page_content.strip():
            log.warning("embed_page: page %s (%s) has no content — skipping", page_id, page_title)
            return False

        input_text = f"{page_title}. {page_content[:2000]}"
        try:
            embedding = await self.generate_embedding(input_text)
        except Exception as exc:
            log.error("embed_page: failed for %s: %s", page_id, exc)
            return False

        await db.execute(
            update(Page).where(Page.id == page_id).values(
                embedding=embedding,
                content_hash=self._content_hash(page_content),
            )
        )
        return True

    async def embed_all_pages(
        self,
        db: AsyncSession,
        batch_size: int = 10,
        force: bool = False,
    ) -> dict[str, Any]:
        """
        Embeds pages in batches.
        force=True clears all existing embeddings first (needed when switching models).
        """
        if force:
            log.info("embed_all: force=True — clearing all existing embeddings")
            await db.execute(update(Page).values(embedding=None, content_hash=None))
            await db.commit()

        result = await db.execute(
            select(Page).where(Page.embedding.is_(None))  # type: ignore[attr-defined]
        )
        pages = result.scalars().all()

        # Extract to plain dicts immediately — ORM objects expire after each commit
        # and async SQLAlchemy does not support lazy-loading (greenlet error).
        pages_data = [
            {"id": p.id, "title": p.title, "content": p.content or ""}
            for p in pages
        ]
        total = len(pages_data)
        processed = 0
        failed = 0

        for i in range(0, total, batch_size):
            batch = pages_data[i : i + batch_size]
            for page in batch:
                if not page["content"].strip():
                    log.warning("embed_all: skipping page %s (%s) — no content", page["id"], page["title"])
                    failed += 1
                    continue

                input_text = f"{page['title']}. {page['content'][:2000]}"
                try:
                    embedding = await self.generate_embedding(input_text)
                    await db.execute(
                        update(Page).where(Page.id == page["id"]).values(
                            embedding=embedding,
                            content_hash=self._content_hash(page["content"]),
                        )
                    )
                    await db.commit()
                    processed += 1
                    log.info("embed_all: ✓ %s (%s)", page["id"], page["title"])
                except Exception as exc:
                    await db.rollback()
                    log.error("embed_all: ✗ %s (%s): %s", page["id"], page["title"], exc)
                    failed += 1

            if i + batch_size < total:
                await asyncio.sleep(0.1)

        log.info("embed_all complete: %d processed, %d failed, %d total", processed, failed, total)
        return {"processed": processed, "failed": failed, "total": total}
