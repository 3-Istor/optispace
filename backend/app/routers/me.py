from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AppSettings, AppUser
from app.schemas.me import MeOut, MePatch, Profile
from app.security import get_app_user

router = APIRouter(tags=["me"])


def _out(db: Session, user: AppUser) -> MeOut:
    if user.organization is None:
        role, delay = "staff", None
    else:
        role, delay = "facility_manager" if user.is_fm else "employee", db.get(AppSettings, 1).absence_delay_min
    return MeOut(**Profile.model_validate(user).model_dump(), role=role, absence_delay_min=delay)


@router.get("/me", response_model=MeOut)
def read_me(user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    return _out(db, user)


@router.patch("/me", response_model=MeOut)
def update_me(
    body: MePatch,
    user: AppUser = Depends(get_app_user),
    db: Session = Depends(get_db),
):
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    db.commit()
    return _out(db, user)
