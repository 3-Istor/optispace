"""Dashboard insights (spec §8, IOT-36 §6.2), until the AI module replaces it."""
from datetime import datetime
from uuid import UUID

from sqlalchemy.orm import Session


def compute(db: Session, space_id: UUID, frm: datetime, to: datetime, now: datetime) -> dict:
    """`kpis`, `summary` (mode "template_fallback"), `no_shows`, `recommendations` and `warnings`."""
    raise NotImplementedError
