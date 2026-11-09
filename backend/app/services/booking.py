"""Reservations: slot rules, conflicts and availability (spec §4.1)."""
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import AbsenceEpisode, AppSettings, AppUser, Reservation, Space
from app.models.enums import EpisodeOutcome, ReservationStatus, SpaceType
from app.services import alerts

STEP = timedelta(minutes=5)
MINUTE = timedelta(minutes=1)


def effective_end(r: Reservation) -> datetime:
    """`released_at` once released, else `end_at`, as in the exclusion constraint."""
    return r.released_at or r.end_at


def current_reservation(db: Session, space_id: UUID, now: datetime) -> Reservation | None:
    """The active reservation whose [start_at, end_at[ holds `now`; a released one is over."""
    return db.scalar(
        select(Reservation).where(
            Reservation.space_id == space_id,
            Reservation.status == ReservationStatus.ACTIVE,
            Reservation.start_at <= now,
            Reservation.end_at > now,
        )
    )


def pending_episode(db: Session, reservation_id: UUID) -> AbsenceEpisode | None:
    """Its `deadline_at` is the `release_at` shown to people and devices."""
    return db.scalar(select(AbsenceEpisode).where(
        AbsenceEpisode.reservation_id == reservation_id, AbsenceEpisode.outcome == EpisodeOutcome.PENDING,
    ))


def duration_bounds(db: Session, space: Space) -> tuple[int, int]:
    """Effective (min, max) minutes: the space's override, else its type's default."""
    s = db.get(AppSettings, 1)
    lo, hi = (s.meeting_min_min, s.meeting_max_min) if space.type == SpaceType.MEETING_ROOM else (s.booth_min_min, s.booth_max_min)
    return (
        lo if space.min_duration_min is None else space.min_duration_min,
        hi if space.max_duration_min is None else space.max_duration_min,
    )


def _aligned(t: datetime) -> bool:
    return t.minute % 5 == 0 and t.second == 0 and t.microsecond == 0


def _next_boundary(now: datetime) -> datetime:
    """`now` itself when it is on a 5-min boundary."""
    floor = now.replace(minute=now.minute - now.minute % 5, second=0, microsecond=0)
    return floor if floor == now else floor + STEP


def valid_new_slot(start_at: datetime, end_at: datetime, now: datetime) -> bool:
    return _aligned(start_at) and _aligned(end_at) and start_at >= _next_boundary(now) and end_at > start_at


def _fits(db: Session, space: Space, start_at: datetime, end_at: datetime) -> bool:
    lo, hi = duration_bounds(db, space)
    return lo <= (end_at - start_at) / MINUTE <= hi


def _overlaps(db: Session, space_id: UUID, start_at: datetime, end_at: datetime, exclude: UUID | None = None) -> bool:
    """Same rule as `reservation_no_overlap`; SQLite has no such constraint, PostgreSQL still has the last word."""
    conditions = [
        Reservation.space_id == space_id,
        Reservation.status != ReservationStatus.CANCELLED,
        Reservation.start_at < end_at,
        func.coalesce(Reservation.released_at, Reservation.end_at) > start_at,
    ]
    if exclude is not None:
        conditions.append(Reservation.id != exclude)
    return db.scalar(select(exists().where(*conditions)))


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as error:
        if "reservation_no_overlap" not in str(error.orig):
            raise
        db.rollback()
        raise DomainError(409, "RESERVATION_CONFLICT")


def space_in(db: Session, space_id: UUID, organization: str) -> Space:
    """404 for a space of another company, as if it did not exist."""
    space = db.get(Space, space_id)
    if space is None or space.organization != organization:
        raise DomainError(404, "SPACE_NOT_FOUND")
    return space


def _own(db: Session, user: AppUser, reservation_id: UUID, now: datetime) -> Reservation:
    # Row lock: serializes with absence.evaluate_space on the same reservation.
    r = db.get(Reservation, reservation_id, with_for_update=True)
    if r is None:
        raise DomainError(404, "RESERVATION_NOT_FOUND")
    if r.user_id != user.id:
        raise DomainError(403, "NOT_OWNER")
    if r.status != ReservationStatus.ACTIVE or now >= effective_end(r):
        raise DomainError(409, "RESERVATION_ENDED")
    return r


