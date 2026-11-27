"""The local demo stays usable over time without replacing existing data."""
from datetime import date, timedelta
from pathlib import Path
import runpy

import pytest
from sqlalchemy import func, select

from app.models import Device, Observation, Reservation, Space
from app.models.enums import ObservationKind, Presence, Source, SpaceType
from app.testkit import at, book, make_space, make_user

seed_demo = runpy.run_path(str(Path(__file__).with_name("seed_report_demo.py")))["seed_demo"]


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_demo_refresh_preserves_existing_records_and_skips_booked_days(db):
    make_user(db, "fm-report-simulated-booker")
    room = make_space(db, "Atelier renommé", SpaceType.MEETING_ROOM, 6, device=False)
    device = Device(id="fm-demo-2", space_id=room.id)
    db.add(device)
    original = Observation(device_id=device.id, space_id=room.id, boot_id="fm-report-demo-v1", seq=1,
                           kind=ObservationKind.HEARTBEAT, presence=Presence.PRESENT,
                           observed_at=at("17:59", day=18), received_at=at("17:59", day=18),
                           clock_synced=True, source=Source.SIMULATED)
    db.add(original)
    db.commit()
    manual = book(db, room, at("09:00", day=24), at("10:00", day=24))
    original_rows = {model: list(db.execute(select(model.__table__)))
                     for model in (Observation, Reservation, Device, Space)}

    # The screenshot's last seven days were empty with this stale dataset.
    assert seed_demo(db, date(2026, 11, 27)) == 5
    assert count(db, Observation) == 1 + 5 * 540
    assert count(db, Reservation) == 1 + 5 * 2
    for model, rows in original_rows.items():
        for row in rows:
            assert db.execute(select(model.__table__).where(model.id == row.id)).one() == row
    assert db.scalar(select(func.count()).select_from(Observation).where(
        Observation.observed_at >= at("00:00", day=24), Observation.observed_at < at("00:00", day=25),
    )) == 0
    assert db.get(Reservation, manual.id) is not None
    latest = db.scalar(select(func.max(Observation.observed_at)))
    assert latest == at("17:59", day=26)

    # Relaunching the same day is a no-op; tomorrow only appends the completed Friday.
    assert seed_demo(db, date(2026, 11, 27)) == 0
    assert count(db, Observation) == 1 + 5 * 540
    assert seed_demo(db, date(2026, 11, 28)) == 1
    assert count(db, Observation) == 1 + 6 * 540


def test_demo_initial_seed_covers_eight_weeks_without_weekends_or_today(db):
    today = date(2026, 11, 27)
    assert seed_demo(db, today) == 4 * 40
    assert count(db, Space) == 4
    assert count(db, Device) == 4
    assert count(db, Observation) == 40 * (3 * 540 + 210)
    dates = {row[0].astimezone(at("00:00").tzinfo).date()
             for row in db.execute(select(Observation.observed_at))}
    assert min(dates) == today - timedelta(days=56)
    assert max(dates) == today - timedelta(days=1)
    assert all(day.weekday() < 5 for day in dates)


@pytest.mark.parametrize("state", ["inactive", "other_organization", "unassigned"])
def test_demo_refresh_respects_changed_rooms(db, state):
    make_user(db, "fm-report-simulated-booker")
    room = make_space(db, device=False, is_active=state != "inactive",
                      organization="demo-b" if state == "other_organization" else "demo-a")
    db.add(Device(id="fm-demo-2", space_id=None if state == "unassigned" else room.id))
    db.commit()
    assert seed_demo(db, date(2026, 11, 27)) == 0
    assert count(db, Space) == 1
    assert count(db, Reservation) == 0
    assert count(db, Observation) == 0
