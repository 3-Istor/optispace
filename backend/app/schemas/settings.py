from pydantic import BaseModel, ConfigDict


class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    absence_delay_min: int
    booth_min_min: int
    booth_max_min: int
    meeting_min_min: int
    meeting_max_min: int


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    absence_delay_min: int | None = None
    booth_min_min: int | None = None
    booth_max_min: int | None = None
    meeting_min_min: int | None = None
    meeting_max_min: int | None = None
