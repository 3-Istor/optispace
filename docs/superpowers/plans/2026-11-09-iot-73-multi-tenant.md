# IOT-73 Multi-tenant OptiSpace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several client companies share one OptiSpace instance; each one sees only its own spaces, devices, reservations and settings, and OptiSpace staff install devices.

**Architecture:** The company is the Keycloak organization alias read from the token's `organization` claim in `app/security.py`. One database, an `organization` column on `space` and `app_user`, a new `org_settings` table; everything else follows its space or its user. Router-level dependencies reject accounts without a company and staff accounts; each query filters on the caller's `user.organization`.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, pytest + TestClient, React 19 + Vite.

**Spec:** iot-doc PR #6, `software/specification_application.md` 0.6 (§2, §3, §4.3, §4.4, §8, §9, §10) and DEC-008. Local copy: `/home/hugo/epita/SIGL/IoT/IoT/wt-IOT-73-spec`.

## Global Constraints

- The company comes only from the token (`organization` claim), never from a body, path or query parameter.
- Claim shapes accepted: a list of aliases `["demo-a"]` or an object keyed by alias `{"demo-a": {"id": "…"}}`. Exactly one alias, otherwise `403 NO_ORGANIZATION`.
- Profile order: a group in `STAFF_GROUPS` → `staff` (wins over an organization); else one organization and `FM_GROUP` in `groups` → `facility_manager`; else one organization → `employee`; else `403 NO_ORGANIZATION`, `/me` included.
- Defaults: `STAFF_GROUPS = ["project-admins", "project-members"]`, `FM_GROUP = "facility-managers"`.
- Error codes, body `{"detail": "<CODE>"}`: `NO_ORGANIZATION` (403), `FORBIDDEN` (403), `SPACE_NOT_FOUND` (404), `DEVICE_NOT_FOUND` (404), `SPACE_NAME_TAKEN` (409).
- Staff routes: `GET /me`, `PATCH /me`, `GET /devices`, `PATCH /devices/{id}`, `GET /staff/spaces`. Every other data route answers staff `403 FORBIDDEN`.
- A space or device of another company answers 404, as if it did not exist.
- Data from before 0.6 belongs to `demo-a`.
- One Alembic revision `0005` for the whole branch, amended task by task (not on `main` yet). It must run with the previous release's code (`.claude/rules/migrations.md`): new columns nullable or with a server default, new table instead of reshaping `app_settings`.
- Code comments in English, one or two lines, no ticket key. Commits: `IOT-73: <subject>` plus the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- Run backend commands from `backend/` with `.venv/bin/python -m pytest …`; `make check` from the repo root before the PR.

## Review Focus

1. A user row created before 0.6 has `organization = NULL`; on their next request the token's company must be copied in, not leave them looking like staff. Test in Task 1.
2. `organization` as an empty list, an empty object or a plain string (misconfigured mapper) must give `403 NO_ORGANIZATION`, never a 500 or a one-character alias. Test in Task 1.
3. A staff token that also carries an organization stays staff: no company data. Test in Task 1.
4. Moving one's own reservation (`PATCH /reservations/{id}`) to a space of another company must answer 404. Test in Task 2.
5. A space name already used by another company is accepted; the same name twice in one company is `409 SPACE_NAME_TAKEN`. Test in Task 2.

---

## Shared test helper

Tasks 1 to 5 put their tests in `backend/app/test_tenancy.py` and use this helper, defined once in Task 1:

```python
def act_as(claims: dict, sub: str, org: str | None = None, *groups: str) -> None:
    """Switch the `claims` fixture to another account; `org=None` means no organization claim."""
```

Profiles used: `act_as(claims, "fm-a", "demo-a", "facility-managers")`, `act_as(claims, "emp-a", "demo-a")`, `act_as(claims, "emp-b", "demo-b")`, `act_as(claims, "staff", None, "project-members")`, `act_as(claims, "nobody")`.

### Task 1: Profiles from the token

