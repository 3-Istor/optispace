from unittest.mock import ANY
from uuid import UUID

from sqlalchemy import select

from app.models import AvailabilityAlert, Notification
from app.models.enums import AlertStatus, NotificationType, ReservationStatus, SpaceType
from app.services import alerts
from app.testkit import at, book, iso, make_space, make_user

URL = "/api/v1/alerts"
SPACES = "/api/v1/spaces"
FM = ["project-admins"]
CRITERIA = {"start_at": iso(at("11:00")), "end_at": iso(at("12:00")), "space_type": "meeting_room", "min_capacity": 4}
BOARD_AND_PROJECTOR = ["Tableau blanc", "Vidéoprojecteur"]


def test_alert_created_only_with_criteria(client):
    for missing in ("start_at", "end_at", "space_type"):
        body = {k: v for k, v in CRITERIA.items() if k != missing}
        assert client.post(URL, json=body).status_code == 422
    for start, end in (("12:00", "11:00"), ("11:00", "11:00"), ("08:00", "09:00")):
        response = client.post(URL, json={**CRITERIA, "start_at": iso(at(start)), "end_at": iso(at(end))})
        assert (response.status_code, response.json()) == (422, {"detail": "INVALID_SLOT"})

    response = client.post(URL, json=CRITERIA)

    assert response.status_code == 201
    assert response.json() == {"id": ANY, **CRITERIA, "floor": None, "equipment": [], "status": "active"}
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


def _available(db):
    return [(n.user_id, n.params) for n in db.scalars(
        select(Notification).where(Notification.type == NotificationType.SPACE_AVAILABLE))]


def _params(space_name, start, end):
    return {"space_name": space_name, "space_type": "meeting_room", "start_at": iso(at(start)), "end_at": iso(at(end))}


def test_alert_keeps_floor_and_equipment(client):
    response = client.post(URL, json={**CRITERIA, "floor": 3, "equipment": BOARD_AND_PROJECTOR})

    assert response.status_code == 201
    assert (response.json()["floor"], response.json()["equipment"]) == (3, BOARD_AND_PROJECTOR)
    assert client.get(f"{URL}/mine").json() == [response.json()]


def test_alert_slot_starts_at_the_current_boundary_at_the_earliest(client, frozen_clock):
    frozen_clock.now = at("10:02")

    past = client.post(URL, json={**CRITERIA, "start_at": iso(at("09:55")), "end_at": iso(at("10:30"))})
    current = client.post(URL, json={**CRITERIA, "start_at": iso(at("10:00")), "end_at": iso(at("10:30"))})

    assert (past.status_code, past.json()) == (422, {"detail": "INVALID_SLOT"})
    assert current.status_code == 201


def test_same_alert_twice_returns_the_active_one(client):
    body = {**CRITERIA, "floor": 3, "equipment": BOARD_AND_PROJECTOR}
    first = client.post(URL, json=body)

    again = client.post(URL, json={**body, "equipment": BOARD_AND_PROJECTOR[::-1]})

    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()
    for other in ({"floor": None}, {"equipment": ["Tableau blanc"]}, {"min_capacity": 8}, {"end_at": iso(at("12:30"))}):
        assert client.post(URL, json={**body, **other}).status_code == 201
    assert client.delete(f"{URL}/{first.json()['id']}").status_code == 204
    assert client.post(URL, json=body).status_code == 201  # a cancelled alert is not reused


def test_mine_hides_ended_alerts(client, db):
    _alert(db, "u1", "08:00", "09:30")  # still active in the database, ended at 09:30
    kept = client.post(URL, json=CRITERIA).json()

    assert client.get(f"{URL}/mine").json() == [kept]


def test_on_freed_matches_floor_and_equipment(db):
    space = make_space(db, "Salle 3", SpaceType.MEETING_ROOM, 8, floor=3, equipment=[*BOARD_AND_PROJECTOR, "visio"])
    matching = [
        _alert(db, "any-floor", "10:30", "11:30", equipment=BOARD_AND_PROJECTOR),
        _alert(db, "floor-3", "10:30", "11:30", floor=3, equipment=["visio"]),
    ]
    _alert(db, "floor-2", "10:30", "11:30", floor=2)
    _alert(db, "ground-floor", "10:30", "11:30", floor=0)
    _alert(db, "pmr", "10:30", "11:30", equipment=["Tableau blanc", "PMR"])

    alerts.on_freed(db, space, at("10:20"), at("11:00"), at("10:20"))

    assert {user_id for user_id, _ in _available(db)} == {a.user_id for a in matching}


def test_new_matching_space_triggers_alert(client, db, claims):
    alert = client.post(URL, json={**CRITERIA, "min_capacity": 8, "equipment": BOARD_AND_PROJECTOR}).json()
    user_id = db.get(AvailabilityAlert, UUID(alert["id"])).user_id
    claims.update(sub="fm", groups=FM)
    room = {"type": "meeting_room", "capacity": 10, "floor": 3}

    assert client.post(SPACES, json={**room, "name": "Salle 1", "equipment": ["Tableau blanc"]}).status_code == 201
    assert client.post(SPACES, json={**room, "name": "Salle 2", "capacity": 6, "equipment": BOARD_AND_PROJECTOR}).status_code == 201
    assert client.post(SPACES, json={**room, "name": "Salle 3", "equipment": BOARD_AND_PROJECTOR, "is_active": False}).status_code == 201
    assert _available(db) == []

    assert client.post(SPACES, json={**room, "name": "Salle 4", "equipment": [*BOARD_AND_PROJECTOR, "visio"]}).status_code == 201

    assert _available(db) == [(user_id, _params("Salle 4", "11:00", "12:00"))]


def test_space_update_triggers_alert_once_it_matches(client, db, claims, frozen_clock):
    space = make_space(db, "Salle 3", SpaceType.MEETING_ROOM, 10, floor=3, equipment=["Tableau blanc"])
    alert = _alert(db, "u2", "10:00", "11:00", min_capacity=8, floor=3, equipment=BOARD_AND_PROJECTOR)
    frozen_clock.now = at("10:20")
    claims["groups"] = FM
    space_url = f"{SPACES}/{space.id}"

    assert client.patch(space_url, json={"description": "Vue jardin"}).status_code == 200
    assert _available(db) == []
    assert client.patch(space_url, json={"equipment": BOARD_AND_PROJECTOR}).status_code == 200

    # from now to the end of the searched slot
    assert _available(db) == [(alert.user_id, _params("Salle 3", "10:20", "11:00"))]
    assert client.patch(space_url, json={"capacity": 12}).status_code == 200  # it already matched
    assert len(_available(db)) == 1


def test_space_booked_on_the_slot_does_not_trigger(client, db, claims, frozen_clock):
    space = make_space(db, "Salle 3", SpaceType.MEETING_ROOM, 10, is_active=False)
    freed = _alert(db, "freed", "10:00", "11:00")
    _alert(db, "booked", "11:00", "12:00")
    book(db, space, at("10:00"), at("11:00"), status=ReservationStatus.RELEASED, released_at=at("10:15"))
    book(db, space, at("11:00"), at("11:30"), status=ReservationStatus.CANCELLED)
    book(db, space, at("11:30"), at("12:00"))
    frozen_clock.now = at("10:20")
    claims["groups"] = FM

    assert client.patch(f"{SPACES}/{space.id}", json={"is_active": True}).status_code == 200

    # the released reservation ends at its released_at
    assert _available(db) == [(freed.user_id, _params("Salle 3", "10:20", "11:00"))]
