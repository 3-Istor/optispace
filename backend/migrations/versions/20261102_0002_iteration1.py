"""iteration 1 data model

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TS = sa.DateTime(timezone=True)
ENUM = sa.String(32)  # enum values, see Base.type_annotation_map


def upgrade() -> None:
    op.create_table(
        "app_user",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("keycloak_sub", sa.String(), nullable=False, unique=True),
        sa.Column("email", sa.String()),
        sa.Column("display_name", sa.String()),
        sa.Column("phone", sa.String()),
        sa.Column("notify_push", sa.Boolean(), nullable=False),
        sa.Column("notify_in_app", sa.Boolean(), nullable=False),
        sa.Column("alert_device_offline", sa.Boolean(), nullable=False),
        sa.Column("alert_device_sealed", sa.Boolean(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
    )
    op.create_table(
        "space",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("type", ENUM, nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("floor", sa.Integer(), nullable=False),
        sa.Column("equipment", sa.JSON(), nullable=False),
        sa.Column("min_duration_min", sa.Integer()),
        sa.Column("max_duration_min", sa.Integer()),
        sa.Column("is_active", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "device",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("space_id", sa.Uuid(), sa.ForeignKey("space.id"), unique=True),
        sa.Column("seal", ENUM, nullable=False),
        sa.Column("firmware_version", sa.String()),
        sa.Column("first_seen_at", TS, nullable=False),
        sa.Column("last_seen_at", TS, nullable=False),
    )
    op.create_table(
        "observation",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("device_id", sa.String(), sa.ForeignKey("device.id"), nullable=False),
        sa.Column("space_id", sa.Uuid(), sa.ForeignKey("space.id")),
        sa.Column("boot_id", sa.String(), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("kind", ENUM, nullable=False),
        sa.Column("presence", ENUM, nullable=False),
        sa.Column("target", ENUM),
        sa.Column("observed_at", TS, nullable=False),
        sa.Column("received_at", TS, nullable=False),
        sa.Column("clock_synced", sa.Boolean(), nullable=False),
        sa.Column("source", ENUM, nullable=False),
        sa.UniqueConstraint("device_id", "boot_id", "seq"),
    )
    op.create_index("ix_observation_space_id_observed_at", "observation", ["space_id", "observed_at"])
    op.create_table(
        "space_status",
        sa.Column("space_id", sa.Uuid(), sa.ForeignKey("space.id"), primary_key=True),
        sa.Column("occupancy", ENUM, nullable=False),
        sa.Column("occupancy_since", TS, nullable=False),
        sa.Column("last_observation_at", TS, nullable=False),
    )
    op.create_table(
        "reservation",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("space_id", sa.Uuid(), sa.ForeignKey("space.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("start_at", TS, nullable=False),
        sa.Column("end_at", TS, nullable=False),
        sa.Column("status", ENUM, nullable=False),
        sa.Column("released_at", TS),
        sa.Column("cancelled_at", TS),
        sa.Column("created_at", TS, nullable=False),
    )
    op.create_table(
        "absence_episode",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("reservation_id", sa.Uuid(), sa.ForeignKey("reservation.id"), nullable=False),
        sa.Column("kind", ENUM, nullable=False),
        sa.Column("opened_at", TS, nullable=False),
        sa.Column("deadline_at", TS, nullable=False),
        sa.Column("outcome", ENUM, nullable=False),
        sa.Column("closed_at", TS),
    )
    pending = sa.text("outcome = 'pending'")
    op.create_index(
        "uq_absence_episode_pending", "absence_episode", ["reservation_id"], unique=True,
        postgresql_where=pending, sqlite_where=pending,
    )
    op.create_table(
        "availability_alert",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("start_at", TS, nullable=False),
        sa.Column("end_at", TS, nullable=False),
        sa.Column("space_type", ENUM, nullable=False),
        sa.Column("min_capacity", sa.Integer(), nullable=False),
        sa.Column("status", ENUM, nullable=False),
        sa.Column("created_at", TS, nullable=False),
    )
    op.create_table(
        "notification",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("type", ENUM, nullable=False),
        sa.Column("reservation_id", sa.Uuid(), sa.ForeignKey("reservation.id")),
        sa.Column("space_id", sa.Uuid(), sa.ForeignKey("space.id")),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("read_at", TS),
    )
    op.create_table(
        "push_subscription",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("endpoint", sa.String(), nullable=False, unique=True),
        sa.Column("p256dh", sa.String(), nullable=False),
        sa.Column("auth", sa.String(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
    )
    app_settings = op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("absence_delay_min", sa.Integer(), nullable=False),
        sa.Column("booth_min_min", sa.Integer(), nullable=False),
        sa.Column("booth_max_min", sa.Integer(), nullable=False),
        sa.Column("meeting_min_min", sa.Integer(), nullable=False),
        sa.Column("meeting_max_min", sa.Integer(), nullable=False),
    )
    op.bulk_insert(app_settings, [{
        "id": 1, "absence_delay_min": 10, "booth_min_min": 15, "booth_max_min": 60,
        "meeting_min_min": 30, "meeting_max_min": 180,
    }])

    # get_context(), not get_bind(): the CI lint renders this revision offline, without a connection.
    if op.get_context().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")  # trusted extension: no superuser needed
        op.execute(
            "ALTER TABLE reservation ADD CONSTRAINT reservation_no_overlap EXCLUDE USING gist "
            "(space_id WITH =, tstzrange(start_at, COALESCE(released_at, end_at)) WITH &&) "
            "WHERE (status <> 'cancelled')"
        )


def downgrade() -> None:
    for table in (
        "app_settings", "push_subscription", "notification", "availability_alert", "absence_episode",
        "reservation", "space_status", "observation", "device", "space", "app_user",
    ):
        op.drop_table(table)
