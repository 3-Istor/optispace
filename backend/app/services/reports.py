"""Facility-manager decision reports, derived from the existing insights calculation."""
import hashlib
import json
from collections import defaultdict
from datetime import timedelta, timezone
from statistics import mean, median
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.config import get_settings
from app.errors import DomainError
from app.models import Space
from app.models.enums import SpaceType
from app.services import gemini, insights
from app.services.notifications import iso

PARIS = ZoneInfo("Europe/Paris")
# Pilot thresholds, returned with every report so the decision criteria remain visible.
RULES = {"coverage_pct": 80, "observed_min": 300, "unreserved_pct": 10,
         "reserved_empty_pct": 20, "arrival_delay_min": 5, "arrival_sample_count": 5,
         "underuse_pct": 20, "underuse_days": 10}
COUNTERS = ("period_min", "observed_min", "unknown_min", "occupied_min", "unreserved_min",
            "reserved_initial_min", "reserved_observed_min", "reserved_empty_min",
            "reserved_unknown_min", "released_min", "reused_released_min", "no_show_released_count", "release_failed_count",
            "reservation_count", "arrival_unevaluated_count", "unused_observed_days")


def rates(values):
    for key, part, whole in (
        ("coverage_pct", "observed_min", "period_min"),
        ("occupancy_pct", "occupied_min", "observed_min"),
        ("unreserved_pct", "unreserved_min", "occupied_min"),
        ("reserved_empty_pct", "reserved_empty_min", "reserved_observed_min"),
    ):
        values[key] = insights._rate(values[part], values[whole])
    delays = values.get("arrival_delays_min", [])
    values["arrival_sample_count"] = len(delays)
    values["arrival_avg_min"] = mean(delays) if delays else None
    values["arrival_median_min"] = median(delays) if delays else None
    return values


def aggregate(metrics):
    values = {key: sum(row[key] for row in metrics) for key in COUNTERS}
    values["arrival_delays_min"] = [delay for row in metrics for delay in row["arrival_delays_min"]]
    return rates(values)


def reliable(metrics):
    return (metrics["coverage_pct"] or 0) >= RULES["coverage_pct"] and metrics["observed_min"] >= RULES["observed_min"]


def selection_payload(rooms, actions):
    """Send typed aggregates, never user-controlled labels or raw events."""
    metrics = (*COUNTERS, "coverage_pct", "occupancy_pct", "unreserved_pct", "reserved_empty_pct",
               "arrival_avg_min", "arrival_median_min", "arrival_sample_count")
    return {"rooms": [{"id": room["id"], "kpis": {key: room["current"][key] for key in metrics},
                       "reliable": room["reliable"]} for room in rooms],
            "actions": [{key: action[key] for key in ("id", "room_id", "kind")} for action in actions]}


