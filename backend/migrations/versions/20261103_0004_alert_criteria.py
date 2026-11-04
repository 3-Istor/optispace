"""alert criteria: availability_alert.floor, availability_alert.equipment

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-03

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("availability_alert", sa.Column("floor", sa.Integer()))
    # Server default: the previous release inserts alerts without the column.
    op.add_column("availability_alert", sa.Column("equipment", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("availability_alert", "equipment")
    op.drop_column("availability_alert", "floor")
