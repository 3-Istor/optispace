"""Exigences POC §6.2, data set J-01 and its variants (Salle A, 09:00-12:00 Paris)."""
import json
from unittest.mock import ANY

import httpx
import pytest
from sqlalchemy import event

from app.models import AbsenceEpisode, Observation
from app.models.enums import EpisodeKind, EpisodeOutcome, ObservationKind, Presence, ReservationStatus, Source, SpaceType
from app.services import insights
from app.testkit import MIN, at, book, iso, make_space

FM = ["facility-managers"]


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


def gemini_response(*ids, recommendation_id="CHECK_COVERAGE"):
    content = json.dumps({"fact_ids": ids, "recommendation_id": recommendation_id})
    return {
        "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": content}]}}],
        "modelVersion": "gemini-3.1-flash-lite",
    }


def test_gemini_summary_uses_only_calculated_facts(client, db, claims, frozen_clock, salle, settings_env, monkeypatch):
    j01(db, salle)
    minutes(db, salle, Presence.ABSENT, "10:30", "12:00")
    frozen_clock.now = at("12:01")
    settings_env(GEMINI_API_KEY="test-key")
    requests = []

    def post(url, *, headers, json, timeout):
        requests.append((url, headers, json, timeout))
        return httpx.Response(200, json=gemini_response("OCCUPANCY", "UNRESERVED", "NO_SHOW", recommendation_id="REVIEW_UNRESERVED"),
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)
    path = f"/api/v1/spaces/{salle.id}/insights"
    params = {"from": iso(at("09:00")), "to": iso(at("12:00"))}
    assert client.post(f"{path}/summary", params=params).status_code == 403
    claims["groups"] = FM
    ordinary = client.get(path, params=params).json()
    assert ordinary["summary"]["mode"] == "template_fallback"
    assert ordinary["summary"]["provider_status"] == "not_requested"
    assert ordinary["recommendations"] == []
    assert requests == []

    response = client.post(f"{path}/summary", params=params)
    assert response.status_code == 200
    body = response.json()
    assert body["kpis"] == ordinary["kpis"]
    assert body["summary"] == {
        "status": "ready", "mode": "llm_assisted",
        "text": "L’occupation mesurée est de 90 minutes sur 180 (50 %). "
                "L’espace a été occupé sans réservation pendant 30 minutes. "
                "1 no-show sur 2 réservations évaluées.",
        "fact_ids": ["OCCUPANCY", "UNRESERVED", "NO_SHOW"], "facts_revision": body["data_revision"],
        "model_version": "gemini-3.1-flash-lite", "warnings": [], "provider_status": "ready",
    }
    assert body["recommendations"] == [{
        "title": "Examiner l’usage hors réservation",
        "text": "Dans l’historique de la salle, comparez les créneaux occupés au planning pour repérer les usages sans réservation.",
    }]
    [(url, headers, payload, timeout)] = requests
    assert url == "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
    assert headers == {"x-goog-api-key": "test-key"}
    assert timeout == 12.0
    assert json.loads(payload["contents"][0]["parts"][0]["text"]) == {"kpis": body["kpis"]}
    assert payload["generationConfig"]["responseJsonSchema"]["properties"]["fact_ids"]["items"]["enum"] == [
        "OCCUPANCY", "COVERAGE", "UNRESERVED", "NO_SHOW",
    ]
    assert payload["generationConfig"]["responseJsonSchema"]["properties"]["recommendation_id"]["enum"] == [
        "REVIEW_UNRESERVED", "REVIEW_NO_SHOWS",
    ]


