from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.models import Device, Space
from app.schemas.devices import DeviceDetail, DeviceOut, DevicePatch, UnsealIn
from app.security import require_fm
from app.services import devices, occupancy

router = APIRouter(tags=["devices"], dependencies=[Depends(require_fm)])


def _out(db: Session, device: Device, now: datetime) -> dict:
    space = db.get(Space, device.space_id) if device.space_id else None
    return {
        "id": device.id,
        "space": {"id": space.id, "name": space.name} if space else None,
        "seal": device.seal,
        "online": now - device.last_seen_at < occupancy.STALE_AFTER,
        "firmware_version": device.firmware_version,
        "first_seen_at": device.first_seen_at,
        "last_seen_at": device.last_seen_at,
    }


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(db: Session = Depends(get_db)):
    now = clock.now()
    devices.notify_offline(db, now)
    db.commit()
    return [_out(db, device, now) for device in db.scalars(select(Device).order_by(Device.id))]


@router.get("/devices/{device_id}", response_model=DeviceDetail)
def read_device(device_id: str, db: Session = Depends(get_db)):
    now = clock.now()
    device = devices.get(db, device_id)
    return {**_out(db, device, now), "state": devices.state_payload(db, device, now)}


@router.patch("/devices/{device_id}", response_model=DeviceOut)
def assign_device(device_id: str, body: DevicePatch, db: Session = Depends(get_db)):
    device = devices.assign(db, device_id, body.space_id)
    db.commit()
    return _out(db, device, clock.now())


@router.post("/devices/{device_id}/seal", response_model=DeviceOut)
def seal_device(device_id: str, db: Session = Depends(get_db)):
    device = devices.seal(db, device_id)
    db.commit()
    return _out(db, device, clock.now())


@router.post("/devices/{device_id}/unseal", response_model=DeviceOut)
def unseal_device(device_id: str, body: UnsealIn | None = None, db: Session = Depends(get_db)):
    # Password re-entry is postponed (spec §13): an explicit confirmation is required.
    if body is None or not body.confirm:
        raise HTTPException(status_code=400, detail="CONFIRMATION_REQUIRED")
    device = devices.unseal(db, device_id)
    db.commit()
    return _out(db, device, clock.now())
