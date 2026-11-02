"""Spec §4.2 examples with D = 10 min, reservation 10:00-11:00 Paris, telemetry every 10 s."""
import pytest
from sqlalchemy import select

from app.models import AbsenceEpisode, AvailabilityAlert, Device, Notification
from app.models.enums import (
    EpisodeKind, EpisodeOutcome, NotificationType, Presence, ReservationStatus, SealState, SpaceType,
)
from app.services import absence
from app.testkit import at, book, heartbeats, iso, make_space, make_user

ABSENT, PRESENT = Presence.ABSENT, Presence.PRESENT
WARNING, RELEASED = NotificationType.ABSENCE_WARNING, NotificationType.RELEASED


@pytest.fixture
def space(db):
    return make_space(db)


@pytest.fixture
def owner(db):
    return make_user(db, "u1")


@pytest.fixture
def reservation(db, space, owner):
    return book(db, space, at("10:00"), at("11:00"), user=owner)


def sent(db, type):
    return db.scalars(select(Notification).where(Notification.type == type).order_by(Notification.created_at)).all()


def episodes(db):
    return db.scalars(select(AbsenceEpisode).order_by(AbsenceEpisode.opened_at)).all()


def test_no_show_notified_at_start(db, space, reservation):
    heartbeats(db, space, ABSENT, at("09:59:30"), at("10:00"))

    [episode] = episodes(db)
    assert (episode.kind, episode.opened_at, episode.deadline_at, episode.outcome) == (
        EpisodeKind.NO_SHOW, at("10:00"), at("10:10"), EpisodeOutcome.PENDING)
    [warning] = sent(db, WARNING)
    assert (warning.user_id, warning.reservation_id, warning.space_id) == (reservation.user_id, reservation.id, space.id)
    assert warning.params == {"space_name": "Bulle 1", "at": iso(at("10:10"))}


def test_release_at_deadline(db, space, reservation):
    alert = AvailabilityAlert(user_id=make_user(db, "u3").id, start_at=at("10:30"), end_at=at("11:30"),
                              space_type=SpaceType.INDIVIDUAL_BOOTH)
    db.add(alert)
    db.commit()
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:09:50"))
    assert reservation.status == ReservationStatus.ACTIVE

    heartbeats(db, space, ABSENT, at("10:10"), at("10:10"))

    assert (reservation.status, reservation.released_at) == (ReservationStatus.RELEASED, at("10:10"))
    [episode] = episodes(db)
    assert (episode.outcome, episode.closed_at) == (EpisodeOutcome.RELEASED, at("10:10"))
    [released] = sent(db, RELEASED)
    assert (released.user_id, released.params) == (reservation.user_id, {"space_name": "Bulle 1", "at": iso(at("10:10"))})
    [available] = sent(db, NotificationType.SPACE_AVAILABLE)
    assert (available.user_id, available.params["start_at"], available.params["end_at"]) == (
        alert.user_id, iso(at("10:30")), iso(at("11:00")))


def test_presence_before_deadline_keeps(db, space, reservation):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:05:50"))
    heartbeats(db, space, PRESENT, at("10:06"), at("10:12"))

    [episode] = episodes(db)
    assert (episode.outcome, episode.closed_at) == (EpisodeOutcome.PRESENCE_DETECTED, at("10:06"))
    assert reservation.status == ReservationStatus.ACTIVE
    assert len(sent(db, WARNING)) == 1
    assert sent(db, RELEASED) == []


def test_early_departure(db, space, reservation):
    heartbeats(db, space, PRESENT, at("09:59:50"), at("10:29:50"))
    heartbeats(db, space, ABSENT, at("10:30"), at("10:39:50"))
    assert episodes(db) == []

    heartbeats(db, space, ABSENT, at("10:40"), at("10:50"))

    [episode] = episodes(db)
    assert (episode.kind, episode.opened_at, episode.deadline_at, episode.outcome) == (
        EpisodeKind.EARLY_DEPARTURE, at("10:40"), at("10:50"), EpisodeOutcome.RELEASED)
    [warning] = sent(db, WARNING)
    assert warning.params["at"] == iso(at("10:50"))
    assert reservation.released_at == at("10:50")
    assert len(sent(db, RELEASED)) == 1


def test_new_absence_after_presence_is_an_early_departure(db, space, reservation):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:05:50"))
    heartbeats(db, space, PRESENT, at("10:06"), at("10:09:50"))
    heartbeats(db, space, ABSENT, at("10:10"), at("10:30"))

    first, second = episodes(db)
    assert first.outcome == EpisodeOutcome.PRESENCE_DETECTED
    assert (second.kind, second.opened_at, second.deadline_at) == (EpisodeKind.EARLY_DEPARTURE, at("10:20"), at("10:30"))
    assert reservation.released_at == at("10:30")


