"""Only eligible facts and a next step may be selected for a room summary."""
from pydantic import BaseModel, ConfigDict, Field


class FactSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fact_ids: list[str] = Field(min_length=1, max_length=3)
    recommendation_id: str
