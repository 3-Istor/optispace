"""tenants: app_user.organization

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable: the previous release inserts users without it; filled from the token on the next request.
    op.add_column("app_user", sa.Column("organization", sa.String()))


def downgrade() -> None:
    op.drop_column("app_user", "organization")
