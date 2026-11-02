from unittest.mock import ANY
from uuid import UUID

from sqlalchemy import select

from app.models import AvailabilityAlert, Notification
from app.models.enums import AlertStatus, NotificationType, SpaceType
from app.services import alerts
from app.testkit import at, iso, make_space, make_user

URL = "/api/v1/alerts"
CRITERIA = {"start_at": iso(at("11:00")), "end_at": iso(at("12:00")), "space_type": "meeting_room", "min_capacity": 4}


def test_alert_created_only_with_criteria(client):
    for missing in ("start_at", "end_at", "space_type"):
        body = {k: v for k, v in CRITERIA.items() if k != missing}
        assert client.post(URL, json=body).status_code == 422
    for start, end in (("12:00", "11:00"), ("11:00", "11:00"), ("08:00", "09:00")):
        response = client.post(URL, json={**CRITERIA, "start_at": iso(at(start)), "end_at": iso(at(end))})
        assert (response.status_code, response.json()) == (422, {"detail": "INVALID_SLOT"})

    response = client.post(URL, json=CRITERIA)

    assert response.status_code == 201
    assert response.json() == {"id": ANY, **CRITERIA, "status": "active"}
    assert client.get(f"{URL}/mine").json() == [response.json()]
    default = {k: v for k, v in CRITERIA.items() if k != "min_capacity"}
    assert client.post(URL, json=default).json()["min_capacity"] == 1


def _alert(db, sub, start, end, space_type=SpaceType.MEETING_ROOM, min_capacity=4, **fields):
    alert = AvailabilityAlert(user_id=make_user(db, sub).id, start_at=at(start), end_at=at(end),
                              space_type=space_type, min_capacity=min_capacity, **fields)
    db.add(alert)
    db.commit()
    return alert


def test_on_freed_notifies_matching(db):
    space = make_space(db, "Salle 1", SpaceType.MEETING_ROOM, 6)
    match = _alert(db, "match", "10:30", "11:30")
    other_match = _alert(db, "smaller", "10:00", "10:30", min_capacity=6)
    _alert(db, "booth", "10:30", "11:30", space_type=SpaceType.INDIVIDUAL_BOOTH, min_capacity=1)
    _alert(db, "too-big", "10:30", "11:30", min_capacity=8)
    _alert(db, "after", "11:00", "12:00")  # touches the freed end: no overlap
    _alert(db, "cancelled", "10:30", "11:30", status=AlertStatus.CANCELLED)
    expired = _alert(db, "expired", "10:00", "10:20")

    alerts.on_freed(db, space, at("10:20"), at("11:00"), at("10:20"))
    db.commit()

    notified = {n.user_id: n.params for n in db.scalars(select(Notification))}
    assert notified == {
        match.user_id: {"space_name": "Salle 1", "space_type": "meeting_room",
                        "start_at": iso(at("10:30")), "end_at": iso(at("11:00"))},
        other_match.user_id: {"space_name": "Salle 1", "space_type": "meeting_room",
                              "start_at": iso(at("10:20")), "end_at": iso(at("10:30"))},
    }
    assert all(n.type == NotificationType.SPACE_AVAILABLE for n in db.scalars(select(Notification)))
    db.expire_all()
    assert (match.status, expired.status) == (AlertStatus.ACTIVE, AlertStatus.EXPIRED)


def test_on_freed_ignores_inactive_space(db):
    space = make_space(db, "Salle 1", SpaceType.MEETING_ROOM, 6, is_active=False)
    _alert(db, "match", "10:30", "11:30")

    alerts.on_freed(db, space, at("10:20"), at("11:00"), at("10:20"))

    assert db.scalars(select(Notification)).all() == []


def test_alert_closed_when_user_books(client, db):
    booth = make_space(db)
    criteria = {**CRITERIA, "space_type": "individual_booth", "min_capacity": 1}
    booked = client.post(URL, json={**criteria, "start_at": iso(at("10:30")), "end_at": iso(at("11:00"))}).json()
    kept = client.post(URL, json={**criteria, "start_at": iso(at("11:15")), "end_at": iso(at("12:00"))}).json()

    response = client.post("/api/v1/reservations", json={
        "space_id": str(booth.id), "start_at": iso(at("10:45")), "end_at": iso(at("11:15")),
    })

    assert response.status_code == 201
    assert [a["id"] for a in client.get(f"{URL}/mine").json()] == [kept["id"]]
    assert db.get(AvailabilityAlert, UUID(booked["id"])).status == AlertStatus.FULFILLED


def test_alert_expires_at_end(client, db, frozen_clock):
    assert client.post(URL, json=CRITERIA).status_code == 201
    frozen_clock.now = at("12:00")

    assert client.get(f"{URL}/mine").json() == []
    assert db.scalar(select(AvailabilityAlert)).status == AlertStatus.EXPIRED


def test_delete_alert(client, db, claims):
    alert_id = client.post(URL, json=CRITERIA).json()["id"]

    claims["sub"] = "u2"
    assert (client.delete(f"{URL}/{alert_id}").status_code, client.delete(f"{URL}/{alert_id}").json()) == (
        403, {"detail": "NOT_OWNER"})
    claims["sub"] = "u1"
    assert client.delete(f"{URL}/{alert_id}").status_code == 204
    assert client.get(f"{URL}/mine").json() == []
    assert db.scalar(select(AvailabilityAlert)).status == AlertStatus.CANCELLED
    missing = client.delete(f"{URL}/00000000-0000-0000-0000-000000000000")
    assert (missing.status_code, missing.json()) == (404, {"detail": "ALERT_NOT_FOUND"})
