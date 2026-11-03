from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StrictBool

from app.models.enums import SealState, SpaceState


class Slot(BaseModel):
    start_at: datetime
    end_at: datetime


class DeviceState(BaseModel):
    """The `state` object of the telemetry response (spec §7)."""

    seal: SealState
    space_state: SpaceState
    space_name: str | None
    reservation: Slot | None
    release_at: datetime | None  # deadline of the pending absence episode
    updated_at: datetime


class SpaceRef(BaseModel):
    id: UUID
    name: str


class DeviceOut(BaseModel):
    id: str
    space: SpaceRef | None
    seal: SealState
    online: bool
    firmware_version: str | None
    first_seen_at: datetime
    last_seen_at: datetime


class DeviceDetail(DeviceOut):
    state: DeviceState


class DevicePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    space_id: UUID | None  # required: null unassigns


class UnsealIn(BaseModel):
    confirm: StrictBool = False
