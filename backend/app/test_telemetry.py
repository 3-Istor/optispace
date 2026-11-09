import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models import AbsenceEpisode, Device, Notification, Observation, Space, SpaceStatus
from app.models.enums import EpisodeOutcome, NotificationType, Presence, ReservationStatus, SealState, SpaceType
from app.services import absence, devices
from app.testkit import at, book, iso, make_space

NOW = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)
SEC = timedelta(seconds=1)
KEY = "test-key"
DEVICE = "esp32-24A1B2C3D4E5"


def body(**fields):
    return {
        "schema": "optispace.telemetry/1", "device_id": DEVICE, "boot_id": "7f3a", "seq": 1,
        "kind": "heartbeat", "presence": "absent", "target": "none", "ts": "2026-11-02T09:00:00Z",
        "firmware_version": "0.3.0", "source": "real", **fields,
    }


@pytest.fixture
def post(client, settings_env):
    settings_env(DEVICE_API_KEY=KEY)
    return lambda payload, key=KEY: client.post("/api/v1/telemetry", json=payload, headers={"X-Api-Key": key})


def installed(db, seal=SealState.UNSEALED):
    space = Space(organization="demo-a", name="Bulle 2", type=SpaceType.INDIVIDUAL_BOOTH, capacity=1)
    db.add(space)
    db.flush()
    db.add(Device(id=DEVICE, space_id=space.id, seal=seal, first_seen_at=NOW - 3600 * SEC, last_seen_at=NOW - 3600 * SEC))
    db.commit()
    return space


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_telemetry_requires_api_key(client, post, settings_env):
    assert client.post("/api/v1/telemetry", json=body()).status_code == 401
    response = post(body(), key="wrong")
    assert (response.status_code, response.json()) == (401, {"detail": "INVALID_API_KEY"})

    settings_env(DEVICE_API_KEY="")  # unset key: every request is refused
    assert post(body(), key="").status_code == 401


def test_unknown_device_registered_sealed(post, db, frozen_clock):
    response = post(body())

    assert response.status_code == 200
    assert response.json() == {"accepted": False, "code": "DEVICE_SEALED", "state": {
        "seal": "sealed", "space_state": "sealed", "space_name": None, "reservation": None,
        "release_at": None, "updated_at": "2026-11-02T09:00:00Z",
    }}
    device = db.get(Device, DEVICE)
    assert (device.seal, device.space_id, device.firmware_version) == (SealState.SEALED, None, "0.3.0")
    assert device.first_seen_at == device.last_seen_at == NOW
    assert count(db, Observation) == 0

    frozen_clock.now = NOW + 10 * SEC
    post(body(seq=2, firmware_version="0.3.1"))
    db.expire_all()
    assert (device.first_seen_at, device.last_seen_at, device.firmware_version) == (NOW, NOW + 10 * SEC, "0.3.1")


def test_sealed_device_observation_ignored(post, db):
    space = installed(db, seal=SealState.SEALED)

    response = post(body(presence="present"))

    assert response.json()["accepted"] is False
    assert response.json()["code"] == "DEVICE_SEALED"
    assert count(db, Observation) == 0
    assert db.get(SpaceStatus, space.id) is None
    assert db.get(Device, DEVICE).last_seen_at == NOW


@pytest.mark.parametrize("payload", [
    body(presence="maybe"),
    body(seq=-1),
    body(device_id="esp32-24a1"),
    body(ts="2026-11-02T09:00:00"),  # no time zone
    {key: value for key, value in body().items() if key != "boot_id"},
    [body()],
])
def test_invalid_presence_400(post, payload):
    response = post(payload)

    assert (response.status_code, response.json()) == (400, {"detail": "INVALID_PAYLOAD"})


def test_invalid_json_400(client, post):
    response = client.post(
        "/api/v1/telemetry", content=b"{", headers={"X-Api-Key": KEY, "Content-Type": "application/json"},
    )

    assert (response.status_code, response.json()) == (400, {"detail": "INVALID_PAYLOAD"})


def test_other_routes_keep_fastapi_validation(client, claims):
    claims["groups"] = ["facility-managers"]

    assert client.patch("/api/v1/settings", json={"absence_delay_min": "x"}).status_code == 422


def test_unknown_schema_422(post):
    for payload in (body(schema="optispace.telemetry/0.1"), {"schema": "optispace.telemetry/2", "device_id": DEVICE}):
        response = post(payload)
        assert (response.status_code, response.json()) == (422, {"detail": "UNKNOWN_SCHEMA"})


def test_clock_skew_422(post, db):
    installed(db)

    response = post(body(ts="2026-11-02T09:01:01Z"))
    assert (response.status_code, response.json()) == (422, {"detail": "CLOCK_SKEW"})
    assert post(body(seq=2, ts="2026-11-02T09:01:00Z")).status_code == 200
    assert count(db, Observation) == 1


def test_simulated_source_refused_unless_allowed(post, db, settings_env):
    installed(db)

    response = post(body(source="simulated"))
    assert (response.status_code, response.json()) == (422, {"detail": "SIMULATED_NOT_ALLOWED"})
    assert count(db, Observation) == 0

    settings_env(DEVICE_API_KEY=KEY, ALLOW_SIMULATED_TELEMETRY="true")
    assert post(body(source="simulated")).json()["accepted"] is True
    assert count(db, Observation) == 1


def test_replay_identical_ignored(post, db, frozen_clock):
    installed(db)

    first, again = post(body()), post(body())
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    assert again.json()["accepted"] is True

    # unsynced clock: the replay arrives later but carries the same content
    post(body(seq=2, ts=None))
    frozen_clock.now = NOW + 5 * SEC
    assert post(body(seq=2, ts=None)).status_code == 200
    assert count(db, Observation) == 2


