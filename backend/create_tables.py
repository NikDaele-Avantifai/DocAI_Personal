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
    import app.models.page      # noqa: F401 — registers Space + Page
    import app.models.audit     # noqa: F401 — registers AuditEntry
    import app.models.snapshot  # noqa: F401 — registers Snapshot

    print(f"Connecting to: {settings.database_url}")

    try:
        async with engine.begin() as conn:
            # Create any tables that don't exist yet
            await conn.run_sync(Base.metadata.create_all)

            # Safe migrations — ADD COLUMN IF NOT EXISTS for columns added after initial setup
            migrations = [
                "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS snapshot_id VARCHAR",
            ]
            for sql in migrations:
                await conn.execute(__import__("sqlalchemy").text(sql))

        print("✓ Tables and migrations applied:")
        for table in Base.metadata.sorted_tables:
            print(f"  • {table.name}")
    except Exception as exc:
        print(f"✗ Failed: {exc}")
        print()
        print("Check that PostgreSQL is running and doc_ai_db exists.")
        sys.exit(1)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