**Files:**
- Modify: `backend/app/config.py` (`fm_group`, new `staff_groups`, `dev_fake_user` comment)
- Modify: `backend/app/security.py`
- Modify: `backend/app/models/app_user.py` (`organization: Mapped[str | None]`)
- Create: `backend/migrations/versions/20261109_0005_tenants.py` (revision `0005`, revises `0004`): `app_user.organization` nullable `String`
- Modify: `backend/app/routers/me.py`, `backend/app/schemas/me.py`
- Modify: `backend/app/routers/{spaces,reservations,alerts,notifications,push,insights,settings}.py`: `APIRouter(..., dependencies=[Depends(member)])`
- Modify: `backend/app/conftest.py`: default `claims` = `{"sub": "u1", "email": "u1@example.com", "name": "User One", "groups": [], "organization": ["demo-a"]}`; docstring example becomes `claims["groups"] = ["facility-managers"]`
- Modify: every `claims["groups"] = ["project-admins"]` in `backend/app/test_*.py` → `["facility-managers"]`
- Create: `backend/app/test_tenancy.py`

**Interfaces:**
- Produces, in `app/security.py`:
  - `organization_of(claims: dict) -> str | None`
  - `is_staff(claims: dict) -> bool`
  - `is_fm(claims: dict) -> bool`: false for staff and without organization
  - `get_app_user(...) -> AppUser`: raises `403 NO_ORGANIZATION` for a non-staff account without one organization; syncs `organization` (`None` for staff), `is_fm`, e-mail and name
  - `member(user: AppUser = Depends(get_app_user)) -> AppUser`: `403 FORBIDDEN` when `user.organization is None` (staff)
  - `require_fm(user: AppUser = Depends(member)) -> AppUser`: `403 FORBIDDEN` unless `user.is_fm`
  - `require_staff(user: AppUser = Depends(get_app_user)) -> AppUser`: `403 FORBIDDEN` unless `user.organization is None`
- Produces: `MeOut.role: Literal["employee", "facility_manager", "staff"]`, `MeOut.absence_delay_min: int | None` (`None` for staff)

- [ ] **Step 1: Write the failing tests** in `test_tenancy.py`, with `act_as` above:
  - `test_organization_claim_shapes`: `organization_of` gives `"demo-a"` for `{"organization": ["demo-a"]}` and for `{"organization": {"demo-a": {"id": "x"}}}`; `None` for `{}`, `{"organization": []}`, `{"organization": {}}`, `{"organization": "demo-a"}`, `{"organization": ["demo-a", "demo-b"]}`.
  - `test_no_organization_is_refused_everywhere`: `act_as(claims, "nobody")`; `GET /api/v1/me`, `GET /api/v1/spaces` and `GET /api/v1/reservations/mine` all answer 403 `{"detail": "NO_ORGANIZATION"}`.
  - `test_staff_profile`: `act_as(claims, "staff", "demo-a", "project-members")`; `/me` answers 200 with `role == "staff"` and `absence_delay_min is None`; `GET /api/v1/spaces` and `GET /api/v1/notifications` answer 403 `FORBIDDEN`; the `app_user` row has `organization is None`. Same `role` with `project-admins`.
  - `test_facility_manager_needs_the_fm_group_and_a_company`: `act_as(claims, "fm-a", "demo-a", "facility-managers")` → role `facility_manager`; `act_as(claims, "emp-a", "demo-a")` → role `employee`.
  - `test_existing_user_gets_the_company_of_the_token`: `make_user(db, "old")` (organization `None`, as after the migration), then `act_as(claims, "old", "demo-a")`; `/me` role `employee`; `db.expire_all()`, row `organization == "demo-a"`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest app/test_tenancy.py -q` → FAIL (`organization_of` not defined).
- [ ] **Step 3: Implement** the Interfaces above. `staff_groups: list[str]` in `Settings` (pydantic-settings reads it as JSON from `STAFF_GROUPS`). `get_app_user`'s early return compares `organization` too. `me._out` derives the role from the user row, and `absence_delay_min` reads `db.get(AppSettings, 1)` for now (Task 3 changes it).
- [ ] **Step 4: Run** `.venv/bin/python -m pytest -q` → all pass, the 147 existing tests included.
- [ ] **Step 5: Commit** `IOT-73: profiles from the token's organization and groups`.

### Task 2: Spaces and reservations per company

