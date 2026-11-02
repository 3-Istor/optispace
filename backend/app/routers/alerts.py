from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.models import AppUser
from app.schemas.reservations import AlertIn, AlertOut
from app.security import get_app_user
from app.services import alerts

router = APIRouter(tags=["alerts"])


@router.post("/alerts", status_code=201, response_model=AlertOut)
def create_alert(body: AlertIn, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    alert = alerts.create(db, user, body.start_at, body.end_at, body.space_type, body.min_capacity, clock.now())
    db.commit()
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
