"""Availability alerts after an empty search (spec §4.3)."""
from datetime import datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import Space


def on_freed(db: Session, space: Space, start_at: datetime, end_at: datetime, now: datetime) -> None:
    raise NotImplementedError


def close_for_user(db: Session, user_id: UUID, start_at: datetime, end_at: datetime) -> None:
    raise NotImplementedError