**Files:**
- Modify: `backend/app/models/space.py`: `organization: Mapped[str]` (not null, no Python default); drop `unique=True` on `name`; `__table_args__ = (Index("uq_space_organization_name", "organization", "name", unique=True),)`
- Modify: `backend/migrations/versions/20261109_0005_tenants.py`: add `space.organization` not null with `server_default="demo-a"` (backfill, and the previous release inserts without it); drop the old unique on `name` (PostgreSQL: constraint `space_name_key`; SQLite: `batch_alter_table("space", naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"})` then drop `uq_space_name`); create the unique index, on PostgreSQL with `postgresql_concurrently=True` inside `op.get_context().autocommit_block()`
- Modify: `backend/app/testkit.py`: `make_space(..., organization="demo-a")`, `make_user(..., organization="demo-a")` unless given
- Modify: `Space(...)` built directly in `backend/app/test_devices.py`, `test_foundation.py`, `test_telemetry.py`: `organization="demo-a"`
- Modify: `backend/app/services/booking.py`, `backend/app/routers/spaces.py`, `backend/app/routers/insights.py`, `backend/app/routers/reservations.py`
- Test: `backend/app/test_tenancy.py`

**Interfaces:**
- Consumes: `member`, `require_fm` (Task 1)
- Produces, in `app/services/booking.py`:
  - `space_in(db: Session, space_id: UUID, organization: str) -> Space`: `DomainError(404, "SPACE_NOT_FOUND")` when missing or of another company (replaces the private `_space`)
  - `find_spaces(db, organization: str, space_type, min_capacity, floor, equipment, active_only=True)` and `free_spaces(db, organization: str, start_at, ...)`: the new parameter comes second
  - `create(...)` and the modification path check the target space with `space_in(db, space_id, user.organization)`
- Routers stop reading `claims`: `user: AppUser = Depends(member)` and `fm = user.is_fm`. `create_space` sets `organization=user.organization`; insights calls `space_in` before `insights.compute`.

- [ ] **Step 1: Write the failing tests**, each with A1 = `make_space(db, "A1")` and B1 = `make_space(db, "B1", organization="demo-b")`:
  - `test_employee_sees_only_spaces_of_their_company`: as `emp-a`, `GET /spaces` names `== ["A1"]`; `GET /spaces/{B1.id}` → 404 `SPACE_NOT_FOUND`; `GET /spaces/availability` (10:00–10:30) names `== ["A1"]`.
  - `test_employee_cannot_book_a_space_of_another_company`: as `emp-a`, `POST /reservations` on B1 → 404 `SPACE_NOT_FOUND`; a reservation of A1 created, then `PATCH` with `space_id` B1 → 404 `SPACE_NOT_FOUND`.
  - `test_fm_manages_only_spaces_of_their_company`: as `fm-a`, `PATCH /spaces/{B1.id}` → 404; `GET /spaces/{B1.id}/history` and `/insights` (one hour today) → 404; `POST /spaces` named `"B1"` → 201 and the row has `organization == "demo-a"`; a second `POST` named `"A1"` → 409 `SPACE_NAME_TAKEN`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest app/test_tenancy.py -q` → the three new tests FAIL.
- [ ] **Step 3: Implement** the model, revision, testkit and Interfaces above.
- [ ] **Step 4: Run** `.venv/bin/python -m pytest -q` → all pass, `test_migrations.py` included.
- [ ] **Step 5: Commit** `IOT-73: spaces and reservations limited to the caller's company`.

### Task 3: Settings per company

**Files:**
- Create: `backend/app/models/org_settings.py`: `OrgSettings`, table `org_settings`, `organization: Mapped[str]` primary key, plus the five columns of `AppSettings` with the same defaults; export it from `app/models/__init__.py`
- Modify: `backend/app/models/app_settings.py`: one-line comment, the model stays for the previous release during the rollout and goes in the next release
- Modify: `backend/migrations/versions/20261109_0005_tenants.py`: create `org_settings`; copy row `id = 1` of `app_settings` as `organization = 'demo-a'` (`INSERT … SELECT`)
- Create: `backend/app/services/settings.py`
- Modify: `backend/app/services/booking.py` (`duration_bounds`), `backend/app/services/absence.py` (delay), `backend/app/services/insights.py` (delay), `backend/app/routers/settings.py`, `backend/app/routers/me.py`
- Modify: `backend/app/conftest.py` (no `AppSettings` seed) and the `AppSettings` uses in `backend/app/test_foundation.py`
- Test: `backend/app/test_tenancy.py`

**Interfaces:**
- Produces, in `app/services/settings.py`:
  - `DEFAULTS: dict[str, int]` (`absence_delay_min` 10, `booth_min_min` 15, `booth_max_min` 60, `meeting_min_min` 30, `meeting_max_min` 180)
  - `get(db: Session, organization: str) -> OrgSettings`: the row, or a transient `OrgSettings(organization=organization, **DEFAULTS)` never added to the session
  - `save(db: Session, organization: str, changes: dict) -> OrgSettings`: creates the row on the first change; the router keeps its `422 INVALID_SETTINGS` check
