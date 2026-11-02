from unittest.mock import ANY

import pytest
from sqlalchemy import select

from app.models import AbsenceEpisode
from app.models.enums import EpisodeKind, Presence, ReservationStatus, SpaceType
from app.services import occupancy
from app.testkit import SEC, at, book, heartbeats, iso, make_space, make_user

URL = "/api/v1/spaces"
FM = ["project-admins"]


def test_list_spaces(client, db, claims):
    booth = make_space(db, "Bulle 1", equipment=["écran"])
    make_space(db, "Salle 1", SpaceType.MEETING_ROOM, 8, floor=1, min_duration_min=45, device=False)
    reservation = book(db, booth, at("09:30"), at("10:30"), user=make_user(db, "u2", display_name="Alice Martin"))
    heartbeats(db, booth, Presence.PRESENT, at("09:59:50"), at("10:00"))

    body = client.get(URL).json()

    assert [s["name"] for s in body] == ["Bulle 1", "Salle 1"]
    assert body[0] == {
        "id": str(booth.id), "name": "Bulle 1", "type": "individual_booth", "description": "", "capacity": 1,
        "floor": 0, "equipment": ["écran"], "is_active": True, "min_duration_min": 15, "max_duration_min": 60,
        "space_state": "occupied_reserved", "occupancy_fresh_at": iso(at("10:00")),
        "current_reservation": {
            "id": str(reservation.id), "start_at": iso(at("09:30")), "end_at": iso(at("10:30")),
            "release_at": None, "booker_name": None,
        },
    }
    room = body[1]
    assert (room["min_duration_min"], room["max_duration_min"], room["space_state"], room["occupancy_fresh_at"],
            room["current_reservation"]) == (45, 180, "unknown", None, None)
    claims["groups"] = FM
    assert client.get(URL).json()[0]["current_reservation"]["booker_name"] == "Alice Martin"


def test_list_filters(client, db):
    make_space(db, "A", SpaceType.INDIVIDUAL_BOOTH, 1)
    make_space(db, "B", SpaceType.MEETING_ROOM, 4, floor=1, equipment=["écran", "visio"])
    make_space(db, "C", SpaceType.MEETING_ROOM, 10, floor=2, equipment=["écran"])

    def names(**params):
        return [s["name"] for s in client.get(URL, params=params).json()]

    assert names(type="meeting_room") == ["B", "C"]
    assert names(min_capacity=5) == ["C"]
    assert names(floor=1) == ["B"]
    assert names(equipment=["écran", "visio"]) == ["B"]
    assert names(equipment="écran") == ["B", "C"]


def test_inactive_hidden_from_employees(client, db, claims):
    space = make_space(db, is_active=False)

    assert client.get(URL).json() == []
    response = client.get(f"{URL}/{space.id}")
    assert (response.status_code, response.json()) == (404, {"detail": "SPACE_NOT_FOUND"})
    claims["groups"] = FM
    assert [s["is_active"] for s in client.get(URL).json()] == [False]
    assert client.get(f"{URL}/{space.id}").status_code == 200


def test_space_detail_day(client, db):
    me = make_user(db, "u1")
    space = make_space(db)
    mine = book(db, space, at("11:00"), at("11:30"), user=me)
    theirs = book(db, space, at("12:00"), at("12:30"), user=make_user(db, "u2", display_name="Alice"))
    book(db, space, at("13:00"), at("13:30"), status=ReservationStatus.CANCELLED, cancelled_at=at("09:00"))
    night = book(db, space, at("00:30", day=3), at("01:00", day=3))  # 23:30 UTC on the 2nd

    today = client.get(f"{URL}/{space.id}").json()
    tomorrow = client.get(f"{URL}/{space.id}", params={"date": "2026-11-03"}).json()

    assert today["name"] == "Bulle 1"
    assert today["space_state"] == "unknown"
    assert today["date"] == "2026-11-02"
    assert today["reservations"] == [
        {"id": str(mine.id), "start_at": iso(at("11:00")), "end_at": iso(at("11:30")), "status": "active",
         "released_at": None, "mine": True, "booker_name": None},
        {"id": str(theirs.id), "start_at": iso(at("12:00")), "end_at": iso(at("12:30")), "status": "active",
         "released_at": None, "mine": False, "booker_name": None},
    ]
    assert [r["id"] for r in tomorrow["reservations"]] == [str(night.id)]


def test_availability(client, db):
    booked = make_space(db, "Bulle 1")
    make_space(db, "Bulle 2")
    make_space(db, "Bulle 3", is_active=False)
    make_space(db, "Salle 1", SpaceType.MEETING_ROOM, 6)
    book(db, booked, at("10:30"), at("11:00"))

    def names(start, end, **params):
        response = client.get(f"{URL}/availability", params={"start_at": iso(at(start)), "end_at": iso(at(end)), **params})
        assert response.status_code == 200, response.json()
        return [s["name"] for s in response.json()]

    assert names("10:30", "11:00", type="individual_booth") == ["Bulle 2"]
    assert names("10:30", "11:00") == ["Bulle 2", "Salle 1"]
    assert names("11:00", "11:30", type="individual_booth") == ["Bulle 1", "Bulle 2"]
    assert names("10:30", "12:00") == ["Salle 1"]  # 90 min: over the booth max
    assert names("10:30", "11:00", min_capacity=2) == ["Salle 1"]
    for start, end in (("10:32", "11:00"), ("09:30", "10:30"), ("11:00", "10:30")):
        response = client.get(f"{URL}/availability", params={"start_at": iso(at(start)), "end_at": iso(at(end))})
        assert (response.status_code, response.json()) == (422, {"detail": "INVALID_SLOT"})


