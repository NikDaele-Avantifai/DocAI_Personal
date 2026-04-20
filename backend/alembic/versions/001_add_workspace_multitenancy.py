"""Add workspace multi-tenancy

Revision ID: add_workspace_multitenancy
Revises: None
Create Date: 2026-04-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'add_workspace_multitenancy'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create workspaces table
    op.create_table(
        'workspaces',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('owner_sub', sa.String(), nullable=False),
        sa.Column('owner_email', sa.String(), nullable=True),
        sa.Column('confluence_base_url', sa.String(), nullable=True),
        sa.Column('confluence_email', sa.String(), nullable=True),
        sa.Column('confluence_api_token_enc', sa.Text(), nullable=True),
        sa.Column('onboarding_completed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('confluence_connected', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspaces_owner_sub', 'workspaces', ['owner_sub'], unique=True)

    # 2. Insert a default workspace for existing data (legacy migration)
    op.execute("""
        INSERT INTO workspaces (id, owner_sub, owner_email, onboarding_completed, confluence_connected)
        VALUES ('00000000-0000-0000-0000-000000000001',
                'legacy|default',
                'legacy@avantifai.com',
                true,
                true)
    """)

    # 3. Add workspace_id to every table with default pointing to legacy workspace
    tables = [
        'pages', 'spaces', 'audit_log', 'workspace_sweeps',
        'page_analyses', 'dismissed_issues', 'snapshots', 'workspace_settings'
    ]
    for table in tables:
        op.add_column(table, sa.Column(
            'workspace_id', sa.String(), nullable=True
        ))
        op.execute(f"""
            UPDATE {table}
            SET workspace_id = '00000000-0000-0000-0000-000000000001'
        """)
        op.alter_column(table, 'workspace_id', nullable=False)
        op.create_index(f'ix_{table}_workspace_id', table, ['workspace_id'])

    # 4. Fix Space unique constraint — must be per-workspace not global
    op.drop_constraint('uq_spaces_key', 'spaces', type_='unique')
    op.create_unique_constraint('uq_spaces_workspace_key', 'spaces', ['workspace_id', 'key'])

    # 5. Add unique constraint on workspace_settings.workspace_id
    op.create_unique_constraint(
        'uq_workspace_settings_workspace_id', 'workspace_settings', ['workspace_id']
    )


def downgrade() -> None:
    op.drop_constraint('uq_workspace_settings_workspace_id', 'workspace_settings', type_='unique')
    op.drop_constraint('uq_spaces_workspace_key', 'spaces', type_='unique')
    op.create_unique_constraint('uq_spaces_key', 'spaces', ['key'])

    tables = [
        'pages', 'spaces', 'audit_log', 'workspace_sweeps',
        'page_analyses', 'dismissed_issues', 'snapshots', 'workspace_settings'
    ]
    for table in tables:
        op.drop_index(f'ix_{table}_workspace_id', table_name=table)
        op.drop_column(table, 'workspace_id')

    op.drop_index('ix_workspaces_owner_sub', table_name='workspaces')
    op.drop_table('workspaces')
