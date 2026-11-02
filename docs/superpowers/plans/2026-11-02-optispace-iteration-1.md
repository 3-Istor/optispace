# OptiSpace iteration 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OptiSpace web app (FastAPI backend + React frontend) of iteration 1: spaces, bookings, absence release, alerts, notifications, devices with seal/unseal, Facility Manager dashboard, and the ESP32 telemetry endpoint.

**Architecture:** One FastAPI service (layers `routers/`, `schemas/`, `services/`, `models/`) on PostgreSQL (SQLite in tests), one React 19 + Vite SPA served by nginx, both deployed by the CNP platform from this repo. No background loop: absence deadlines are evaluated whenever a request touches a space (device telemetry every 10 s, web polling every 5 s).

**Tech Stack:** Python 3.12+, FastAPI 0.162, SQLAlchemy 2.1, Alembic 1.20, PyJWT[crypto], pywebpush; React 19, Vite 8, plain CSS from the mockup design system.

**Spec:** `iot-doc/software/specification_application.md` v0.2 (repo `3-Istor/iot-doc`, branch `docs/IOT-12-app-spec`). UI reference: `docs/maquettes/*.dc.html` + `docs/maquettes/design-system.css` (read them as specifications, never execute them). When the spec and the mockup disagree on business rules, data or wording of rules, the spec wins; the mockup wins on layout and look.

## Global Constraints

- Follow `AGENTS.md`: layers `routers/` thin, `schemas/` Pydantic, `services/` logic, `models/` SQLAlchemy; `Depends(get_db)`; errors `HTTPException(status, detail="<CODE>")`, body `{"detail": "<CODE>"}`; every endpoint has a `TestClient` test; deps pinned exactly; `make check` passes.
- All browser routes under `/api/v1/…`, called with relative URLs. `GET /health` stays unauthenticated.
- Identity comes from the gateway: `Authorization: Bearer <JWT>` verified with PyJWT against `OIDC_ISSUER` (see `.claude/skills/using-cnp-services/reference/identity.md`). Facility Manager = JWT group `project-admins` (setting `FM_GROUP`, default `project-admins`). Local dev only: setting `DEV_FAKE_USER` (JSON `{"sub","email","name","groups"}`), empty by default, never set in `deploy/`.
- No in-process timer or background task. `services/absence.evaluate_space` runs inside requests.
- All datetimes are timezone-aware UTC (`DateTime(timezone=True)`); `app/clock.py: now() -> datetime` is the only source of "now" (tests monkeypatch it). Display in Europe/Paris on the frontend.
- Enums are stored as strings (`native_enum=False`) so SQLite tests and PostgreSQL behave the same.
- Values from the spec: absence delay D = 10 min (global setting); durations meeting room 30–180 min, booth 15–60 min, 5-min alignment; telemetry heartbeat 10 s; occupancy stale and device offline after 30 s; unseal needs group FM; web polling 5 s.
- Copy is French, no em dash (U+2014), "Facility manager" with lowercase m in UI copy. Notification texts are the exact strings of spec §10.
- Out of scope (spec §14): support console, multi-site, distance and floor plan, opening hours and booking limits, reminders and weekly reports, export, device on-site tests, battery/RSSI.

## Review Focus

1. Two bookings of the same space committed at the same time: one 201, one 409 `RESERVATION_CONFLICT` (PostgreSQL exclusion constraint; app-level check covers SQLite). Test in Task 5.
2. Device offline or sealed while a reservation is pending: never released (`release_blocked`). Test in Task 5.
3. Telemetry replayed (same `boot_id`, `seq`) after a network retry: 200, no second observation. Test in Task 4.
4. A booking that ends inside a pending absence episode, or a modification shortening it: episode closed without release, no double notification. Test in Task 5.
5. Times at exact boundaries (`start_at == now` rounded, deadline exactly reached, interval `[start, end[`): no off-by-one release or conflict. Test in Task 5.

---

## Shared interfaces (decided here; every task uses these names)

**Models** (`backend/app/models/`, one module per table, re-exported in `models/__init__.py`; columns are spec §9 unless noted):
`AppUser`, `Space` (`floor: int`, `equipment: list[str]` as JSON), `Device` (no `online` column: online = `last_seen_at > now - 30 s`), `Observation` (unique `(device_id, boot_id, seq)` instead of `event_id`), `SpaceStatus`, `Reservation`, `AbsenceEpisode`, `AvailabilityAlert`, `Notification` (+ `params: dict` JSON for the text placeholders), `PushSubscription`, `AppSettings` (single row id=1).

