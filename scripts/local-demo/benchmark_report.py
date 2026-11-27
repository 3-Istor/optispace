"""Isolated Windows report-memory experiment, not a production load test.

Seed once, then measure in fresh processes with --buffered (previous behavior)
and without it. The database contains only synthetic heartbeats, no bookings.
"""
import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
from time import perf_counter
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def peak_memory():
    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]
    info = Counters()
    info.cb = ctypes.sizeof(info)
    ctypes.windll.kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    if not ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(info), info.cb):
        raise ctypes.WinError()
    return round(info.PeakWorkingSetSize / 2**20, 1)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--database", type=Path, required=True)
    p.add_argument("--seed", action="store_true")
    p.add_argument("--buffered", action="store_true")
    p.add_argument("--days", type=int, choices=(28, 93), default=93)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    args.database.parent.mkdir(parents=True, exist_ok=True)
    if args.seed and args.database.exists():
        raise SystemExit("Refusing to overwrite an existing database")
    if not args.seed and not args.database.exists():
        raise SystemExit("Seed the synthetic database first")
    os.environ.update(DB_TYPE="sqlite", SQLITE_PATH=str(args.database), GEMINI_API_KEY=" ", OIDC_ISSUER="", DEV_FAKE_USER="")
    from app.database import Base, engine, SessionLocal
    from app.models import Device, Observation, Space
    from app.models.enums import ObservationKind, Presence, Source, SpaceType
    from app.services import reports
    start = datetime(2026, 8, 1, tzinfo=timezone.utc)
    space_id = UUID("00000000-0000-0000-0000-000000000086")
    if args.seed:
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            db.add(Space(id=space_id, name="Synthetic benchmark", organization="benchmark", type=SpaceType.MEETING_ROOM, capacity=6))
            db.flush()
            db.add(Device(id="synthetic-benchmark", space_id=space_id))
            db.commit()
            rows = []
            for seq in range(93 * 8640):
                instant = start + timedelta(seconds=10*seq)
                rows.append(dict(id=uuid4(), device_id="synthetic-benchmark", space_id=space_id, boot_id="synthetic", seq=seq,
                                 kind=ObservationKind.HEARTBEAT, presence=Presence.PRESENT if seq % 2 else Presence.ABSENT,
                                 observed_at=instant, received_at=instant, clock_synced=True, source=Source.SIMULATED))
                if len(rows) == 2000:
                    db.execute(Observation.__table__.insert(), rows)
                    db.commit()
                    rows = []
            if rows:
                db.execute(Observation.__table__.insert(), rows)
                db.commit()
        print("Seeded 803520 synthetic observations", flush=True)
        return
    with SessionLocal() as db:
        if args.buffered:
            original = db.execute
            def execute(statement, *a, **kw):
                if statement.get_execution_options().get("yield_per"):
                    statement = statement.execution_options(yield_per=None)
                return original(statement, *a, **kw)
            db.execute = execute
        began = perf_counter()
        report = reports.compute(db, "benchmark", start, start+timedelta(days=args.days), start+timedelta(days=94))
        result = dict(days=args.days, buffered=args.buffered, seconds=round(perf_counter()-began, 3), peak_working_set_mib=peak_memory(),
                      facts_revision=report["facts_revision"], totals=report["totals"], platform=sys.platform,
                      scope="single_room_single_request_sqlite_no_reservations_not_container_memory")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({k:v for k,v in result.items() if k != "totals"}))


if __name__ == "__main__":
    main()
