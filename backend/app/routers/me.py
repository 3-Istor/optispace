from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AppSettings, AppUser
from app.schemas.me import MeOut, MePatch, Profile
from app.security import current_user, get_app_user, is_fm

router = APIRouter(tags=["me"])


def _out(db: Session, user: AppUser, claims: dict) -> MeOut:
    role = "facility_manager" if is_fm(claims) else "employee"
    return MeOut(
        **Profile.model_validate(user).model_dump(), role=role,
        absence_delay_min=db.get(AppSettings, 1).absence_delay_min,
    )


@router.get("/me", response_model=MeOut)
def read_me(user: AppUser = Depends(get_app_user), claims: dict = Depends(current_user), db: Session = Depends(get_db)):
    return _out(db, user, claims)


@router.patch("/me", response_model=MeOut)
def update_me(
    body: MePatch,
    user: AppUser = Depends(get_app_user),
    claims: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    db.commit()
    return _out(db, user, claims)
