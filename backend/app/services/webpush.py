"""Web Push delivery, the one place that calls pywebpush (tests patch `webpush` or `send`)."""
import json
import logging

from pywebpush import WebPushException, webpush

from app.config import get_settings
from app.models import PushSubscription

log = logging.getLogger(__name__)


def send(subscription: PushSubscription, payload: dict) -> bool:
    """False when the push service says the subscription is gone (404/410); any other failure is logged."""
    settings = get_settings()
    try:
        webpush(
            subscription_info={"endpoint": subscription.endpoint, "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth}},
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},  # a new dict each time: pywebpush adds aud and exp to it
            timeout=5,
            ttl=3600,  # the default 0 drops the message when the device is asleep
        )
    except WebPushException as error:
        if getattr(error.response, "status_code", None) in (404, 410):
            return False
        log.warning("web push failed for subscription %s: %s", subscription.id, error)
    except Exception as error:
        log.warning("web push failed for subscription %s: %r", subscription.id, error)
    return True
