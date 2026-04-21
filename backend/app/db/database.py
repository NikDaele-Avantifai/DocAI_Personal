import logging
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


async def init_db() -> None:
    """Create all tables on startup. Warns instead of crashing if the DB is unreachable."""
    from app.models.workspace import Workspace                           # noqa: F401 — registers Workspace
    from app.models.page import Base as PageBase                        # noqa: F401 — registers Space + Page
    from app.models.audit import AuditEntry                             # noqa: F401 — registers AuditEntry
    from app.models.snapshot import Snapshot                            # noqa: F401 — registers Snapshot
    from app.models.page_analysis import PageAnalysis                   # noqa: F401 — registers PageAnalysis
    from app.models.analysis_settings import WorkspaceSettings          # noqa: F401 — registers WorkspaceSettings
    from app.models.sweep import WorkspaceSweep                          # noqa: F401 — registers WorkspaceSweep
    from app.models.dismissed_issue import DismissedIssue               # noqa: F401 — registers DismissedIssue
    from app.models.usage import WorkspaceUsage, UsageEvent              # noqa: F401 — registers usage tables

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # Verify critical migrations have run
        async with engine.connect() as conn:
            result = await conn.execute(sqlalchemy.text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'spaces'
                AND column_name = 'workspace_id'
            """))
            if not result.fetchone():
                logger.critical(
                    "MIGRATION NEEDED: spaces.workspace_id column missing. "
                    "Run: alembic upgrade head"
                )

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
