import uuid
from datetime import datetime

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app import clock
from app.database import Base
from app.models.enums import SealState


class Device(Base):
    """No `online` column: a device is online while `last_seen_at > now - 30 s`."""

    __tablename__ = "device"

    id: Mapped[str] = mapped_column(primary_key=True)  # "esp32-" + MAC, upper case, no separator
    space_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("space.id"), unique=True)
    seal: Mapped[SealState] = mapped_column(default=SealState.SEALED)
    firmware_version: Mapped[str | None]
    first_seen_at: Mapped[datetime] = mapped_column(default=lambda: clock.now())
    last_seen_at: Mapped[datetime] = mapped_column(default=lambda: clock.now())
    # DEVICE_OFFLINE was sent for the current silence when this is after last_seen_at.
    offline_notified_at: Mapped[datetime | None]
