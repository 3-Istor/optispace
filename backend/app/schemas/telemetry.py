from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field

from app.models.enums import ObservationKind, Presence, Source, Target
from app.schemas.devices import DeviceState

SCHEMA = "optispace.telemetry/1"


class TelemetryIn(BaseModel):
    """Body of POST /telemetry (spec §7); unknown extra fields are ignored."""

    schema_: Literal[SCHEMA] = Field(alias="schema")
    device_id: str = Field(pattern=r"^esp32-[0-9A-F]{12}$")
    boot_id: str = Field(min_length=1, max_length=64)
    seq: int = Field(ge=0, le=2**63 - 1)  # BIGINT column
    kind: ObservationKind
    presence: Presence
    target: Target | None = None
    ts: AwareDatetime | None = None  # null: device clock not synced
    firmware_version: str = Field(max_length=64)
    source: Source


class TelemetryOut(BaseModel):
    accepted: bool
    code: str | None
    state: DeviceState
