import uuid
from datetime import datetime

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app import clock
from app.database import Base
from app.models.enums import ReservationStatus


class Reservation(Base):
    """On PostgreSQL, the exclusion constraint `reservation_no_overlap` (migration
    0002) forbids overlapping [start_at, released_at or end_at) per space, cancelled
    rows excepted. SQLite has no equivalent: the booking service checks first."""

    __tablename__ = "reservation"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("space.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    start_at: Mapped[datetime]
    end_at: Mapped[datetime]  # kept as booked when the reservation is released
    status: Mapped[ReservationStatus] = mapped_column(default=ReservationStatus.ACTIVE)
    released_at: Mapped[datetime | None]
    cancelled_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=lambda: clock.now())
