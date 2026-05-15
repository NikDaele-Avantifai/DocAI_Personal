import logging
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chunk import PageChunk
from app.models.page import Page
from app.services.embedding_service import EmbeddingService

log = logging.getLogger(__name__)

CHUNK_SIZE = 400
CHUNK_OVERLAP = 50
MIN_CHUNK_WORDS = 30


def _split_into_chunks(text: str) -> list[str]:
    """
    Split text into overlapping word-based chunks.
    400 words ≈ 500-600 tokens which fits comfortably in context.
    Overlap preserves sentence context at chunk boundaries.
    """
    words = text.split()
    if not words:
        return []

    chunks = []
    start = 0

    while start < len(words):
        end = min(start + CHUNK_SIZE, len(words))
        chunk_words = words[start:end]

        if len(chunk_words) >= MIN_CHUNK_WORDS:
            chunks.append(" ".join(chunk_words))

        if end >= len(words):
            break

        start += CHUNK_SIZE - CHUNK_OVERLAP

    return chunks


async def chunk_and_embed_page(
    page: Page,
    workspace_id: str,
    embedding_svc: EmbeddingService,
    db: AsyncSession,
) -> int:
    """
    Delete existing chunks for this page, re-chunk the content,
    generate embeddings, and store. Returns number of chunks created.
    """
    await db.execute(
        delete(PageChunk).where(
            PageChunk.workspace_id == workspace_id,
            PageChunk.page_id == page.id,
        )
    )

    content = page.content or ""
    if not content.strip():
        log.debug("chunk_and_embed_page: page %s has no content — skipping", page.id)
        return 0

    full_text = f"{page.title}\n\n{content}" if page.title else content
    raw_chunks = _split_into_chunks(full_text)

    if not raw_chunks:
        return 0

    created = 0
    for idx, chunk_text in enumerate(raw_chunks):
        try:
            embedding = await embedding_svc.generate_embedding(chunk_text)
        except Exception as exc:
            log.warning(
                "chunk_and_embed_page: embedding failed for page %s chunk %d: %s",
                page.id, idx, exc,
            )
            embedding = None

        chunk = PageChunk(
            workspace_id=workspace_id,
            page_id=page.id,
            chunk_index=idx,
            content=chunk_text,
            embedding=embedding,
            page_title=page.title,
            space_key=page.space_key,
            page_url=page.url,
            page_owner=page.owner,
            last_modified=page.last_modified,
        )
        db.add(chunk)
        created += 1

    await db.flush()
    log.info(
        "chunk_and_embed_page: page %s → %d chunks created",
        page.id, created,
    )
    return created


async def chunk_workspace(
    workspace_id: str,
    embedding_svc: EmbeddingService,
    db: AsyncSession,
    force: bool = False,
) -> dict:
    """
    Chunk and embed all pages in a workspace.
    force=True re-chunks pages that already have chunks.
    """
    if force:
        await db.execute(
            delete(PageChunk).where(PageChunk.workspace_id == workspace_id)
        )
        await db.flush()

    pages_result = await db.execute(
        select(Page).where(
            Page.workspace_id == workspace_id,
            Page.content.isnot(None),
            Page.content != "",
        )
    )
    pages = pages_result.scalars().all()

    if not force:
        chunked_page_ids_result = await db.execute(
            select(PageChunk.page_id).where(
                PageChunk.workspace_id == workspace_id
            ).distinct()
        )
        chunked_ids = {r[0] for r in chunked_page_ids_result.all()}
        pages = [p for p in pages if p.id not in chunked_ids]

    total = len(pages)
    processed = 0
    failed = 0

    for page in pages:
        try:
            n = await chunk_and_embed_page(page, workspace_id, embedding_svc, db)
            await db.commit()
            processed += 1
            log.info("chunk_workspace: ✓ %s (%s) → %d chunks", page.id, page.title, n)
        except Exception as exc:
            await db.rollback()
            log.error("chunk_workspace: ✗ %s (%s): %s", page.id, page.title, exc)
            failed += 1

    return {"total": total, "processed": processed, "failed": failed}