@pytest.mark.parametrize("outcome", ["valid", "missing_coverage", "inapplicable", "inapplicable_recommendation", "duplicate", "too_many", "quota", "timeout"])
def test_gemini_summary_partial_coverage(db, salle, settings_env, monkeypatch, caplog, outcome):
    minutes(db, salle, Presence.PRESENT, "09:00", "09:01")
    settings_env(GEMINI_API_KEY="test-key")

    def post(url, **kwargs):
        request = httpx.Request("POST", url)
        if outcome == "timeout":
            raise httpx.ReadTimeout("test deadline", request=request)
        if outcome == "quota":
            return httpx.Response(429, json={"error": {"message": "Quota exhausted for test-key"}}, request=request)
        ids = {
            "valid": ["OCCUPANCY", "COVERAGE"],
            "missing_coverage": ["OCCUPANCY"],
            "inapplicable": ["NO_SHOW", "COVERAGE"],
            "inapplicable_recommendation": ["OCCUPANCY", "COVERAGE"],
            "duplicate": ["COVERAGE", "COVERAGE"],
            "too_many": ["OCCUPANCY", "UNRESERVED", "COVERAGE", "NO_SHOW"],
        }[outcome]
        recommendation = "REVIEW_NO_SHOWS" if outcome == "inapplicable_recommendation" else "CHECK_COVERAGE"
        return httpx.Response(200, json=gemini_response(*ids, recommendation_id=recommendation), request=request)

    monkeypatch.setattr(httpx, "post", post)
    result = insights.compute(db, salle.id, at("09:00"), at("10:00"), at("10:01"), assist_summary=True)

    assert result["warnings"] == ["MISSING_SENSOR_DATA"]
    assert result["summary"]["text"].endswith("Les observations couvrent 1,7 % de la période (59 minutes inconnues).")
    if outcome == "valid":
        assert result["summary"]["mode"] == "llm_assisted"
        assert result["summary"]["provider_status"] == "ready"
        assert result["summary"]["fact_ids"] == ["OCCUPANCY", "COVERAGE"]
        assert result["recommendations"][0]["title"] == "Vérifier les mesures manquantes"
    else:
        assert result["summary"]["mode"] == "template_fallback"
        assert result["summary"]["provider_status"] == "unavailable"
        assert result["summary"]["model_version"] is None
        assert result["recommendations"] == []
    if outcome == "quota":
        assert "HTTP 429" in caplog.text
        assert "[masked]" in caplog.text
        assert "test-key" not in caplog.text


def test_gemini_is_skipped_without_observations(db, salle, settings_env, monkeypatch):
    settings_env(GEMINI_API_KEY="test-key")

    def unexpected_post(*args, **kwargs):
        pytest.fail("Gemini should not be called without observations")

    monkeypatch.setattr(httpx, "post", unexpected_post)
    result = insights.compute(db, salle.id, at("09:00"), at("10:00"), at("10:01"), assist_summary=True)
    assert result["summary"]["mode"] == "template_fallback"
    assert result["summary"]["provider_status"] == "insufficient_data"


def test_summary_without_key_is_explicit(client, db, claims, frozen_clock, salle, settings_env, monkeypatch):
    settings_env(GEMINI_API_KEY="")
    minutes(db, salle, Presence.ABSENT, "09:00", "10:00")
    claims["groups"] = FM
    frozen_clock.now = at("10:01")

    def unexpected_post(*args, **kwargs):
        pytest.fail("Gemini should not be called without a configured key")

    monkeypatch.setattr(httpx, "post", unexpected_post)
    path = f"/api/v1/spaces/{salle.id}/insights"
    params = {"from": iso(at("09:00")), "to": iso(at("10:00"))}
    ordinary = client.get(path, params=params).json()
    response = client.post(f"{path}/summary", params=params)
    assert response.status_code == 200
    body = response.json()
    assert body["kpis"]["occupancy_pct"] == 0
    assert body["summary"]["provider_status"] == ordinary["summary"]["provider_status"] == "not_configured"
    assert body["summary"]["mode"] == "template_fallback"
    assert body["summary"]["model_version"] is None
    assert body["summary"]["facts_revision"] == body["data_revision"]