**Domain enums** (`app/models/enums.py`, `StrEnum`): `SpaceType`, `SealState`, `Presence`, `ObservationKind`, `Target`, `Source`, `ReservationStatus`, `EpisodeKind`, `EpisodeOutcome`, `AlertStatus`, `NotificationType`, `SpaceState`, values exactly as spec §5, §7, §9.

**Services** (signatures; `db: Session`, `now: datetime`):
- `app/services/occupancy.py`: `effective_occupancy(status: SpaceStatus | None, device: Device | None, now) -> Presence`; `apply_observation(db, space_id: UUID, presence: Presence, observed_at: datetime) -> None`; `space_state(db, space: Space, now) -> SpaceState`.
- `app/services/booking.py`: `effective_end(r: Reservation) -> datetime`; `current_reservation(db, space_id, now) -> Reservation | None`; `create(db, user, space_id, start_at, end_at, now) -> Reservation`; `modify(db, user, reservation_id, space_id, start_at, end_at, now) -> Reservation`; `cancel(db, user, reservation_id, now) -> None`; `free_spaces(db, start_at, end_at, space_type, min_capacity, floor, equipment, now) -> list[Space]`. Domain errors raise `DomainError(status: int, code: str)` (`app/errors.py`), turned into `HTTPException` by one exception handler.
- `app/services/absence.py`: `evaluate_space(db, space_id, now) -> None`.
- `app/services/alerts.py`: `on_freed(db, space: Space, start_at, end_at, now) -> None`; `close_for_user(db, user_id, start_at, end_at) -> None`.
- `app/services/notifications.py`: `notify(db, user: AppUser, type: NotificationType, **params) -> Notification` (row if `notify_in_app`, push if `notify_push`; push failure is logged, never raised; 404/410 deletes the subscription).
- `app/services/devices.py`: `register_or_touch(db, device_id, firmware_version, now) -> Device`; `assign(db, device_id, space_id | None) -> Device` (always reseals); `seal(db, device_id) -> Device`; `unseal(db, device_id) -> Device` (409 `DEVICE_UNASSIGNED`); `state_payload(db, device, now) -> dict` (the `state` object of spec §7).
- `app/services/insights.py`: `compute(db, space_id, frm, to, now) -> dict` returning the shape of spec §8 / IOT-36 §6.2 (`kpis`, `summary` with `mode: "template_fallback"`, `no_shows`, `recommendations: []`, `warnings`). Placeholder until Raphaël's module replaces it.

**Security** (`app/security.py`): `current_user(...) -> dict` (claims), `require_fm(...) -> dict` (403 `FORBIDDEN`), `get_app_user(db, claims) -> AppUser` (upsert by `sub`).

**HTTP API**: spec §7 (telemetry) and §8 (REST), base `/api/v1`, errors `{"detail": "<CODE>"}`. Extra: `GET /api/v1/push/vapid-public-key` → `{"key": str | null}`; `GET /api/v1/devices/{id}` for the device panel.

**Frontend** (`frontend/src/`): `api.js` exports `api.get/post/patch/del(path, body?)` → JSON, throws `ApiError{status, code}`; `messages.js` maps error codes and notification types to French text; `router.jsx` (tiny history router, no dependency) exports `Link`, `useRoute()`, `navigate(path)`; `usePolling(fn, ms)` hook; `ui/` holds `Button`, `Card`, `StatusBadge({state})`, `Toast`, `Loader`, `EmptyState`, `Shell({role, children})` (FM sidebar or employee top bar, bell). Styles: `styles/design-system.css` copied from the mockup.

---

### Task 1: Backend foundation (IOT-29) — wave 1

