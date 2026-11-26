"""Generated prose is bounded and attributable; source metrics and bookings are immutable."""
import base64
import copy
import json

import httpx
import pytest

from app.models import Reservation
from app.models.enums import SpaceType
from app.services import groq, report_pdf
from app.test_insights import j01
from app.test_reports import report_params
from app.testkit import at, make_space

encode_json = json.dumps


def authored(action_id="room:COVERAGE"):
    return {"overview": "Les lacunes de mesure limitent la décision sur les usages.",
            "evidence_action_ids": [action_id],
            "recommendations": [{"action_id": action_id,
                "rationale": "La mesure doit être fiabilisée avant de comparer cette salle aux autres.",
                "steps": ["Repérer les plages sans observation et vérifier la connexion du boîtier."],
                "check": "Recalculer la couverture après la vérification sur les mêmes horaires."}],
            "caution": "Les périodes inconnues ne permettent pas de conclure que la salle était vide."}


@pytest.mark.parametrize("case", ["valid", "unknown_ref", "unselected_ref", "duplicate_ref", "number", "html",
                                  "url", "blank", "long", "extra_step", "extra_nested", "truncated", "missing"])
def test_analysis_guards_and_provider_trace(settings_env, monkeypatch, case):
    settings_env(GROQ_API_KEY="test-key", GROQ_MODEL="test-model")
    content = authored()
    if case == "unknown_ref":
        content["evidence_action_ids"] = ["unknown"]
    if case == "unselected_ref":
        content["evidence_action_ids"] = ["other:UNRESERVED"]
    if case == "duplicate_ref":
        content["evidence_action_ids"] *= 2
    if case == "number":
        content["overview"] = "Une économie de 500 euros est garantie."
    if case == "html":
        content["recommendations"][0]["steps"] = ["<script>alert('fake');</script>"]
    if case == "url":
        content["caution"] = "Consultez https://untrusted.example pour continuer."
    if case == "blank":
        content["overview"] = " " * 10
    if case == "long":
        content["overview"] = "texte " * 200
    if case == "extra_step":
        content["recommendations"][0]["steps"] *= 3
    if case == "extra_nested":
        content["recommendations"][0]["execute"] = True
    if case == "missing":
        del content["caution"]
    calls = []

    def post(url, *, headers, json: dict, timeout):
        calls.append(json)
        assert timeout == 30.0
        assert headers == {"Authorization": "Bearer test-key"}
        assert url == groq.COMPLETIONS_URL
        assert json["model"] == "test-model" and json["max_completion_tokens"] == 2400
        assert json["response_format"]["json_schema"]["strict"] is True
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "model": "test-model-version", "id": "provider-response-id",
            "usage": {"prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300},
            "choices": [{"finish_reason": "length" if case == "truncated" else "stop",
                         "message": {"content": encode_json(content)}}]})

    monkeypatch.setattr(httpx, "post", post)
    result = groq.analyze_report({"rooms": [], "actions": []}, ["room:COVERAGE", "other:UNRESERVED"])
    assert len(calls) == 1
    if case != "valid":
        assert result is None
    else:
        analysis, response = result
        assert analysis.model_dump() == content
        assert response.trace["response_id"] == "provider-response-id"
        assert (response.trace["input_tokens"], response.trace["output_tokens"], response.trace["total_tokens"]) == (100, 200, 300)
        assert response.trace["duration_ms"] >= 0


def test_generated_analysis_reaches_pdf_without_changing_facts_or_bookings(client, db, claims, frozen_clock, settings_env, monkeypatch):
    frozen_clock.now = at("18:00", day=3)
    claims["groups"] = ["facility-managers"]
    room = make_space(db, "Confidential room name", SpaceType.MEETING_ROOM, 6, device=False)
    j01(db, room)
    settings_env(GROQ_API_KEY=" ")
    baseline = client.post("/api/v1/reports/usage", params=report_params()).json()
    before = [(r.id, r.status, r.released_at) for r in db.query(Reservation).order_by(Reservation.id)]
    action_id = baseline["recommendations"][0]["id"]
    content = authored(action_id)
    content["recommendations"][0]["steps"][0] = "Vérifier les plages non‑observées et la connexion du boîtier."
    settings_env(GROQ_API_KEY="groq-test-key")
    calls, snapshots, paragraphs = [], [], []

    def post(url, **kwargs):
        calls.append(kwargs["json"])
        assert url == groq.COMPLETIONS_URL
        assert kwargs["headers"] == {"Authorization": "Bearer groq-test-key"}
        return httpx.Response(200, request=httpx.Request("POST", url), json={"model": "groq-test-model", "id": "groq-response-id",
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(content)}}]})

    render, paragraph = report_pdf.render, report_pdf.Paragraph

    def capture(report):
        snapshots.append(copy.deepcopy(report))
        return render(report)

    def capture_paragraph(text, *args, **kwargs):
        paragraphs.append(text)
        return paragraph(text, *args, **kwargs)

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(report_pdf, "render", capture)
    monkeypatch.setattr(report_pdf, "Paragraph", capture_paragraph)
    response = client.post("/api/v1/reports/usage", params=report_params())
    assert response.status_code == 200
    report = response.json()
    assert base64.b64decode(report.pop("pdf_base64")).startswith(b"%PDF-")
    assert snapshots == [report] and len(calls) == 1
    assert report["analysis"] == content
    assert report["summary"]["provider"] == "groq"
    assert all(report[field] == baseline[field] for field in
               ("rooms", "totals", "trend", "eligible_actions", "baseline_recommendations", "comparison"))
    assert [(r.id, r.status, r.released_at) for r in db.query(Reservation).order_by(Reservation.id)] == before
    assert "Confidential room name" not in json.dumps(calls)
    assert content["overview"] in paragraphs
    assert any(content["recommendations"][0]["rationale"] in p for p in paragraphs)
    assert any("Vérifier les plages non-observées" in p for p in paragraphs)
    assert report["summary"]["generation"]["payload_revision"]
    assert "Groq" in " ".join(paragraphs) and "Gemini" not in " ".join(paragraphs)
    assert "groq-test-key" not in json.dumps(report)
