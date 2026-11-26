"""Decision report regressions: denominators, observed delays, tenant isolation and PDF snapshot."""
import base64
import json as json_module
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.models import AbsenceEpisode, Observation
from app.models.enums import EpisodeKind, EpisodeOutcome, Presence, ReservationStatus, SpaceType
from app.services import insights, report_pdf, reports
from app.test_insights import j01, minutes
from app.testkit import at, book, iso, make_space

FM = ["facility-managers"]


def test_report_metrics_preserve_effective_booking_and_unknown_time(db):
    room = make_space(db, "Salle A", SpaceType.MEETING_ROOM, 6, device=False)
    j01(db, room)
    minutes(db, room, Presence.ABSENT, "10:30", "12:00")
    result = insights.compute(db, room.id, at("09:00"), at("12:00"), at("12:01"), report_schedule=(9, 18, True))["report"]
    assert (result["occupied_min"], result["unreserved_min"], result["reserved_initial_min"]) == (90, 30, 120)
    assert (result["reserved_observed_min"], result["reserved_empty_min"], result["reserved_unknown_min"]) == (70, 10, 0)
    assert (result["released_min"], result["reused_released_min"], result["no_show_released_count"]) == (50, 0, 1)
    assert result["arrival_delays_min"] == [0]


@pytest.mark.parametrize("missing, synced, expected", [(False, True, [7]), (True, True, []), (False, False, [])])
def test_arrival_delay_requires_continuous_observations_and_synced_clock(db, missing, synced, expected):
    room = make_space(db, "Salle A", SpaceType.MEETING_ROOM, 6, device=False)
    book(db, room, at("09:00"), at("10:00"))
    minutes(db, room, Presence.ABSENT, "09:01" if missing else "09:00", "09:07")
    minutes(db, room, Presence.PRESENT, "09:07", "10:00")
    if not synced:
        db.query(Observation).update({Observation.clock_synced: False})
        db.commit()
    k = insights.compute(db, room.id, at("09:00"), at("10:00"), at("12:01"), report_schedule=(9, 18, True))["report"]
    assert k["arrival_delays_min"] == expected


def test_reoccupation_after_release_is_separate_from_released_duration(db):
    room = make_space(db, "Salle A", SpaceType.MEETING_ROOM, 6, device=False)
    book(db, room, at("09:00"), at("10:00"), status=ReservationStatus.RELEASED, released_at=at("09:10"))
    minutes(db, room, Presence.ABSENT, "09:00", "09:20")
    minutes(db, room, Presence.PRESENT, "09:20", "09:40")
    k = insights.compute(db, room.id, at("09:00"), at("10:00"), at("12:01"), report_schedule=(9, 18, True))["report"]
    assert (k["released_min"], k["reused_released_min"], k["unreserved_min"]) == (50, 20, 20)


def test_weighted_rates_aggregate_durations_instead_of_percentages():
    a = {key: 0 for key in reports.COUNTERS}
    b = dict(a)
    a.update(period_min=60, observed_min=60, occupied_min=60, arrival_delays_min=[2])
    b.update(period_min=180, observed_min=180, occupied_min=0, arrival_delays_min=[4, 6, 8])
    combined = reports.aggregate([a, b])
    assert combined["occupancy_pct"] == 25
    assert combined["arrival_avg_min"] == 5
    assert combined["arrival_sample_count"] == 4


def report_params():
    return {"from": iso(at("00:00")), "to": iso(at("00:00", day=3)), "start_hour": 9, "end_hour": 18}


def test_report_endpoint_permissions_empty_state_and_pdf(client, db, claims, frozen_clock):
    frozen_clock.now = at("18:00", day=3)
    assert client.post("/api/v1/reports/usage", params=report_params()).status_code == 403
    claims["groups"] = FM
    response = client.post("/api/v1/reports/usage", params=report_params())
    assert response.status_code == 200
    report = response.json()
    assert report["rooms"] == []
    assert report["totals"]["occupancy_pct"] is None
    assert report["summary"]["mode"] == "template_fallback"
    assert base64.b64decode(report["pdf_base64"]).startswith(b"%PDF-")
    other = make_space(db, "Other tenant", SpaceType.MEETING_ROOM, 6, organization="demo-b")
    assert client.post("/api/v1/reports/usage", params={**report_params(), "space_id": str(other.id)}).status_code == 404
    assert client.post("/api/v1/reports/usage", params={**report_params(), "start_hour": 18, "end_hour": 9}).status_code == 400


