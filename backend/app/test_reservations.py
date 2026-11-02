from unittest.mock import ANY

from sqlalchemy import func, select, text

from app.models import AbsenceEpisode, AvailabilityAlert, Notification, Reservation
from app.models.enums import EpisodeKind, NotificationType, ReservationStatus, SpaceType
from app.services import booking
from app.testkit import at, book, iso, make_space, make_user

URL = "/api/v1/reservations"


def post(client, space, start, end):
    return client.post(URL, json={"space_id": str(space.id), "start_at": iso(start), "end_at": iso(end)})


def patch(client, reservation_id, **fields):
    body = {k: iso(v) if hasattr(v, "tzinfo") else str(v) for k, v in fields.items()}
    return client.patch(f"{URL}/{reservation_id}", json=body)


def code(response):
    return response.status_code, response.json().get("detail") if response.content else None


def test_create_returns_the_reservation(client, db):
    space = make_space(db)

    response = post(client, space, at("10:00"), at("10:30"))

    assert response.status_code == 201
    assert response.json() == {
        "id": ANY, "space_id": str(space.id), "space_name": "Bulle 1", "start_at": iso(at("10:00")),
        "end_at": iso(at("10:30")), "status": "active", "released_at": None, "release_at": None,
    }


def test_create_aligned_5_min(client, db):
    space = make_space(db)

    for start, end in (("10:03", "10:30"), ("10:05", "10:33"), ("10:05:30", "10:30")):
        assert code(post(client, space, at(start), at(end))) == (422, "INVALID_SLOT")


def test_duration_bounds_by_type(client, db):
    room = make_space(db, "Salle 1", SpaceType.MEETING_ROOM, 6)
    booth = make_space(db, "Bulle 1")
    custom = make_space(db, "Bulle 2", min_duration_min=10, max_duration_min=90)

    for space, start, end, status in (
        (room, "10:00", "10:25", 422), (room, "10:00", "10:30", 201),
        (room, "11:00", "14:05", 422), (room, "11:00", "14:00", 201),
        (booth, "10:00", "10:10", 422), (booth, "10:00", "11:05", 422), (booth, "10:00", "11:00", 201),
        (custom, "10:00", "11:05", 201), (custom, "12:00", "12:10", 201), (custom, "13:00", "14:35", 422),
    ):
        assert post(client, space, at(start), at(end)).status_code == status, (space.name, start, end)


def test_no_past_start(client, db, frozen_clock):
    booth1, booth2, booth3 = (make_space(db, f"Bulle {n}") for n in (1, 2, 3))

    # now exactly on a boundary: that boundary is the earliest start
    assert post(client, booth1, at("10:00"), at("10:30")).status_code == 201
    frozen_clock.now = at("10:00:01")
    assert code(post(client, booth2, at("10:00"), at("10:30"))) == (422, "INVALID_SLOT")
    assert post(client, booth2, at("10:05"), at("10:30")).status_code == 201
    frozen_clock.now = at("10:03")
    assert code(post(client, booth3, at("09:55"), at("10:30"))) == (422, "INVALID_SLOT")


def test_overlap_same_space_409(client, db):
    space = make_space(db)
    assert post(client, space, at("10:00"), at("11:00")).status_code == 201
    assert post(client, space, at("12:00"), at("12:30")).status_code == 201

    assert code(post(client, space, at("10:30"), at("11:30"))) == (409, "RESERVATION_CONFLICT")
    assert code(post(client, space, at("10:55"), at("11:15"))) == (409, "RESERVATION_CONFLICT")
    assert code(post(client, space, at("11:45"), at("12:05"))) == (409, "RESERVATION_CONFLICT")
    # [start, end[: touching intervals do not overlap
    assert post(client, space, at("11:00"), at("11:30")).status_code == 201
    assert post(client, space, at("11:30"), at("12:00")).status_code == 201


def test_overlap_other_space_allowed(client, db):
    booth1, booth2 = make_space(db, "Bulle 1"), make_space(db, "Bulle 2")

    assert post(client, booth1, at("10:00"), at("11:00")).status_code == 201
    assert post(client, booth2, at("10:00"), at("11:00")).status_code == 201


def test_released_or_cancelled_time_is_bookable(client, db, frozen_clock):
    space = make_space(db)
    book(db, space, at("10:00"), at("11:00"), status=ReservationStatus.RELEASED, released_at=at("10:10"))
    book(db, space, at("11:00"), at("12:00"), status=ReservationStatus.CANCELLED, cancelled_at=at("10:00"))
    frozen_clock.now = at("10:10")

    assert code(post(client, space, at("10:05"), at("10:30"))) == (422, "INVALID_SLOT")
    assert post(client, space, at("10:10"), at("10:40")).status_code == 201
    assert post(client, space, at("11:00"), at("11:30")).status_code == 201


