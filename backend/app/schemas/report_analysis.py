"""Bounded model-authored prose; measured values remain in server-owned evidence."""
import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints


def qualitative_text(value: str) -> str:
    # This is a format guard, not a semantic fact checker. Human review remains necessary.
    if re.search(r"[\d%€$<>]|https?://|www\.|[\x00-\x08\x0b-\x1f]", value):
        raise ValueError("Use plain qualitative prose; measured figures are rendered from source evidence")
    return value


Prose = Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=600),
                  AfterValidator(qualitative_text)]
Step = Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=260),
                 AfterValidator(qualitative_text)]


class ActionAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action_id: str
    rationale: Prose
    steps: list[Step] = Field(min_length=1, max_length=2)
    check: Step


class ReportAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overview: Prose
    evidence_action_ids: list[str] = Field(min_length=1, max_length=3)
    recommendations: list[ActionAnalysis] = Field(min_length=1, max_length=3)
    caution: Prose
