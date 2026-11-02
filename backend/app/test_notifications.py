import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pywebpush import WebPushException
from sqlalchemy import func, select

from app.models import Notification, PushSubscription
from app.models.enums import NotificationType as T
from app.services import notifications, webpush
from app.testkit import at, iso, make_user

AT = iso(at("10:10"))


def test_notification_texts():
    render = notifications.render

    assert render(T.ABSENCE_WARNING, {"space_name": "Bulle 2", "at": AT}) == (
        "Personne n'est détecté dans Bulle 2. Sans présence, la réservation sera libérée à 10:10.")
    assert render(T.RELEASED, {"space_name": "Bulle 2", "at": AT}) == "Votre réservation de Bulle 2 a été libérée à 10:10."
    assert render(T.SPACE_AVAILABLE, {
        "space_name": "Bulle 2", "space_type": "individual_booth", "start_at": AT, "end_at": iso(at("11:00")),
    }) == "Bulle 2 est disponible de 10:10 à 11:00."
    assert render(T.DEVICE_OFFLINE, {"space_name": "Bulle 2", "at": AT}) == "Le boîtier de Bulle 2 est hors ligne depuis 10:10."
    assert render(T.DEVICE_SEALED, {"space_name": "Bulle 2"}) == "Le boîtier de Bulle 2 a été rescellé."
    # Paris summer time
    summer = iso(datetime(2026, 7, 1, 8, 10, tzinfo=timezone.utc))
    assert render(T.RELEASED, {"space_name": "Bulle 2", "at": summer}).endswith("à 10:10.")


@pytest.fixture
def pushes(monkeypatch, settings_env):
    settings_env(VAPID_PUBLIC_KEY="public", VAPID_PRIVATE_KEY="private")
    calls = []
    monkeypatch.setattr(webpush, "send", lambda sub, payload: calls.append((sub.endpoint, payload)) or True)
    return calls


def subscribe(db, user, endpoint="https://push.example/1"):
    db.add(PushSubscription(user_id=user.id, endpoint=endpoint, p256dh="key", auth="auth"))
    db.commit()


def test_notification_prefs_respected(db, pushes, settings_env):
    user = make_user(db, notify_in_app=False)
    subscribe(db, user)

    assert notifications.notify(db, user, T.RELEASED, space_name="Bulle 1", at=AT) is None
    assert db.scalar(select(func.count()).select_from(Notification)) == 0
    assert pushes == [("https://push.example/1", {
        "title": "OptiSpace", "body": "Votre réservation de Bulle 1 a été libérée à 10:10.", "url": "/reservations",
    })]

    user.notify_in_app, user.notify_push = True, False
    row = notifications.notify(db, user, T.RELEASED, reservation_id=None, space_name="Bulle 1", at=AT)
    assert (row.user_id, row.type, row.params) == (user.id, T.RELEASED, {"space_name": "Bulle 1", "at": AT})
    assert len(pushes) == 1

    settings_env(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="")  # no VAPID keys: no push
    user.notify_push = True
    notifications.notify(db, user, T.RELEASED, space_name="Bulle 1", at=AT)
    assert len(pushes) == 1


def test_push_urls(db, pushes):
    user = make_user(db)
    subscribe(db, user)

    notifications.notify(db, user, T.SPACE_AVAILABLE, space_name="Bulle 1", space_type="individual_booth",
                         start_at=AT, end_at=iso(at("11:00")))
    notifications.notify(db, user, T.DEVICE_SEALED, space_name="Bulle 1")
    notifications.notify(db, user, T.ABSENCE_WARNING, space_name="Bulle 1", at=AT)

    assert [payload["url"] for _, payload in pushes] == [
        "/?type=individual_booth&start_at=2026-11-02T09%3A10%3A00Z&end_at=2026-11-02T10%3A00%3A00Z",
        "/admin/devices",
        "/reservations",
    ]


def test_push_410_deletes_subscription(db, monkeypatch, settings_env):
    settings_env(VAPID_PUBLIC_KEY="public", VAPID_PRIVATE_KEY="private", VAPID_SUBJECT="mailto:ops@example.com")
    user = make_user(db)
    for endpoint in ("gone", "missing", "busy", "broken", "fine"):
        subscribe(db, user, endpoint)
    calls = []

    def fake_webpush(subscription_info, **kwargs):
        calls.append((subscription_info, kwargs))
        status = {"gone": 410, "missing": 404, "busy": 503}.get(subscription_info["endpoint"])
        if status:
            raise WebPushException("push refused", response=SimpleNamespace(status_code=status))
        if subscription_info["endpoint"] == "broken":
            raise OSError("network down")

    monkeypatch.setattr(webpush, "webpush", fake_webpush)

    row = notifications.notify(db, user, T.RELEASED, space_name="Bulle 1", at=AT)
    db.commit()

    assert row is not None
    assert sorted(db.scalars(select(PushSubscription.endpoint))) == ["broken", "busy", "fine"]
    info, kwargs = calls[0]
    assert info == {"endpoint": "gone", "keys": {"p256dh": "key", "auth": "auth"}}
    assert json.loads(kwargs["data"])["body"] == "Votre réservation de Bulle 1 a été libérée à 10:10."
    assert (kwargs["vapid_private_key"], kwargs["vapid_claims"]) == ("private", {"sub": "mailto:ops@example.com"})


def test_notifications_list_and_read(client, db, frozen_clock):
    user, other = make_user(db, "u1"), make_user(db, "u2")
    first = notifications.notify(db, user, T.RELEASED, space_name="Bulle 1", at=AT)
    frozen_clock.now = at("10:01")
    second = notifications.notify(db, user, T.ABSENCE_WARNING, space_name="Bulle 1", at=AT)
    foreign = notifications.notify(db, other, T.RELEASED, space_name="Bulle 1", at=AT)
    db.commit()

    listed = client.get("/api/v1/notifications").json()

    assert [n["id"] for n in listed] == [str(second.id), str(first.id)]
    assert listed[1] == {
        "id": str(first.id), "type": "RELEASED", "params": {"space_name": "Bulle 1", "at": AT},
        "created_at": iso(at("10:00")), "read_at": None,
    }
    assert client.post(f"/api/v1/notifications/{first.id}/read").status_code == 204
    assert [n["id"] for n in client.get("/api/v1/notifications", params={"unread": "true"}).json()] == [str(second.id)]
    assert client.get("/api/v1/notifications").json()[1]["read_at"] == iso(at("10:01"))
    response = client.post(f"/api/v1/notifications/{foreign.id}/read")
    assert (response.status_code, response.json()) == (404, {"detail": "NOTIFICATION_NOT_FOUND"})


def test_push_subscription_routes(client, db, settings_env):
    assert client.get("/api/v1/push/vapid-public-key").json() == {"key": None}
    settings_env(VAPID_PUBLIC_KEY="BPublic")
    assert client.get("/api/v1/push/vapid-public-key").json() == {"key": "BPublic"}

    body = {"endpoint": "https://push.example/abc", "expirationTime": None, "keys": {"p256dh": "p1", "auth": "a1"}}
    assert client.post("/api/v1/push-subscriptions", json=body).status_code == 201
    body["keys"] = {"p256dh": "p2", "auth": "a2"}
    assert client.post("/api/v1/push-subscriptions", json=body).status_code == 201
    [subscription] = db.scalars(select(PushSubscription)).all()
    assert (subscription.p256dh, subscription.auth) == ("p2", "a2")

    response = client.request("DELETE", "/api/v1/push-subscriptions", json={"endpoint": body["endpoint"]})

    assert response.status_code == 204
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 0