@pytest.mark.parametrize("outcome", ["valid", "duplicate", "invented", "timeout", "quota"])
def test_report_gemini_selection_is_bounded_and_single_call(client, db, claims, frozen_clock, settings_env, monkeypatch, outcome):
    room = make_space(db, "Salle A", SpaceType.MEETING_ROOM, 6, device=False)
    j01(db, room)
    minutes(db, room, Presence.ABSENT, "10:30", "12:00")
    frozen_clock.now = at("18:00", day=3)
    claims["groups"] = FM
    settings_env(GEMINI_API_KEY="test-key")
    calls = []

    def post(url, *, headers, json, timeout):
        calls.append(json)
        request = httpx.Request("POST", url)
        if outcome == "timeout":
            raise httpx.ReadTimeout("test", request=request)
        if outcome == "quota":
            return httpx.Response(429, json={"error": {"message": "quota"}}, request=request)
        ids = json["generationConfig"]["responseJsonSchema"]["properties"]["action_ids"]["items"]["enum"][:1]
        if outcome == "duplicate":
            ids *= 2
        if outcome == "invented":
            ids = ["MAKE_UP_A_SAVING"]
        content = json_module.dumps({"action_ids": ids})
        return httpx.Response(200, json={"modelVersion": "test-model", "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": content}]}}]}, request=request)

    monkeypatch.setattr(httpx, "post", post)
    report = client.post("/api/v1/reports/usage", params=report_params()).json()
    assert len(calls) == 1
    assert report["summary"]["mode"] == ("llm_assisted" if outcome == "valid" else "template_fallback")
    assert report["recommendations"]
    payload = json_module.loads(calls[0]["contents"][0]["parts"][0]["text"])
    assert "name" not in payload["rooms"][0]
    assert "daily" not in payload["rooms"][0]["kpis"]
    assert "arrival_delays_min" not in payload["rooms"][0]["kpis"]


def test_report_does_not_call_gemini_without_observations(db, settings_env, monkeypatch):
    make_space(db, "Salle vide", SpaceType.MEETING_ROOM, 6)
    settings_env(GEMINI_API_KEY="test-key")
    monkeypatch.setattr(httpx, "post", lambda *a, **kw: pytest.fail("No provider call without observations"))
    report = reports.compute(db, "demo-a", at("00:00"), at("00:00", day=3), at("18:00", day=3))
    assert report["summary"]["provider_status"] == "insufficient_data"


def test_pdf_omits_technical_model_name(db, monkeypatch):
    report = reports.compute(db, "demo-a", at("00:00"), at("00:00", day=3), at("18:00", day=3))
    report["summary"].update(mode="llm_assisted", provider_status="ready", model_version="internal-model-version")
    paragraphs = []
    original_paragraph = report_pdf.Paragraph

    def record_paragraph(text, *args, **kwargs):
        paragraphs.append(text)
        return original_paragraph(text, *args, **kwargs)

    monkeypatch.setattr(report_pdf, "Paragraph", record_paragraph)
    assert report_pdf.render(report).startswith(b"%PDF-")
    rendered = " ".join(paragraphs)
    assert "internal-model-version" not in rendered
    assert "Priorisation assistée par Gemini" in rendered


def test_reserved_unknown_minutes_do_not_become_empty_time(db):
    room = make_space(db, "Salle A", SpaceType.MEETING_ROOM, 6, device=False)
    book(db, room, at("09:00"), at("10:00"))
    minutes(db, room, Presence.ABSENT, "09:00", "09:20")
    minutes(db, room, Presence.PRESENT, "09:40", "10:00")
    k = insights.compute(db, room.id, at("09:00"), at("10:00"), at("12:00"), report_schedule=(9, 18, True))["report"]
    assert (k["reserved_observed_min"], k["reserved_empty_min"], k["reserved_unknown_min"]) == (40, 20, 20)


def test_failed_release_does_not_create_released_time_or_released_no_show(db):
    room = make_space(db, "Salle A", SpaceType.MEETING_ROOM, 6, device=False)
    reservation = book(db, room, at("09:00"), at("10:00"))
    db.add(AbsenceEpisode(reservation_id=reservation.id, kind=EpisodeKind.NO_SHOW, opened_at=at("09:00"),
                          deadline_at=at("09:10"), closed_at=at("09:10"), outcome=EpisodeOutcome.RELEASE_BLOCKED))
    db.commit()
    minutes(db, room, Presence.ABSENT, "09:00", "10:00")
    k = insights.compute(db, room.id, at("09:00"), at("10:00"), at("12:00"), report_schedule=(9, 18, True))["report"]
    assert (k["release_failed_count"], k["released_min"], k["no_show_released_count"]) == (1, 0, 0)


def test_report_counts_elapsed_minutes_across_paris_dst(db):
    make_space(db, "Salle A", SpaceType.MEETING_ROOM, 6, device=False)
    paris = ZoneInfo("Europe/Paris")
    report = reports.compute(db, "demo-a", datetime(2026, 10, 24, tzinfo=paris), datetime(2026, 10, 26, tzinfo=paris),
                             at("18:00"), start_hour=0, end_hour=24, weekdays_only=False)
    assert report["totals"]["period_min"] == 49 * 60
    assert report["previous_totals"]["period_min"] == 48 * 60
    assert report["trend"][1]["period_min"] == 25 * 60


def test_equipment_opportunity_requires_reliable_comparable_room():
    metrics = {key: 0 for key in reports.COUNTERS}
    metrics.update(period_min=5400, observed_min=5400, occupied_min=300, arrival_delays_min=[], daily=[{}] * 10)
    low = reports.rates(metrics)
    busy = {**low, "occupancy_pct": 80}
    rooms = [
        {"id": "a", "name": "A", "capacity": 6, "equipment": [], "current": low, "reliable": True},
        {"id": "b", "name": "B", "capacity": 6, "equipment": ["Visioconférence"], "current": busy, "reliable": True},
    ]
    assert any(action["kind"] == "EQUIPMENT" and action["room_id"] == "a" for action in reports._actions(rooms))
    rooms[1]["reliable"] = False
    assert all(action["kind"] != "EQUIPMENT" for action in reports._actions(rooms))
