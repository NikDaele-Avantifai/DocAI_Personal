-- Step 1: Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add embedding column to pages table
-- voyage-3 produces 1024-dimensional embeddings (not 1536 — that is OpenAI ada-002)
ALTER TABLE pages ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- Step 3: IVFFlat index for fast approximate cosine-similarity search
-- lists = 100 is appropriate for up to ~1M rows; lower (e.g. 10) is fine for small datasets
CREATE INDEX IF NOT EXISTS pages_embedding_idx
    ON pages USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
