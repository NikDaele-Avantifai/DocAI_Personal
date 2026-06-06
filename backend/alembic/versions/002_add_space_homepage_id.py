"""Add homepage_id to spaces for tree deduplication

Revision ID: add_space_homepage_id
Revises: add_workspace_multitenancy
Create Date: 2026-06-05

Stores the Confluence homepage page ID against each space so that
get_space_tree() can hoist homepage children to the root, eliminating
the duplicate same-named node that Confluence places at the top of every
space tree.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "add_space_homepage_id"
down_revision: Union[str, None] = "add_workspace_multitenancy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("spaces", sa.Column("homepage_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("spaces", "homepage_id")
