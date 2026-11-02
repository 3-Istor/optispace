"""Dashboard insights (spec §8, IOT-36 §6.2), until the AI module replaces it.

Minute resolution (IOT-36 §2.2): a minute is occupied with a `present` observation, empty with only
`absent` ones, else unknown. KPIs follow exigences POC §6.1 (K-01 to K-07)."""
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import AbsenceEpisode, AppSettings, Observation, Reservation, Space
from app.models.enums import EpisodeKind, EpisodeOutcome, Presence, ReservationStatus
from app.services import booking
from app.services.notifications import hhmm, iso

MINUTE = timedelta(minutes=1)
RULES_VERSION = "1.0"


def _pct(part: int, whole: int) -> float | None:
    """One decimal, half up (56.25 -> 56.3); None when there is nothing to divide by."""
    if not whole:
        return None
    return float((Decimal(100 * part) / Decimal(whole)).quantize(Decimal("0.1"), ROUND_HALF_UP))


def _fr(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def _s(n: int) -> str:
    return "s" if n > 1 else ""


def compute(db: Session, space_id: UUID, frm: datetime, to: datetime, now: datetime) -> dict:
    """`kpis`, `summary` (mode "template_fallback"), `no_shows`, `recommendations` and `warnings`.
    The period is cut at the current minute: later minutes are not observed yet."""
    space = db.get(Space, space_id)
    if space is None:
        raise DomainError(404, "SPACE_NOT_FOUND")
    if any(t.second or t.microsecond for t in (frm, to)):
        raise DomainError(400, "INVALID_PERIOD")
    to = min(to, now.replace(second=0, microsecond=0))
    if frm >= to:
        raise DomainError(400, "INVALID_PERIOD")

    total = (to - frm) // MINUTE

    def span(a: datetime, b: datetime) -> set[int]:
        """Indexes of the period's minutes that [a, b[ touches."""
        a, b = max(a, frm), min(b, to)
        return set(range((a - frm) // MINUTE, math.ceil((b - frm) / MINUTE))) if a < b else set()

    def union(intervals) -> set[int]:
        return set().union(*(span(a, b) for a, b in intervals))

    observations = db.scalars(select(Observation).where(
        Observation.space_id == space.id, Observation.observed_at >= frm, Observation.observed_at < to,
    )).all()
    seen = defaultdict(set)
    for o in observations:
        seen[(o.observed_at - frm) // MINUTE].add(o.presence)
    occupied = {i for i, values in seen.items() if Presence.PRESENT in values}
    observed = occupied | {i for i, values in seen.items() if values == {Presence.ABSENT}}

    reservations = db.scalars(select(Reservation).where(
        Reservation.space_id == space.id, Reservation.status != ReservationStatus.CANCELLED,
        Reservation.start_at < to, Reservation.end_at > frm,
    ).order_by(Reservation.start_at)).all()
    episodes = defaultdict(list)
    for e in db.scalars(select(AbsenceEpisode).where(AbsenceEpisode.reservation_id.in_([r.id for r in reservations]))):
        episodes[e.reservation_id].append(e)
    booked = union((r.start_at, r.end_at) for r in reservations)  # R0: initial, kept after a release
    effective = union((r.start_at, booking.effective_end(r)) for r in reservations)
    released = union((r.released_at, r.end_at) for r in reservations if r.released_at)  # L

    sources = {o.source.value for o in observations}
    source_mode = (sources.pop() if len(sources) == 1 else "mixed") if sources else None
    delay = timedelta(minutes=db.get(AppSettings, 1).absence_delay_min)
    no_shows = []
    for r in reservations:
        if not frm <= r.start_at < to:
            continue
        window_end = min(r.start_at + delay, r.end_at)
        window = span(r.start_at, window_end)
        if any(e.kind == EpisodeKind.NO_SHOW and e.outcome == EpisodeOutcome.RELEASED for e in episodes[r.id]):
            status, reason = "no_show_detected", "EMPTY_WINDOW"
        elif window & occupied:
            status, reason = "presence_detected", "PRESENCE_IN_WINDOW"
        elif now < window_end:
            status, reason = "pending", "WINDOW_IN_PROGRESS"
        else:
            status, reason = "undetermined", "MISSING_OBSERVATIONS"
        no_shows.append({
            "reservation_id": str(r.id), "room_id": str(space.id), "status": status, "reason_code": reason,
            "window_start": iso(r.start_at), "window_end": iso(window_end), "evaluated_at": iso(now),
            "observed_minutes": len(window & observed), "unknown_minutes": len(window - observed),
            "source_mode": source_mode, "rules_version": RULES_VERSION,
        })

    evaluated = sum(n["status"] in ("no_show_detected", "presence_detected") for n in no_shows)
    no_show_count = sum(n["status"] == "no_show_detected" for n in no_shows)
    succeeded = sum(r.status == ReservationStatus.RELEASED for r in reservations)
    failed = sum(
        r.status != ReservationStatus.RELEASED and any(e.outcome == EpisodeOutcome.RELEASE_BLOCKED for e in episodes[r.id])
        for r in reservations
    )
    occupied_reserved = len(occupied & effective)
    kpis = {
        "scheduled_minutes": total, "observed_minutes": len(observed), "occupied_minutes": len(occupied),
        "empty_minutes": len(observed) - len(occupied), "unknown_minutes": total - len(observed),
        "occupancy_pct": _pct(len(occupied), len(observed)), "coverage_pct": _pct(len(observed), total),
        "reserved_minutes": len(booked), "reserved_pct": _pct(len(booked), total),
        "reserved_occupied_minutes": occupied_reserved, "unreserved_occupied_minutes": len(occupied) - occupied_reserved,
        "no_show_count": no_show_count, "evaluated_count": evaluated, "not_evaluated_count": len(no_shows) - evaluated,
        "no_show_pct": _pct(no_show_count, evaluated),
        "released_minutes": len(released), "releases_succeeded": succeeded, "releases_failed": failed,
    }
    revision = hashlib.sha256(json.dumps([kpis, [(n["reservation_id"], n["status"]) for n in no_shows]]).encode()).hexdigest()[:12]
    facts = _summary(space.name, frm, to, kpis)
    return {
        "schema_version": "1.0", "room_id": str(space.id), "period": {"from": iso(frm), "to": iso(to)},
        "generated_at": iso(now), "as_of": iso(now), "data_revision": revision, "rules_version": RULES_VERSION,
        "source_mode": source_mode,
        "status": "no_data" if not observed else "ok" if len(observed) == total else "partial",
        "kpis": kpis,
        "summary": {
            "status": "ready", "mode": "template_fallback", "text": " ".join(text for _, text in facts),
            "fact_ids": [fact for fact, _ in facts], "facts_revision": revision, "model_version": None, "warnings": [],
        },
        "no_shows": no_shows,
        "warnings": ["MISSING_SENSOR_DATA"] if len(observed) < total else [],
        "recommendations": [],
    }


def _summary(name: str, frm: datetime, to: datetime, k: dict) -> list[tuple[str, str]]:
    """Template of exigences POC §6.2, one (fact id, sentence) per fact."""
    o, v, u = k["occupied_minutes"], k["observed_minutes"], k["unknown_minutes"]
    where = f"Pour {name}, de {hhmm(frm)} à {hhmm(to)}, "
    if v:
        occupancy = (
            f"{where}l'occupation observée est de {o} minute{_s(o)} sur {v} ({_fr(k['occupancy_pct'])} %), "
            f"dont {k['reserved_occupied_minutes']} minute{_s(k['reserved_occupied_minutes'])} pendant une réservation "
            f"et {k['unreserved_occupied_minutes']} minute{_s(k['unreserved_occupied_minutes'])} sans réservation."
        )
    else:
        occupancy = f"{where}l'occupation ne peut pas être évaluée faute d'observations."
    facts = [("OCCUPANCY", occupancy)]
    n, ev = k["no_show_count"], k["evaluated_count"]
    facts.append(("NO_SHOW", f"{n} no-show{_s(n)} sur {ev} réservation{_s(ev)} évaluée{_s(ev)}." if ev
                  else "Aucune réservation n'a pu être évaluée pour les no-shows."))
    freed, ok, failed = k["released_minutes"], k["releases_succeeded"], k["releases_failed"]
    if ok or failed:
        facts.append(("RELEASE", f"{freed} minute{_s(freed)} libérée{_s(freed)} "
                                 f"({ok} libération{_s(ok)} réussie{_s(ok)}, {failed} échouée{_s(failed)})."))
    facts.append(("COVERAGE", "Les observations couvrent toute la période." if not u
                  else f"Les observations couvrent {_fr(k['coverage_pct'])} % de la période "
                       f"({u} minute{_s(u)} inconnue{_s(u)})."))
    return facts
