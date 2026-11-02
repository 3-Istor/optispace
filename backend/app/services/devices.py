"""Device registration, assignment and seal (spec §4.4), and telemetry ingestion (spec §7)."""
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import AbsenceEpisode, Device, Observation, Space
from app.models.enums import EpisodeOutcome, SealState, SpaceState
from app.schemas.telemetry import TelemetryIn
from app.services import absence, booking, occupancy

MAX_CLOCK_SKEW = timedelta(seconds=60)


def get(db: Session, device_id: str) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise DomainError(404, "DEVICE_NOT_FOUND")
    return device


def register_or_touch(db: Session, device_id: str, firmware_version: str, now: datetime) -> Device:
    """An unknown device is created sealed and unassigned."""
    device = db.get(Device, device_id)
    if device is None:
        device = Device(id=device_id, seal=SealState.SEALED, first_seen_at=now)
        db.add(device)
    device.firmware_version, device.last_seen_at = firmware_version, now
    db.flush()
    return device


def assign(db: Session, device_id: str, space_id: UUID | None) -> Device:
    """Always reseals, even when the space does not change."""
    device = get(db, device_id)
    if space_id is not None:
        if db.get(Space, space_id) is None:
            raise DomainError(404, "SPACE_NOT_FOUND")
        if db.scalar(select(Device.id).where(Device.space_id == space_id)) not in (None, device_id):
            raise DomainError(409, "SPACE_HAS_DEVICE")
    device.space_id, device.seal = space_id, SealState.SEALED
    db.flush()
    return device


def seal(db: Session, device_id: str) -> Device:
    device = get(db, device_id)
    device.seal = SealState.SEALED
    db.flush()
    return device


def unseal(db: Session, device_id: str) -> Device:
    """409 DEVICE_UNASSIGNED when the device has no space."""
    device = get(db, device_id)
    if device.space_id is None:
        raise DomainError(409, "DEVICE_UNASSIGNED")
    device.seal = SealState.UNSEALED
    db.flush()
    return device


def state_payload(db: Session, device: Device, now: datetime) -> dict:
    """The `state` object of the telemetry response (spec §7)."""
    space = db.get(Space, device.space_id) if device.space_id else None
    reservation = space and booking.current_reservation(db, space.id, now)
    release_at = reservation and db.scalar(select(AbsenceEpisode.deadline_at).where(
        AbsenceEpisode.reservation_id == reservation.id, AbsenceEpisode.outcome == EpisodeOutcome.PENDING,
    ))
    return {
        "seal": device.seal,
        "space_state": occupancy.space_state(db, space, now) if space else SpaceState.SEALED,
        "space_name": space.name if space else None,
        "reservation": {"start_at": reservation.start_at, "end_at": reservation.end_at} if reservation else None,
        "release_at": release_at,
        "updated_at": now,
    }


def ingest(db: Session, data: TelemetryIn, now: datetime) -> dict:
    """Apply one telemetry message; returns the response body `{accepted, code, state}`."""
    if data.ts is not None and data.ts - now > MAX_CLOCK_SKEW:
        raise DomainError(422, "CLOCK_SKEW")
    # ponytail: two concurrent copies of one event both miss this lookup and the loser gets a 500
    # from the unique constraint; catch IntegrityError and answer as a replay if retries overlap.
    previous = db.scalar(select(Observation).where(
        Observation.device_id == data.device_id, Observation.boot_id == data.boot_id, Observation.seq == data.seq,
    ))
    if previous is not None:
        stored = (previous.kind, previous.presence, previous.target, previous.source,
                  previous.observed_at if previous.clock_synced else None)
        if stored != (data.kind, data.presence, data.target, data.source, data.ts):
            raise DomainError(409, "DUPLICATE_EVENT_CONFLICT")
        return {"accepted": True, "code": None, "state": state_payload(db, db.get(Device, data.device_id), now)}

    device = register_or_touch(db, data.device_id, data.firmware_version, now)
    if device.seal != SealState.UNSEALED or device.space_id is None:
        return {"accepted": False, "code": "DEVICE_SEALED", "state": state_payload(db, device, now)}

    observed_at = data.ts or now
    db.add(Observation(
        device_id=device.id, space_id=device.space_id, boot_id=data.boot_id, seq=data.seq, kind=data.kind,
        presence=data.presence, target=data.target, observed_at=observed_at, received_at=now,
        clock_synced=data.ts is not None, source=data.source,
    ))
    occupancy.apply_observation(db, device.space_id, data.presence, observed_at)
    absence.evaluate_space(db, device.space_id, now)
    return {"accepted": True, "code": None, "state": state_payload(db, device, now)}
