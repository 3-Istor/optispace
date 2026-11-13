from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.errors import DomainError
from app.models.enums import NotificationType

# Web Push services of Chrome, Firefox, Safari and Edge; their subdomains too.
PUSH_SERVICES = (
    "fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com",
    "push.services.mozilla.com", "web.push.apple.com", "notify.windows.com",
)


class NotificationOut(BaseModel):
    """The text is built by the client from `type` and `params` (spec §10)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: NotificationType
    params: dict
    created_at: datetime
    read_at: datetime | None
    reservation_id: UUID | None  # ABSENCE_WARNING and RELEASED: what "Libérer" cancels


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    """The browser's `PushSubscription.toJSON()`."""

    endpoint: str
    expirationTime: float | None = None
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def _known_push_service(cls, endpoint: str) -> str:
        # The backend POSTs to this URL: anything else would let a user make it call internal hosts.
        url = urlsplit(endpoint)
        host = url.hostname or ""
        if url.scheme != "https" or not any(host == s or host.endswith("." + s) for s in PUSH_SERVICES):
            raise DomainError(422, "INVALID_PUSH_ENDPOINT")  # not ValueError: the body stays {"detail": CODE}
        return endpoint


class PushSubscriptionDelete(BaseModel):
    endpoint: str
