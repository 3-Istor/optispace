from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.models import AppUser, Notification
from app.schemas.notifications import NotificationOut
from app.security import get_app_user

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(unread: bool = False, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    """The 50 newest."""
    query = select(Notification).where(Notification.user_id == user.id)
    if unread:
        query = query.where(Notification.read_at.is_(None))
    return db.scalars(query.order_by(Notification.created_at.desc(), Notification.id).limit(50)).all()


@router.post("/notifications/{notification_id}/read", status_code=204)
def mark_read(notification_id: UUID, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    notification = db.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="NOTIFICATION_NOT_FOUND")
    if notification.read_at is None:
        notification.read_at = clock.now()
        db.commit()
