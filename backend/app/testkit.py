"""Builders shared by the test modules. Times are Europe/Paris, like the spec examples:
`at("10:00")` is 2026-11-02 10:00 Paris, the conftest frozen clock (09:00 UTC)."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models import AppUser, Device, Observation, Reservation, Space
from app.models.enums import ObservationKind, Presence, SealState, Source, SpaceType
from app.services import absence, occupancy

PARIS = ZoneInfo("Europe/Paris")
SEC = timedelta(seconds=1)
MIN = timedelta(minutes=1)


def at(hhmm: str, day: int = 2) -> datetime:
    return datetime(2026, 11, day, *map(int, hhmm.split(":")), tzinfo=PARIS)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_user(db, sub="u2", **fields) -> AppUser:
    user = AppUser(keycloak_sub=sub, **fields)
    db.add(user)
    db.commit()
    return user


def make_space(db, name="Bulle 1", type=SpaceType.INDIVIDUAL_BOOTH, capacity=1, device=True, **fields) -> Space:
    """With an unsealed device unless `device=False`."""
    space = Space(name=name, type=type, capacity=capacity, **fields)
    db.add(space)
    db.flush()
    if device:
        db.add(Device(id=f"esp32-{space.id.hex[:12].upper()}", space_id=space.id, seal=SealState.UNSEALED))
    db.commit()
    return space


def book(db, space, start_at, end_at, user=None, **fields) -> Reservation:
    """Inserted as is, without the booking rules."""
    user = user or make_user(db, f"booker-{start_at.isoformat()}-{space.name}")
    reservation = Reservation(space_id=space.id, user_id=user.id, start_at=start_at, end_at=end_at, **fields)
    db.add(reservation)
    db.commit()
    return reservation


def observe(db, space, presence: Presence, when: datetime) -> None:
    """One telemetry message, handled like the telemetry route: store, apply, evaluate."""
    device_id = f"esp32-{space.id.hex[:12].upper()}"
    db.add(Observation(
        device_id=device_id, space_id=space.id, boot_id="boot", seq=int(when.timestamp()),
        kind=ObservationKind.HEARTBEAT, presence=presence, target=None, observed_at=when, received_at=when,
        clock_synced=True, source=Source.SIMULATED,
    ))
    occupancy.apply_observation(db, space.id, presence, when)
    absence.evaluate_space(db, space.id, when)
    db.commit()


def heartbeats(db, space, presence: Presence, start: datetime, end: datetime) -> None:
    """One message every 10 s from `start` to `end` included."""
    when = start
    while when <= end:
        observe(db, space, presence, when)
        when += 10 * SEC