- Callers take the company from the space (`space.organization`) or the user (`user.organization`).

- [ ] **Step 1: Write the failing tests:**
  - `test_settings_are_per_company`: as `fm-a`, `PATCH /settings {"absence_delay_min": 5}` → 200; as `fm-b` (`act_as(claims, "fm-b", "demo-b", "facility-managers")`), `GET /settings` → `absence_delay_min == 10`; as `emp-a`, `/me` → 5; as `emp-b` → 10.
  - `test_booking_durations_follow_the_company_settings`: as `fm-b`, `PATCH /settings {"booth_max_min": 30}`; as `emp-b`, booking B1 10:00–10:45 → 422 `INVALID_SLOT`; as `emp-a`, booking A1 10:00–10:45 → 201.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest app/test_tenancy.py -q` → FAIL.
- [ ] **Step 3: Implement** the files and Interfaces above.
- [ ] **Step 4: Run** `.venv/bin/python -m pytest -q` → all pass.
- [ ] **Step 5: Commit** `IOT-73: settings per company`.

### Task 4: Alerts and FM notifications per company

**Files:**
- Modify: `backend/app/services/alerts.py`: `on_freed` and `on_space_available` select only alerts whose user has `AppUser.organization == space.organization` (join on `AvailabilityAlert.user_id`)
- Modify: `backend/app/services/devices.py`: `_notify_fms` adds `AppUser.organization == space.organization`
- Test: `backend/app/test_tenancy.py`

**Interfaces:**
- Consumes: `Space.organization`, `AppUser.organization` (Tasks 1, 2). No new names.

- [ ] **Step 1: Write the failing tests:**
  - `test_free_space_alerts_stay_within_the_company`: as `emp-a`, `POST /alerts` (booth, 10:00–11:00, `min_capacity` 4, which no space has yet); as `fm-b`, `POST /spaces` with a matching booth (capacity 4) → `emp-a` has no `SPACE_AVAILABLE`; as `fm-a`, the same in demo-a → exactly one `SPACE_AVAILABLE` for `emp-a`.
  - `test_device_alerts_reach_the_fms_of_the_space_company`: users `fm-a` (`organization="demo-a"`, `is_fm=True`) and `fm-b` (`"demo-b"`, `is_fm=True`); an unsealed device on A1 last seen 10:00, clock at 10:01; `GET /devices` as `fm-a` → `DEVICE_OFFLINE` for `fm-a` only.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest app/test_tenancy.py -q` → FAIL.
- [ ] **Step 3: Implement** the two filters.
- [ ] **Step 4: Run** `.venv/bin/python -m pytest -q` → all pass.
- [ ] **Step 5: Commit** `IOT-73: alerts and device notifications per company`.

### Task 5: Devices installed by OptiSpace staff

**Files:**
- Modify: `backend/app/routers/devices.py`: no router-level dependency; per route as below
- Modify: `backend/app/services/devices.py`: `get`, `seal` and `unseal` take the caller's company
- Modify: `backend/app/schemas/devices.py`: the `space` object of `DeviceOut` gains `organization: str`
- Create: `backend/app/routers/staff.py` and `StaffSpaceOut` in `backend/app/schemas/spaces.py`; register in `backend/app/main.py`
- Modify: `backend/app/test_devices.py`: assignments (`PATCH /devices/{id}`) run as staff
- Test: `backend/app/test_tenancy.py`

