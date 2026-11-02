"""Exigences POC §6.2, data set J-01 and its variants (Salle A, 09:00-12:00 Paris)."""
from unittest.mock import ANY

import pytest

from app.models import AbsenceEpisode, Observation
from app.models.enums import EpisodeKind, EpisodeOutcome, ObservationKind, Presence, ReservationStatus, Source, SpaceType
from app.services import insights
from app.testkit import MIN, at, book, iso, make_space

FM = ["project-admins"]


def minutes(db, space, presence, start, end):
    """One valid observation at the start of every minute of [start, end[."""
    when = at(start)
    while when < at(end):
        db.add(Observation(
            device_id="esp32-A", space_id=space.id, boot_id="b", seq=int(when.timestamp()),
            kind=ObservationKind.HEARTBEAT, presence=presence, target=None, observed_at=when, received_at=when,
            clock_synced=True, source=Source.SIMULATED,
        ))
        when += MIN
    db.commit()


@pytest.fixture
def salle(db):
    return make_space(db, "Salle A", SpaceType.MEETING_ROOM, 6, device=False)


def j01(db, salle, released=True):
    book(db, salle, at("09:00"), at("10:00"))  # R-A
    rb = book(db, salle, at("11:00"), at("12:00"),
              **({"status": ReservationStatus.RELEASED, "released_at": at("11:10")} if released else {}))
    if released:
        db.add(AbsenceEpisode(reservation_id=rb.id, kind=EpisodeKind.NO_SHOW, opened_at=at("11:00"),
                              deadline_at=at("11:10"), outcome=EpisodeOutcome.RELEASED, closed_at=at("11:10")))
        db.commit()
    minutes(db, salle, Presence.PRESENT, "09:00", "10:30")


def test_j01(client, db, claims, frozen_clock, salle):
    j01(db, salle)
    minutes(db, salle, Presence.ABSENT, "10:30", "12:00")
    frozen_clock.now = at("12:01")
    claims["groups"] = FM

    response = client.get(f"/api/v1/spaces/{salle.id}/insights", params={"from": iso(at("09:00")), "to": iso(at("12:00"))})

    assert response.status_code == 200
    body = response.json()
    assert body["kpis"] == {
        "period_min": 180, "observed_min": 180, "unknown_min": 0, "occupied_min": 90,
        "occupied_reserved_min": 60, "occupied_unreserved_min": 30, "occupancy_pct": 50.0,
        "reserved_initial_min": 120, "reserved_initial_pct": pytest.approx(200 / 3),  # rates are not rounded
        "no_show_count": 1, "evaluated_count": 2, "not_evaluated_count": 0, "no_show_pct": 50.0,
        "released_min": 50, "releases_succeeded": 1, "releases_failed": 0, "coverage_pct": 100.0,
    }
    assert body["summary"]["text"] == (
        "Pour Salle A, de 09:00 à 12:00, l'occupation observée est de 90 minutes sur 180 (50 %), "
        "dont 60 minutes pendant une réservation et 30 minutes sans réservation. "
        "1 no-show sur 2 réservations évaluées. 50 minutes libérées (1 libération réussie, 0 échouée). "
        "Les observations couvrent toute la période."
    )
    assert (body["summary"]["mode"], body["summary"]["model_version"]) == ("template_fallback", None)
    assert body["no_shows"] == [{
        "reservation_id": ANY, "start_at": iso(at("11:00")), "end_at": iso(at("12:00")), "released_at": iso(at("11:10")),
    }]
    assert {k: body[k] for k in ("schema_version", "room_id", "period", "generated_at", "as_of", "rules_version",
                                 "source_mode", "status", "warnings", "recommendations")} == {
        "schema_version": "1.0", "room_id": str(salle.id), "period": {"from": iso(at("09:00")), "to": iso(at("12:00"))},
        "generated_at": iso(at("12:01")), "as_of": iso(at("12:01")), "rules_version": "1.0",
        "source_mode": "simulated", "status": "ok", "warnings": [], "recommendations": [],
    }
    assert body["summary"]["facts_revision"] == body["data_revision"]


def test_j02_partial_coverage(db, salle):
    j01(db, salle, released=False)
    minutes(db, salle, Presence.ABSENT, "10:30", "11:00")
    minutes(db, salle, Presence.ABSENT, "11:20", "12:00")  # unknown 11:00-11:20

    result = insights.compute(db, salle.id, at("09:00"), at("12:00"), at("12:01"))

    k = result["kpis"]
    assert (k["observed_min"], k["occupied_min"], k["occupancy_pct"], k["coverage_pct"], k["unknown_min"]) == (
        160, 90, 56.25, pytest.approx(800 / 9), 20)
    assert (k["no_show_count"], k["evaluated_count"], k["not_evaluated_count"], k["no_show_pct"], k["released_min"]) == (
        0, 1, 1, 0.0, 0)
    assert (result["status"], result["warnings"], result["no_shows"]) == ("partial", ["MISSING_SENSOR_DATA"], [])
    assert result["summary"]["text"].endswith(
        "0 no-show sur 1 réservation évaluée. Les observations couvrent 88,9 % de la période (20 minutes inconnues).")


def test_j04_no_data(db, salle):
    result = insights.compute(db, salle.id, at("09:00"), at("10:00"), at("12:00"))

    k = result["kpis"]
    assert (k["observed_min"], k["occupancy_pct"], k["coverage_pct"], k["no_show_pct"], k["reserved_initial_min"]) == (
        0, None, 0.0, None, 0)
    assert (result["status"], result["source_mode"]) == ("no_data", None)
    assert result["summary"]["text"] == (
        "Pour Salle A, de 09:00 à 10:00, l'occupation ne peut pas être évaluée faute d'observations. "
        "Aucune réservation n'a pu être évaluée pour les no-shows. "
        "Les observations couvrent 0 % de la période (60 minutes inconnues)."
    )


def test_j05_replay_is_stable(db, salle):
    j01(db, salle)
    minutes(db, salle, Presence.ABSENT, "10:30", "12:00")

    first = insights.compute(db, salle.id, at("09:00"), at("12:00"), at("12:01"))

    assert insights.compute(db, salle.id, at("09:00"), at("12:00"), at("12:01")) == first


def test_period_after_now_is_cut(db, salle):
    result = insights.compute(db, salle.id, at("09:00"), at("12:00"), at("10:30:20"))

    assert result["period"] == {"from": iso(at("09:00")), "to": iso(at("10:30"))}


def test_insights_access_and_errors(client, db, claims, salle):
    url = f"/api/v1/spaces/{salle.id}/insights"
    period = {"from": iso(at("09:00")), "to": iso(at("10:00"))}
    assert client.get(url, params=period).status_code == 403
    claims["groups"] = FM

    for bad in ({"from": iso(at("09:00:30")), "to": period["to"]}, {"from": period["to"], "to": period["from"]}):
        response = client.get(url, params=bad)
        assert (response.status_code, response.json()) == (400, {"detail": "INVALID_PERIOD"})
    missing = client.get("/api/v1/spaces/00000000-0000-0000-0000-000000000000/insights", params=period)
    assert (missing.status_code, missing.json()) == (404, {"detail": "SPACE_NOT_FOUND"})
