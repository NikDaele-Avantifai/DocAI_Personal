import asyncio
import os
from logging.config import fileConfig

from sqlalchemy.ext.asyncio import create_async_engine
from alembic import context

# Import your Base and all models
from app.db.database import Base
from app.core.config import settings

# Import all models so Base.metadata is populated
import app.models.workspace
import app.models.page
import app.models.audit
import app.models.snapshot
import app.models.page_analysis
import app.models.analysis_settings
import app.models.sweep
import app.models.dismissed_issue

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def run_migrations_offline() -> None:
    url = settings.async_database_url
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations() -> None:
    # Use settings.async_database_url — this reads from environment
    # Railway injects DATABASE_URL, settings converts it to asyncpg format
    connectable = create_async_engine(settings.async_database_url)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()

def do_run_migrations(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()