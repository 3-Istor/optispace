"""Shared test fixtures.

- `db`: a session on a fresh in-memory SQLite database (tables from the
  models). Commit setup data before calling `client`: each request gets its
  own session on the same connection. Call `db.expire_all()`
  to read what a request wrote to rows `db` had already loaded.
- `claims`: the JWT claims `current_user` returns. Mutate it to switch user or
  role, e.g. `claims["groups"] = ["facility-managers"]` for a facility manager.
  Default: an employee of `demo-a`.
- `frozen_clock`: `app.clock.now()` returns `frozen_clock.now` (aware UTC,
  2026-11-02 09:00); assign it to move time.
- `client`: a TestClient wired to the three fixtures above.
- `settings_env`: call `settings_env(DEVICE_API_KEY="k")` to set what
  `get_settings()` reads. It also blanks `DEV_FAKE_USER`, which a local `.env`
  may set.
"""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import clock
from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.security import current_user


@pytest.fixture
def session_factory():
    # StaticPool: one connection, so every session sees the same in-memory database.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    yield factory
    engine.dispose()


@pytest.fixture
def db(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture
def claims():
    return {"sub": "u1", "email": "u1@example.com", "name": "User One", "groups": [], "organization": ["demo-a"]}


@pytest.fixture
def frozen_clock(monkeypatch):
    state = SimpleNamespace(now=datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(clock, "now", lambda: state.now)
    return state


@pytest.fixture
def settings_env(monkeypatch):
    def set_env(**values):
        for name, value in {"DEV_FAKE_USER": "", "GROQ_API_KEY": " ", "GROQ_MODEL": "openai/gpt-oss-120b", **values}.items():
            monkeypatch.setenv(name, value)  # environment variables win over .env
        get_settings.cache_clear()

    set_env()
    yield set_env
    get_settings.cache_clear()


@pytest.fixture
def client(session_factory, claims, frozen_clock):
    def override_get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user] = lambda: claims
    yield TestClient(app)
    app.dependency_overrides.clear()