**Files:** `backend/requirements.txt`, `backend/app/{config,database,clock,errors,security}.py`, `backend/app/models/*.py`, `backend/migrations/versions/20261102_0002_iteration1.py`, `backend/app/routers/{__init__,me,settings,spaces,reservations,alerts,notifications,push,devices,insights,telemetry}.py` (all registered in `main.py` with `prefix="/api/v1"`; empty `APIRouter` for those owned by later tasks), `backend/app/services/{occupancy,booking,absence,alerts,notifications,devices,insights}.py` (stubs with the signatures above; implement `occupancy.*`, `booking.effective_end`, `booking.current_reservation` here), `backend/app/test_foundation.py`, `backend/app/conftest.py` (SQLite in-memory engine with `StaticPool`, `Base.metadata.create_all`, `client` fixture overriding `get_db`, `current_user`, `clock.now`), `AGENTS.md` header lines.

**Interfaces:** Produces every name in "Shared interfaces"; later tasks only fill bodies and routers.

- [ ] Step 1: Pin `PyJWT[crypto]==2.10.1` and `pywebpush==2.0.3` (check the latest patch on PyPI if install fails; keep exact pins). Add settings `oidc_issuer=""`, `fm_group="project-admins"`, `dev_fake_user=""`, `device_api_key=""`, `vapid_public_key=""`, `vapid_private_key=""`, `vapid_subject="mailto:support@3istor.com"`.
- [ ] Step 2: Write failing tests in `test_foundation.py`: `test_me_creates_user_on_first_call` (GET `/api/v1/me` twice → one `AppUser`, body has `role` `"employee"`), `test_me_role_fm_from_group` (groups `["project-admins"]` → `role == "facility_manager"`), `test_patch_me_preferences` (`{"phone": "+33600000000", "notify_push": false}` persisted), `test_settings_requires_fm` (employee → 403 `FORBIDDEN`), `test_settings_defaults` (`{"absence_delay_min": 10, "booth_min_min": 15, "booth_max_min": 60, "meeting_min_min": 30, "meeting_max_min": 180}`), `test_settings_reject_min_over_max` (422 `INVALID_SETTINGS`), `test_effective_occupancy_stale` (last observation 31 s ago → `unknown`; 29 s → stored value; device sealed → `unknown`), `test_space_state_matrix` (the six rows of spec §5).
- [ ] Step 3: Run `cd backend && .venv/bin/python -m pytest app/test_foundation.py -q` → FAIL.
- [ ] Step 4: Implement models, `get_db`, `clock.now`, `DomainError` handler, `security`, routers `me` and `settings`, services `occupancy` and the two `booking` helpers.
- [ ] Step 5: Write the Alembic revision by hand (no Docker needed): all tables; on PostgreSQL only (`if op.get_bind().dialect.name == "postgresql"`) `CREATE EXTENSION IF NOT EXISTS btree_gist` and the exclusion constraint `EXCLUDE USING gist (space_id WITH =, tstzrange(start_at, COALESCE(released_at, end_at)) WITH &&) WHERE (status <> 'cancelled')`; insert the `app_settings` row. Declare `squawk_ignore` only for rules it really trips, with a comment.
- [ ] Step 6: `make check` → backend tests (including `test_migrations.py`) PASS, frontend build PASS.
- [ ] Step 7: Fill the 3 header lines of `AGENTS.md` (app purpose; Tickets: Jira `3istors.atlassian.net`, project `IOT`; Docs: `3-Istor/iot-doc`, `software/specification_application.md`). Commit `IOT-29: data model, identity and settings`.

### Task 2: Frontend shell and employee pages (IOT-30) — wave 1

**Files:** `frontend/src/{main.jsx,App.jsx,api.js,messages.js,router.jsx,usePolling.js}`, `frontend/src/styles/design-system.css`, `frontend/src/ui/*.jsx`, `frontend/src/pages/{Login,Reserve,MyReservations,Notifications,Errors}.jsx`, `frontend/public/{sw.js,manifest.webmanifest}`, `frontend/index.html`, `frontend/vite.config.js` (dev proxy `/api` → `http://localhost:8081`).

**Interfaces:** Consumes the HTTP API (spec §8). Produces `api.js`, `router.jsx`, `ui/*`, `Shell` for Task 6.

