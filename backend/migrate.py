"""
Simple migration runner for Railway.
Usage:
  python migrate.py                    # run all pending migrations
  python migrate.py --list             # show migration status

Set DATABASE_URL in your environment or .env.local file.
Never commit credentials.
"""
import asyncio
import sys
import asyncpg
import os
from datetime import datetime

# Load .env.local if present (never committed to git)
try:
    with open('.env.local') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())
except FileNotFoundError:
    pass

DATABASE_URL = os.environ.get('DATABASE_URL', '').replace(
    'postgresql+asyncpg://', 'postgresql://'
)

# ── Migration registry ────────────────────────────────────────────────────────
# Add new migrations here. Never edit existing ones — always add new entries.
# Each migration is (id, description, sql_or_callable)

MIGRATIONS = [
    (
        '001_workspace_multitenancy',
        'Add workspace_id to all tables',
        [
            'CREATE TABLE IF NOT EXISTS workspaces (id VARCHAR PRIMARY KEY, owner_sub VARCHAR NOT NULL, owner_email VARCHAR, confluence_base_url VARCHAR, confluence_email VARCHAR, confluence_api_token_enc TEXT, onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE, confluence_connected BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())',
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_workspaces_owner_sub ON workspaces(owner_sub)',
            "INSERT INTO workspaces (id, owner_sub, owner_email, onboarding_completed, confluence_connected, plan) VALUES ('00000000-0000-0000-0000-000000000001', 'legacy|default', 'legacy@avantifai.com', true, true, 'trial') ON CONFLICT DO NOTHING",
            'ALTER TABLE spaces ADD COLUMN IF NOT EXISTS workspace_id VARCHAR',
            "UPDATE spaces SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL",
            'CREATE INDEX IF NOT EXISTS ix_spaces_workspace_id ON spaces(workspace_id)',
            'ALTER TABLE spaces DROP CONSTRAINT IF EXISTS uq_spaces_key',
            """DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_spaces_workspace_key') THEN
                    ALTER TABLE spaces ADD CONSTRAINT uq_spaces_workspace_key UNIQUE (workspace_id, key);
                END IF;
            END $$""",
            'ALTER TABLE pages ADD COLUMN IF NOT EXISTS workspace_id VARCHAR',
            "UPDATE pages SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL",
            'CREATE INDEX IF NOT EXISTS ix_pages_workspace_id ON pages(workspace_id)',
            'ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS workspace_id VARCHAR',
            "UPDATE audit_log SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL",
            'CREATE INDEX IF NOT EXISTS ix_audit_log_workspace_id ON audit_log(workspace_id)',
            'ALTER TABLE workspace_sweeps ADD COLUMN IF NOT EXISTS workspace_id VARCHAR',
            "UPDATE workspace_sweeps SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL",
            'CREATE INDEX IF NOT EXISTS ix_workspace_sweeps_workspace_id ON workspace_sweeps(workspace_id)',
            'ALTER TABLE page_analyses ADD COLUMN IF NOT EXISTS workspace_id VARCHAR',
            "UPDATE page_analyses SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL",
            'CREATE INDEX IF NOT EXISTS ix_page_analyses_workspace_id ON page_analyses(workspace_id)',
            'ALTER TABLE dismissed_issues ADD COLUMN IF NOT EXISTS workspace_id VARCHAR',
            "UPDATE dismissed_issues SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL",
            'CREATE INDEX IF NOT EXISTS ix_dismissed_issues_workspace_id ON dismissed_issues(workspace_id)',
            'ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS workspace_id VARCHAR',
            "UPDATE snapshots SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL",
            'CREATE INDEX IF NOT EXISTS ix_snapshots_workspace_id ON snapshots(workspace_id)',
            'ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS workspace_id VARCHAR',
            "UPDATE workspace_settings SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL",
        ]
    ),
    (
        '002_usage_tracking',
        'Add usage tracking tables and plan field to workspaces',
        [
            # Plan field on workspaces
            "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan VARCHAR NOT NULL DEFAULT 'trial'",
            "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ",

            # Set trial end date for existing workspaces (14 days from now)
            "UPDATE workspaces SET trial_ends_at = NOW() + INTERVAL '14 days' WHERE plan = 'trial' AND trial_ends_at IS NULL",

            # workspace_usage table
            """CREATE TABLE IF NOT EXISTS workspace_usage (
                id SERIAL PRIMARY KEY,
                workspace_id VARCHAR NOT NULL,
                period VARCHAR NOT NULL,
                analyses_count INTEGER NOT NULL DEFAULT 0,
                chat_count INTEGER NOT NULL DEFAULT 0,
                rename_count INTEGER NOT NULL DEFAULT 0,
                duplication_scans_count INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_usage_workspace_period UNIQUE (workspace_id, period)
            )""",
            "CREATE INDEX IF NOT EXISTS ix_workspace_usage_workspace_id ON workspace_usage(workspace_id)",

            # usage_events table
            """CREATE TABLE IF NOT EXISTS usage_events (
                id SERIAL PRIMARY KEY,
                workspace_id VARCHAR NOT NULL,
                user_sub VARCHAR NOT NULL,
                user_email VARCHAR,
                action VARCHAR NOT NULL,
                meta VARCHAR,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS ix_usage_events_workspace_id ON usage_events(workspace_id)",
            "CREATE INDEX IF NOT EXISTS ix_usage_events_user_sub ON usage_events(user_sub)",
        ]
    ),
    (
        '005_workspace_members_and_invites',
        'Add workspace members and invitations tables',
        [
            """CREATE TABLE IF NOT EXISTS workspace_members (
                id SERIAL PRIMARY KEY,
                workspace_id VARCHAR NOT NULL,
                user_sub VARCHAR NOT NULL,
                user_email VARCHAR NOT NULL,
                role VARCHAR NOT NULL DEFAULT 'viewer',
                invited_by_sub VARCHAR NOT NULL,
                invited_by_email VARCHAR,
                joined_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_workspace_members_workspace_user
                    UNIQUE (workspace_id, user_sub)
            )""",
            "CREATE INDEX IF NOT EXISTS ix_workspace_members_workspace_id ON workspace_members(workspace_id)",
            "CREATE INDEX IF NOT EXISTS ix_workspace_members_user_sub ON workspace_members(user_sub)",
            """CREATE TABLE IF NOT EXISTS workspace_invites (
                id SERIAL PRIMARY KEY,
                workspace_id VARCHAR NOT NULL,
                email VARCHAR NOT NULL,
                role VARCHAR NOT NULL DEFAULT 'viewer',
                token VARCHAR NOT NULL UNIQUE,
                invited_by_sub VARCHAR NOT NULL,
                invited_by_email VARCHAR,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                accepted BOOLEAN NOT NULL DEFAULT FALSE,
                accepted_at TIMESTAMPTZ,
                CONSTRAINT uq_workspace_invites_workspace_email
                    UNIQUE (workspace_id, email)
            )""",
            "CREATE INDEX IF NOT EXISTS ix_workspace_invites_workspace_id ON workspace_invites(workspace_id)",
            "CREATE INDEX IF NOT EXISTS ix_workspace_invites_email ON workspace_invites(email)",
        ]
    ),
    (
        '004_workspace_member_roles',
        'Add default_member_role to workspaces for future member management',
        [
            "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_member_role VARCHAR NOT NULL DEFAULT 'viewer'",
        ]
    ),
    (
        '003_clear_encrypted_tokens_after_key_hardening',
        'Clear Confluence tokens after encryption key hardening (users must re-enter)',
        [
            "UPDATE workspaces SET confluence_api_token_enc = NULL, confluence_connected = FALSE WHERE confluence_api_token_enc IS NOT NULL",
        ]
    ),
]

# ── Runner ────────────────────────────────────────────────────────────────────

async def main():
    if not DATABASE_URL:
        print('ERROR: DATABASE_URL not set')
        print('Create .env.local with: DATABASE_URL=postgresql://...')
        sys.exit(1)

    conn = await asyncpg.connect(DATABASE_URL)

    # Create migrations tracking table
    await conn.execute('''
        CREATE TABLE IF NOT EXISTS _migrations (
            id VARCHAR PRIMARY KEY,
            description VARCHAR NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ''')

    applied = {r['id'] for r in await conn.fetch('SELECT id FROM _migrations')}

    if '--list' in sys.argv:
        print(f'{"ID":<40} {"STATUS":<10} DESCRIPTION')
        print('-' * 80)
        for mid, desc, _ in MIGRATIONS:
            status = 'applied' if mid in applied else 'PENDING'
            print(f'{mid:<40} {status:<10} {desc}')
        await conn.close()
        return

    pending = [(mid, desc, sqls) for mid, desc, sqls in MIGRATIONS if mid not in applied]

    if not pending:
        print('No pending migrations.')
        await conn.close()
        return

    for mid, desc, sqls in pending:
        print(f'\nRunning: {mid} — {desc}')
        async with conn.transaction():
            for sql in sqls:
                try:
                    await conn.execute(sql)
                    print(f'  OK  {sql[:70].strip()}...' if len(sql) > 70 else f'  OK  {sql.strip()}')
                except Exception as e:
                    print(f'  ERR {sql[:70].strip()}')
                    print(f'      {e}')
                    raise  # rolls back the transaction

            await conn.execute(
                'INSERT INTO _migrations (id, description) VALUES ($1, $2)',
                mid, desc
            )
            print(f'  Recorded migration {mid}')

    print(f'\nDone. {len(pending)} migration(s) applied.')
    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())