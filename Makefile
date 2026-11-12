.PHONY: install check migrate migration dev-as

# Agents run each command in a fresh shell, so use the venv's python directly.
PYTHON := $(if $(wildcard backend/.venv/bin/python),.venv/bin/python,python3)

install:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
	cd frontend && npm install

check:
	cd backend && $(PYTHON) -m pytest -q
	cd frontend && npm run build

migrate:
	docker compose run --rm migrate

migration:
	@test -n "$(name)" || { echo 'usage: make migration name="add email_verified"'; exit 1; }
	docker compose run --rm -e MIGRATION_NAME="$(name)" migrate \
		sh -c '/app/migrate && alembic revision --autogenerate -m "$$MIGRATION_NAME"'

# Demo profiles for local dev: fake token claims, no Keycloak. Shared SQLite in /tmp, so the tracked app.db stays untouched.
DEMO_fm-a      := {"sub":"demo-fm-a","email":"fm.demo-a@example.com","name":"FM Demo A","groups":["facility-managers"],"organization":["demo-a"]}
DEMO_employe-a := {"sub":"demo-employe-a","email":"employe.demo-a@example.com","name":"Employe Demo A","groups":[],"organization":["demo-a"]}
DEMO_fm-b      := {"sub":"demo-fm-b","email":"fm.demo-b@example.com","name":"FM Demo B","groups":["facility-managers"],"organization":["demo-b"]}
DEMO_employe-b := {"sub":"demo-employe-b","email":"employe.demo-b@example.com","name":"Employe Demo B","groups":[],"organization":["demo-b"]}
DEMO_staff     := {"sub":"demo-staff","email":"staff@example.com","name":"Staff OptiSpace","groups":["project-members"]}

# Backend on :8081, where the vite dev proxy expects it; run `npm run dev` in frontend/ next to it.
dev-as:
	@test -n '$(DEMO_$(who))' || { echo 'usage: make dev-as who=fm-a|employe-a|fm-b|employe-b|staff'; exit 1; }
	cd backend && SQLITE_PATH=/tmp/optispace-demo.db $(PYTHON) -m alembic upgrade head && \
		SQLITE_PATH=/tmp/optispace-demo.db OIDC_ISSUER= DEV_FAKE_USER='$(DEMO_$(who))' $(PYTHON) -m uvicorn app.main:app --reload --port 8081
