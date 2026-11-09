from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Device, Space
from app.schemas.spaces import StaffSpaceOut
from app.security import require_staff

router = APIRouter(tags=["staff"], dependencies=[Depends(require_staff)])


@router.get("/staff/spaces", response_model=list[StaffSpaceOut])
def list_spaces(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Space, Device.id).outerjoin(Device, Device.space_id == Space.id).order_by(Space.organization, Space.name)
    ).all()
    return [{**{f: getattr(space, f) for f in StaffSpaceOut.model_fields if f != "device_id"}, "device_id": device_id}
            for space, device_id in rows]
