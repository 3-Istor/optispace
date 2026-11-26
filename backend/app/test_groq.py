"""Provider routing, error handling and credential isolation for FM reports."""
import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.models.enums import SpaceType
from app.services import groq, insights, reports
from app.test_insights import j01
from app.testkit import at, make_space


@pytest.mark.parametrize("outcome", [401, 403, 429, 503, "timeout", "malformed", "refusal", "empty"])
def test_groq_error_is_bounded_and_does_not_log_credentials(settings_env, monkeypatch, caplog, outcome):
    settings_env(GROQ_API_KEY="private-groq-test-key", GEMINI_API_KEY="private-gemini-test-key")
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        assert url == groq.COMPLETIONS_URL
        assert kwargs["headers"] == {"Authorization": "Bearer private-groq-test-key"}
        request = httpx.Request("POST", url)
        if outcome == "timeout":
            raise httpx.ReadTimeout("private-groq-test-key", request=request)
        if isinstance(outcome, int):
            return httpx.Response(outcome, request=request, json={"error": {"message": "private-groq-test-key sensitive request"}})
        if outcome == "malformed":
            return httpx.Response(200, request=request, json={})
        return httpx.Response(200, request=request, json={"choices": [{"finish_reason": "stop", "message": {
            "refusal": "Request refused" if outcome == "refusal" else None, "content": ""}}]})

    monkeypatch.setattr(httpx, "post", post)
    assert groq.analyze_report({"rooms": []}, ["room:COVERAGE"]) is None
    assert len(calls) == 1
    assert "private-groq-test-key" not in caplog.text and "sensitive request" not in caplog.text


def test_missing_groq_key_never_uses_retired_provider_key(db, settings_env, monkeypatch):
    settings_env(REPORT_AI_PROVIDER="gemini", GROQ_API_KEY=" ", GEMINI_API_KEY="gemini-only-secret")
    room = make_space(db, "Room", SpaceType.MEETING_ROOM, 6, device=False)
    j01(db, room)
    monkeypatch.setattr(httpx, "post", lambda *a, **kw: pytest.fail("No request without the selected provider key"))
    report = reports.compute(db, "demo-a", at("00:00"), at("00:00", day=3), at("18:00", day=3), 9, 18, True)
    assert report["summary"]["provider"] == "groq"
    assert report["summary"]["provider_status"] == "not_configured"
    assert report["analysis"] is None
    summary = insights.compute(db, room.id, at("09:00"), at("12:00"), at("18:00"), assist_summary=True)["summary"]
    assert summary["provider_status"] == "not_configured"


def test_retired_dotenv_settings_do_not_block_groq(tmp_path, settings_env):
    dotenv = tmp_path / "legacy.env"
    dotenv.write_text("GEMINI_API_KEY=old-test-key\nGEMINI_MODEL=old-test-model\nREPORT_AI_PROVIDER=gemini\n", encoding="utf-8")
    config = Settings(_env_file=dotenv, groq_api_key="new-test-key", groq_model="new-test-model")
    assert config.groq_api_key.get_secret_value() == "new-test-key"
    assert config.groq_model == "new-test-model"
    assert not {"gemini_api_key", "gemini_model", "report_ai_provider"} & config.model_dump().keys()
    dotenv.write_text("UNEXPECTED_SETTING=typo\n", encoding="utf-8")
    with pytest.raises(ValidationError):
        Settings(_env_file=dotenv)


@pytest.mark.parametrize("case", ["valid", "bad_recommendation", "empty", "extra", "truncated", "refusal", "malformed"])
def test_summary_with_no_recommendations_is_bounded(settings_env, monkeypatch, case):
    import json

    settings_env(GROQ_API_KEY="test-key")
    content = {"fact_ids": ["OCCUPANCY"], "recommendation_id": "NONE"}
    if case == "bad_recommendation":
        content["recommendation_id"] = "CHECK_COVERAGE"
    if case == "empty":
        content["fact_ids"] = []
    if case == "extra":
        content["text"] = "An invented conclusion"

    def post(url, **kwargs):
        assert url == groq.COMPLETIONS_URL
        schema = kwargs["json"]["response_format"]["json_schema"]["schema"]
        assert schema["properties"]["recommendation_id"]["enum"] == ["NONE"]
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "model": "summary-model", "choices": [{"finish_reason": "length" if case == "truncated" else "stop",
                "message": {"content": "not JSON" if case == "malformed" else json.dumps(content),
                            "refusal": "Refused" if case == "refusal" else None}}]})

    monkeypatch.setattr(httpx, "post", post)
    result = groq.select_facts({"unknown_min": 0}, ["OCCUPANCY", "COVERAGE"], [])
    if case == "valid":
        selection, version = result
        assert selection.fact_ids == ["OCCUPANCY"] and selection.recommendation_id == "NONE"
        assert version == "summary-model"
    else:
        assert result is None
