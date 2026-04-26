"""
Run once (and re-run safely) to create/migrate all database tables.

Usage (from the backend/ directory):
    python create_tables.py
"""
import asyncio
import sys


async def main() -> None:
    from app.core.config import settings
    from app.db.database import engine, Base
    import app.models.page             # noqa: F401 — registers Space + Page
    import app.models.audit            # noqa: F401 — registers AuditEntry
    import app.models.snapshot         # noqa: F401 — registers Snapshot
    import app.models.dismissed_issue  # noqa: F401 — registers DismissedIssue
    import app.models.page_analysis    # noqa: F401 — registers PageAnalysis
    import app.models.analysis_settings  # noqa: F401 — registers WorkspaceSettings
    import app.models.sweep            # noqa: F401 — registers WorkspaceSweep
    import app.models.workspace        # noqa: F401 — registers Workspace
    import app.models.usage            # noqa: F401 — registers WorkspaceUsage + UsageEvent
    import app.models.workspace_member  # noqa: F401 — registers WorkspaceMember + WorkspaceInvite

    print(f"Connecting to: {settings.database_url}")

    import sqlalchemy

    try:
        async with engine.begin() as conn:
            # Ensure pgvector extension exists before table creation
            try:
                await conn.execute(sqlalchemy.text("CREATE EXTENSION IF NOT EXISTS vector"))
                print("  ✓ pgvector extension")
            except Exception as e:
                print(f"  ✗ pgvector extension (non-fatal): {e}")

            await conn.run_sync(Base.metadata.create_all)

        print("✓ Tables created/verified")
    except Exception as exc:
        print(f"✗ Failed to create tables: {exc}")
        print()
        print("Check that PostgreSQL is running and doc_ai_db exists.")
        await engine.dispose()
        sys.exit(1)

    # Safe migrations — each runs in its own transaction so one failure doesn't block others
    migrations = [
        # extensions
        ("CREATE EXTENSION IF NOT EXISTS vector", "pgvector extension"),
        # audit_log
        ("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS snapshot_id VARCHAR", "audit_log.snapshot_id"),
        # pages
        ("ALTER TABLE pages ADD COLUMN IF NOT EXISTS content_hash VARCHAR(32)", "pages.content_hash"),
        ("ALTER TABLE pages ADD COLUMN IF NOT EXISTS is_healthy BOOLEAN NOT NULL DEFAULT FALSE", "pages.is_healthy"),
        ("ALTER TABLE pages ADD COLUMN IF NOT EXISTS embedding vector(1024)", "pages.embedding"),
        ("ALTER TABLE pages ADD COLUMN IF NOT EXISTS last_fixed_at TIMESTAMPTZ", "pages.last_fixed_at"),
        ("ALTER TABLE pages ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ", "pages.health_checked_at"),
    ]

    for sql, label in migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(sqlalchemy.text(sql))
            print(f"  ✓ {label}")
        except Exception as exc:
            print(f"  ✗ {label}: {exc}")

    print()
    print("✓ Migrations applied:")
    for table in Base.metadata.sorted_tables:
        print(f"  • {table.name}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
