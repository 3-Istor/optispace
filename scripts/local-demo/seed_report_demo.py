"""Eight weeks of explicitly simulated FM data in a dedicated disposable database."""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import sys

from sqlalchemy import insert, select

from app import clock
from app.database import SessionLocal
from app.models import AbsenceEpisode, AppUser, Device, Observation, Reservation, Space
from app.models.enums import EpisodeKind, EpisodeOutcome, ObservationKind, Presence, ReservationStatus, SealState, Source, SpaceType

PARIS = ZoneInfo("Europe/Paris")
today = clock.now().astimezone(PARIS).date()
beginning = today - timedelta(days=56)

with SessionLocal() as db:
    if db.scalar(select(AppUser.id).where(AppUser.keycloak_sub == "fm-report-simulated-booker")):
        print("Données FM de démonstration déjà présentes.")
        sys.exit(0)
    user = AppUser(keycloak_sub="fm-report-simulated-booker", organization="demo-a")
    db.add(user)
    db.flush()
    for index, (name, equipment) in enumerate([
        ("Horizon (démo)", ["Écran", "Visioconférence", "Tableau blanc"]),
        ("Orion (démo)", ["Écran", "Tableau blanc"]),
        ("Atelier (démo)", []),
        ("Azur (démo - couverture partielle)", ["Écran"]),
    ]):
        room = Space(organization="demo-a", name=name, type=SpaceType.MEETING_ROOM, capacity=6,
                     floor=1, equipment=equipment, description="Données fictives pour tester le rapport FM.")
        db.add(room)
        db.flush()
        device = Device(id=f"fm-demo-{index}", space_id=room.id, seal=SealState.UNSEALED)
        db.add(device)
        db.flush()
        for offset in range(56):
            day = beginning + timedelta(days=offset)
            if day.weekday() >= 5:
                continue
            week = offset // 7
            delay = [3, 9 - min(week // 2, 3), 5, 5][index]
            end_morning, end_afternoon = [(12, 18), (12, 17), (11, 16), (12, 17)][index]
            midnight = datetime.combine(day, time(), PARIS)
            first = Reservation(space_id=room.id, user_id=user.id, start_at=midnight + timedelta(hours=9),
                                end_at=midnight + timedelta(hours=end_morning), status=ReservationStatus.ACTIVE)
            second = Reservation(space_id=room.id, user_id=user.id, start_at=first.start_at + timedelta(hours=5),
                                 end_at=first.start_at + timedelta(hours=end_afternoon - 9), status=ReservationStatus.ACTIVE)
            db.add_all([first, second])
            db.flush()
            no_show = index == 1 and day.weekday() == 4
            early = index == 0 and day.weekday() == 1
            if no_show:
                first.status, first.released_at = ReservationStatus.RELEASED, first.start_at + timedelta(minutes=10)
                db.add(AbsenceEpisode(reservation_id=first.id, kind=EpisodeKind.NO_SHOW,
                                     opened_at=first.start_at, deadline_at=first.released_at,
                                     closed_at=first.released_at, outcome=EpisodeOutcome.RELEASED))
            if early:
                second.status, second.released_at = ReservationStatus.RELEASED, second.start_at + timedelta(minutes=130)
                db.add(AbsenceEpisode(reservation_id=second.id, kind=EpisodeKind.EARLY_DEPARTURE,
                                     opened_at=second.start_at + timedelta(hours=2), deadline_at=second.released_at,
                                     closed_at=second.released_at, outcome=EpisodeOutcome.RELEASED))
                db.add(Reservation(space_id=room.id, user_id=user.id, start_at=second.start_at + timedelta(minutes=165),
                                   end_at=second.start_at + timedelta(minutes=195), status=ReservationStatus.ACTIVE))
            observations = []
            for minute in range(540):
                if index == 3 and minute >= 210:
                    continue
                morning_end = [170, 75, 20, 90][index]
                afternoon_end = [250 if not early else 110, 120, 20, 120][index]
                shadow = [max(15, 60 - week * 7), max(20, 45 - week * 5), max(0, 15 - week * 3), 0][index]
                present = (delay <= minute < morning_end and not no_show) or (300 + delay <= minute < 300 + afternoon_end)
                present = present or 195 <= minute < 195 + shadow or (early and 465 <= minute < 495)
                if index == 2 and day.weekday() == 2:
                    present = False
                when = first.start_at + timedelta(minutes=minute)
                observations.append({
                    "device_id": device.id, "space_id": room.id, "boot_id": "fm-report-demo-v1",
                    "seq": int(when.timestamp()), "kind": ObservationKind.HEARTBEAT,
                    "presence": Presence.PRESENT if present else Presence.ABSENT,
                    "observed_at": when, "received_at": when, "clock_synced": True, "source": Source.SIMULATED,
                })
            db.execute(insert(Observation), observations)
        print(f"{name} - 8 semaines simulées")
    db.commit()
print(f"Période de démonstration du {beginning.isoformat()} au {(today - timedelta(days=1)).isoformat()} inclus.")
