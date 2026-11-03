import uuid
from datetime import datetime

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app import clock
from app.database import Base
from app.models.enums import AlertStatus, SpaceType


class AvailabilityAlert(Base):
    __tablename__ = "availability_alert"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    start_at: Mapped[datetime]
    end_at: Mapped[datetime]
    space_type: Mapped[SpaceType]
    min_capacity: Mapped[int] = mapped_column(default=1)
    floor: Mapped[int | None]  # None = any floor
    equipment: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    status: Mapped[AlertStatus] = mapped_column(default=AlertStatus.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(default=lambda: clock.now())