def test_create_and_patch_space(client, db, claims):
    body = {"name": "Salle 2", "type": "meeting_room", "capacity": 6, "floor": 1, "equipment": ["visio"]}
    assert client.post(URL, json=body).status_code == 403
    claims["groups"] = FM

    created = client.post(URL, json=body)

    assert created.status_code == 201
    assert created.json() == {
        "id": ANY, "name": "Salle 2", "type": "meeting_room", "description": "", "capacity": 6, "floor": 1,
        "equipment": ["visio"], "is_active": True, "min_duration_min": 30, "max_duration_min": 180,
        "space_state": "unknown", "occupancy_fresh_at": None, "current_reservation": None,
    }
    duplicate = client.post(URL, json=body)
    assert (duplicate.status_code, duplicate.json()) == (409, {"detail": "SPACE_NAME_TAKEN"})
    space_url = f"{URL}/{created.json()['id']}"
    invalid = client.patch(space_url, json={"min_duration_min": 60, "max_duration_min": 45})
    assert (invalid.status_code, invalid.json()) == (422, {"detail": "INVALID_SPACE"})
    assert client.patch(space_url, json={"name": None}).status_code == 422

    patched = client.patch(space_url, json={"max_duration_min": 120, "is_active": False, "description": "Vue jardin"})

    assert patched.status_code == 200
    assert (patched.json()["max_duration_min"], patched.json()["is_active"], patched.json()["description"]) == (
        120, False, "Vue jardin")
    assert client.patch(space_url, json={"max_duration_min": None}).json()["max_duration_min"] == 180
    claims["groups"] = []
    assert client.patch(space_url, json={"capacity": 2}).status_code == 403


@pytest.mark.parametrize("route", ["/api/v1/spaces", "/api/v1/spaces/{id}", "/api/v1/reservations/mine"])
def test_reads_evaluate_the_deadline(client, db, frozen_clock, route):
    space = make_space(db)
    reservation = book(db, space, at("10:00"), at("11:00"), user=make_user(db, "u1"))
    heartbeats(db, space, Presence.ABSENT, at("09:59:50"), at("10:05"))
    frozen_clock.now = at("10:05")
    [listed] = client.get(URL).json()
    assert (listed["space_state"], listed["current_reservation"]["release_at"]) == ("awaiting_presence", iso(at("10:10")))
    # telemetry goes on, but no request evaluates at the deadline itself
    when = at("10:05:10")
    while when <= at("10:10"):
        occupancy.apply_observation(db, space.id, Presence.ABSENT, when)
        when += 10 * SEC
    db.commit()
    frozen_clock.now = at("10:10:05")

    assert client.get(route.format(id=space.id)).status_code == 200

    db.expire_all()
    assert (reservation.status, reservation.released_at) == (ReservationStatus.RELEASED, at("10:10:05"))


def test_history_fm(client, db, claims):
    space = make_space(db)
    reservation = book(db, space, at("10:00"), at("11:00"), user=make_user(db, "u2", display_name="Alice"))
    heartbeats(db, space, Presence.ABSENT, at("10:00"), at("10:00:10"))
    book(db, space, at("08:00"), at("08:30"))  # before the period
    params = {"from": iso(at("09:00")), "to": iso(at("12:00"))}
    assert client.get(f"{URL}/{space.id}/history", params=params).status_code == 403
    claims["groups"] = FM

    body = client.get(f"{URL}/{space.id}/history", params=params).json()

    assert [o["observed_at"] for o in body["observations"]] == [iso(at("10:00")), iso(at("10:00:10"))]
    assert body["observations"][0] == {
        "observed_at": iso(at("10:00")), "presence": "absent", "kind": "heartbeat", "source": "simulated",
        "device_id": ANY,
    }
    assert body["reservations"] == [{
        "id": str(reservation.id), "start_at": iso(at("10:00")), "end_at": iso(at("11:00")), "status": "active",
        "released_at": None, "cancelled_at": None, "booker_name": "Alice",
    }]
    episode = db.scalar(select(AbsenceEpisode))
    assert body["episodes"] == [{
        "id": str(episode.id), "reservation_id": str(reservation.id), "kind": EpisodeKind.NO_SHOW.value,
        "opened_at": iso(at("10:00")), "deadline_at": iso(at("10:10")), "outcome": "pending", "closed_at": None,
    }]
    invalid = client.get(f"{URL}/{space.id}/history", params={"from": params["to"], "to": params["from"]})
    assert (invalid.status_code, invalid.json()) == (400, {"detail": "INVALID_PERIOD"})
