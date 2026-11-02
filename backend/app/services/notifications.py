"""In-app notifications and Web Push (spec §10)."""
from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AppUser, Notification, PushSubscription
from app.models.enums import NotificationType
from app.services import webpush

PARIS = ZoneInfo("Europe/Paris")

# Exact texts of spec §10. Params: space_name, and `at` or start_at/end_at as UTC ISO strings.
TEXTS = {
    NotificationType.ABSENCE_WARNING: "Personne n'est détecté dans {space_name}. Sans présence, la réservation sera libérée à {at}.",
    NotificationType.RELEASED: "Votre réservation de {space_name} a été libérée à {at}.",
    NotificationType.SPACE_AVAILABLE: "{space_name} est disponible de {start_at} à {end_at}.",
    NotificationType.DEVICE_OFFLINE: "Le boîtier de {space_name} est hors ligne depuis {at}.",
    NotificationType.DEVICE_SEALED: "Le boîtier de {space_name} a été rescellé.",
}
TIMES = ("at", "start_at", "end_at")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def hhmm(dt: datetime | str) -> str:
    """Paris wall-clock time, as in every text shown to people."""
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    return dt.astimezone(PARIS).strftime("%H:%M")


def render(type: NotificationType, params: dict) -> str:
    return TEXTS[type].format(**{k: hhmm(v) if k in TIMES else v for k, v in params.items()})


def _url(type: NotificationType, params: dict) -> str:
    if type in (NotificationType.DEVICE_OFFLINE, NotificationType.DEVICE_SEALED):
        return "/admin/devices"
    if type == NotificationType.SPACE_AVAILABLE:
        return "/?" + urlencode({"type": params["space_type"], "start_at": params["start_at"], "end_at": params["end_at"]})
    return "/reservations"


def notify(
    db: Session, user: AppUser, type: NotificationType,
    reservation_id: UUID | None = None, space_id: UUID | None = None, **params,
) -> Notification | None:
    """Row if `notify_in_app` (else None), push if `notify_push`; a push failure is logged, never raised."""
    row = None
    if user.notify_in_app:
        row = Notification(user_id=user.id, type=type, reservation_id=reservation_id, space_id=space_id, params=params)
        db.add(row)
        db.flush()
    settings = get_settings()
    if user.notify_push and settings.vapid_public_key and settings.vapid_private_key:
        payload = {"title": "OptiSpace", "body": render(type, params), "url": _url(type, params)}
        # ponytail: pushes inside the request (5 s timeout each); a queue if latency matters
        for subscription in db.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id)).all():
            if not webpush.send(subscription, payload):
                db.delete(subscription)
    return row
