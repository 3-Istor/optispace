import datetime as dt
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EpisodeKind, EpisodeOutcome, Presence, ReservationStatus, SpaceState, SpaceType


class CurrentReservation(BaseModel):
    id: UUID
    start_at: dt.datetime
    end_at: dt.datetime
    release_at: dt.datetime | None  # deadline of the pending absence episode
    booker_name: str | None  # facility managers only


class StaffSpaceOut(BaseModel):
    id: UUID
    name: str
    type: SpaceType
    floor: int
    is_active: bool
    organization: str
    device_id: str | None


class SpaceOut(BaseModel):
    id: UUID
    name: str
    type: SpaceType
    description: str
    capacity: int
    floor: int
    equipment: list[str]
    is_active: bool
    min_duration_min: int  # effective: the space's override or its type's default
    max_duration_min: int
    min_duration_override: int | None  # facility managers only; null = the type's default
    max_duration_override: int | None
    space_state: SpaceState
    occupancy_fresh_at: dt.datetime | None  # last observation
    current_reservation: CurrentReservation | None


class DayReservation(BaseModel):
    id: UUID
    start_at: dt.datetime
    end_at: dt.datetime
    status: ReservationStatus
    released_at: dt.datetime | None
    mine: bool
    booker_name: str | None  # facility managers only


class SpaceDetail(SpaceOut):
    date: dt.date
    reservations: list[DayReservation]


class SpaceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    type: SpaceType
    description: str = ""
    capacity: int = Field(ge=1)
    floor: int = 0
    equipment: list[str] = []
    min_duration_min: int | None = Field(default=None, ge=1)  # null = the type's default
    max_duration_min: int | None = Field(default=None, ge=1)
    is_active: bool = True


class SpacePatch(BaseModel):
    """Only the fields sent change. Defaults are not validated, so an explicit null is refused
    for the non-nullable fields and resets the durations to the type's default."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default=None, min_length=1, max_length=100)
    type: SpaceType = None
    description: str = None
    capacity: int = Field(default=None, ge=1)
    floor: int = None
    equipment: list[str] = None
    min_duration_min: int | None = Field(default=None, ge=1)
    max_duration_min: int | None = Field(default=None, ge=1)
    is_active: bool = None


class ObservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    observed_at: dt.datetime
    presence: Presence


class HistoryReservation(BaseModel):
    id: UUID
    start_at: dt.datetime
    end_at: dt.datetime
    status: ReservationStatus
    released_at: dt.datetime | None
    booker_name: str | None


class EpisodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reservation_id: UUID
    kind: EpisodeKind
    opened_at: dt.datetime
    deadline_at: dt.datetime
    outcome: EpisodeOutcome
    closed_at: dt.datetime | None


class History(BaseModel):
    observations: list[ObservationOut]
    reservations: list[HistoryReservation]
    episodes: list[EpisodeOut]

