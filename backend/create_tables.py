"""
Run once to create all database tables in doc_ai_db.

Usage (from the backend/ directory):
    python create_tables.py
"""
import asyncio
import sys


async def main() -> None:
    # Import after the event loop starts so asyncpg initialises correctly
    from app.core.config import settings
    from app.db.database import engine
    import app.models.page  # noqa: F401 — registers Space + Page on Base.metadata
    from app.db.database import Base

    print(f"Connecting to: {settings.database_url}")

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        print("✓ Tables created successfully:")
        for table in Base.metadata.sorted_tables:
            print(f"  • {table.name}")
    except Exception as exc:
        print(f"✗ Failed to create tables: {exc}")
        print()
        print("Check that:")
        print("  1. PostgreSQL is running")
        print("  2. The database 'doc_ai_db' exists")
        print("  3. DATABASE_URL in .env matches your credentials")
        sys.exit(1)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
