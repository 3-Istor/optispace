import uuid
from datetime import datetime

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import Presence


class SpaceStatus(Base):
    """Last known occupancy of a space, written by occupancy.apply_observation."""

    __tablename__ = "space_status"

    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("space.id"), primary_key=True)
    occupancy: Mapped[Presence]
    # Start of the current run of `occupancy`; a data gap starts a new run.
    occupancy_since: Mapped[datetime]
    last_observation_at: Mapped[datetime]
