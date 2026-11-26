"""Browser acceptance on the SQLite output of verify_aiad.py; starts its own local servers.

Requires Playwright and a locally installed Edge (default) or Chrome browser.
Saves screenshots, JSON evidence and the actual downloaded PDF. Stops only its own servers.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

import httpx
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/aiad")
    parser.add_argument("--channel", default="msedge")
    args = parser.parse_args()
    output = args.output.resolve()
    database = output / "demo.sqlite3"
    if not database.is_file():
        raise SystemExit("Run verify_aiad.py first.")
    for port in (5310, 5311):
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise SystemExit(f"Port {port} is already in use; existing servers were left untouched.")
    env = {**os.environ, "DB_TYPE": "sqlite", "DB_ENABLED": "true", "SQLITE_PATH": str(database),
           "OIDC_ISSUER": "", "GEMINI_API_KEY": " ", "GROQ_API_KEY": " ", "PYTHONPATH": str(ROOT / "backend"),
           "DEV_FAKE_USER": json.dumps({"sub": "aiad-browser-fm", "email": "fm@example.test", "name": "FM démo",
                                        "groups": ["facility-managers"], "organization": ["demo-a"]}),
           "BACKEND_HOST": "http://127.0.0.1:5311"}
    processes = []
    logs = []
    errors = []
    reports = []
    try:
        for name, cwd, command in (
            ("api", ROOT / "backend", [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "5311"]),
            ("web", ROOT / "frontend", [shutil.which("node"), "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5310", "--strictPort"]),
        ):
            log = (output / f"browser-{name}.log").open("w", encoding="utf-8")
            logs.append(log)
            processes.append(subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
        for _ in range(80):
            assert all(p.poll() is None for p in processes), "A test server exited; see browser-*.log"
            try:
                if httpx.get("http://127.0.0.1:5310/api/v1/me", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(.25)
        else:
            raise RuntimeError("Test servers did not become ready")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=args.channel, headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, locale="fr-FR", timezone_id="Europe/Paris", accept_downloads=True)
            context.set_default_timeout(15000)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto("http://127.0.0.1:5310/admin")
            section = page.locator('section[aria-labelledby="report-heading"]')
            expect(section.get_by_role("button", name="Générer le rapport", exact=True)).to_be_enabled()
            section.get_by_label("Du", exact=True).fill("2026-10-23")
            section.get_by_label("Au inclus", exact=True).fill("2026-11-19")
            section.scroll_into_view_if_needed()
            page.screenshot(path=str(output / "ui-filters.png"))
            print("Browser: filters visible", flush=True)

            def generate(label):
                with page.expect_response(lambda response: "/reports/usage?" in response.url and response.request.method == "POST", timeout=60000) as awaited:
                    section.get_by_role("button", name="Générer le rapport", exact=True).click()
                    expect(section.get_by_role("status").filter(has_text="Votre analyse se prépare")).to_be_visible()
                response = awaited.value
                assert response.status == 200
                report = response.json()
                expect(section.locator('.report-result-title')).to_be_focused()
                expect(section.get_by_role('tab', name='Recommandations')).to_have_attribute('aria-selected', 'true')
                expect(section.locator('#report-filters')).to_be_hidden()
                reports.append({"case": label, "revision": report["data_revision"], "summary": report["summary"], "totals": report["totals"]})
                print(f"Browser: {label} report ready", flush=True)
                return report

            report = generate("all_rooms")
            assert len(report["rooms"]) == 4
            assert report["totals"]["unknown_min"] == 6600
            expect(section.get_by_role("status").filter(has_text="Sélection par les règles OptiSpace")).to_be_visible()
            expect(section.locator('.report-metrics')).to_be_in_viewport()
            for index, action in enumerate(report["recommendations"]):
                expect(section.locator(f'#report-action-{index} .report-first-step')).to_contain_text(action["action"])
            section.locator('#report-action-0 summary').click()
            expect(section.get_by_text('70 h observées sur 180 h du périmètre.', exact=True).first).to_be_visible()
            section.locator('#report-action-0 summary').click()
            page.screenshot(path=str(output / "ui-actions.png"))
            with page.expect_download() as download:
                section.get_by_role("button", name="Télécharger le PDF").click()
            pdf = output / "rapport-demo-telecharge.pdf"
            download.value.save_as(pdf)
            assert pdf.read_bytes() == base64.b64decode(report["pdf_base64"])
            report.pop("pdf_base64")
            (output / "browser-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            section.get_by_text("Toutes les pistes à examiner", exact=False).click()
            assert section.get_by_text("Toutes les pistes à examiner", exact=False).count() == 1
            partial = next(room for room in report["rooms"] if room["name"].startswith("Azur"))
            section.get_by_role('button', name='Modifier le périmètre').click()
            section.get_by_role("combobox").first.select_option(partial["id"])
            expect(section.get_by_role("button", name="Télécharger le PDF")).to_be_visible()
            expect(section.get_by_role('status').filter(has_text='Filtres modifiés')).to_be_visible()
            partial_report = generate("partial_room")
            assert partial_report["comparison"]["room_count"] == 0
            assert partial_report["recommendations"][0]["kind"] == "COVERAGE"
            section.get_by_role('tab', name='Indicateurs', exact=True).click()
            expect(section.get_by_role('slider')).to_be_visible()
            page.screenshot(path=str(output / "ui-partial.png"))
            section.get_by_role('button', name='Modifier le périmètre').click()
            section.get_by_label("Du", exact=True).fill("2026-08-01")
            section.get_by_label("Au inclus", exact=True).fill("2026-08-28")
            empty = generate("no_data")
            assert empty["totals"]["occupancy_pct"] is None
            expect(section.get_by_text("Mesures insuffisantes", exact=True)).to_be_visible()
            page.screenshot(path=str(output / "ui-no-data.png"))
            # Invalid ranges are explained before requesting the server; previous report remains.
            section.get_by_role('button', name='Modifier le périmètre').click()
            section.get_by_label("Du", exact=True).fill("2026-04-01")
            expect(section.get_by_role('button', name='Générer le rapport', exact=True)).to_be_disabled()
            expect(section.get_by_role("alert")).to_contain_text("Choisissez une période de 1 à 93 jours")
            expect(section.get_by_role("button", name="Télécharger le PDF")).to_be_visible()
            print("Browser: invalid period error visible", flush=True)
            # Restore demo filters and verify the narrow layout too.
            section.get_by_label("Du", exact=True).fill("2026-10-23")
            section.get_by_label("Au inclus", exact=True).fill("2026-11-19")
            section.get_by_role("combobox").first.select_option("")
            page.set_viewport_size({"width": 390, "height": 844})
            generate("mobile")
            expect(section.locator('.report-metrics')).to_be_in_viewport()
            page.screenshot(path=str(output / "ui-mobile.png"))
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Page overflows horizontally"
            section.get_by_role('tab', name='Indicateurs', exact=True).click()
            section.get_by_role('slider').fill('0')
            section.get_by_role('tab', name='Salles', exact=True).click()
            expect(section.get_by_role('table')).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Room view overflows"
            assert not errors, errors
            browser.close()
        (output / "browser-results.json").write_text(json.dumps({"passed": True, "channel": args.channel,
            "pdf_matches_response_bytes": True, "page_errors": errors, "reports": reports}, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Browser PASS: filters, loading, actions, downloaded PDF bytes, partial coverage, no data, invalid period, mobile, no page errors.")
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
        for log in logs:
            log.close()


if __name__ == "__main__":
    main()
