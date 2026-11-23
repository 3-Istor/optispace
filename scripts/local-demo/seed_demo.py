"""Load IOT-38 reference rooms into the disposable local OptiSpace database."""
import json
import math
import sys
from datetime import datetime, timedelta
from pathlib import Path

from app import clock
from app.database import SessionLocal
from app.models import AbsenceEpisode, Device, Observation
from app.models.enums import EpisodeKind, EpisodeOutcome, ObservationKind, Presence, ReservationStatus, Source, SpaceType
from app.services import insights
from app.testkit import book, make_space


def load_case(db, case):
    source = case["input"]
    case_id = case["id"]
    room = make_space(db, f"Salle A - {case_id} (simulation)", SpaceType.MEETING_ROOM, 6)
    device = db.query(Device).filter_by(space_id=room.id).one()
    device.firmware = "simulation-iot38"

    reservations = {}
    for row in source["reservations"]:
        reservations[row["id"]] = book(
            db, room, datetime.fromisoformat(row["start_at"]), datetime.fromisoformat(row["end_at"]),
            status=ReservationStatus(row["status"]),
            released_at=datetime.fromisoformat(row["released_at"]) if row.get("released_at") else None,
        )

    for row in source["absence_episodes"]:
        db.add(AbsenceEpisode(
            reservation_id=reservations[row["reservation_id"]].id, kind=EpisodeKind(row["kind"]),
            opened_at=datetime.fromisoformat(row["notification_at"]),
            deadline_at=datetime.fromisoformat(row["deadline_at"]),
            closed_at=datetime.fromisoformat(row["closed_at"]), outcome=EpisodeOutcome(row["outcome"]),
        ))

    for interval in source["observations"]:
        when = datetime.fromisoformat(interval["from"])
        until = datetime.fromisoformat(interval["to"])
        presence = {"occupied": Presence.PRESENT, "empty": Presence.ABSENT}[interval["state"]]
        while when < until:
            db.add(Observation(
                device_id=device.id, space_id=room.id, boot_id="iot-38", seq=int(when.timestamp()),
                kind=ObservationKind.HEARTBEAT, presence=presence, observed_at=when, received_at=when,
                clock_synced=True, source=Source.SIMULATED,
            ))
            when += timedelta(minutes=1)
    db.commit()
    return room


def verify_case(db, case, room):
    period = case["input"]["period"]
    result = insights.compute(db, room.id, datetime.fromisoformat(period["from"]), datetime.fromisoformat(period["to"]), clock.now())
    expected = case["expected"]["kpis"]
    kpis = result["kpis"]
    assert kpis["observed_min"] == expected["observable_minutes"]
    assert kpis["occupied_min"] == expected["occupied_minutes"]
    assert kpis["unknown_min"] == expected["unknown_minutes"]
    assert kpis["released_min"] == expected["released_minutes"]
    for key in ("occupancy_pct", "coverage_pct"):
        if expected[key] is None:
            assert kpis[key] is None
        else:
            assert math.isclose(kpis[key], expected[key], abs_tol=0.050001)
    assert result["summary"]["mode"] == "template_fallback"
    return {"space_id": str(room.id), **period, "expected": expected}


dataset = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
cases = {case["id"]: case for case in dataset["cases"]}
with SessionLocal() as database:
    result = {}
    for case_id in ("J-01", "J-02", "J-04"):
        case = cases[case_id]
        result[case_id] = verify_case(database, case, load_case(database, case))
        print(f"{case_id} OK (chiffres de reference et gabarit)")
Path(sys.argv[2]).write_text(json.dumps(result, indent=2), encoding="utf-8")
