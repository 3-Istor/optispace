"""Device registration, assignment and seal (spec §4.4), and telemetry ingestion (spec §7)."""
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import AbsenceEpisode, AppUser, Device, Observation, Space
from app.models.enums import EpisodeOutcome, NotificationType, SealState, SpaceState
from app.schemas.telemetry import TelemetryIn
from app.services import absence, booking, occupancy
from app.services.notifications import iso, notify

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


def _notify_fms(db: Session, alert, type: NotificationType, space: Space, **params) -> None:
    """`alert`: the AppUser preference column of this alert."""
    for fm in db.scalars(select(AppUser).where(AppUser.is_fm, AppUser.organization == space.organization, alert)).all():
        notify(db, fm, type, space_id=space.id, space_name=space.name, **params)


def _reseal(db: Session, device: Device) -> None:
    """DEVICE_SEALED for the space an unsealed device was measuring."""
    if device.seal == SealState.UNSEALED and device.space_id is not None:
        _notify_fms(db, AppUser.alert_device_sealed, NotificationType.DEVICE_SEALED, db.get(Space, device.space_id))
    device.seal = SealState.SEALED


def assign(db: Session, device_id: str, space_id: UUID | None) -> Device:
    """Always reseals, even when the space does not change."""
    device = get(db, device_id)
    if space_id is not None:
        if db.get(Space, space_id) is None:
            raise DomainError(404, "SPACE_NOT_FOUND")
        if db.scalar(select(Device.id).where(Device.space_id == space_id)) not in (None, device_id):
            raise DomainError(409, "SPACE_HAS_DEVICE")
    _reseal(db, device)
    device.space_id = space_id
    db.flush()
    return device


def seal(db: Session, device_id: str) -> Device:
    device = get(db, device_id)
    _reseal(db, device)
    db.flush()
    return device


def notify_offline(db: Session, now: datetime) -> None:
    """DEVICE_OFFLINE once per silence of an assigned unsealed device, checked by the polled reads
    (no background job). The caller commits."""
    unsent = or_(Device.offline_notified_at.is_(None), Device.offline_notified_at < Device.last_seen_at)
    candidates = db.scalars(select(Device).where(
        Device.space_id.is_not(None), Device.seal == SealState.UNSEALED,
        Device.last_seen_at <= now - occupancy.STALE_AFTER, unsent,
    ).order_by(Device.id)).all()  # a fixed order keeps row locks deadlock-free
    for device in candidates:
        # Conditional update: of two concurrent polls, only one sends the alert.
        claimed = db.execute(update(Device).where(Device.id == device.id, unsent).values(offline_notified_at=now)).rowcount
        if claimed:
            _notify_fms(db, AppUser.alert_device_offline, NotificationType.DEVICE_OFFLINE,
                        db.get(Space, device.space_id), at=iso(device.last_seen_at))


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


def _previous(db: Session, data: TelemetryIn) -> Observation | None:
    return db.scalar(select(Observation).where(
        Observation.device_id == data.device_id, Observation.boot_id == data.boot_id, Observation.seq == data.seq,
    ))


def _replay(db: Session, data: TelemetryIn, previous: Observation, now: datetime) -> dict:
    stored = (previous.kind, previous.presence, previous.target, previous.source,
              previous.observed_at if previous.clock_synced else None)
    if stored != (data.kind, data.presence, data.target, data.source, data.ts):
        raise DomainError(409, "DUPLICATE_EVENT_CONFLICT")
    return {"accepted": True, "code": None, "state": state_payload(db, db.get(Device, data.device_id), now)}


def ingest(db: Session, data: TelemetryIn, now: datetime) -> dict:
    """Apply one telemetry message; returns the response body `{accepted, code, state}`.
    `observed_at` keeps the device time for history and insights; the state uses the receipt time."""
    if data.ts is not None and data.ts - now > MAX_CLOCK_SKEW:
        raise DomainError(422, "CLOCK_SKEW")
    if (previous := _previous(db, data)) is not None:
        return _replay(db, data, previous, now)

    device = register_or_touch(db, data.device_id, data.firmware_version, now)
    if device.seal != SealState.UNSEALED or device.space_id is None:
        return {"accepted": False, "code": "DEVICE_SEALED", "state": state_payload(db, device, now)}

    # Within a boot, seq orders the events whatever the device clock says.
    newest = db.scalar(select(func.max(Observation.seq)).where(
        Observation.device_id == device.id, Observation.boot_id == data.boot_id,
    ))
    try:
        with db.begin_nested():
            db.add(Observation(
                device_id=device.id, space_id=device.space_id, boot_id=data.boot_id, seq=data.seq, kind=data.kind,
                presence=data.presence, target=data.target, observed_at=data.ts or now, received_at=now,
                clock_synced=data.ts is not None, source=data.source,
            ))
    except IntegrityError:  # a concurrent copy of this event was stored first
        if (previous := _previous(db, data)) is None:
            raise
        return _replay(db, data, previous, now)
    if newest is None or data.seq > newest:
        occupancy.apply_observation(db, device.space_id, data.presence, now)
    absence.evaluate_space(db, device.space_id, now)
    return {"accepted": True, "code": None, "state": state_payload(db, device, now)}
