"""In-app notifications and Web Push (spec §10)."""
from sqlalchemy.orm import Session

from app.models import AppUser, Notification
from app.models.enums import NotificationType


def notify(db: Session, user: AppUser, type: NotificationType, **params) -> Notification:
    """Row if `notify_in_app`, push if `notify_push`; a push failure is logged, never raised."""
    raise NotImplementedError
