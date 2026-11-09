from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import DomainError
from app.models import AppUser
from app.schemas.settings import SettingsOut, SettingsPatch
from app.security import require_fm
from app.services import settings

router = APIRouter(tags=["settings"], dependencies=[Depends(require_fm)])


@router.get("/settings", response_model=SettingsOut)
def read_settings(user: AppUser = Depends(require_fm), db: Session = Depends(get_db)):
    return settings.get(db, user.organization)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(body: SettingsPatch, user: AppUser = Depends(require_fm), db: Session = Depends(get_db)):
    changes = body.model_dump(exclude_none=True)
    merged = SettingsOut.model_validate(settings.get(db, user.organization)).model_copy(update=changes)
    if (
        min(merged.model_dump().values()) < 1
        or merged.booth_min_min > merged.booth_max_min
        or merged.meeting_min_min > merged.meeting_max_min
    ):
        raise DomainError(422, "INVALID_SETTINGS")
    return settings.save(db, user.organization, changes)
