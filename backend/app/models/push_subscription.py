import uuid
from datetime import datetime

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app import clock
from app.database import Base


class PushSubscription(Base):
    __tablename__ = "push_subscription"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    endpoint: Mapped[str] = mapped_column(unique=True)
    p256dh: Mapped[str]
    auth: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(default=lambda: clock.now())
