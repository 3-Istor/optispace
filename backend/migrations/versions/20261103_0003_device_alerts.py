"""device alerts: app_user.is_fm, device.offline_notified_at

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-03

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Server default: the previous release inserts users without the column.
    op.add_column("app_user", sa.Column("is_fm", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("device", sa.Column("offline_notified_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("device", "offline_notified_at")
    op.drop_column("app_user", "is_fm")
