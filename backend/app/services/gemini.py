"""Select applicable summary facts with Gemini's structured output."""
import json
import logging

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.config import get_settings

logger = logging.getLogger(__name__)
MODEL_URL = "https://generativelanguage.googleapis.com/v1beta/models"


class FactSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fact_ids: list[str] = Field(min_length=1, max_length=3)


def select_facts(kpis: dict, allowed_ids: list[str]) -> tuple[list[str], str] | None:
    config = get_settings()
    key = config.gemini_api_key.get_secret_value()
    if not key:
        return None

    needs_coverage = kpis["unknown_min"] > 0
    guidance = (
        "Choose up to three distinct facts for a short room usage summary. "
        "OCCUPANCY describes only observed minutes; UNRESERVED describes use without an effective booking. "
        "NO_SHOW describes evaluated bookings; COVERAGE describes missing or complete observations. "
        "Include COVERAGE whenever unknown_min is positive. Return only the chosen IDs."
    )
    schema = FactSelection.model_json_schema()
    schema["properties"]["fact_ids"]["items"]["enum"] = allowed_ids
    try:
        response = httpx.post(
            f"{MODEL_URL}/{config.gemini_model}:generateContent",
            headers={"x-goog-api-key": key},
            json={
                "systemInstruction": {"parts": [{"text": guidance}]},
                "contents": [{"parts": [{"text": json.dumps({"kpis": kpis})}]}],
                "generationConfig": {
                    "maxOutputTokens": 256,
                    "responseMimeType": "application/json",
                    "responseJsonSchema": schema,
                },
            },
            timeout=3.0,
        )
        response.raise_for_status()
        body = response.json()
        candidate = body["candidates"][0]
        if candidate["finishReason"] != "STOP":
            raise ValueError("Incomplete Gemini response")
        parts = candidate["content"]["parts"]
        selection = FactSelection.model_validate_json("".join(part["text"] for part in parts if not part.get("thought")))
        ids = selection.fact_ids
        if len(set(ids)) != len(ids) or not set(ids).issubset(allowed_ids) or (needs_coverage and "COVERAGE" not in ids):
            raise ValueError("Inapplicable Gemini selection")
        model_version = body.get("modelVersion")
        return ids, model_version if isinstance(model_version, str) and model_version else config.gemini_model
    except (httpx.HTTPError, AttributeError, IndexError, KeyError, TypeError, ValueError) as exc:
        logger.warning("Gemini summary unavailable (%s)", type(exc).__name__)
        return None
