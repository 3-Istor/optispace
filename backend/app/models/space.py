import uuid

from sqlalchemy import JSON, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import SpaceType


class Space(Base):
    __tablename__ = "space"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization: Mapped[str]  # Keycloak organization alias; no default, the caller must set it
    name: Mapped[str]
    type: Mapped[SpaceType]
    description: Mapped[str] = mapped_column(default="")
    capacity: Mapped[int]
    floor: Mapped[int] = mapped_column(default=0)  # 0 = ground floor
    equipment: Mapped[list[str]] = mapped_column(JSON, default=list)
    # None = the type's default from OrgSettings.
    min_duration_min: Mapped[int | None]
    max_duration_min: Mapped[int | None]
    is_active: Mapped[bool] = mapped_column(default=True)

    __table_args__ = (Index("uq_space_organization_name", "organization", "name", unique=True),)