- [ ] Step 1: Port `docs/maquettes/design-system.css` and the fonts (DM Sans, Sora via Google Fonts link in `index.html`). `App.jsx` loads `GET /api/v1/me`; 401 → Login page (button « Se connecter » → `/` reload through the gateway; « Créer un compte » → Keycloak registration URL from `VITE_KEYCLOAK_REGISTER_URL`, hidden when empty), 403 → error page.
- [ ] Step 2: Pages per mockup: `EmployeRecherche` → `Reserve` (criteria: type, date, start, duration with type bounds and 5-min steps, participants → `min_capacity`, floor, equipment; results with `StatusBadge`; empty state « M'avertir si un espace se libère » → `POST /alerts`; 409 toast « Ce créneau vient d'être réservé »), `EmployeProfil` → `MyReservations` (upcoming/in progress/past, absence banner with `release_at`, modify panel, cancel, « Mes alertes », two notification toggles via `PATCH /me`), `Notifications` (bell + list + browser permission card: registers `sw.js`, `PushManager.subscribe` with the key from `/push/vapid-public-key`, `POST /push-subscriptions`), `Erreurs`, `Chargement`.
- [ ] Step 3: `usePolling(fn, 5000)` drives spaces, notifications count and reservations; pause when `document.hidden`.
- [ ] Step 4: `cd frontend && npm run build` PASS; `make check` PASS. Commit `IOT-30: web shell and employee pages`.

### Task 3: Landing page and mockups in the repo (new IOT ticket) — wave 1, done by the lead

**Files:** `landing/` (sources, `build.js`, `package.json`, `CLAUDE.md` from the delivery), `docs/maquettes/` (12 `.dc.html`, `design-system.css`, `img/`).

