"""Dashboard insights and period summary (IOT-36, IOT-40).

Minute resolution (IOT-36 §2.2): a minute is occupied with a `present` observation, empty with only
`absent` ones, else unknown. KPIs follow exigences POC §6.1 (K-01 to K-07)."""
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import DomainError
from app.models import AbsenceEpisode, Observation, Reservation, Space
from app.models.enums import EpisodeKind, EpisodeOutcome, Presence, ReservationStatus
from app.services import booking, gemini, settings
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


def compute(db: Session, space_id: UUID, frm: datetime, to: datetime, now: datetime, *, assist_summary: bool = False,
            report_schedule: tuple[int, int, bool] | None = None) -> dict:
    """`kpis`, `summary`, `hourly`, `no_shows`, `recommendations` and `warnings`.
    The period is cut at the current minute: later minutes are not observed yet, and a period
    with no elapsed minute is `no_data`."""
    space = db.get(Space, space_id)
    if space is None:
        raise DomainError(404, "SPACE_NOT_FOUND")
    if any(t.second or t.microsecond for t in (frm, to)) or frm >= to:
        raise DomainError(400, "INVALID_PERIOD")
    to = max(frm, min(to, now.replace(second=0, microsecond=0)))

    total = (to - frm) // MINUTE

    def span(a: datetime, b: datetime) -> set[int]:
        """Indexes of the period's minutes that [a, b[ touches."""
        a, b = max(a, frm), min(b, to)
        return set(range((a - frm) // MINUTE, math.ceil((b - frm) / MINUTE))) if a < b else set()

    def union(intervals) -> set[int]:
        return set().union(*(span(a, b) for a, b in intervals))

    # One pass over four columns: heartbeats arrive every 10 s, ORM entities for a month exceed 256 Mi.
    # ponytail: minute sets stay in Python; aggregate per minute in SQL if periods or rooms grow.
    seen, sources, unsynced = defaultdict(set), set(), set()
    for observed_at, presence, source, clock_synced in db.execute(select(
        Observation.observed_at, Observation.presence, Observation.source, Observation.clock_synced,
    ).where(Observation.space_id == space.id, Observation.observed_at >= frm, Observation.observed_at < to)):
        minute = (observed_at - frm) // MINUTE
        seen[minute].add(presence)
        sources.add(source.value)
        if not clock_synced:
            unsynced.add(minute)
    occupied = {i for i, values in seen.items() if Presence.PRESENT in values}
    observed = occupied | {i for i, values in seen.items() if values == {Presence.ABSENT}}

    reservations = db.scalars(select(Reservation).where(
        Reservation.space_id == space.id, Reservation.status != ReservationStatus.CANCELLED,
        Reservation.start_at < to, Reservation.end_at > frm,
    ).order_by(Reservation.start_at)).all() if total else []
    episodes = defaultdict(list)
    for e in db.scalars(select(AbsenceEpisode).where(AbsenceEpisode.reservation_id.in_([r.id for r in reservations]))):
        episodes[e.reservation_id].append(e)
    booked = union((r.start_at, r.end_at) for r in reservations)  # R0: initial, kept after a release
    effective = union((r.start_at, booking.effective_end(r)) for r in reservations)
    released = union((r.released_at, r.end_at) for r in reservations if r.released_at)  # L

    # K-05 population: reservations starting in the period. A no-show is a no_show episode that released;
    # a presence in the first D minutes is evaluated too; anything else is not evaluated.
    delay = timedelta(minutes=settings.get(db, space.organization).absence_delay_min)
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
    # One item per clock hour the period touches (UTC and Paris hours share their boundaries). The sums
    # are reserved_initial_min and occupied_reserved_min.
    lead = frm.minute
    reserved_by_hour = Counter((i + lead) // 60 for i in booked)
    used_by_hour = Counter((i + lead) // 60 for i in occupied & effective)
    hourly = [
        {"start_at": iso(frm + timedelta(minutes=60 * h - lead)), "reserved_min": reserved_by_hour[h], "used_min": used_by_hour[h]}
        for h in range(math.ceil((lead + total) / 60) if total else 0)
    ]
    revision = hashlib.sha256(json.dumps([kpis, no_shows]).encode()).hexdigest()[:12]
    summary, recommendations = _period_summary(space.name, frm, to, kpis, revision, assist_summary)
    result = {
        "schema_version": "1.0", "room_id": str(space.id), "period": {"from": iso(frm), "to": iso(to)},
        "generated_at": iso(now), "as_of": iso(now), "data_revision": revision, "rules_version": RULES_VERSION,
        "source_mode": (sources.pop() if len(sources) == 1 else "mixed") if sources else None,
        "status": "no_data" if not observed else "ok" if len(observed) == total else "partial",
        "kpis": kpis,
        "summary": summary,
        "hourly": hourly,
        "no_shows": no_shows,
        "warnings": ["MISSING_SENSOR_DATA"] if len(observed) < total else [],
        "recommendations": recommendations,
    }
    if report_schedule is not None:
        result["report"] = _report_metrics(frm, total, occupied, observed, booked, effective, released,
                                            reservations, episodes, unsynced, span, report_schedule)
    return result


def _report_metrics(frm, total, occupied, observed, booked, effective, released,
                    reservations, episodes, unsynced, span, schedule):
    """Reuse the minute classification for business-hour reporting and observable arrival delays."""
    start_hour, end_hour, weekdays_only = schedule
    days = defaultdict(set)
    paris = ZoneInfo("Europe/Paris")
    for minute in range(total):
        local = (frm + minute * MINUTE).astimezone(paris)
        if start_hour <= local.hour < end_hour and (not weekdays_only or local.weekday() < 5):
            days[local.date().isoformat()].add(minute)
    scheduled = set().union(*days.values())
    empty = observed - occupied
    daily = []
    for day, indexes in days.items():
        daily.append({
            "date": day, "period_min": len(indexes), "observed_min": len(indexes & observed),
            "occupied_min": len(indexes & occupied), "unreserved_min": len(indexes & (occupied - effective)),
            "reserved_observed_min": len(indexes & effective & observed),
            "reserved_empty_min": len(indexes & effective & empty),
        })
    population = [r for r in reservations if (r.start_at - frm) // MINUTE in scheduled]
    delays = []
    for reservation in population:
        window = span(reservation.start_at, booking.effective_end(reservation))
        present = window & occupied
        if not present:
            continue
        first = min(present)
        beginning = (reservation.start_at - frm) // MINUTE
        before = set(range(beginning, first + 1))
        if before <= observed and not before & unsynced:
            delays.append(first - beginning)
    reserved_observed = len(scheduled & effective & observed)
    occupied_minutes = len(scheduled & occupied)
    unreserved_minutes = len(scheduled & (occupied - effective))
    empty_minutes = len(scheduled & effective & empty)
    return {
        "period_min": len(scheduled), "observed_min": len(scheduled & observed),
        "unknown_min": len(scheduled - observed), "occupied_min": occupied_minutes,
        "unreserved_min": unreserved_minutes, "reserved_initial_min": len(scheduled & booked),
        "reserved_observed_min": reserved_observed, "reserved_empty_min": empty_minutes,
        "reserved_unknown_min": len((scheduled & effective) - observed),
        "released_min": len(scheduled & released), "reused_released_min": len(scheduled & released & occupied),
        "reservation_count": len(population), "arrival_unevaluated_count": len(population) - len(delays),
        "no_show_released_count": sum(any(e.kind == EpisodeKind.NO_SHOW and e.outcome == EpisodeOutcome.RELEASED
                                           for e in episodes[r.id]) for r in population),
        "release_failed_count": sum(any(e.outcome == EpisodeOutcome.RELEASE_BLOCKED for e in episodes[r.id])
                                     for r in population),
        "unused_observed_days": sum(row["observed_min"] == row["period_min"] and row["occupied_min"] == 0 for row in daily),
        "arrival_delays_min": delays, "daily": daily,
    }


def _period_summary(name: str, frm: datetime, to: datetime, k: dict, revision: str, assist_summary: bool) -> tuple[dict, list[dict]]:
    facts = dict(_summary(name, frm, to, k))
    observed = k["observed_min"]
    configured = bool(get_settings().gemini_api_key.get_secret_value().strip())
    provider_status = "insufficient_data" if not observed else "not_requested" if configured else "not_configured"
    summary = {
        "status": "ready", "mode": "template_fallback", "text": " ".join(facts.values()),
        "fact_ids": list(facts), "facts_revision": revision, "model_version": None, "warnings": [],
        "provider_status": provider_status,
    }
    if not assist_summary or not observed or not configured:
        return summary, []

    occupied = k["occupied_min"]
    eligible = {
        "OCCUPANCY": f"L’occupation mesurée est de {occupied} minute{_s(occupied)} sur {observed} "
                     f"({_pct(occupied, observed)} %).",
        "COVERAGE": facts["COVERAGE"],
    }
    unreserved = k["occupied_unreserved_min"]
    if unreserved:
        eligible["UNRESERVED"] = f"L’espace a été occupé sans réservation pendant {unreserved} minute{_s(unreserved)}."
    if k["evaluated_count"]:
        eligible["NO_SHOW"] = facts["NO_SHOW"]

    recommendations = _applicable_recommendations(k)
    selection = gemini.select_facts(k, list(eligible), list(recommendations))
    if selection is None:
        summary["provider_status"] = "unavailable"
        return summary, []

    chosen, version = selection
    ids = chosen.fact_ids
    summary.update(mode="llm_assisted", provider_status="ready", text=" ".join(eligible[fact] for fact in ids),
                   fact_ids=ids, model_version=version)
    next_step = recommendations.get(chosen.recommendation_id)
    return summary, [next_step] if next_step else []


def _applicable_recommendations(k: dict) -> dict[str, dict]:
    recommendations = {}
    if k["unknown_min"]:
        recommendations["CHECK_COVERAGE"] = {
            "title": "Vérifier les mesures manquantes",
            "text": "Repérez les plages sans mesure et vérifiez l’état du boîtier avant de comparer le taux avec d’autres salles ou périodes.",
        }
    if k["occupied_unreserved_min"]:
        recommendations["REVIEW_UNRESERVED"] = {
            "title": "Examiner l’usage hors réservation",
            "text": "Dans l’historique de la salle, comparez les créneaux occupés au planning pour repérer les usages sans réservation.",
        }
    if k["no_show_count"]:
        recommendations["REVIEW_NO_SHOWS"] = {
            "title": "Examiner les réservations libérées pour absence",
            "text": "Relisez les créneaux signalés et vérifiez si les absences se concentrent sur certains horaires avant de modifier un réglage.",
        }
    return recommendations


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
    if total:  # no elapsed minute: nothing to cover
        facts.append(("COVERAGE", "Les observations couvrent toute la période." if not u
                      else f"Les observations couvrent {_pct(v, total)} % de la période ({u} minute{_s(u)} inconnue{_s(u)})."))
    return facts
