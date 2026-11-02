from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Profile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str | None
    display_name: str | None
    phone: str | None
    notify_push: bool
    notify_in_app: bool
    alert_device_offline: bool
    alert_device_sealed: bool


class MeOut(Profile):
    role: Literal["employee", "facility_manager"]


class MePatch(BaseModel):
    """Fields left out or null are unchanged; send "" to clear the phone."""

    model_config = ConfigDict(extra="forbid")

    phone: str | None = Field(default=None, max_length=32)
    notify_push: bool | None = None
    notify_in_app: bool | None = None
    alert_device_offline: bool | None = None
    alert_device_sealed: bool | None = None
