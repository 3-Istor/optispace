"""Availability alerts after an empty search (spec §4.3)."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import AppUser, AvailabilityAlert, Space
from app.models.enums import AlertStatus, NotificationType, SpaceType
from app.services.notifications import iso, notify


def _expire(db: Session, now: datetime) -> None:
    """Alerts end at end_at; done lazily, there is no background job."""
    db.execute(update(AvailabilityAlert).where(
        AvailabilityAlert.status == AlertStatus.ACTIVE, AvailabilityAlert.end_at <= now,
    ).values(status=AlertStatus.EXPIRED))


def create(
    db: Session, user: AppUser, start_at: datetime, end_at: datetime, space_type: SpaceType, min_capacity: int, now: datetime,
) -> AvailabilityAlert:
    if end_at <= start_at or end_at <= now:
        raise DomainError(422, "INVALID_SLOT")
    alert = AvailabilityAlert(user_id=user.id, start_at=start_at, end_at=end_at, space_type=space_type, min_capacity=min_capacity)
    db.add(alert)
    db.flush()
    return alert


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


def on_freed(db: Session, space: Space, start_at: datetime, end_at: datetime, now: datetime) -> None:
    """SPACE_AVAILABLE to every active alert the freed [start_at, end_at[ matches, for the overlapping part.
    The alert stays active: the notification books nothing."""
    if not space.is_active or start_at >= end_at:
        return
    _expire(db, now)
    matching = db.scalars(select(AvailabilityAlert).where(
        AvailabilityAlert.status == AlertStatus.ACTIVE,
        AvailabilityAlert.space_type == space.type,
        AvailabilityAlert.min_capacity <= space.capacity,
        AvailabilityAlert.start_at < end_at,
        AvailabilityAlert.end_at > start_at,
    )).all()
    for alert in matching:
        notify(
            db, db.get(AppUser, alert.user_id), NotificationType.SPACE_AVAILABLE, space_id=space.id,
            space_name=space.name, space_type=space.type.value,
            start_at=iso(max(start_at, alert.start_at)), end_at=iso(min(end_at, alert.end_at)),
        )


def close_for_user(db: Session, user_id: UUID, start_at: datetime, end_at: datetime) -> None:
    """The user booked something overlapping the alert's slot: the alert is fulfilled."""
    db.execute(update(AvailabilityAlert).where(
        AvailabilityAlert.user_id == user_id,
        AvailabilityAlert.status == AlertStatus.ACTIVE,
        AvailabilityAlert.start_at < end_at,
        AvailabilityAlert.end_at > start_at,
    ).values(status=AlertStatus.FULFILLED))