**Interfaces:**
- Consumes: `member`, `require_fm`, `require_staff` (Task 1)
- Produces:
  - `devices.get(db, device_id, organization: str | None)`, required argument: `None` (staff) finds any device; otherwise `DEVICE_NOT_FOUND` unless the device's space belongs to `organization`, so an unassigned device is not found. `devices.seal(db, device_id, organization)` and `devices.unseal(db, device_id, organization)` pass it on; `devices.assign` calls `get(db, device_id, None)`
  - `GET /devices`: FM → devices whose space is in their company; staff → every device. Dependency `fm_or_staff(user = Depends(get_app_user)) -> AppUser` (`403 FORBIDDEN` for an employee), in `app/security.py`
  - `GET /devices/{id}`, `POST /devices/{id}/seal`, `POST /devices/{id}/unseal`: `require_fm`, `devices.get(db, id, user.organization)`
  - `PATCH /devices/{id}`: `require_staff`; `devices.assign` unchanged (any company's space)
  - `GET /staff/spaces` → `list[StaffSpaceOut]` (`id`, `name`, `type`, `floor`, `is_active`, `organization`), sorted by `organization` then `name`; `require_staff`

- [ ] **Step 1: Write the failing tests** (an unassigned device `esp32-NEW` created like `register_or_touch`):
  - `test_unassigned_devices_are_visible_to_staff_only`: as `fm-a`, `GET /devices` ids exclude `esp32-NEW`; `GET /devices/esp32-NEW` → 404 `DEVICE_NOT_FOUND`; as staff, `GET /devices` includes it with `space is None`.
  - `test_staff_assigns_a_device_to_a_space_of_any_company`: as staff, `PATCH /devices/esp32-NEW {"space_id": B1}` → 200; as `fm-b`, `GET /devices` includes it with `space.organization == "demo-b"`, and unseal with `{"confirm": true}` → 200; as `fm-a`, it is absent and `POST /devices/esp32-NEW/seal` → 404 `DEVICE_NOT_FOUND`.
  - `test_only_staff_assign_devices`: as `fm-a`, `PATCH /devices/{id}` → 403 `FORBIDDEN`; as staff, `POST /devices/{id}/seal` → 403 `FORBIDDEN`; as `emp-a`, `GET /devices` → 403.
  - `test_staff_spaces_lists_every_company`: as staff, `GET /staff/spaces` organizations `== ["demo-a", "demo-b"]`; as `fm-a` → 403 `FORBIDDEN`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest app/test_tenancy.py -q` → FAIL.
- [ ] **Step 3: Implement** the Interfaces above.
- [ ] **Step 4: Run** `.venv/bin/python -m pytest -q` → all pass.
- [ ] **Step 5: Commit** `IOT-73: devices installed by OptiSpace staff`.

### Task 6: Front: no-company page, staff installation page, FM devices

**Files:**
- Modify: `frontend/src/App.jsx`: a `/me` failure with `e.code === 'NO_ORGANIZATION'` shows `ErrorPage kind="noOrganization" standalone`; role `staff` gets `STAFF_ROUTES = { '/': Devices }`, any other path → `notFound`
- Modify: `frontend/src/pages/Errors.jsx`: kind `noOrganization`, code `ERREUR 403`, title « Votre compte n'est rattaché à aucune entreprise. », text « Demandez au support OptiSpace de rattacher votre compte à votre entreprise. », no home button
- Modify: `frontend/src/ui/Shell.jsx`: `STAFF_NAV = [['Installation', [['/', 'Boîtiers', ICONS.device]]]]`; `roleLabel` gives « Admin OptiSpace » for `staff`
- Modify: `frontend/src/pages/admin/Devices.jsx`: `Devices({ me })`. Staff loads `/devices` and `/staff/spaces`, keeps assign, move and detach, hides seal and unseal, and `SpaceSelect` groups by `organization`. FM keeps seal and unseal and loses assign, move and detach.

**Interfaces:**
- Consumes: `GET /me` `role`, `GET /devices` (`space.organization`), `GET /staff/spaces` (Task 5)

- [ ] **Step 1: Implement** the four files above.
- [ ] **Step 2: Run** `cd frontend && npm run build` → success.
- [ ] **Step 3: Check in the browser:** backend with `DEV_FAKE_USER` set to each of the five profiles of the shared helper, frontend with `npm run dev`; screenshot `/` for staff (device list with an assign form grouped by company), `/admin/devices` for `fm-a` (no assign form), and the page for `nobody`.
- [ ] **Step 4: Commit** `IOT-73: front for staff, facility managers and accounts without a company`.

### Task 7: Docs and pull request

**Files:**
- Modify: `AGENTS.md`, conventions line on `get_app_user`: company data routes use `Depends(member)`, facility managers `Depends(require_fm)`, OptiSpace staff `Depends(require_staff)`
- Modify: `backend/app/conftest.py` docstring if Tasks 1–3 left it stale

- [ ] **Step 1: Run** `make check` at the repo root → backend tests and frontend build pass; keep the output.
- [ ] **Step 2: Commit** `IOT-73: document the tenant dependencies`.
- [ ] **Step 3: Push and open the PR** `IOT-73: multi-tenant isolation by organization` to `main`, body linking IOT-73 and iot-doc#6, then wait for CI (tests, migration lint, frontend build, security scans) to be green.
