"""Absence episodes and automatic release (spec §4.2), evaluated inside requests."""
from datetime import datetime
from uuid import UUID

from sqlalchemy.orm import Session


def evaluate_space(db: Session, space_id: UUID, now: datetime) -> None:
    """Open, close or release the absence episode of the space's current reservation.
    No-op for now, so callers can already rely on it."""
    return None