def test_inactive_space_422(client, db):
    space = make_space(db, is_active=False)

    assert code(post(client, space, at("10:00"), at("10:30"))) == (422, "INVALID_SLOT")


def test_unknown_space_404(client):
    response = client.post(URL, json={
        "space_id": "00000000-0000-0000-0000-000000000000", "start_at": iso(at("10:00")), "end_at": iso(at("10:30")),
    })

    assert code(response) == (404, "SPACE_NOT_FOUND")


def test_concurrent_booking_rejected_by_the_database(client, db, monkeypatch):
    """Two requests passed the service check before either committed: the database decides."""
    space = make_space(db)
    # Stands in for the PostgreSQL exclusion constraint, which SQLite lacks.
    db.execute(text("""
        CREATE TRIGGER fake_no_overlap BEFORE INSERT ON reservation
        WHEN EXISTS (SELECT 1 FROM reservation WHERE space_id = NEW.space_id AND status <> 'cancelled'
                     AND start_at < NEW.end_at AND COALESCE(released_at, end_at) > NEW.start_at)
        BEGIN SELECT RAISE(ABORT, 'conflicting key value violates exclusion constraint "reservation_no_overlap"'); END
    """))
    db.commit()
    assert post(client, space, at("10:00"), at("11:00")).status_code == 201
    monkeypatch.setattr(booking, "_overlaps", lambda *args, **kwargs: False)

    assert code(post(client, space, at("10:30"), at("11:00"))) == (409, "RESERVATION_CONFLICT")
    assert db.scalar(select(func.count()).select_from(Reservation)) == 1
    assert post(client, space, at("11:00"), at("11:30")).status_code == 201


def test_modify_before_start_any_field(client, db):
    booth1, booth2 = make_space(db, "Bulle 1"), make_space(db, "Bulle 2")
    book(db, booth2, at("13:00"), at("13:30"))
    reservation_id = post(client, booth1, at("11:00"), at("11:30")).json()["id"]

    response = patch(client, reservation_id, space_id=booth2.id, start_at=at("12:00"), end_at=at("12:45"))

    assert response.status_code == 200
    assert response.json() == {
        "id": ANY, "space_id": str(booth2.id), "space_name": "Bulle 2", "start_at": iso(at("12:00")),
        "end_at": iso(at("12:45")), "status": "active", "released_at": None, "release_at": None,
    }
    assert code(patch(client, reservation_id, start_at=at("12:50"), end_at=at("13:15"))) == (409, "RESERVATION_CONFLICT")
    assert code(patch(client, reservation_id, start_at=at("12:02"))) == (422, "INVALID_SLOT")
    assert code(patch(client, reservation_id, end_at=at("13:45"))) == (422, "INVALID_SLOT")  # 105 min > 60
    # its own current slot does not conflict with itself
    assert patch(client, reservation_id, end_at=at("13:00")).status_code == 200


def test_modify_in_progress_end_only(client, db, frozen_clock):
    booth1, booth2 = make_space(db, "Bulle 1"), make_space(db, "Bulle 2")
    reservation_id = post(client, booth1, at("10:00"), at("11:00")).json()["id"]
    frozen_clock.now = at("10:07")

    assert code(patch(client, reservation_id, start_at=at("10:05"))) == (422, "INVALID_SLOT")
    assert code(patch(client, reservation_id, space_id=booth2.id)) == (422, "INVALID_SLOT")
    assert code(patch(client, reservation_id, end_at=at("10:05"))) == (422, "INVALID_SLOT")  # already past
    assert code(patch(client, reservation_id, end_at=at("11:05"))) == (422, "INVALID_SLOT")  # over the 60 min max
    assert code(patch(client, reservation_id, end_at=at("10:32"))) == (422, "INVALID_SLOT")
    # shortening a started booking below the minimum is allowed: it frees the space
    assert patch(client, reservation_id, end_at=at("10:10")).json()["end_at"] == iso(at("10:10"))
    assert patch(client, reservation_id, start_at=at("10:00"), end_at=at("10:55")).json()["end_at"] == iso(at("10:55"))


