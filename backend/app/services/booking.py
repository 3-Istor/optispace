"""Reservations: slot rules, conflicts and availability (spec §4.1)."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, Reservation, Space
from app.models.enums import ReservationStatus, SpaceType


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


def create(db: Session, user: AppUser, space_id: UUID, start_at: datetime, end_at: datetime, now: datetime) -> Reservation:
    raise NotImplementedError


def modify(
    db: Session, user: AppUser, reservation_id: UUID, space_id: UUID, start_at: datetime, end_at: datetime, now: datetime,
) -> Reservation:
    raise NotImplementedError


def cancel(db: Session, user: AppUser, reservation_id: UUID, now: datetime) -> None:
    raise NotImplementedError


def free_spaces(
    db: Session,
    start_at: datetime,
    end_at: datetime,
    space_type: SpaceType | None,
    min_capacity: int | None,
    floor: int | None,
    equipment: list[str] | None,
    now: datetime,
) -> list[Space]:
    raise NotImplementedError
