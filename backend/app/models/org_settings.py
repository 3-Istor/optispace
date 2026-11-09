from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OrgSettings(Base):
    """Settings of one company; no row means the defaults of `app.services.settings`."""

    __tablename__ = "org_settings"

    organization: Mapped[str] = mapped_column(primary_key=True)
    absence_delay_min: Mapped[int] = mapped_column(default=10)
    booth_min_min: Mapped[int] = mapped_column(default=15)
    booth_max_min: Mapped[int] = mapped_column(default=60)
    meeting_min_min: Mapped[int] = mapped_column(default=30)
    meeting_max_min: Mapped[int] = mapped_column(default=180)