- [ ] Step 1: Copy, keep `optispace-landing-3d.html` git-ignored or committed as the built artefact (follow the delivery's `.gitignore`).
- [ ] Step 2: `cd landing && npm install && npm run build` PASS. Hosting is decided separately (the app is behind SSO; the landing must be public).
- [ ] Step 3: Commit `IOT-XX: 3D landing sources`.

### Task 4: Telemetry, devices and simulator (IOT-28) — wave 2, after Task 1

**Files:** `routers/telemetry.py`, `routers/devices.py`, `schemas/telemetry.py`, `schemas/devices.py`, `services/devices.py`, `simulator/simulate.py` (stdlib only), `backend/app/test_telemetry.py`, `backend/app/test_devices.py`.

**Interfaces:** Consumes `occupancy.apply_observation`, `occupancy.space_state`, `absence.evaluate_space`, `booking.current_reservation`. Produces `devices.*` and `POST /api/v1/telemetry`, `GET/PATCH /api/v1/devices`, `GET /api/v1/devices/{id}`, `POST /api/v1/devices/{id}/{seal,unseal}`.

- [ ] Step 1: Failing tests: `test_telemetry_requires_api_key` (no or wrong `X-Api-Key` → 401 `INVALID_API_KEY`), `test_unknown_device_registered_sealed` (200, `accepted false`, `code "DEVICE_SEALED"`, `state.seal "sealed"`), `test_invalid_presence_400` (`"maybe"` → 400 `INVALID_PAYLOAD`), `test_unknown_schema_422`, `test_clock_skew_422` (`ts` 61 s ahead), `test_replay_identical_ignored` (same body twice → one observation, both 200), `test_replay_conflict_409`, `test_valid_updates_status_and_returns_state` (unsealed assigned device, `presence present` → `space_state` `occupied_unreserved`), `test_ts_null_uses_received_at`, `test_assign_reseals`, `test_unseal_unassigned_409`, `test_device_routes_require_fm`.
- [ ] Step 2: Implement; telemetry calls `absence.evaluate_space` after `apply_observation`. Observations older than `space_status.last_observation_at` are stored but do not change the status.
- [ ] Step 3: `simulator/simulate.py --url http://localhost:8081 --key $DEVICE_API_KEY --devices 3 --pattern demo` posts `optispace.telemetry/1` heartbeats every 10 s with `source "simulated"`.
- [ ] Step 4: `make check` PASS. Commit `IOT-28: telemetry endpoint, devices and simulator`.

### Task 5: Spaces, bookings, absence, alerts, notifications, insights (IOT-30) — wave 2, after Task 1

**Files:** `routers/{spaces,reservations,alerts,notifications,push,insights}.py`, `schemas/*.py`, `services/{booking,absence,alerts,notifications,insights}.py`, `services/webpush.py`, tests `test_spaces.py`, `test_reservations.py`, `test_absence.py`, `test_alerts.py`, `test_notifications.py`, `test_insights.py`.

**Interfaces:** Consumes Task 1 models, `occupancy.*`, `security.*`. Produces the REST API of spec §8 (except devices/telemetry/me/settings).

- [ ] Step 1: Failing tests for bookings: `test_create_aligned_5_min` (10:03 → 422 `INVALID_SLOT`), `test_duration_bounds_by_type` (meeting 25 min → 422; booth 65 min → 422; space override wins), `test_no_past_start`, `test_overlap_same_space_409`, `test_overlap_other_space_allowed`, `test_inactive_space_422`, `test_modify_before_start_any_field`, `test_modify_in_progress_end_only` (changing start → 422), `test_cancel_not_owner_403`, `test_cancel_frees_and_triggers_alerts`.
- [ ] Step 2: Failing tests for absence (D = 10, reservation 10:00–11:00, `clock.now` patched): `test_no_show_notified_at_start` (absent at 10:00 → `ABSENCE_WARNING` with `release_at` 10:10), `test_release_at_deadline` (absent continuously to 10:10 → status `released`, `released_at` 10:10, `RELEASED` sent, alerts evaluated), `test_presence_before_deadline_keeps` (present 10:06 → `presence_detected`), `test_early_departure` (present 10:00–10:30, absent → warning 10:40, release 10:50), `test_unknown_at_deadline_blocks` (no telemetry since 10:05 → `release_blocked`), `test_gap_during_episode_blocks`, `test_no_episode_when_deadline_after_end` (reservation 10:00–10:15 with presence then absence at 10:10), `test_evaluate_idempotent` (two calls at 10:10 → one release, one `RELEASED`), `test_modify_end_before_deadline_closes_episode`.
- [ ] Step 3: Failing tests for alerts and notifications: `test_alert_created_only_with_criteria`, `test_on_freed_notifies_matching` (type and capacity match, interval overlaps), `test_alert_closed_when_user_books`, `test_alert_expires_at_end`, `test_notification_prefs_respected` (`notify_in_app false` → no row), `test_push_410_deletes_subscription` (mock `webpush`), `test_notification_texts` (exact strings of spec §10).
- [ ] Step 4: Implement. Overlap check in `booking` before insert (SQLite) and catch `IntegrityError` from the PostgreSQL constraint → 409. `evaluate_space` is called from `GET /spaces`, `GET /spaces/{id}`, `GET /reservations/mine` for the spaces they return. Insights: compute occupied, reserved, released minutes, no-show count and coverage from observations at minute resolution; summary from the template of exigences §6.2.
- [ ] Step 5: `make check` PASS. Commit `IOT-30: bookings, absence release, alerts and notifications`.

### Task 6: Facility manager pages (IOT-30) — wave 2, after Task 2

**Files:** `frontend/src/pages/admin/{Dashboard,Spaces,Devices,Settings,Profile}.jsx`.

**Interfaces:** Consumes Task 2 `api.js`, `router.jsx`, `ui/*`, `Shell`; the API of Tasks 4 and 5.

- [ ] Step 1: Pages per mockup and the regeneration notes: Dashboard (space and period selectors, KPI cards K-01, K-02, K-05, K-06, K-07, IA block showing `summary.text`, badge « IA » or « Gabarit (repli) », `recommendations`, `warnings`; « À traiter » from `GET /devices`), Spaces (table + form: name, type, description, capacity, floor, equipment, min/max, active; detail tabs « Détails » and « Historique » from `/spaces/{id}/history`), Devices (states, assign, « Desceller » with a confirmation dialog, « Mettre en maintenance » = seal), Settings (delay D, durations by type), Profile (identity read-only + « Gérer mon compte » link `VITE_KEYCLOAK_ACCOUNT_URL`, phone, two channel toggles, two device alerts).
- [ ] Step 2: `npm run build` PASS, `make check` PASS. Commit `IOT-30: facility manager pages`.

### Task 7: Integration and review — wave 3, lead

- [ ] Step 1: Merge branches locally in order 1 → 4, 5 → 2 → 6 on an integration branch; `make check` PASS.
- [ ] Step 2: `docker compose up --build` with `DEV_FAKE_USER` and `DEVICE_API_KEY` in `.env`; run the simulator; book a space, watch the release at +10 min with `ABSENCE_DELAY` lowered to 1 min in settings.
- [ ] Step 3: Whole-branch review by a fresh reviewer; fix findings; open PRs per ticket, linked to Jira.
