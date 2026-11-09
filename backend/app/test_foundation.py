from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import security
from app.main import app
from app.models import AppSettings, AppUser, Device, Reservation, Space, SpaceStatus
from app.models.enums import Presence, ReservationStatus, SealState, SpaceState, SpaceType
from app.services import booking, occupancy

NOW = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)
SEC = timedelta(seconds=1)
MIN = timedelta(minutes=1)
SETTINGS_DEFAULTS = {
    "absence_delay_min": 10,
    "booth_min_min": 15,
    "booth_max_min": 60,
    "meeting_min_min": 30,
    "meeting_max_min": 180,
}


def test_me_creates_user_on_first_call(client, db):
    assert client.get("/api/v1/me").status_code == 200
    response = client.get("/api/v1/me")

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "employee"
    assert body["email"] == "u1@example.com"
    assert body["display_name"] == "User One"
    assert db.scalar(select(func.count()).select_from(AppUser)) == 1


def test_me_includes_the_absence_delay(client, db):
    db.get(AppSettings, 1).absence_delay_min = 7
    db.commit()

    assert client.get("/api/v1/me").json()["absence_delay_min"] == 7
    assert client.patch("/api/v1/me", json={"notify_push": False}).json()["absence_delay_min"] == 7


def test_me_role_fm_from_group(client, claims):
    claims["groups"] = ["facility-managers"]

    assert client.get("/api/v1/me").json()["role"] == "facility_manager"


def test_patch_me_preferences(client, db):
    response = client.patch("/api/v1/me", json={"phone": "+33600000000", "notify_push": False})

    assert response.status_code == 200
    assert response.json()["phone"] == "+33600000000"
    user = db.scalar(select(AppUser))
    assert (user.phone, user.notify_push, user.notify_in_app) == ("+33600000000", False, True)


