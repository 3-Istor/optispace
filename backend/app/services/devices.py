"""Device registration, assignment and seal (spec §4.4, §7)."""
from datetime import datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import Device


def register_or_touch(db: Session, device_id: str, firmware_version: str, now: datetime) -> Device:
    raise NotImplementedError


def assign(db: Session, device_id: str, space_id: UUID | None) -> Device:
    """Always reseals."""
    raise NotImplementedError


def seal(db: Session, device_id: str) -> Device:
    raise NotImplementedError


def unseal(db: Session, device_id: str) -> Device:
    """409 DEVICE_UNASSIGNED when the device has no space."""
    raise NotImplementedError


def state_payload(db: Session, device: Device, now: datetime) -> dict:
    """The `state` object of the telemetry response (spec §7)."""
    raise NotImplementedError
