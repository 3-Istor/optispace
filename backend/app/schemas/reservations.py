from datetime import datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.models.enums import AlertStatus, ReservationStatus, SpaceType


class ReservationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    space_id: UUID
    start_at: AwareDatetime
    end_at: AwareDatetime


class ReservationPatch(BaseModel):
    """Fields left out keep their value; once started, only `end_at` may change."""

    model_config = ConfigDict(extra="forbid")

    space_id: UUID | None = None
    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None


class ReservationOut(BaseModel):
    id: UUID
    space_id: UUID
    space_name: str
    start_at: datetime
    end_at: datetime  # as booked, also once released
    status: ReservationStatus
    released_at: datetime | None
    release_at: datetime | None  # deadline of the pending absence episode


class AlertIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_at: AwareDatetime
    end_at: AwareDatetime
    space_type: SpaceType
    min_capacity: int = Field(default=1, ge=1)
    floor: int | None = None  # null = any floor
    equipment: list[str] = []  # the space has every item


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    space_type: SpaceType
    min_capacity: int
    floor: int | None
    equipment: list[str]
    start_at: datetime
    end_at: datetime
    status: AlertStatus
