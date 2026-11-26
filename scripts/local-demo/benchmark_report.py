"""Isolated KPI/PDF benchmark, not a production load test (based on IOT-86 PR #39).

Seed once, then measure each version in a fresh process on the same SQLite file.
AI is disabled. --compare checks the complete result, including its data_revision.
Seeded heartbeats run every 10 seconds, 07:00-01:00 Paris, with daily bookings.
"""
import argparse
import cProfile
import ctypes
from ctypes import wintypes
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
from time import perf_counter
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def peak_memory():
    if sys.platform != "win32":
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(peak / (2**20 if sys.platform == "darwin" else 1024), 1)
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
    p.add_argument("--days", type=int, choices=range(1, 94), default=93)
    p.add_argument("--rooms", type=int, choices=range(1, 11), default=1)
    p.add_argument("--kind", choices=("report", "dashboard"), default="report")
    p.add_argument("--compare", type=Path)
    p.add_argument("--profile", action="store_true")
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    args.database.parent.mkdir(parents=True, exist_ok=True)
    if args.seed and args.database.exists():
        raise SystemExit("Refusing to overwrite an existing database")
    if not args.seed and not args.database.exists():
        raise SystemExit("Seed the synthetic database first")
    os.environ.update(DB_TYPE="sqlite", SQLITE_PATH=str(args.database.resolve()), GROQ_API_KEY=" ", OIDC_ISSUER="", DEV_FAKE_USER="")
    from app.database import Base, engine, SessionLocal
    from sqlalchemy import select, func
    from app.models import AppUser, Device, Observation, Reservation, Space
    from app.models.enums import ObservationKind, Presence, Source, SpaceType
    from app.services import insights, report_pdf, reports
    start = datetime(2026, 8, 1, tzinfo=timezone.utc)
    space_id = UUID("00000000-0000-0000-0000-000000000086")
    if args.seed:
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            user = AppUser(keycloak_sub="benchmark", organization="benchmark")
            db.add(user)
            db.flush()
            for room in range(args.rooms):
                room_id = UUID(int=space_id.int + room)
                device_id = f"synthetic-benchmark-{room}"
                db.add(Space(id=room_id, name=f"Synthetic benchmark {room:02}", organization="benchmark", type=SpaceType.MEETING_ROOM, capacity=6))
                db.flush()
                db.add(Device(id=device_id, space_id=room_id))
                db.commit()
                rows = []
                for day in range(args.days):
                    opening = (start + timedelta(days=day)).replace(hour=7, tzinfo=ZoneInfo("Europe/Paris")).astimezone(timezone.utc)
                    db.add(Reservation(space_id=room_id, user_id=user.id, start_at=opening+timedelta(hours=2), end_at=opening+timedelta(hours=4)))
                    for tick in range(18 * 360):
                        instant = opening + timedelta(seconds=10*tick)
                        rows.append(dict(id=uuid4(), device_id=device_id, space_id=room_id, boot_id="synthetic", seq=day*6480+tick,
                                         kind=ObservationKind.HEARTBEAT,
                                         presence=Presence.PRESENT if tick % 360 >= 42 else Presence.ABSENT,
                                         observed_at=instant, received_at=instant, clock_synced=True, source=Source.SIMULATED))
                        if len(rows) == 2000:
                            db.execute(Observation.__table__.insert(), rows)
                            db.commit()
                            rows = []
                if rows:
                    db.execute(Observation.__table__.insert(), rows)
                    db.commit()
                print(f"Seeded room {room+1}/{args.rooms}", flush=True)
        print(f"Seeded {args.rooms * args.days * 6480} synthetic observations", flush=True)
        return
    with SessionLocal() as db:
        spaces = list(db.scalars(select(Space.id).where(Space.organization == "benchmark").order_by(Space.name)))
        if len(spaces) != args.rooms:
            raise SystemExit(f"Expected {args.rooms} benchmark rooms, found {len(spaces)}")
        counts = {"rooms": len(spaces), "observations": db.scalar(select(func.count()).select_from(Observation).where(Observation.space_id.in_(spaces))),
                  "reservations": db.scalar(select(func.count()).select_from(Reservation).where(Reservation.space_id.in_(spaces)))}
        profiler = cProfile.Profile() if args.profile else None
        if profiler:
            profiler.enable()
        began = perf_counter()
        if args.kind == "report":
            report = reports.compute(db, "benchmark", start, start+timedelta(days=args.days), start+timedelta(days=94))
        else:
            report = insights.compute(db, spaces[0], start, start+timedelta(days=args.days), start+timedelta(days=94))
        calculated = perf_counter()
        pdf = report_pdf.render(report) if args.kind == "report" else b""
        finished = perf_counter()
        if profiler:
            profiler.disable()
        digest = hashlib.sha256(json.dumps(report, sort_keys=True).encode()).hexdigest()
        result = dict(days=args.days, kind=args.kind, **counts,
                      calculation_seconds=round(calculated-began, 3), pdf_seconds=round(finished-calculated, 3),
                      seconds=round(finished-began, 3), peak_working_set_mib=peak_memory(), pdf_bytes=len(pdf),
                      data_revision=report["data_revision"], result_sha256=digest, platform=sys.platform,
                      scope="single_request_sqlite_rules_only_not_container_memory", profiled=args.profile, report=report)
        if args.compare:
            baseline = json.loads(args.compare.read_text(encoding="utf-8"))
            if baseline["report"] != report:
                raise AssertionError("The report differs from the baseline")
            result["identical_to_baseline"] = True
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
        if pdf:
            args.output.with_suffix(".pdf").write_bytes(pdf)
        if profiler:
            profiler.dump_stats(str(args.output.with_suffix(".prof")))
        print(json.dumps({k:v for k,v in result.items() if k != "report"}))


if __name__ == "__main__":
    main()