def test_modify_or_cancel_ended_409(client, db, frozen_clock):
    user = make_user(db, "u1")
    ended = book(db, make_space(db, "Bulle 1"), at("09:00"), at("09:30"), user=user)
    released = book(db, make_space(db, "Bulle 2"), at("09:50"), at("10:20"), user=user,
                    status=ReservationStatus.RELEASED, released_at=at("10:00"))
    cancelled = book(db, make_space(db, "Bulle 3"), at("11:00"), at("11:30"), user=user,
                     status=ReservationStatus.CANCELLED, cancelled_at=at("09:00"))

    for reservation in (ended, released, cancelled):
        assert code(patch(client, reservation.id, end_at=at("11:45"))) == (409, "RESERVATION_ENDED")
        assert code(client.delete(f"{URL}/{reservation.id}")) == (409, "RESERVATION_ENDED")
    # [start, end[: at end_at the reservation is over
    current = book(db, make_space(db, "Bulle 4"), at("10:00"), at("10:30"), user=user)
    frozen_clock.now = at("10:30")
    assert code(client.delete(f"{URL}/{current.id}")) == (409, "RESERVATION_ENDED")


def test_modify_or_cancel_not_owner_403(client, db):
    other = book(db, make_space(db), at("11:00"), at("11:30"))

    assert code(patch(client, other.id, end_at=at("11:45"))) == (403, "NOT_OWNER")
    assert code(client.delete(f"{URL}/{other.id}")) == (403, "NOT_OWNER")
    assert code(client.delete(f"{URL}/00000000-0000-0000-0000-000000000000")) == (404, "RESERVATION_NOT_FOUND")


def test_cancel(client, db, frozen_clock):
    reservation_id = post(client, make_space(db), at("11:00"), at("11:30")).json()["id"]
    frozen_clock.now = at("10:20")

    response = client.delete(f"{URL}/{reservation_id}")

    assert response.status_code == 204
    reservation = db.scalar(select(Reservation))
    assert (reservation.status, reservation.cancelled_at) == (ReservationStatus.CANCELLED, at("10:20"))


def _alert(db, sub, start, end, space_type=SpaceType.INDIVIDUAL_BOOTH, min_capacity=1):
    alert = AvailabilityAlert(user_id=make_user(db, sub).id, start_at=start, end_at=end,
                              space_type=space_type, min_capacity=min_capacity)
    db.add(alert)
    db.commit()
    return alert


def _available(db):
    return [(n.user_id, n.params) for n in db.scalars(
        select(Notification).where(Notification.type == NotificationType.SPACE_AVAILABLE))]


def test_cancel_frees_and_triggers_alerts(client, db, frozen_clock):
    space = make_space(db)
    reservation_id = post(client, space, at("10:00"), at("11:00")).json()["id"]
    alert = _alert(db, "u2", at("10:30"), at("11:30"))
    frozen_clock.now = at("10:20")

    assert client.delete(f"{URL}/{reservation_id}").status_code == 204

    # frees [max(now, start_at), end_at[, notified on the alert's slot
    assert _available(db) == [(alert.user_id, {
        "space_name": "Bulle 1", "space_type": "individual_booth",
        "start_at": iso(at("10:30")), "end_at": iso(at("11:00")),
    })]


def test_modify_frees_time_and_triggers_alerts(client, db, frozen_clock):
    space = make_space(db)
    reservation_id = post(client, space, at("10:00"), at("11:00")).json()["id"]
    alert = _alert(db, "u2", at("10:45"), at("11:15"))
    frozen_clock.now = at("10:10")

    assert patch(client, reservation_id, end_at=at("10:30")).status_code == 200

    assert _available(db) == [(alert.user_id, {
        "space_name": "Bulle 1", "space_type": "individual_booth",
        "start_at": iso(at("10:45")), "end_at": iso(at("11:00")),
    })]


def test_reservations_mine(client, db, frozen_clock):
    user = make_user(db, "u1")
    booth = make_space(db)
    old = book(db, booth, at("10:00", day=1), at("10:30", day=1), user=user)
    now = book(db, booth, at("10:00"), at("11:00"), user=user)
    later = book(db, booth, at("12:00"), at("12:30"), user=user)
    book(db, booth, at("13:00"), at("13:30"))  # someone else's
    db.add(AbsenceEpisode(reservation_id=now.id, kind=EpisodeKind.NO_SHOW, opened_at=at("10:00"), deadline_at=at("10:10")))
    db.commit()
    frozen_clock.now = at("10:05")

    everything = client.get(f"{URL}/mine").json()
    recent = client.get(f"{URL}/mine", params={"from": iso(at("09:00"))}).json()

    assert [r["id"] for r in everything] == [str(old.id), str(now.id), str(later.id)]
    assert [r["id"] for r in recent] == [str(now.id), str(later.id)]
    assert recent[0] == {
        "id": str(now.id), "space_id": str(booth.id), "space_name": "Bulle 1", "start_at": iso(at("10:00")),
        "end_at": iso(at("11:00")), "status": "active", "released_at": None, "release_at": iso(at("10:10")),
    }
