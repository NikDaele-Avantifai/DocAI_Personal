-- Requires: CREATE EXTENSION vector; already run on the database
-- Run this after the application tables exist (init_db creates them first)

ALTER TABLE pages ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS pages_embedding_idx
    ON pages USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