def _close_episode(db: Session, reservation_id: UUID, now: datetime, unless_before: datetime | None = None) -> None:
    """Close the pending episode as cancelled, or only if its deadline is not before `unless_before`."""
    episode = pending_episode(db, reservation_id)
    if episode and (unless_before is None or episode.deadline_at >= unless_before):
        episode.outcome, episode.closed_at = EpisodeOutcome.CANCELLED, now


def create(db: Session, user: AppUser, space_id: UUID, start_at: datetime, end_at: datetime, now: datetime) -> Reservation:
    space = space_in(db, space_id, user.organization)
    if not (space.is_active and valid_new_slot(start_at, end_at, now) and _fits(db, space, start_at, end_at)):
        raise DomainError(422, "INVALID_SLOT")
    if _overlaps(db, space_id, start_at, end_at):
        raise DomainError(409, "RESERVATION_CONFLICT")
    r = Reservation(space_id=space_id, user_id=user.id, start_at=start_at, end_at=end_at)
    db.add(r)
    _flush(db)
    alerts.close_for_user(db, user.id, start_at, end_at)
    return r


def modify(
    db: Session, user: AppUser, reservation_id: UUID,
    space_id: UUID | None, start_at: datetime | None, end_at: datetime | None, now: datetime,
) -> Reservation:
    """None keeps the current value. Once started, only the end moves (on a 5-min boundary, after now, within the max)."""
    r = _own(db, user, reservation_id, now)
    space_id, start_at, end_at = space_id or r.space_id, start_at or r.start_at, end_at or r.end_at
    space = space_in(db, space_id, user.organization)
    if r.start_at <= now:
        _, hi = duration_bounds(db, space)
        valid = (space_id, start_at) == (r.space_id, r.start_at) and _aligned(end_at) and end_at > now \
            and (end_at - start_at) / MINUTE <= hi
    else:
        valid = space.is_active and valid_new_slot(start_at, end_at, now) and _fits(db, space, start_at, end_at)
    if not valid:
        raise DomainError(422, "INVALID_SLOT")
    if _overlaps(db, space_id, start_at, end_at, exclude=r.id):
        raise DomainError(409, "RESERVATION_CONFLICT")
    old_space, old_start, old_end = db.get(Space, r.space_id), max(now, r.start_at), r.end_at
    r.space_id, r.start_at, r.end_at = space_id, start_at, end_at
    _flush(db)
    # The episode keeps its deadline; one that falls at or after the new end closes without release.
    _close_episode(db, r.id, now, unless_before=end_at)
    if old_space.id != space_id:
        alerts.on_freed(db, old_space, old_start, old_end, now)
    else:
        alerts.on_freed(db, space, old_start, min(old_end, start_at), now)
        alerts.on_freed(db, space, max(old_start, end_at), old_end, now)
    return r


def cancel(db: Session, user: AppUser, reservation_id: UUID, now: datetime) -> None:
    r = _own(db, user, reservation_id, now)
    r.status, r.cancelled_at = ReservationStatus.CANCELLED, now
    _close_episode(db, r.id, now)
    db.flush()
    alerts.on_freed(db, db.get(Space, r.space_id), max(now, r.start_at), r.end_at, now)


def find_spaces(
    db: Session, organization: str, space_type: SpaceType | None, min_capacity: int | None, floor: int | None,
    equipment: list[str] | None, active_only: bool = True,
) -> list[Space]:
    query = select(Space).where(Space.organization == organization).order_by(Space.name)
    if active_only:
        query = query.where(Space.is_active)
    if space_type is not None:
        query = query.where(Space.type == space_type)
    if min_capacity is not None:
        query = query.where(Space.capacity >= min_capacity)
    if floor is not None:
        query = query.where(Space.floor == floor)
    # JSON containment differs between SQLite and PostgreSQL; the list of spaces is short.
    return [s for s in db.scalars(query) if set(equipment or ()) <= set(s.equipment)]


def free_spaces(
    db: Session,
    organization: str,
    start_at: datetime,
    end_at: datetime,
    space_type: SpaceType | None,
    min_capacity: int | None,
    floor: int | None,
    equipment: list[str] | None,
    now: datetime,
) -> list[Space]:
    """Active spaces matching the criteria, whose durations allow the slot, with nothing booked on it."""
    if not valid_new_slot(start_at, end_at, now):
        raise DomainError(422, "INVALID_SLOT")
    return [
        s for s in find_spaces(db, organization, space_type, min_capacity, floor, equipment)
        if _fits(db, s, start_at, end_at) and not _overlaps(db, s.id, start_at, end_at)
    ]
