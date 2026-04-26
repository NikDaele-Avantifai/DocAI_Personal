import logging
import os
import sys
import sqlalchemy
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def run_migrations() -> None:
    """
    Run any pending migrations from migrate.py automatically on startup.
    Non-fatal: logs a warning and continues if the DB is unreachable or
    migration fails, so the app can still start in degraded state.
    """
    import asyncpg

    url = settings.database_url
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    url = url.replace("postgres://", "postgresql://")

    try:
        conn = await asyncpg.connect(url)

        # Ensure pgvector extension exists before any table creation
        try:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            logger.info("pgvector extension verified")
        except Exception as e:
            logger.warning("pgvector extension not available: %s", e)
            # Continue — tables without vector columns will still work

        # Ensure migrations tracking table exists
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS _migrations (
                id VARCHAR PRIMARY KEY,
                description VARCHAR NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # Import MIGRATIONS list from migrate.py (sits at the backend root)
        backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if backend_root not in sys.path:
            sys.path.insert(0, backend_root)
        from migrate import MIGRATIONS  # noqa: PLC0415

        applied = {r["id"] for r in await conn.fetch("SELECT id FROM _migrations")}
        pending = [(mid, desc, sqls) for mid, desc, sqls in MIGRATIONS if mid not in applied]

        for mid, desc, sqls in pending:
            async with conn.transaction():
                for sql in sqls:
                    try:
                        await conn.execute(sql)
                    except Exception as e:
                        logger.warning("Migration step skipped (%s): %s", mid, e)
                await conn.execute(
                    "INSERT INTO _migrations (id, description) VALUES ($1, $2)",
                    mid, desc,
                )
                logger.info("Migration applied: %s — %s", mid, desc)

        if pending:
            logger.info("Auto-migration complete: %d migration(s) applied.", len(pending))
        else:
            logger.info("Auto-migration: no pending migrations.")

        await conn.close()

    except Exception as exc:
        logger.warning("Auto-migration failed (non-fatal): %s", exc)


async def init_db() -> None:
    """Run pending migrations, then ensure all tables exist via SQLAlchemy."""
    from app.models.workspace import Workspace                           # noqa: F401 — registers Workspace
    from app.models.page import Base as PageBase                        # noqa: F401 — registers Space + Page
    from app.models.audit import AuditEntry                             # noqa: F401 — registers AuditEntry
    from app.models.snapshot import Snapshot                            # noqa: F401 — registers Snapshot
    from app.models.page_analysis import PageAnalysis                   # noqa: F401 — registers PageAnalysis
    from app.models.analysis_settings import WorkspaceSettings          # noqa: F401 — registers WorkspaceSettings
    from app.models.sweep import WorkspaceSweep                          # noqa: F401 — registers WorkspaceSweep
    from app.models.dismissed_issue import DismissedIssue               # noqa: F401 — registers DismissedIssue
    from app.models.usage import WorkspaceUsage, UsageEvent              # noqa: F401 — registers usage tables
    from app.models.workspace_member import WorkspaceMember, WorkspaceInvite  # noqa: F401 — registers member tables

    # Run pending migrations before creating tables
    await run_migrations()

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        logger.info("Database tables initialised successfully.")
    except Exception as exc:
        logger.warning(
            "Could not initialise database tables — is PostgreSQL running "
            "and does the database exist? Error: %s",
            exc,
        )


async def get_db() -> AsyncSession:  # type: ignore[return]
    """FastAPI dependency — yields a scoped async session per request."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
