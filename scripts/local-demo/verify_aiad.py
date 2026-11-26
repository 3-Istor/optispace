"""Replay the AIAD acceptance cases against an isolated, migrated SQLite database.

Run with the backend venv, from any directory. No production data is read or changed.
The real provider is opt-in; only its normal minimized report payload is sent.
"""
import argparse
import base64
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
import json
from json import dumps
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
from time import perf_counter
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
REFERENCE = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
PARIS = ZoneInfo("Europe/Paris")
FACT_FIELDS = ("period", "previous_period", "schedule", "rooms", "totals", "previous_totals",
               "comparison", "trend", "eligible_actions", "source_mode", "rules", "limitations")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/aiad")
    parser.add_argument("--real-provider", action="store_true",
                        help="Also call Groq for the report and short room summary")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    original_cwd = Path.cwd()
    os.chdir(ROOT / "backend")  # Settings reads the same env files as the demo server.
    with tempfile.TemporaryDirectory(prefix="optispace-aiad-") as temporary:
        database = Path(temporary) / "demo.sqlite3"
        os.environ.update(DB_TYPE="sqlite", DB_ENABLED="true", SQLITE_PATH=str(database), OIDC_ISSUER="", DEV_FAKE_USER="")
        from app.config import get_settings
        get_settings.cache_clear()
        config = get_settings()
        from alembic import command
        from alembic.config import Config
        command.upgrade(Config(str(ROOT / "backend/alembic.ini")), "head")
        from app import clock
        from app.database import SessionLocal, engine
        from app.main import app
        from app.models import Reservation, Space
        from app.security import current_user
        from fastapi.testclient import TestClient
        from pydantic import SecretStr
        import httpx

        cases = []
        with (patch.object(clock, "now", return_value=REFERENCE),
              patch.object(config, "groq_api_key", SecretStr(" "))):
            with patch.object(sys, "argv", ["seed_demo.py", str(ROOT / "scripts/local-demo/iot-38.json"), str(output / "reference-cases.json")]):
                runpy.run_path(str(ROOT / "scripts/local-demo/seed_demo.py"), run_name="__main__")
            # Reference fixture rooms remain separate from the multi-room filters.
            runpy.run_path(str(ROOT / "scripts/local-demo/seed_report_demo.py"), run_name="__main__")

        with SessionLocal() as db:
            # Keep IOT-38 fixture rooms out of the FM demo's "all rooms" UI scope.
            db.query(Space).filter(Space.name.contains("(simulation)")).update({Space.organization: "aiad-reference"})
            db.commit()
            rooms = list(db.query(Space).filter(Space.name.contains("(démo")).order_by(Space.name))
            all_ids = [str(room.id) for room in rooms]
            full_ids = [str(room.id) for room in rooms if not room.name.startswith("Azur")]
            partial_id = next(str(room.id) for room in rooms if room.name.startswith("Azur"))

        def bookings():
            with SessionLocal() as db:
                return [(r.id, r.status, r.start_at, r.end_at, r.released_at, r.cancelled_at)
                        for r in db.query(Reservation).order_by(Reservation.id)]

        before = bookings()
        claims = {"sub": "aiad-fm", "email": "fm@example.test", "name": "FM simulé",
                  "groups": ["facility-managers"], "organization": ["demo-a"]}
        app.dependency_overrides[current_user] = lambda: claims
        day = REFERENCE.astimezone(PARIS).replace(hour=0, minute=0, second=0, microsecond=0)
        params = {"from": (day - timedelta(days=28)).isoformat(), "to": day.isoformat(),
                  "start_hour": 9, "end_hour": 18, "weekdays_only": "true"}
        baselines = {}

        def run(case_id, mode, ids, baseline=None, period=None, status=200):
            calls = []

            def post(url, *, json, **kwargs):
                calls.append(json)
                assert kwargs["timeout"] == 30.0
                request = httpx.Request("POST", url)
                if mode in ("rules", "no_data", "access"):
                    raise AssertionError("Provider must not be called")
                if mode == "timeout":
                    raise httpx.ReadTimeout("simulated timeout", request=request)
                if mode in ("quota", "unavailable"):
                    return httpx.Response(429 if mode == "quota" else 503, request=request)
                assert url == "https://api.groq.com/openai/v1/chat/completions"
                schema = json["response_format"]["json_schema"]["schema"]
                allowed = schema["$defs"]["ActionAnalysis"]["properties"]["action_id"]["enum"]
                chosen = list(reversed(allowed[:3]))
                if mode == "duplicate":
                    chosen = [allowed[0]] * 2
                if mode == "unknown":
                    chosen = ["invented-action"]
                content = {"overview": "Les écarts observés invitent à examiner les usages et les réservations.",
                    "evidence_action_ids": chosen[:1],
                    "recommendations": [{"action_id": item,
                        "rationale": "Ce constat mérite une vérification sur les plages observées.",
                        "steps": ["Relire les créneaux concernés avant de choisir un test."],
                        "check": "Comparer les indicateurs sur le même périmètre après vérification."} for item in chosen],
                    "caution": "Ces textes viennent du double de test et ne prouvent pas une analyse réelle par IA."}
                text = "invalid JSON" if mode == "malformed" else dumps(content)
                return httpx.Response(200, request=request, json={"model": "aiad-test-double",
                    "choices": [{"finish_reason": "stop", "message": {"content": text}}]})

            key = config.groq_api_key if mode == "real" else SecretStr(" " if mode == "rules" else "aiad-test-key")
            query = {**params, **(period or {}), "space_id": ids}
            provider = nullcontext() if mode == "real" else patch.object(httpx, "post", post)
            started = perf_counter()
            with patch.object(config, "groq_api_key", key), provider, patch.object(clock, "now", return_value=REFERENCE):
                response = client.post("/api/v1/reports/usage", params=query)
            elapsed = round(perf_counter() - started, 3)
            assert response.status_code == status, (case_id, response.text[:300])
            record = {"case": case_id, "mode": mode, "params": query, "http_status": response.status_code,
                      "seconds": elapsed, "provider_calls": "real adapter" if mode == "real" else len(calls)}
            if status != 200:
                assert not calls
                record["result"] = response.json()
            else:
                report = response.json()
                (output / f"{case_id}.pdf").write_bytes(base64.b64decode(report.pop("pdf_base64")))
                (output / f"{case_id}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                assert len(report["recommendations"]) <= 3
                assert len({action["id"] for action in report["recommendations"]}) == len(report["recommendations"])
                assert all(action in report["eligible_actions"] for action in report["recommendations"])
                if baseline:
                    assert all(report[field] == baseline[field] for field in FACT_FIELDS)
                if mode in ("timeout", "quota", "unavailable", "duplicate", "unknown", "malformed"):
                    assert report["summary"]["provider_status"] == "unavailable"
                    assert report["recommendations"] == baseline["recommendations"]
                if mode == "simulated":
                    assert report["summary"]["mode"] == "llm_assisted"
                    assert report["analysis"]["overview"].startswith("Les écarts observés")
                    assert [a["id"] for a in report["recommendations"]] == [a["id"] for a in reversed(baseline["recommendations"])]
                record.update(summary=report["summary"], totals=report["totals"],
                              ranking=[f"{a['room_name']} / {a['kind']}" for a in report["recommendations"]],
                              eligible_count=len(report["eligible_actions"]), facts_match=True)
                if calls:
                    payload_text = calls[0]["messages"][1]["content"]
                    payload = json.loads(payload_text)
                    (output / f"{case_id}-payload.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                baselines[case_id] = report
            record["passed"] = True
            cases.append(record)
            print(f"{case_id}: PASS ({elapsed:.3f} s)")
            return baselines.get(case_id)

        try:
            with TestClient(app) as client:
                full = run("M-01", "rules", full_ids)
                assert (full["totals"]["occupied_min"], full["totals"]["observed_min"], full["totals"]["unknown_min"]) == (12413, 32400, 0)
                assert full["source_mode"] == "simulated" and full["comparison"]["room_count"] == 3
                assert len(full["eligible_actions"]) > 3
                partial = run("M-02", "rules", all_ids)
                assert (partial["totals"]["occupied_min"], partial["totals"]["observed_min"], partial["totals"]["unknown_min"]) == (14113, 36600, 6600)
                assert partial["comparison"]["room_count"] == 3
                assert partial["recommendations"][0]["kind"] == "COVERAGE"
                empty = run("M-03", "no_data", [partial_id], period={"from": "2026-08-01T00:00:00+02:00", "to": "2026-08-29T00:00:00+02:00"})
                assert empty["totals"]["occupancy_pct"] is None and empty["summary"]["provider_status"] == "insufficient_data"
                claims["groups"] = []
                run("A-01", "access", full_ids, status=403)
                claims["groups"] = ["facility-managers"]
                claims["organization"] = ["demo-b"]
                run("A-02", "access", full_ids, status=404)
                claims["organization"] = ["demo-a"]
                run("M-04", "simulated", full_ids, baseline=full)
                for index, mode in enumerate(("timeout", "quota", "unavailable", "malformed", "duplicate", "unknown"), 1):
                    run(f"F-{index:02}", mode, full_ids, baseline=full)
                real_status = "not_requested"
                real_summary_status = "not_requested"
                if args.real_provider:
                    if config.groq_api_key.get_secret_value().strip():
                        real = run("M-05", "real", full_ids, baseline=full)
                        real_status = real["summary"]["provider_status"]
                        summary_path = f"/api/v1/spaces/{full_ids[0]}/insights"
                        summary_params = {key: params[key] for key in ("from", "to")}
                        with patch.object(clock, "now", return_value=REFERENCE):
                            ordinary = client.get(summary_path, params=summary_params)
                            started = perf_counter()
                            generated = client.post(f"{summary_path}/summary", params=summary_params)
                        assert ordinary.status_code == generated.status_code == 200
                        summary_report = generated.json()
                        assert summary_report["kpis"] == ordinary.json()["kpis"]
                        assert summary_report["data_revision"] == ordinary.json()["data_revision"]
                        real_summary_status = summary_report["summary"]["provider_status"]
                        (output / "S-01.json").write_text(json.dumps({
                            "provider": "groq", "seconds": round(perf_counter() - started, 3),
                            "facts_match": True, "response": summary_report,
                        }, ensure_ascii=False, indent=2), encoding="utf-8")
                        print(f"S-01: facts PASS; Groq summary {real_summary_status}")
                    else:
                        real_status = "not_configured"
                        real_summary_status = "not_configured"
                assert bookings() == before
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
        shutil.copy2(database, output / "demo.sqlite3")
        git_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        results = {"base_commit": git_sha, "reference_time": REFERENCE.isoformat(),
                   "provider": "groq", "real_provider": real_status,
                   "real_summary_provider": real_summary_status,
                   "facts": {"passed": sum(c.get("facts_match", False) for c in cases), "executed": sum(c["http_status"] == 200 for c in cases)},
                   "access": {"passed": 2, "executed": 2}, "fallback": {"passed": 6, "executed": 6},
                   "bookings_unchanged": True, "cases": cases}
        (output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({key: results[key] for key in ("facts", "access", "fallback", "real_provider", "real_summary_provider", "bookings_unchanged")}, indent=2))
    os.chdir(original_cwd)


if __name__ == "__main__":
    main()
