import logging
from dataclasses import dataclass
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.embedding_service import EmbeddingService

log = logging.getLogger(__name__)

VECTOR_CANDIDATES = 20
KEYWORD_CANDIDATES = 20
FINAL_TOP_K = 8
RRF_K = 60  # standard RRF constant


@dataclass
class RetrievedChunk:
    chunk_id: int
    page_id: str
    page_title: str
    space_key: str
    page_url: str | None
    page_owner: str | None
    last_modified: str | None
    content: str
    score: float


def _reciprocal_rank_fusion(
    vector_results: list[tuple],
    keyword_results: list[tuple],
) -> list[tuple]:
    """
    Merge two ranked lists using Reciprocal Rank Fusion.
    Each item gets score = sum of 1/(k + rank) across lists.
    Higher is better.
    """
    scores: dict[int, float] = {}
    id_to_row: dict[int, tuple] = {}

    for rank, row in enumerate(vector_results):
        chunk_id = row[0]
        scores[chunk_id] = scores.get(chunk_id, 0) + 1.0 / (RRF_K + rank + 1)
        id_to_row[chunk_id] = row

    for rank, row in enumerate(keyword_results):
        chunk_id = row[0]
        scores[chunk_id] = scores.get(chunk_id, 0) + 1.0 / (RRF_K + rank + 1)
        id_to_row[chunk_id] = row

    merged = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [(id_to_row[cid], score) for cid, score in merged]


async def retrieve(
    query: str,
    workspace_id: str,
    embedding_svc: EmbeddingService,
    db: AsyncSession,
    top_k: int = FINAL_TOP_K,
) -> list[RetrievedChunk]:
    """
    Hybrid retrieval: vector similarity + keyword search, merged with RRF.
    Returns top_k chunks most relevant to the query.
    """
    if not query.strip():
        return []

    try:
        query_embedding = await embedding_svc.generate_embedding(query)
    except Exception as exc:
        log.error("retrieve: embedding failed: %s", exc)
        return []

    embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

    vector_sql = text("""
        SELECT
            id,
            page_id,
            page_title,
            space_key,
            page_url,
            page_owner,
            last_modified,
            content,
            1 - (embedding <=> :embedding::vector) AS score
        FROM page_chunks
        WHERE workspace_id = :workspace_id
          AND embedding IS NOT NULL
        ORDER BY embedding <=> :embedding::vector
        LIMIT :limit
    """)

    try:
        vector_rows = (await db.execute(vector_sql, {
            "embedding": embedding_str,
            "workspace_id": workspace_id,
            "limit": VECTOR_CANDIDATES,
        })).fetchall()
    except Exception as exc:
        log.warning("retrieve: vector search failed: %s", exc)
        vector_rows = []

    keyword_sql = text("""
        SELECT
            id,
            page_id,
            page_title,
            space_key,
            page_url,
            page_owner,
            last_modified,
            content,
            ts_rank(
                to_tsvector('english', content),
                plainto_tsquery('english', :query)
            ) AS score
        FROM page_chunks
        WHERE workspace_id = :workspace_id
          AND to_tsvector('english', content) @@
              plainto_tsquery('english', :query)
        ORDER BY score DESC
        LIMIT :limit
    """)

    try:
        keyword_rows = (await db.execute(keyword_sql, {
            "query": query,
            "workspace_id": workspace_id,
            "limit": KEYWORD_CANDIDATES,
        })).fetchall()
    except Exception as exc:
        log.warning("retrieve: keyword search failed: %s", exc)
        keyword_rows = []

    if not vector_rows and not keyword_rows:
        return []

    merged = _reciprocal_rank_fusion(
        [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]) for r in vector_rows],
        [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]) for r in keyword_rows],
    )

    results = []
    seen_page_ids: set[str] = set()

    for (row, score) in merged[:top_k]:
        chunk_id, page_id, page_title, space_key, page_url, page_owner, last_modified, content, _ = row
        results.append(RetrievedChunk(
            chunk_id=chunk_id,
            page_id=page_id,
            page_title=page_title or "Untitled",
            space_key=space_key or "",
            page_url=page_url,
            page_owner=page_owner,
            last_modified=last_modified,
            content=content,
            score=score,
        ))
        seen_page_ids.add(page_id)

    log.info(
        "retrieve: query='%s...' → %d chunks from %d pages (vector=%d keyword=%d)",
        query[:50], len(results), len(seen_page_ids),
        len(vector_rows), len(keyword_rows),
    )
    return results
