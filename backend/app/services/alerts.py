"""Availability alerts after an empty search (spec §4.3)."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import AppUser, AvailabilityAlert, Space
from app.models.enums import AlertStatus, NotificationType, SpaceType
from app.services import booking
from app.services.notifications import iso, notify


def _expire(db: Session, now: datetime) -> None:
    """Alerts end at end_at; done lazily, there is no background job."""
    db.execute(update(AvailabilityAlert).where(
        AvailabilityAlert.status == AlertStatus.ACTIVE, AvailabilityAlert.end_at <= now,
    ).values(status=AlertStatus.EXPIRED))


def create(
    db: Session, user: AppUser, now: datetime, start_at: datetime, end_at: datetime, space_type: SpaceType,
    min_capacity: int, floor: int | None, equipment: list[str],
) -> tuple[AvailabilityAlert, bool]:
    """(alert, created): the user's active alert with the same criteria is returned instead of a copy."""
    boundary = now.replace(minute=now.minute - now.minute % 5, second=0, microsecond=0)
    if start_at < boundary or end_at <= start_at or end_at <= now:
        raise DomainError(422, "INVALID_SLOT")
    for alert in db.scalars(select(AvailabilityAlert).where(
        AvailabilityAlert.user_id == user.id, AvailabilityAlert.status == AlertStatus.ACTIVE,
        AvailabilityAlert.start_at == start_at, AvailabilityAlert.end_at == end_at,
        AvailabilityAlert.space_type == space_type, AvailabilityAlert.min_capacity == min_capacity,
        AvailabilityAlert.floor == floor,  # None compiles to IS NULL
    )):
        if set(alert.equipment) == set(equipment):
            return alert, False
    alert = AvailabilityAlert(
        user_id=user.id, start_at=start_at, end_at=end_at, space_type=space_type, min_capacity=min_capacity,
        floor=floor, equipment=equipment,
    )
    db.add(alert)
    db.flush()
    return alert, True


def mine(db: Session, user: AppUser, now: datetime) -> list[AvailabilityAlert]:
    _expire(db, now)
    return list(db.scalars(select(AvailabilityAlert).where(
        AvailabilityAlert.user_id == user.id, AvailabilityAlert.status == AlertStatus.ACTIVE,
    ).order_by(AvailabilityAlert.start_at)))


def cancel(db: Session, user: AppUser, alert_id: UUID) -> None:
    alert = db.get(AvailabilityAlert, alert_id)
    if alert is None:
        raise DomainError(404, "ALERT_NOT_FOUND")
    if alert.user_id != user.id:
        raise DomainError(403, "NOT_OWNER")
    alert.status = AlertStatus.CANCELLED


def _matches(alert: AvailabilityAlert, space) -> bool:
    """The search criteria of `booking.find_spaces`; `space` may be a snapshot with the same fields."""
    return (
        space.type == alert.space_type and space.capacity >= alert.min_capacity
        and alert.floor in (None, space.floor) and set(alert.equipment) <= set(space.equipment)
    )


def _notify(db: Session, alert: AvailabilityAlert, space: Space, start_at: datetime, end_at: datetime) -> None:
    notify(
        db, db.get(AppUser, alert.user_id), NotificationType.SPACE_AVAILABLE, space_id=space.id,
        space_name=space.name, space_type=space.type.value, start_at=iso(start_at), end_at=iso(end_at),
    )


def on_freed(db: Session, space: Space, start_at: datetime, end_at: datetime, now: datetime) -> None:
    """SPACE_AVAILABLE to every active alert the freed [start_at, end_at[ matches, for the overlapping part.
    The alert stays active: the notification books nothing."""
    if not space.is_active or start_at >= end_at:
        return
    _expire(db, now)
    overlapping = db.scalars(select(AvailabilityAlert).join(AppUser, AppUser.id == AvailabilityAlert.user_id).where(
        AppUser.organization == space.organization,
        AvailabilityAlert.status == AlertStatus.ACTIVE,
        AvailabilityAlert.start_at < end_at,
        AvailabilityAlert.end_at > start_at,
    ).order_by(AvailabilityAlert.start_at)).all()
    notified = set()  # one notification per user and space: repeated searches must not spam
    for alert in overlapping:
        if _matches(alert, space) and alert.user_id not in notified:
            notified.add(alert.user_id)
            _notify(db, alert, space, max(start_at, alert.start_at), min(end_at, alert.end_at))


def on_space_available(db: Session, space: Space, now: datetime, before=None) -> None:
    """`space` was created, or changed from the snapshot `before`: SPACE_AVAILABLE to every active alert
    it now matches (and did not before), when nothing is booked on what is left of the alert's slot."""
    if not space.is_active:
        return
    _expire(db, now)
    notified = set()  # one notification per user and space, the earliest free slot
    for alert in db.scalars(select(AvailabilityAlert).join(AppUser, AppUser.id == AvailabilityAlert.user_id).where(
        AppUser.organization == space.organization,
        AvailabilityAlert.status == AlertStatus.ACTIVE).order_by(AvailabilityAlert.start_at)).all():
        if alert.user_id in notified or not _matches(alert, space) or (before and before.is_active and _matches(alert, before)):
            continue
        start_at = max(now, alert.start_at)
        if not booking._overlaps(db, space.id, start_at, alert.end_at):
            notified.add(alert.user_id)
            _notify(db, alert, space, start_at, alert.end_at)


def close_for_user(db: Session, user_id: UUID, start_at: datetime, end_at: datetime) -> None:
    """The user booked something overlapping the alert's slot: the alert is fulfilled."""
    db.execute(update(AvailabilityAlert).where(
        AvailabilityAlert.user_id == user_id,
        AvailabilityAlert.status == AlertStatus.ACTIVE,
        AvailabilityAlert.start_at < end_at,
        AvailabilityAlert.end_at > start_at,
    ).values(status=AlertStatus.FULFILLED))
