from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.models import AppUser
from app.schemas.reservations import AlertIn, AlertOut
from app.security import get_app_user, member
from app.services import alerts

router = APIRouter(tags=["alerts"], dependencies=[Depends(member)])


@router.post("/alerts", status_code=201, response_model=AlertOut)
def create_alert(
    body: AlertIn, response: Response, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db),
):
    """201, or 200 with the user's active alert of the same criteria; 422 INVALID_SLOT."""
    alert, created = alerts.create(db, user, clock.now(), **body.model_dump())
    db.commit()
    if not created:
        response.status_code = 200
    return alert


@router.get("/alerts/mine", response_model=list[AlertOut])
def my_alerts(user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    """Active alerts only."""
    result = alerts.mine(db, user, clock.now())
    db.commit()
    return result


@router.delete("/alerts/{alert_id}", status_code=204)
def cancel_alert(alert_id: UUID, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    alerts.cancel(db, user, alert_id)
    db.commit()