def test_replay_conflict_409(post, db):
    installed(db)
    post(body())

    response = post(body(presence="present"))

    assert (response.status_code, response.json()) == (409, {"detail": "DUPLICATE_EVENT_CONFLICT"})
    assert count(db, Observation) == 1


def test_valid_updates_status_and_returns_state(post, db, monkeypatch):
    space = installed(db)
    evaluated = []
    monkeypatch.setattr(absence, "evaluate_space", lambda db, space_id, now: evaluated.append((space_id, now)))

    response = post(body(kind="transition", presence="present", target="static"))

    assert response.status_code == 200
    assert response.json() == {"accepted": True, "code": None, "state": {
        "seal": "unsealed", "space_state": "occupied_unreserved", "space_name": "Bulle 2", "reservation": None,
        "release_at": None, "updated_at": "2026-11-02T09:00:00Z",
    }}
    assert evaluated == [(space.id, NOW)]
    status = db.get(SpaceStatus, space.id)
    assert (status.occupancy, status.last_observation_at) == (Presence.PRESENT, NOW)
    observation = db.scalar(select(Observation))
    assert (observation.space_id, observation.observed_at, observation.received_at) == (space.id, NOW, NOW)
    assert observation.clock_synced is True
    assert db.get(Device, DEVICE).last_seen_at == NOW


def test_older_observation_archived(post, db):
    space = installed(db)
    post(body(seq=2, presence="present"))

    # sent before seq 2 by the same boot, received after it
    assert post(body(seq=1, presence="absent", ts="2026-11-02T08:59:50Z")).status_code == 200

    assert count(db, Observation) == 2
    assert db.get(SpaceStatus, space.id).occupancy == Presence.PRESENT


def test_state_follows_seq_not_the_device_clock(post, db):
    space = installed(db)
    post(body(seq=1, presence="present"))

    # the clock stepped back (NTP correction): seq still says this one is newer
    post(body(seq=2, presence="absent", ts="2026-11-02T08:59:50Z"))

    assert db.get(SpaceStatus, space.id).occupancy == Presence.ABSENT


def stream(post, frozen_clock, space, presence, start, end, ahead):
    """A heartbeat every 10 s of server time from `start` to `end` included, from a device clock `ahead`."""
    when = start
    while when <= end:
        frozen_clock.now = when
        response = post(body(device_id=f"esp32-{space.id.hex[:12].upper()}", seq=int(when.timestamp()),
                             presence=presence, ts=iso(when + ahead)))
        assert response.json()["accepted"] is True
        when += 10 * SEC


def test_device_clock_ahead_going_silent_is_unknown(client, post, db, frozen_clock):
    space = make_space(db)
    reservation = book(db, space, at("10:00"), at("11:00"))
    stream(post, frozen_clock, space, "absent", at("10:00"), at("10:09:20"), 50 * SEC)
    frozen_clock.now = at("10:10")

    [listed] = client.get("/api/v1/spaces").json()

    assert (listed["space_state"], listed["occupancy_fresh_at"]) == ("unknown", iso(at("10:09:20")))
    db.expire_all()
    assert reservation.status == ReservationStatus.ACTIVE
    assert [e.outcome for e in db.scalars(select(AbsenceEpisode))] == [EpisodeOutcome.RELEASE_BLOCKED]


def test_device_clock_ahead_absence_run_starts_on_receipt(post, db, frozen_clock):
    space = make_space(db)
    reservation = book(db, space, at("10:00"), at("11:00"))
    stream(post, frozen_clock, space, "unknown", at("10:00"), at("10:01:50"), SEC)

    stream(post, frozen_clock, space, "absent", at("10:02"), at("10:12"), SEC)

    db.expire_all()
    assert (reservation.status, reservation.released_at) == (ReservationStatus.RELEASED, at("10:12"))
    [episode] = db.scalars(select(AbsenceEpisode)).all()
    assert (episode.opened_at, episode.outcome) == (at("10:02"), EpisodeOutcome.RELEASED)
    sent = db.scalars(select(Notification.type).order_by(Notification.created_at)).all()
    assert sent == [NotificationType.ABSENCE_WARNING, NotificationType.RELEASED]


def test_concurrent_copy_answered_as_replay(post, db, monkeypatch):
    installed(db)
    assert post(body()).status_code == 200
    real = devices._previous

    def missed(db, data):  # the copy looked before the first one committed
        monkeypatch.setattr(devices, "_previous", real)
        return None

    monkeypatch.setattr(devices, "_previous", missed)
    response = post(body())

    assert (response.status_code, response.json()["accepted"]) == (200, True)
    assert count(db, Observation) == 1


def test_ts_null_uses_received_at(post, db, frozen_clock):
    space = installed(db)
    frozen_clock.now = NOW + 7 * SEC

    assert post(body(ts=None)).status_code == 200

    observation = db.scalar(select(Observation))
    assert (observation.observed_at, observation.clock_synced) == (NOW + 7 * SEC, False)
    assert db.get(SpaceStatus, space.id).last_observation_at == NOW + 7 * SEC


def test_rejects_logged_without_key(post, capsys):
    post(body(seq=5), key="wrong")
    post(body(seq=6, presence="maybe"))

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [(line["device_id"], line["seq"], line["code"]) for line in lines] == [
        (DEVICE, 5, "INVALID_API_KEY"), (DEVICE, 6, "INVALID_PAYLOAD"),
    ]
    assert "wrong" not in json.dumps(lines) and KEY not in json.dumps(lines)
