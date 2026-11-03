from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.models import AbsenceEpisode, AppUser, Device, Reservation, Space, SpaceStatus
from app.models.enums import EpisodeKind, Presence, SealState, SpaceType
from app.services import devices

NOW = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)
SEC = timedelta(seconds=1)
MIN = timedelta(minutes=1)
DEVICE = "esp32-24A1B2C3D4E5"


@pytest.fixture
def fm(claims):
    claims["groups"] = ["project-admins"]


def make_space(db, name="Bulle 2"):
    space = Space(name=name, type=SpaceType.INDIVIDUAL_BOOTH, capacity=1)
    db.add(space)
    db.flush()
    return space


def make_device(db, device_id=DEVICE, space=None, seal=SealState.SEALED, last_seen_at=NOW):
    device = Device(
        id=device_id, space_id=space and space.id, seal=seal, firmware_version="0.3.0",
        first_seen_at=NOW - 60 * MIN, last_seen_at=last_seen_at,
    )
    db.add(device)
    db.flush()
    return device


def test_device_routes_require_fm(client):
    for response in (
        client.get("/api/v1/devices"),
        client.get(f"/api/v1/devices/{DEVICE}"),
        client.patch(f"/api/v1/devices/{DEVICE}", json={"space_id": None}),
        client.post(f"/api/v1/devices/{DEVICE}/seal"),
        client.post(f"/api/v1/devices/{DEVICE}/unseal", json={"confirm": True}),
    ):
        assert (response.status_code, response.json()) == (403, {"detail": "FORBIDDEN"})


def test_list_devices(client, db, fm):
    space = make_space(db)
    make_device(db, space=space, seal=SealState.UNSEALED, last_seen_at=NOW - 29 * SEC)
    make_device(db, "esp32-000000000001", last_seen_at=NOW - 30 * SEC)
    db.commit()

    response = client.get("/api/v1/devices")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "esp32-000000000001", "space": None, "seal": "sealed", "online": False,
            "firmware_version": "0.3.0", "first_seen_at": "2026-11-02T08:00:00Z",
            "last_seen_at": "2026-11-02T08:59:30Z",
        },
        {
            "id": DEVICE, "space": {"id": str(space.id), "name": "Bulle 2"}, "seal": "unsealed", "online": True,
            "firmware_version": "0.3.0", "first_seen_at": "2026-11-02T08:00:00Z",
            "last_seen_at": "2026-11-02T08:59:31Z",
        },
    ]


def test_get_device_includes_state(client, db, fm):
    space = make_space(db)
    make_device(db, space=space, seal=SealState.UNSEALED)
    db.add(SpaceStatus(space_id=space.id, occupancy=Presence.PRESENT, occupancy_since=NOW, last_observation_at=NOW))
    db.commit()

    response = client.get(f"/api/v1/devices/{DEVICE}")

    assert response.status_code == 200
    assert response.json()["space"] == {"id": str(space.id), "name": "Bulle 2"}
    assert response.json()["state"] == {
        "seal": "unsealed", "space_state": "occupied_unreserved", "space_name": "Bulle 2", "reservation": None,
        "release_at": None, "updated_at": "2026-11-02T09:00:00Z",
    }
    assert client.get("/api/v1/devices/esp32-000000000001").json() == {"detail": "DEVICE_NOT_FOUND"}


def test_state_payload_reservation_and_release_at(db):
    space = make_space(db)
    device = make_device(db, space=space, seal=SealState.UNSEALED)
    db.add(SpaceStatus(space_id=space.id, occupancy=Presence.ABSENT, occupancy_since=NOW, last_observation_at=NOW + 30 * SEC))
    user = AppUser(keycloak_sub="u1")
    db.add(user)
    db.flush()
    reservation = Reservation(space_id=space.id, user_id=user.id, start_at=NOW, end_at=NOW + 60 * MIN)
    db.add(reservation)
    db.flush()
    db.add(AbsenceEpisode(reservation_id=reservation.id, kind=EpisodeKind.NO_SHOW, opened_at=NOW, deadline_at=NOW + 10 * MIN))
    db.flush()

    assert devices.state_payload(db, device, NOW + 30 * SEC) == {
        "seal": SealState.UNSEALED, "space_state": "awaiting_presence", "space_name": "Bulle 2",
        "reservation": {"start_at": NOW, "end_at": NOW + 60 * MIN},
        "release_at": NOW + 10 * MIN, "updated_at": NOW + 30 * SEC,
    }


def test_assign_reseals(client, db, fm):
    first, second = make_space(db), make_space(db, "Salle Lovelace")
    make_device(db, space=first, seal=SealState.UNSEALED)
    db.commit()

    moved = client.patch(f"/api/v1/devices/{DEVICE}", json={"space_id": str(second.id)})
    assert moved.status_code == 200
    assert (moved.json()["space"], moved.json()["seal"]) == ({"id": str(second.id), "name": "Salle Lovelace"}, "sealed")

    client.post(f"/api/v1/devices/{DEVICE}/unseal", json={"confirm": True})
    removed = client.patch(f"/api/v1/devices/{DEVICE}", json={"space_id": None})
    assert (removed.json()["space"], removed.json()["seal"]) == (None, "sealed")
    db.expire_all()
    assert db.get(Device, DEVICE).space_id is None


def test_assign_errors(client, db, fm):
    space = make_space(db)
    make_device(db)
    make_device(db, "esp32-000000000001", space=space)
    db.commit()

    for device_id, space_id, expected in (
        (DEVICE, str(uuid4()), (404, "SPACE_NOT_FOUND")),
        (DEVICE, str(space.id), (409, "SPACE_HAS_DEVICE")),
        ("esp32-FFFFFFFFFFFF", None, (404, "DEVICE_NOT_FOUND")),
    ):
        response = client.patch(f"/api/v1/devices/{device_id}", json={"space_id": space_id})
        assert (response.status_code, response.json()["detail"]) == expected
    # reassigning a device to its own space is allowed
    assert client.patch("/api/v1/devices/esp32-000000000001", json={"space_id": str(space.id)}).status_code == 200


def test_unseal_requires_confirmation(client, db, fm):
    make_device(db, space=make_space(db))
    db.commit()

    for kwargs in ({}, {"json": {}}, {"json": {"confirm": False}}):
        response = client.post(f"/api/v1/devices/{DEVICE}/unseal", **kwargs)
        assert (response.status_code, response.json()) == (400, {"detail": "CONFIRMATION_REQUIRED"})
    db.expire_all()
    assert db.get(Device, DEVICE).seal == SealState.SEALED


def test_unseal_unassigned_409(client, db, fm):
    make_device(db)
    db.commit()

    response = client.post(f"/api/v1/devices/{DEVICE}/unseal", json={"confirm": True})

    assert (response.status_code, response.json()) == (409, {"detail": "DEVICE_UNASSIGNED"})


def test_unseal_then_seal(client, db, fm):
    make_device(db, space=make_space(db))
    db.commit()

    assert client.post(f"/api/v1/devices/{DEVICE}/unseal", json={"confirm": True}).json()["seal"] == "unsealed"
    assert client.post(f"/api/v1/devices/{DEVICE}/seal").json()["seal"] == "sealed"
    db.expire_all()
    assert db.get(Device, DEVICE).seal == SealState.SEALED
