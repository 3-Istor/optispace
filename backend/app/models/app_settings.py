from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSettings(Base):
    """Legacy global settings, read only by the previous release during the rollout; superseded by OrgSettings."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False, default=1)
    absence_delay_min: Mapped[int] = mapped_column(default=10)
    booth_min_min: Mapped[int] = mapped_column(default=15)
    booth_max_min: Mapped[int] = mapped_column(default=60)
    meeting_min_min: Mapped[int] = mapped_column(default=30)
    meeting_max_min: Mapped[int] = mapped_column(default=180)
