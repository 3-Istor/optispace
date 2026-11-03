"""Occupancy of a space and its space_state (spec §4.2 and §5)."""
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Device, Space, SpaceStatus
from app.models.enums import Presence, SealState, SpaceState
from app.services import booking

# Occupancy goes stale, and a device offline, after this long without telemetry.
STALE_AFTER = timedelta(seconds=30)


def effective_occupancy(status: SpaceStatus | None, device: Device | None, now: datetime) -> Presence:
    if (
        status is None
        or device is None
        or device.seal != SealState.UNSEALED
        or device.space_id is None
        or now - status.last_observation_at >= STALE_AFTER
    ):
        return Presence.UNKNOWN
    return status.occupancy


def apply_observation(db: Session, space_id: UUID, presence: Presence, received_at: datetime) -> None:
    """Update space_status with a valid observation. Times are the server's receipt, never the device
    clock, which may be off; an observation received before the current state changes nothing."""
    # Row lock: concurrent telemetry of one space updates its status one after the other on PostgreSQL.
    status = db.get(SpaceStatus, space_id, with_for_update=True, populate_existing=True)
    if status is None:
        db.add(SpaceStatus(
            space_id=space_id, occupancy=presence, occupancy_since=received_at, last_observation_at=received_at,
        ))
    elif received_at >= status.last_observation_at:
        # A data gap counts as unknown, so the same value after it starts a new run.
        if presence != status.occupancy or received_at - status.last_observation_at >= STALE_AFTER:
            status.occupancy_since = received_at
        status.occupancy = presence
        status.last_observation_at = received_at
    db.flush()  # sessions do not autoflush: later reads in this request must see it


def space_state(db: Session, space: Space, now: datetime) -> SpaceState:
    device = db.scalar(select(Device).where(Device.space_id == space.id))
    if device is not None and device.seal == SealState.SEALED:
        return SpaceState.SEALED
    presence = effective_occupancy(db.get(SpaceStatus, space.id), device, now)
    if presence == Presence.UNKNOWN:
        return SpaceState.UNKNOWN
    reserved = booking.current_reservation(db, space.id, now) is not None
    if presence == Presence.PRESENT:
        return SpaceState.OCCUPIED_RESERVED if reserved else SpaceState.OCCUPIED_UNRESERVED
    return SpaceState.AWAITING_PRESENCE if reserved else SpaceState.FREE
