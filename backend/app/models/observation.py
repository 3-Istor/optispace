import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import ObservationKind, Presence, Source, Target


class Observation(Base):
    __tablename__ = "observation"
    __table_args__ = (
        # Replay key of the telemetry contract.
        UniqueConstraint("device_id", "boot_id", "seq"),
        Index("ix_observation_space_id_observed_at", "space_id", "observed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    device_id: Mapped[str] = mapped_column(ForeignKey("device.id"))
    space_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("space.id"))
    boot_id: Mapped[str]
    seq: Mapped[int] = mapped_column(BigInteger)
    kind: Mapped[ObservationKind]
    presence: Mapped[Presence]
    target: Mapped[Target | None]
    observed_at: Mapped[datetime]  # device `ts`, or received_at when the clock is not synced
    received_at: Mapped[datetime]
    clock_synced: Mapped[bool]
    source: Mapped[Source]
