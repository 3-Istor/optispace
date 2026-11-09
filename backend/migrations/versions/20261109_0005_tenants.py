"""tenants: app_user.organization, space.organization

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

    # The default backfills data from before 0.6 and serves the previous release, which inserts without it.
    op.add_column("space", sa.Column("organization", sa.String(), nullable=False, server_default="demo-a"))
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint("space_name_key", "space", type_="unique")
        with op.get_context().autocommit_block():
            op.create_index(
                "uq_space_organization_name", "space", ["organization", "name"], unique=True,
                postgresql_concurrently=True,
            )
    else:
        with op.batch_alter_table("space", naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"}) as batch:
            batch.drop_constraint("uq_space_name", type_="unique")
        op.create_index("uq_space_organization_name", "space", ["organization", "name"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_space_organization_name", "space")
    op.drop_column("space", "organization")
    op.create_unique_constraint("space_name_key", "space", ["name"])
    op.drop_column("app_user", "organization")
