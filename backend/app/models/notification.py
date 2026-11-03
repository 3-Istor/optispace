import uuid
from datetime import datetime

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app import clock
from app.database import Base
from app.models.enums import NotificationType


class Notification(Base):
    __tablename__ = "notification"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    type: Mapped[NotificationType]
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reservation.id"))
    space_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("space.id"))
    params: Mapped[dict] = mapped_column(JSON, default=dict)  # placeholders of the text
    created_at: Mapped[datetime] = mapped_column(default=lambda: clock.now())
    read_at: Mapped[datetime | None]
