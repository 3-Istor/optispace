"""tenants: app_user.organization, space.organization, org_settings

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

# The new unique index keeps the previous release's guarantee: everything it inserts goes to demo-a.
squawk_ignore = ["ban-drop-constraint"]


def upgrade() -> None:
    # Nullable: the previous release inserts users without it; filled from the token on the next request.
    op.add_column("app_user", sa.Column("organization", sa.String()))

    # The default backfills data from before 0.6 and serves the previous release, which inserts without it.
    op.add_column("space", sa.Column("organization", sa.String(), nullable=False, server_default="demo-a"))
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.create_index(
                "uq_space_organization_name", "space", ["organization", "name"], unique=True,
                postgresql_concurrently=True,
            )
        op.drop_constraint("space_name_key", "space", type_="unique")
    else:
        with op.batch_alter_table("space", naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"}) as batch:
            batch.drop_constraint("uq_space_name", type_="unique")
        op.create_index("uq_space_organization_name", "space", ["organization", "name"], unique=True)


    # New table: the previous release keeps reading app_settings row 1.
    op.create_table(
        "org_settings",
        sa.Column("organization", sa.String(), primary_key=True),
        sa.Column("absence_delay_min", sa.Integer(), nullable=False),
        sa.Column("booth_min_min", sa.Integer(), nullable=False),
        sa.Column("booth_max_min", sa.Integer(), nullable=False),
        sa.Column("meeting_min_min", sa.Integer(), nullable=False),
        sa.Column("meeting_max_min", sa.Integer(), nullable=False),
    )
    op.execute(
        "INSERT INTO org_settings (organization, absence_delay_min, booth_min_min, booth_max_min, "
        "meeting_min_min, meeting_max_min) SELECT 'demo-a', absence_delay_min, booth_min_min, booth_max_min, "
        "meeting_min_min, meeting_max_min FROM app_settings WHERE id = 1"
    )


def downgrade() -> None:
    op.drop_table("org_settings")
    op.drop_index("uq_space_organization_name", "space")
    op.drop_column("space", "organization")
    op.create_unique_constraint("space_name_key", "space", ["name"])
    op.drop_column("app_user", "organization")
