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


def _rate(part: int, whole: int) -> float | None:
    """0-100, not rounded (the client rounds for display); None when there is nothing to divide by."""
    return 100 * part / whole if whole else None


def _pct(part: int, whole: int) -> str:
    """French text, one decimal, half up from the exact ratio (56.25 -> "56,3")."""
    value = (Decimal(100 * part) / Decimal(whole)).quantize(Decimal("0.1"), ROUND_HALF_UP)
    return f"{value:f}".removesuffix(".0").replace(".", ",")


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

    # K-05 population: reservations starting in the period. A no-show is a no_show episode that released;
    # a presence in the first D minutes is evaluated too; anything else is not evaluated.
    delay = timedelta(minutes=db.get(AppSettings, 1).absence_delay_min)
    population = [r for r in reservations if frm <= r.start_at < to]
    no_show_list = [r for r in population if any(
        e.kind == EpisodeKind.NO_SHOW and e.outcome == EpisodeOutcome.RELEASED for e in episodes[r.id])]
    evaluated = len(no_show_list) + sum(
        r not in no_show_list and bool(span(r.start_at, min(r.start_at + delay, r.end_at)) & occupied)
        for r in population
    )
    no_shows = [{"reservation_id": str(r.id), "start_at": iso(r.start_at), "end_at": iso(r.end_at),
                 "released_at": iso(r.released_at)} for r in no_show_list]
    succeeded = sum(r.status == ReservationStatus.RELEASED for r in reservations)
    failed = sum(
        r.status != ReservationStatus.RELEASED and any(e.outcome == EpisodeOutcome.RELEASE_BLOCKED for e in episodes[r.id])
        for r in reservations
    )
    occupied_reserved = len(occupied & effective)
    kpis = {
        "period_min": total, "observed_min": len(observed), "unknown_min": total - len(observed),
        "occupied_min": len(occupied), "occupied_reserved_min": occupied_reserved,
        "occupied_unreserved_min": len(occupied) - occupied_reserved, "occupancy_pct": _rate(len(occupied), len(observed)),
        "reserved_initial_min": len(booked), "reserved_initial_pct": _rate(len(booked), total),
        "no_show_count": len(no_shows), "evaluated_count": evaluated, "not_evaluated_count": len(population) - evaluated,
        "no_show_pct": _rate(len(no_shows), evaluated),
        "released_min": len(released), "releases_succeeded": succeeded, "releases_failed": failed,
        "coverage_pct": _rate(len(observed), total),
    }
    sources = {o.source.value for o in observations}
    revision = hashlib.sha256(json.dumps([kpis, no_shows]).encode()).hexdigest()[:12]
    facts = _summary(space.name, frm, to, kpis)
    return {
        "schema_version": "1.0", "room_id": str(space.id), "period": {"from": iso(frm), "to": iso(to)},
        "generated_at": iso(now), "as_of": iso(now), "data_revision": revision, "rules_version": RULES_VERSION,
        "source_mode": (sources.pop() if len(sources) == 1 else "mixed") if sources else None,
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
    o, v, u, total = k["occupied_min"], k["observed_min"], k["unknown_min"], k["period_min"]
    reserved, unreserved = k["occupied_reserved_min"], k["occupied_unreserved_min"]
    where = f"Pour {name}, de {hhmm(frm)} à {hhmm(to)}, "
    if v:
        occupancy = (
            f"{where}l'occupation observée est de {o} minute{_s(o)} sur {v} ({_pct(o, v)} %), "
            f"dont {reserved} minute{_s(reserved)} pendant une réservation et {unreserved} minute{_s(unreserved)} sans réservation."
        )
    else:
        occupancy = f"{where}l'occupation ne peut pas être évaluée faute d'observations."
    facts = [("OCCUPANCY", occupancy)]
    n, ev = k["no_show_count"], k["evaluated_count"]
    facts.append(("NO_SHOW", f"{n} no-show{_s(n)} sur {ev} réservation{_s(ev)} évaluée{_s(ev)}." if ev
                  else "Aucune réservation n'a pu être évaluée pour les no-shows."))
    freed, ok, failed = k["released_min"], k["releases_succeeded"], k["releases_failed"]
    if ok or failed:
        facts.append(("RELEASE", f"{freed} minute{_s(freed)} libérée{_s(freed)} "
                                 f"({ok} libération{_s(ok)} réussie{_s(ok)}, {failed} échouée{_s(failed)})."))
    facts.append(("COVERAGE", "Les observations couvrent toute la période." if not u
                  else f"Les observations couvrent {_pct(v, total)} % de la période ({u} minute{_s(u)} inconnue{_s(u)})."))
    return facts