def compute(db, organization, frm, to, now, start_hour=9, end_hour=18, weekdays_only=True, space_ids=None):
    frm, to = frm.astimezone(timezone.utc), to.astimezone(timezone.utc)
    if frm >= to or any(value.second or value.microsecond for value in (frm, to)):
        raise DomainError(400, "INVALID_PERIOD")
    days = (to.astimezone(PARIS).date() - frm.astimezone(PARIS).date()).days
    if not 1 <= days <= 93 or not 0 <= start_hour < end_hour <= 24:
        raise DomainError(400, "INVALID_REPORT_PERIOD")
    to = min(to, now.replace(second=0, microsecond=0))
    if to <= frm:
        raise DomainError(400, "INVALID_PERIOD")
    # Calendar-day shift preserves the same Paris working hours across DST transitions.
    previous_to = (to.astimezone(PARIS) - timedelta(days=days)).astimezone(timezone.utc)
    previous_from = (frm.astimezone(PARIS) - timedelta(days=days)).astimezone(frm.tzinfo)
    spaces = list(db.scalars(select(Space).where(
        Space.organization == organization, Space.is_active.is_(True), Space.type == SpaceType.MEETING_ROOM,
    ).order_by(Space.name)))
    if space_ids:
        wanted = set(space_ids)
        spaces = [space for space in spaces if space.id in wanted]
        if {space.id for space in spaces} != wanted:
            raise DomainError(404, "SPACE_NOT_FOUND")
    rooms, sources = [], set()
    for space in spaces:
        current = insights.compute(db, space.id, frm, to, now, report_schedule=(start_hour, end_hour, weekdays_only))
        previous = insights.compute(db, space.id, previous_from, previous_to, now,
                                    report_schedule=(start_hour, end_hour, weekdays_only))
        for result in (current, previous):
            if result["source_mode"]:
                sources.add(result["source_mode"])
        metrics, before = rates(current["report"]), rates(previous["report"])
        rooms.append({"id": str(space.id), "name": space.name, "capacity": space.capacity,
                      "floor": space.floor, "equipment": space.equipment,
                      "current": metrics, "previous": before, "reliable": reliable(metrics)})
    totals = aggregate([room["current"] for room in rooms])
    previous_totals = aggregate([room["previous"] for room in rooms])
    by_day = defaultdict(list)
    for room in rooms:
        for day in room["current"]["daily"]:
            by_day[day["date"]].append(day)
    trend = []
    for day, rows in sorted(by_day.items()):
        values = {key: sum(row[key] for row in rows) for key in rows[0] if key != "date"}
        trend.append({"date": day, **rates(values)})
    candidates = _actions(rooms)
    baseline = candidates[:3]
    mode, provider_status, model_version = "template_fallback", "insufficient_data", None
    selected = baseline
    if totals["observed_min"] and candidates:
        provider_status = "not_configured"
        if get_settings().gemini_api_key.get_secret_value().strip():
            provider_status = "unavailable"
            choice = gemini.select_report_actions(
                selection_payload(rooms, candidates),
                [action["id"] for action in candidates],
            )
            if choice:
                ids, model_version = choice
                by_id = {action["id"]: action for action in candidates}
                selected = [by_id[action_id] for action_id in ids]
                mode, provider_status = "llm_assisted", "ready"
    elif totals["observed_min"]:
        provider_status = "no_action"
    comparable = [room for room in rooms if room["reliable"] and reliable(room["previous"])]
    comparison = {"room_count": len(comparable),
                  "current": aggregate([room["current"] for room in comparable]),
                  "previous": aggregate([room["previous"] for room in comparable])}
    report = {
        "period": {"from": iso(frm), "to": iso(to)},
        "previous_period": {"from": iso(previous_from), "to": iso(previous_to)},
        "generated_at": iso(now), "rules_version": "fm-report-pilot-2",
        "schedule": {"start_hour": start_hour, "end_hour": end_hour, "weekdays_only": weekdays_only,
                     "timezone": "Europe/Paris"}, "rules": RULES,
        "source_mode": next(iter(sources)) if len(sources) == 1 else "mixed" if sources else None,
        "rooms": rooms, "totals": totals, "previous_totals": previous_totals,
        "comparison": comparison, "trend": trend, "recommendations": selected, "eligible_actions": candidates,
        "baseline_recommendations": baseline,
        "measurement_warnings": [action for action in candidates if action["kind"] == "COVERAGE"],
        "summary": {"mode": mode, "provider_status": provider_status, "model_version": model_version,
                    "prompt_version": gemini.REPORT_PROMPT_VERSION,
                    "selection_changed": [a["id"] for a in selected] != [a["id"] for a in baseline]},
        "limitations": [
            "La présence est binaire et ne mesure pas le nombre de participants.",
            "Le délai décrit la première présence détectée. Le capteur ne reconnaît pas le réservant.",
            "L’inventaire des équipements décrit l’offre. Les demandes non satisfaites et les coûts restent à renseigner.",
            "Les variations décrivent les périodes observées. L’effet causal d’une action demande une évaluation dédiée.",
        ],
    }
    # Stable facts identity, independent of generation time and model choice.
    facts = {key: report[key] for key in ("period", "previous_period", "schedule", "rules_version",
                                         "rules", "rooms", "source_mode")}
    report["facts_revision"] = hashlib.sha256(json.dumps(facts, sort_keys=True).encode()).hexdigest()[:12]
    report["data_revision"] = hashlib.sha256(json.dumps(report, sort_keys=True).encode()).hexdigest()[:12]
    return report


