import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import EpisodeKind, EpisodeOutcome

PENDING = text("outcome = 'pending'")


class AbsenceEpisode(Base):
    __tablename__ = "absence_episode"
    __table_args__ = (
        # At most one pending episode per reservation.
        Index(
            "uq_absence_episode_pending", "reservation_id", unique=True,
            postgresql_where=PENDING, sqlite_where=PENDING,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservation.id"))
    kind: Mapped[EpisodeKind]
    opened_at: Mapped[datetime]
    deadline_at: Mapped[datetime]  # fixed at opening: a later change of D does not move it
    outcome: Mapped[EpisodeOutcome] = mapped_column(default=EpisodeOutcome.PENDING)
    closed_at: Mapped[datetime | None]
