from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AppUser, PushSubscription
from app.schemas.notifications import PushSubscriptionDelete, PushSubscriptionIn
from app.security import get_app_user, member

router = APIRouter(tags=["push"], dependencies=[Depends(member)])


@router.get("/push/vapid-public-key")
def vapid_public_key():
    """null while Web Push is not configured."""
    return {"key": get_settings().vapid_public_key or None}


@router.post("/push-subscriptions", status_code=201)
def subscribe(body: PushSubscriptionIn, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    """Upsert by endpoint: a browser re-subscribing, possibly for another account, replaces its row."""
    subscription = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if subscription is None:
        subscription = PushSubscription(endpoint=body.endpoint)
        db.add(subscription)
    subscription.user_id, subscription.p256dh, subscription.auth = user.id, body.keys.p256dh, body.keys.auth
    db.commit()


@router.delete("/push-subscriptions", status_code=204)
def unsubscribe(body: PushSubscriptionDelete, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    db.execute(delete(PushSubscription).where(
        PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id,
    ))
    db.commit()