def _actions(rooms):
    actions = []

    def add(room, kind, title, evidence, action, follow_up, priority):
        volume_key = {"COVERAGE": "unknown_min", "UNRESERVED": "unreserved_min", "RESERVED_EMPTY": "reserved_empty_min"}.get(kind)
        actions.append({"id": f"{room['id']}:{kind}", "room_id": room["id"], "room_name": room["name"],
                        "kind": kind, "title": title, "evidence": evidence, "action": action,
                        "follow_up": follow_up, "priority": priority,
                        "observed_volume_min": room["current"][volume_key] if volume_key else None})

    for room in rooms:
        k = room["current"]
        if not room["reliable"]:
            add(room, "COVERAGE", "Rétablir une mesure exploitable",
                f"{k['observed_min']} minutes observées sur {k['period_min']} minutes du périmètre.",
                "Vérifier le boîtier et les plages sans mesure avant une décision d’aménagement.",
                "Recalculer la couverture sur les mêmes horaires après vérification.", 0)
            continue
        if (k["unreserved_pct"] or 0) >= RULES["unreserved_pct"] and k["unreserved_min"] >= 30:
            add(room, "UNRESERVED", "Réduire l’usage hors réservation",
                f"{k['unreserved_min']} minutes occupées sans réservation effective, soit {k['unreserved_pct']:.1f} % du temps occupé.",
                "Vérifier les créneaux concernés et tester un rappel du parcours de réservation à l’entrée de la salle.",
                "Comparer la part hors réservation et sa durée à la période suivante, sur les mêmes salles et horaires.", 1)
        if (k["reserved_empty_pct"] or 0) >= RULES["reserved_empty_pct"] and k["reserved_observed_min"] >= 120:
            add(room, "RESERVED_EMPTY", "Examiner les créneaux réservés mais vides",
                f"{k['reserved_empty_min']} minutes vides sur {k['reserved_observed_min']} minutes réservées observables ({k['reserved_empty_pct']:.1f} %).",
                "Relire les créneaux et les épisodes d’absence. Tester un rappel ciblé avant d’ajuster la règle de libération.",
                "Suivre la part réservée vide, les libérations échouées et le temps réoccupé après libération.", 2)
        if k["arrival_sample_count"] >= RULES["arrival_sample_count"] and k["arrival_avg_min"] >= RULES["arrival_delay_min"]:
            add(room, "ARRIVAL", "Examiner le délai avant première présence",
                f"Moyenne {k['arrival_avg_min']:.1f} min, médiane {k['arrival_median_min']:.1f} min sur {k['arrival_sample_count']} réservations évaluables.",
                "Vérifier les créneaux et la visibilité du début de réservation avant de modifier le délai de grâce.",
                "Comparer moyenne, médiane et nombre de réservations évaluables sur une période comparable.", 3)
        if (k["occupancy_pct"] or 0) < RULES["underuse_pct"] and len(k["daily"]) >= RULES["underuse_days"]:
            add(room, "UNDERUSE", "Tester une meilleure utilisation de la salle",
                f"{k['occupied_min']} minutes occupées sur {k['observed_min']} observables ({k['occupancy_pct']:.1f} %). "
                f"{k['unused_observed_days']} jour(s) entièrement observé(s) sans présence.",
                "Vérifier l’accès et la visibilité dans la recherche. Examiner les équipements avant de tester un nouvel usage.",
                "Mesurer l’évolution de l’occupation sur les mêmes jours et horaires après le test.", 4)
            peers = [peer for peer in rooms if peer["reliable"] and peer["capacity"] == room["capacity"]
                     and (peer["current"]["occupancy_pct"] or 0) >= 70]
            missing = sorted({item for peer in peers for item in peer["equipment"]} - set(room["equipment"]))
            if missing:
                add(room, "EQUIPMENT", "Vérifier une piste d’équipement",
                    f"Équipements présents dans des salles de même capacité occupées à au moins 70 % et absents de cette salle : {', '.join(missing)}.",
                    "Recueillir les besoins et les demandes non satisfaites pour ces équipements avant de chiffrer un essai.",
                    "Suivre les demandes satisfaites et l’occupation après un éventuel essai.", 4)
    # Measurement first, then booking discrepancies by observed duration.
    # A duration describes a problem, never promised savings or causal impact.
    return sorted(actions, key=lambda action: (
        1 if action["kind"] in ("UNRESERVED", "RESERVED_EMPTY") else action["priority"],
        -(action["observed_volume_min"] or 0), action["room_name"], action["kind"]))