def test_j05_replay_is_stable(db, salle):
    j01(db, salle)
    minutes(db, salle, Presence.ABSENT, "10:30", "12:00")

    first = insights.compute(db, salle.id, at("09:00"), at("12:00"), at("12:01"))

    assert insights.compute(db, salle.id, at("09:00"), at("12:00"), at("12:01")) == first


def test_period_after_now_is_cut(db, salle):
    result = insights.compute(db, salle.id, at("09:00"), at("12:00"), at("10:30:20"))

    assert result["period"] == {"from": iso(at("09:00")), "to": iso(at("10:30"))}


def test_no_elapsed_minute_is_no_data(client, db, claims, frozen_clock, salle):
    # "Today" just after midnight: valid as sent, nothing elapsed yet.
    frozen_clock.now = at("00:00:30", day=3)
    claims["groups"] = FM

    response = client.get(f"/api/v1/spaces/{salle.id}/insights",
                          params={"from": iso(at("00:00", day=3)), "to": iso(at("00:01", day=3))})

    assert response.status_code == 200
    body = response.json()
    assert body["kpis"] == {
        "period_min": 0, "observed_min": 0, "unknown_min": 0, "occupied_min": 0, "occupied_reserved_min": 0,
        "occupied_unreserved_min": 0, "occupancy_pct": None, "reserved_initial_min": 0, "reserved_initial_pct": None,
        "no_show_count": 0, "evaluated_count": 0, "not_evaluated_count": 0, "no_show_pct": None,
        "released_min": 0, "releases_succeeded": 0, "releases_failed": 0, "coverage_pct": None,
    }
    assert (body["status"], body["no_shows"], body["warnings"]) == ("no_data", [], [])
    assert body["period"] == {"from": iso(at("00:00", day=3)), "to": iso(at("00:00", day=3))}
    assert body["summary"]["text"] == (
        "Pour Salle A, de 00:00 à 00:00, l'occupation ne peut pas être évaluée faute d'observations. "
        "Aucune réservation n'a pu être évaluée pour les no-shows."
    )


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


def test_hourly_series(client, db, claims, frozen_clock, salle):
    j01(db, salle)
    minutes(db, salle, Presence.ABSENT, "10:30", "12:00")
    frozen_clock.now = at("12:01")
    claims["groups"] = FM

    # 09:30 to 12:00: a first bucket cut at the period start, then two whole hours.
    body = client.get(f"/api/v1/spaces/{salle.id}/insights", params={"from": iso(at("09:30")), "to": iso(at("12:00"))}).json()

    assert body["hourly"] == [
        {"start_at": iso(at("09:00")), "reserved_min": 30, "used_min": 30},
        {"start_at": iso(at("10:00")), "reserved_min": 0, "used_min": 0},  # present until 10:30, but not reserved
        {"start_at": iso(at("11:00")), "reserved_min": 60, "used_min": 0},  # no-show: reserved, released at 11:10
    ]
    assert sum(h["reserved_min"] for h in body["hourly"]) == body["kpis"]["reserved_initial_min"]
    assert sum(h["used_min"] for h in body["hourly"]) == body["kpis"]["occupied_reserved_min"]


def test_hourly_series_is_empty_without_elapsed_minute(db, salle):
    assert insights.compute(db, salle.id, at("09:00"), at("10:00"), at("08:00"))["hourly"] == []


def test_compute_reads_observation_columns_not_entities(db, salle):
    """A month of 10 s heartbeats loaded as ORM entities exceeds the backend's 256 Mi limit."""
    j01(db, salle)
    space_id = salle.id
    db.expunge_all()
    loaded = []
    listener = lambda target, context: loaded.append(target)  # noqa: E731
    event.listen(Observation, "load", listener)
    try:
        insights.compute(db, space_id, at("09:00"), at("12:00"), at("12:01"), report_schedule=(9, 18, True))
    finally:
        event.remove(Observation, "load", listener)
    assert loaded == []
