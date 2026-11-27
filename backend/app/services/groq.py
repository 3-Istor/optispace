"""Groq structured output for room summaries and full FM reports."""
import json
import logging
from time import perf_counter

import httpx

from app.config import get_settings
from app.schemas.insight_summary import FactSelection
from app.schemas.report_analysis import ReportAnalysis
from app.services.ai_response import JsonGeneration
from app.services.report_analysis import analyze

logger = logging.getLogger(__name__)
COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"


def select_facts(kpis: dict, allowed_ids: list[str], recommendation_ids: list[str]) -> tuple[FactSelection, str] | None:
    schema = FactSelection.model_json_schema()
    schema["properties"]["fact_ids"]["items"]["enum"] = allowed_ids
    allowed_recommendations = recommendation_ids or ["NONE"]
    schema["properties"]["recommendation_id"]["enum"] = allowed_recommendations
    guidance = (
        "Choose up to three distinct facts for a short room usage summary. "
        "OCCUPANCY describes only observed minutes; UNRESERVED describes use without an effective booking. "
        "NO_SHOW describes evaluated bookings; COVERAGE describes missing or complete observations. "
        "Include COVERAGE whenever unknown_min is positive. "
        "Choose the most useful next step for the facility manager from the recommendation IDs. "
        "CHECK_COVERAGE means verify gaps in measurements before comparing usage, and should be preferred "
        "when most of the period is unknown. REVIEW_UNRESERVED means compare recorded usage with bookings. "
        "REVIEW_NO_SHOWS means review the released no-show bookings before adjusting rules. "
        "Return NONE when it is the only allowed recommendation ID."
    )
    result = _request_json({"kpis": kpis}, guidance, schema,
                           max_output_tokens=512, timeout=12.0, schema_name="room_usage_summary")
    if result is None:
        return None
    try:
        selection = FactSelection.model_validate_json(result.content)
        ids = selection.fact_ids
        if len(set(ids)) != len(ids) or not set(ids) <= set(allowed_ids):
            return None
        if kpis["unknown_min"] > 0 and "COVERAGE" not in ids:
            return None
        if selection.recommendation_id not in allowed_recommendations:
            return None
        return selection, result.model_version
    except (TypeError, ValueError):
        return None


def analyze_report(facts: dict, allowed_ids: list[str]) -> tuple[ReportAnalysis, JsonGeneration] | None:
    return analyze(facts, allowed_ids, request_json=_request_json)


def _request_json(payload: dict, guidance: str, schema: dict, *, max_output_tokens=2400, timeout=30.0,
                  schema_name="facility_manager_analysis") -> JsonGeneration | None:
    config = get_settings()
    key = config.groq_api_key.get_secret_value().strip()
    if not key:
        return None
    started = perf_counter()
    try:
        response = httpx.post(
            COMPLETIONS_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": config.groq_model,
                "messages": [{"role": "system", "content": guidance},
                             {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                "max_completion_tokens": max_output_tokens,
                "response_format": {"type": "json_schema", "json_schema": {
                    "name": schema_name, "strict": True, "schema": schema}},
            },
            timeout=timeout,
        )
        response.raise_for_status()
        body = response.json()
        choice = body["choices"][0]
        if choice["finish_reason"] != "stop" or choice["message"].get("refusal"):
            raise ValueError("Incomplete or refused analysis")
        content = choice["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Empty analysis")
        version = body.get("model")
        version = version if isinstance(version, str) and version else config.groq_model
        trace = {"duration_ms": round((perf_counter() - started) * 1000)}
        response_id = body.get("id")
        if isinstance(response_id, str) and 0 < len(response_id) <= 200:
            trace["response_id"] = response_id
        usage = body.get("usage") or {}
        for source, target in (("prompt_tokens", "input_tokens"), ("completion_tokens", "output_tokens"),
                               ("total_tokens", "total_tokens")):
            count = usage.get(source)
            if type(count) is int and count >= 0:
                trace[target] = count
        return JsonGeneration(content, version, trace)
    except httpx.HTTPStatusError as exc:
        # Provider error bodies may repeat request content; never log them or the credential.
        logger.warning("Groq generation unavailable (HTTP %s)", exc.response.status_code)
        return None
    except (httpx.HTTPError, AttributeError, IndexError, KeyError, TypeError, ValueError) as exc:
        logger.warning("Groq generation unavailable (%s)", type(exc).__name__)
        return None
