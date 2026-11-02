from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.enums import NotificationType


class NotificationOut(BaseModel):
    """The text is built by the client from `type` and `params` (spec §10)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: NotificationType
    params: dict
    created_at: datetime
    read_at: datetime | None


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    """The browser's `PushSubscription.toJSON()`."""

    endpoint: str
    expirationTime: float | None = None
    keys: PushKeys


class PushSubscriptionDelete(BaseModel):
    endpoint: str