def test_unknown_at_deadline_blocks(db, space, reservation):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:05"))
    # no telemetry since 10:05: the device is offline at the deadline
    absence.evaluate_space(db, space.id, at("10:10"))
    db.commit()

    [episode] = episodes(db)
    assert (episode.outcome, episode.closed_at) == (EpisodeOutcome.RELEASE_BLOCKED, at("10:10"))
    assert reservation.status == ReservationStatus.ACTIVE
    assert sent(db, RELEASED) == []

    # absence re-established at 10:12: a new no_show episode D minutes later
    heartbeats(db, space, ABSENT, at("10:12"), at("10:21:50"))
    assert len(episodes(db)) == 1
    heartbeats(db, space, ABSENT, at("10:22"), at("10:22"))
    second = episodes(db)[1]
    assert (second.kind, second.opened_at, second.deadline_at) == (EpisodeKind.NO_SHOW, at("10:22"), at("10:32"))
    assert len(sent(db, WARNING)) == 2


def test_gap_during_episode_blocks(db, space, reservation):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:03"))
    heartbeats(db, space, ABSENT, at("10:04"), at("10:10"))  # 60 s without telemetry before

    [episode] = episodes(db)
    assert episode.outcome == EpisodeOutcome.RELEASE_BLOCKED
    assert reservation.status == ReservationStatus.ACTIVE


def test_sealed_device_never_released(db, space, reservation):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:05"))
    db.scalar(select(Device)).seal = SealState.SEALED
    db.commit()

    heartbeats(db, space, ABSENT, at("10:05:10"), at("10:10"))

    [episode] = episodes(db)
    assert episode.outcome == EpisodeOutcome.RELEASE_BLOCKED
    assert reservation.status == ReservationStatus.ACTIVE


@pytest.mark.parametrize("before", [
    [(PRESENT, "09:59:50", "10:09:50"), (ABSENT, "10:10", "10:15")],  # presence, then absence at 10:10
    [(ABSENT, "10:05", "10:15")],  # unknown until 10:05: deadline 10:15 = end
])
def test_no_episode_when_deadline_after_end(db, space, owner, before):
    book(db, space, at("10:00"), at("10:15"), user=owner)

    for presence, start, end in before:
        heartbeats(db, space, presence, at(start), at(end))

    assert episodes(db) == []
    assert sent(db, WARNING) == []


def test_episode_when_deadline_just_before_end(db, space, owner):
    book(db, space, at("10:00"), at("10:15"), user=owner)

    heartbeats(db, space, ABSENT, at("10:04:50"), at("10:04:50"))

    [episode] = episodes(db)
    assert episode.deadline_at == at("10:14:50")


def test_evaluate_idempotent(db, space, reservation):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:00"))
    absence.evaluate_space(db, space.id, at("10:00"))
    heartbeats(db, space, ABSENT, at("10:00:10"), at("10:10"))

    absence.evaluate_space(db, space.id, at("10:10"))
    absence.evaluate_space(db, space.id, at("10:10"))
    db.commit()

    assert len(episodes(db)) == 1
    assert len(sent(db, WARNING)) == 1
    assert len(sent(db, RELEASED)) == 1
    assert reservation.released_at == at("10:10")


def test_modify_end_before_deadline_closes_episode(client, db, space, reservation, frozen_clock):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:03"))
    frozen_clock.now = at("10:03")

    response = client.patch(f"/api/v1/reservations/{reservation.id}", json={"end_at": iso(at("10:05"))})

    assert response.status_code == 200
    db.expire_all()
    [episode] = episodes(db)
    assert (episode.outcome, episode.closed_at) == (EpisodeOutcome.CANCELLED, at("10:03"))
    heartbeats(db, space, ABSENT, at("10:03:10"), at("10:10"))
    assert (reservation.status, reservation.end_at) == (ReservationStatus.ACTIVE, at("10:05"))
    assert len(sent(db, WARNING)) == 1
    assert sent(db, RELEASED) == []


def test_modify_extending_keeps_the_deadline(client, db, space, reservation, frozen_clock):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:03"))
    frozen_clock.now = at("10:03")

    assert client.patch(f"/api/v1/reservations/{reservation.id}", json={"end_at": iso(at("10:55"))}).status_code == 200
    db.expire_all()
    heartbeats(db, space, ABSENT, at("10:03:10"), at("10:10"))

    assert reservation.released_at == at("10:10")
    assert len(sent(db, RELEASED)) == 1


def test_cancel_closes_episode(client, db, space, reservation, frozen_clock):
    heartbeats(db, space, ABSENT, at("09:59:50"), at("10:03"))
    frozen_clock.now = at("10:03")

    assert client.delete(f"/api/v1/reservations/{reservation.id}").status_code == 204
    db.expire_all()
    heartbeats(db, space, ABSENT, at("10:03:10"), at("10:10"))

    [episode] = episodes(db)
    assert (episode.outcome, episode.closed_at) == (EpisodeOutcome.CANCELLED, at("10:03"))
    assert reservation.status == ReservationStatus.CANCELLED
    assert sent(db, RELEASED) == []