def test_me_requires_a_token(settings_env):
    response = TestClient(app).get("/api/v1/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "NOT_AUTHENTICATED"}


def test_current_user_verifies_the_token(monkeypatch, settings_env):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    issuer = "https://auth.example.com/realms/iot"
    monkeypatch.setattr(security, "_jwks", lambda: type("JWKS", (), {
        "get_signing_key_from_jwt": staticmethod(lambda token: type("Key", (), {"key": key.public_key()})),
    }))
    settings_env(OIDC_ISSUER=issuer)
    exp = datetime.now(timezone.utc) + timedelta(minutes=5)

    def bearer(signing_key, drop=(), **claims):
        payload = {"sub": "u1", "iss": issuer, "exp": exp, **claims}
        payload = {name: value for name, value in payload.items() if name not in drop}
        return "Bearer " + jwt.encode(payload, signing_key, algorithm="RS256")

    assert security.current_user(bearer(key))["sub"] == "u1"
    for token in (
        bearer(other), bearer(key, iss="https://evil"), bearer(key, exp=exp - timedelta(minutes=10)),
        bearer(key, drop=("exp",)), bearer(key, drop=("iss",)),
    ):
        with pytest.raises(HTTPException) as error:
            security.current_user(token)
        assert (error.value.status_code, error.value.detail) == (401, "INVALID_TOKEN")


def test_jwks_client_does_not_announce_python_urllib(settings_env):
    settings_env(OIDC_ISSUER="https://auth.example.com/realms/iot")
    security._jwks.cache_clear()

    assert "Python-urllib" not in security._jwks().headers.get("User-Agent", "Python-urllib")


def test_dev_fake_user_only_without_issuer(settings_env):
    fake = '{"sub": "dev", "groups": ["facility-managers"]}'

    settings_env(DEV_FAKE_USER=fake, OIDC_ISSUER="")
    assert security.current_user("")["sub"] == "dev"

    settings_env(DEV_FAKE_USER=fake, OIDC_ISSUER="https://auth.example.com/realms/iot")
    with pytest.raises(HTTPException) as error:
        security.current_user("")
    assert (error.value.status_code, error.value.detail) == (401, "NOT_AUTHENTICATED")


def test_settings_requires_fm(client):
    for response in (client.get("/api/v1/settings"), client.patch("/api/v1/settings", json={})):
        assert response.status_code == 403
        assert response.json() == {"detail": "FORBIDDEN"}


def test_settings_defaults(client, claims):
    claims["groups"] = ["facility-managers"]

    response = client.get("/api/v1/settings")

    assert response.status_code == 200
    assert response.json() == SETTINGS_DEFAULTS


def test_settings_patch_persists(client, claims):
    claims["groups"] = ["facility-managers"]

    response = client.patch("/api/v1/settings", json={"absence_delay_min": 1, "meeting_max_min": 240})

    assert response.status_code == 200
    expected = {**SETTINGS_DEFAULTS, "absence_delay_min": 1, "meeting_max_min": 240}
    assert response.json() == expected
    assert client.get("/api/v1/settings").json() == expected


def test_settings_reject_min_over_max(client, claims):
    claims["groups"] = ["facility-managers"]

    for patch in ({"booth_min_min": 70}, {"meeting_min_min": 60, "meeting_max_min": 45}, {"absence_delay_min": 0}):
        response = client.patch("/api/v1/settings", json=patch)
        assert response.status_code == 422
        assert response.json() == {"detail": "INVALID_SETTINGS"}
    assert client.get("/api/v1/settings").json() == SETTINGS_DEFAULTS


def test_effective_occupancy_stale():
    device = Device(id="esp32-AABBCCDDEEFF", space_id=uuid4(), seal=SealState.UNSEALED)
    status = SpaceStatus(
        space_id=device.space_id, occupancy=Presence.PRESENT,
        occupancy_since=NOW - MIN, last_observation_at=NOW - 31 * SEC,
    )
    assert occupancy.effective_occupancy(status, device, NOW) == Presence.UNKNOWN

    status.last_observation_at = NOW - 29 * SEC
    assert occupancy.effective_occupancy(status, device, NOW) == Presence.PRESENT
    assert occupancy.effective_occupancy(None, device, NOW) == Presence.UNKNOWN
    assert occupancy.effective_occupancy(status, None, NOW) == Presence.UNKNOWN

    device.seal = SealState.SEALED
    assert occupancy.effective_occupancy(status, device, NOW) == Presence.UNKNOWN


def make_space(db, name="Bulle 1"):
    space = Space(name=name, type=SpaceType.INDIVIDUAL_BOOTH, capacity=1)
    db.add(space)
    db.flush()
    return space


def make_reservation(db, space, start_at, end_at, **fields):
    user = AppUser(keycloak_sub=str(uuid4()))
    db.add(user)
    db.flush()
    reservation = Reservation(space_id=space.id, user_id=user.id, start_at=start_at, end_at=end_at, **fields)
    db.add(reservation)
    db.flush()
    return reservation


@pytest.mark.parametrize("seal, presence, reserved, expected", [
    (SealState.UNSEALED, Presence.ABSENT, False, SpaceState.FREE),
    (SealState.UNSEALED, Presence.ABSENT, True, SpaceState.AWAITING_PRESENCE),
    (SealState.UNSEALED, Presence.PRESENT, True, SpaceState.OCCUPIED_RESERVED),
    (SealState.UNSEALED, Presence.PRESENT, False, SpaceState.OCCUPIED_UNRESERVED),
    (SealState.UNSEALED, None, True, SpaceState.UNKNOWN),
    (SealState.SEALED, Presence.PRESENT, True, SpaceState.SEALED),
])
def test_space_state_matrix(db, seal, presence, reserved, expected):
    space = make_space(db)
    db.add(Device(id="esp32-AABBCCDDEEFF", space_id=space.id, seal=seal))
    if presence is not None:
        db.add(SpaceStatus(space_id=space.id, occupancy=presence, occupancy_since=NOW - MIN, last_observation_at=NOW - 5 * SEC))
    if reserved:
        make_reservation(db, space, NOW - 10 * MIN, NOW + 50 * MIN)
    db.commit()

    assert occupancy.space_state(db, space, NOW) == expected


def test_space_without_device_is_unknown(db):
    assert occupancy.space_state(db, make_space(db), NOW) == SpaceState.UNKNOWN


def test_current_reservation_interval(db):
    space = make_space(db)
    reservation = make_reservation(db, space, NOW, NOW + 30 * MIN)

    assert booking.current_reservation(db, space.id, NOW - SEC) is None
    assert booking.current_reservation(db, space.id, NOW) == reservation
    assert booking.current_reservation(db, space.id, NOW + 30 * MIN) is None
    assert booking.effective_end(reservation) == NOW + 30 * MIN

    reservation.status, reservation.released_at = ReservationStatus.RELEASED, NOW + 10 * MIN
    db.flush()
    assert booking.current_reservation(db, space.id, NOW + 15 * MIN) is None
    assert booking.effective_end(reservation) == NOW + 10 * MIN


def test_apply_observation_tracks_continuous_runs(db):
    space = make_space(db)

    def observe(presence, at):
        occupancy.apply_observation(db, space.id, presence, NOW + at * SEC)
        status = db.get(SpaceStatus, space.id)
        return status.occupancy, status.occupancy_since - NOW, status.last_observation_at - NOW

    assert observe(Presence.ABSENT, 0) == (Presence.ABSENT, 0 * SEC, 0 * SEC)
    assert observe(Presence.ABSENT, 10) == (Presence.ABSENT, 0 * SEC, 10 * SEC)
    assert observe(Presence.PRESENT, 20) == (Presence.PRESENT, 20 * SEC, 20 * SEC)
    # older than the current state: archived by the caller, state unchanged
    assert observe(Presence.ABSENT, 15) == (Presence.PRESENT, 20 * SEC, 20 * SEC)
    # a gap of 30 s or more starts a new run even with the same value
    assert observe(Presence.PRESENT, 50) == (Presence.PRESENT, 50 * SEC, 50 * SEC)
    db.commit()
    assert db.get(SpaceStatus, space.id).occupancy_since == NOW + 50 * SEC
