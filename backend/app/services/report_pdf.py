"""Render the exact decision-report snapshot shown by the frontend."""
from datetime import datetime
from io import BytesIO
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from reportlab.graphics.shapes import Drawing, Line, String, Circle
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

BLUE = colors.HexColor("#1E56D6")
INK = colors.HexColor("#0E1726")
MUTED = colors.HexColor("#5B6676")
LIGHT = colors.HexColor("#EEF3FB")
PARIS = ZoneInfo("Europe/Paris")


def number(value, suffix=""):
    return "Indisponible" if value is None else f"{value:.1f}".replace(".", ",") + suffix


def duration(minutes):
    hours, remaining = divmod(minutes, 60)
    return f"{hours} h {remaining:02d}" if hours else f"{remaining} min"


def local(value):
    return datetime.fromisoformat(value).astimezone(PARIS).strftime("%d/%m/%Y %Hh%M")


def chart(trend, field, label, color, coverage_min):
    drawing = Drawing(480, 140)
    drawing.add(String(42, 123, label, fontName="Helvetica-Bold", fontSize=10, fillColor=INK))
    for tick in (0, 50, 100):
        y = 25 + tick * .8
        drawing.add(Line(42, y, 470, y, strokeColor=colors.HexColor("#E4E8EE"), strokeWidth=.5))
        drawing.add(String(8, y - 3, f"{tick} %", fontSize=8, fillColor=MUTED))
    previous = None
    first = datetime.fromisoformat(trend[0]["date"]) if trend else None
    span_days = max(1, (datetime.fromisoformat(trend[-1]["date"]) - first).days) if trend else 1
    for point in trend:
        x = 42 + 428 * (datetime.fromisoformat(point["date"]) - first).days / span_days
        value = point[field] if (point["coverage_pct"] or 0) >= coverage_min else None
        if value is None:
            previous = None
            continue
        y = 25 + value * .8
        if previous:
            drawing.add(Line(*previous, x, y, strokeColor=color, strokeWidth=1.8))
        drawing.add(Circle(x, y, 2.2, fillColor=color, strokeColor=color))
        previous = (x, y)
    for index in sorted({0, len(trend) // 2, len(trend) - 1}):
        if index < 0 or not trend:
            continue
        x = 42 + 428 * (datetime.fromisoformat(trend[index]["date"]) - first).days / span_days
        label_date = datetime.fromisoformat(trend[index]["date"]).strftime("%d/%m")
        drawing.add(String(x, 9, label_date, textAnchor="middle", fontSize=8, fillColor=MUTED))
    return drawing


def render(report):
    output = BytesIO()
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReportTitle", fontName="Helvetica-Bold", fontSize=24, leading=29, textColor=INK, spaceAfter=14))
    styles.add(ParagraphStyle(name="ReportBody", fontName="Helvetica", fontSize=10, leading=15, textColor=INK, spaceAfter=8))
    styles.add(ParagraphStyle(name="ReportSmall", fontName="Helvetica", fontSize=8, leading=11, textColor=MUTED, spaceAfter=5))
    styles["Heading2"].textColor = BLUE
    styles["Heading2"].spaceBefore = 14
    styles["Heading2"].spaceAfter = 8

    def p(value, style="ReportBody"):
        # Helvetica lacks these common model-generated hyphens and narrow spaces.
        text = str(value).translate({0x2010: "-", 0x2011: "-", 0x202F: " "})
        return Paragraph(escape(text), styles[style])

    def table(rows, widths):
        result = Table([[p(cell, "ReportSmall") for cell in row] for row in rows], colWidths=widths,
                       repeatRows=1, hAlign="LEFT")
        result.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("LINEBELOW", (0, 0), (-1, -1), .4, colors.HexColor("#E4E8EE")),
        ]))
        return result

    source = {"simulated": "DONNÉES SIMULÉES", "real": "Données réelles", "mixed": "DONNÉES MIXTES"}.get(report["source_mode"], "Données de présence indisponibles")
    schedule, totals = report["schedule"], report["totals"]
    provider_name = "Groq" if report["summary"].get("provider") == "groq" else "Gemini"
    mode = f"Priorisation assistée par {provider_name}" if report["summary"]["mode"] == "llm_assisted" else "Priorisation par les règles OptiSpace"
    analysis = report.get("analysis") if report["summary"]["provider_status"] == "ready" else None
    authored = {item["action_id"]: item for item in analysis["recommendations"]} if analysis else {}
    if analysis:
        mode = f"Analyse rédigée par l’IA via {provider_name}"
    flow = [p("OptiSpace / Facility Manager", "ReportSmall"), p("Décisions pour les salles", "ReportTitle"),
            p(source), p(f"Du {local(report['period']['from'])} au {local(report['period']['to'])}. Fin de période exclusive."),
            p(f"{schedule['start_hour']} h - {schedule['end_hour']} h, "
              f"{'du lundi au vendredi' if schedule['weekdays_only'] else 'tous les jours'}, Europe/Paris. "
              f"{len(report['rooms'])} salle(s) active(s). {mode}.", "ReportSmall"),
            p("Indicateurs de la période", "Heading2"),
            table([
                ["Occupation mesurée", "Usage hors réservation", "Réservé et observé vide"],
                [number(totals["occupancy_pct"], " %"), number(totals["unreserved_pct"], " %"), number(totals["reserved_empty_pct"], " %")],
                [f"{duration(totals['occupied_min'])} / {duration(totals['observed_min'])} observables",
                 f"{duration(totals['unreserved_min'])} / {duration(totals['occupied_min'])} occupées",
                 f"{duration(totals['reserved_empty_min'])} / {duration(totals['reserved_observed_min'])} réservées observables"],
            ], [160, 160, 160]),
            p(f"Couverture {number(totals['coverage_pct'], ' %')}. "
              f"{duration(totals['unknown_min'])} sans mesure. "
              f"Première présence après {number(totals['arrival_avg_min'], ' min')} en moyenne "
              f"sur {totals['arrival_sample_count']} réservations évaluables.", "ReportSmall")]
    if analysis:
        flow.extend([p(f"Ce qu’il faut retenir - {provider_name}", "Heading2"), p(analysis["overview"]),
                     p(f"Point de vigilance. {analysis['caution']}", "ReportSmall")])
        for action in report["recommendations"]:
            if action["id"] in analysis["evidence_action_ids"]:
                flow.append(p(f"Constat source - {action['room_name']}. {action['evidence']}", "ReportSmall"))
        flow.append(p("Les interprétations et étapes proposées sont rédigées par l’IA et à examiner par le Facility Manager. "
                      "Les chiffres et indicateurs de suivi sont calculés par OptiSpace.", "ReportSmall"))
    elif report["summary"]["provider_status"] in ("unavailable", "not_configured"):
        flow.append(p(f"Aucune analyse {provider_name} obtenue. Les pistes ci-dessous proviennent des règles OptiSpace.", "ReportSmall"))
    flow.extend([PageBreak(), p("Décisions suggérées", "ReportTitle")])
    for warning in report.get("measurement_warnings", []):
        flow.append(p(f"Mesures à vérifier : {warning['room_name']}. {warning['evidence']} {warning['action']}"))
    flow.append(p("Les vérifications proposées restent à l’initiative du facility manager.", "ReportSmall"))
    for index, action in enumerate(report["recommendations"], 1):
        content = [
            p(f"{index}. {action['room_name']} - {action['title']}", "Heading3"),
            p(f"Constat mesuré. {action['evidence']}")]
        advice = authored.get(action["id"])
        if advice:
            content.append(p(f"Pourquoi cette priorité - {provider_name}. {advice['rationale']}"))
            content.append(p(f"Étapes proposées par l’IA via {provider_name}", "ReportSmall"))
            content.extend(p(f"{step_index}. {step}") for step_index, step in enumerate(advice["steps"], 1))
            content.append(p(f"À vérifier ensuite - {provider_name}. {advice['check']}", "ReportSmall"))
        else:
            content.append(p(action["action"]))
        content.append(p(f"Indicateur de suivi - OptiSpace. {action['follow_up']}", "ReportSmall"))
        flow.append(KeepTogether(content))
    if not report["recommendations"]:
        flow.append(p("Les données disponibles ne déclenchent aucune action selon les critères pilotes."))
    flow.append(p("Comprendre la sélection des priorités", "Heading2"))
    if report["summary"]["mode"] == "llm_assisted":
        flow.append(p("L’IA a modifié la sélection ou son ordre. Cela ne prouve pas une meilleure décision." if report["summary"].get("selection_changed")
                      else "L’IA a retenu les mêmes priorités dans le même ordre que les règles."))
    else:
        flow.append(p("Priorités calculées par les règles, sans assistance de l’IA."))
    for index, action in enumerate(report.get("baseline_recommendations", []), 1):
        flow.append(p(f"Règles {index}. {action['room_name']} - {action['title']}", "ReportSmall"))
    flow.extend([PageBreak(), p("Évolution dans le temps", "ReportTitle"),
                 p("Chaque point regroupe les durées d’une journée dans le périmètre horaire choisi. "
                   "Les interruptions signalent une mesure insuffisante ou un dénominateur vide.", "ReportSmall")])
    for field, label, color in (
        ("occupancy_pct", "Occupation / temps observable", BLUE),
        ("unreserved_pct", "Hors réservation / temps occupé", colors.HexColor("#D9771F")),
        ("reserved_empty_pct", "Réservé vide / temps réservé observable", colors.HexColor("#8056A5")),
    ):
        flow.extend([chart(report["trend"], field, label, color, report["rules"]["coverage_pct"]), Spacer(1, 6)])
    comparison = report["comparison"]
    flow.append(p(f"Comparaison à la période du {local(report['previous_period']['from'])} au "
                  f"{local(report['previous_period']['to'])}. {comparison['room_count']} salle(s) "
                  "avec une mesure exploitable sur les deux périodes.", "ReportSmall"))
    for field, label in (("occupancy_pct", "Occupation"), ("unreserved_pct", "Hors réservation"), ("reserved_empty_pct", "Réservé vide")):
        current, previous = comparison["current"][field], comparison["previous"][field]
        if current is not None and previous is not None:
            flow.append(p(f"{label} de {number(previous, ' %')} à {number(current, ' %')}, "
                          f"écart {number(current - previous, ' points')}.", "ReportSmall"))
    flow.extend([PageBreak(), p("Comparaison des salles", "ReportTitle")])
    rows = [["Salle", "Occupation", "Hors réservation", "Réservé vide", "Première présence", "Couverture"]]
    for room in report["rooms"]:
        k = room["current"]
        rows.append([room["name"], number(k["occupancy_pct"], " %"), duration(k["unreserved_min"]),
                     duration(k["reserved_empty_min"]), number(k["arrival_avg_min"], " min"), number(k["coverage_pct"], " %")])
    flow.append(table(rows, [110, 70, 75, 75, 80, 70]))
    for room in report["rooms"]:
        k = room["current"]
        flow.append(KeepTogether([
            p(room["name"], "Heading2"),
            p(f"{room['capacity']} places. Étage {room['floor']}. Équipements déclarés "
              f"{', '.join(room['equipment']) or 'aucun'}."),
            p(f"{duration(k['occupied_min'])} occupées sur {duration(k['observed_min'])} observables. "
              f"{k['unused_observed_days']} jour(s) entièrement observé(s) sans présence. "
              f"{duration(k['reserved_unknown_min'])} réservées sans mesure. "
              f"Délai médian {number(k['arrival_median_min'], ' min')}, "
              f"{k['arrival_sample_count']} évaluables et {k['arrival_unevaluated_count']} non évaluables.", "ReportSmall"),
            p(f"{k['no_show_released_count']} réservation(s) libérée(s) pour absence initiale. "
              f"{k['release_failed_count']} libération(s) échouée(s). "
              f"{duration(k['released_min'])} libérées dont {duration(k['reused_released_min'])} ensuite occupées "
              "avec ou sans nouvelle réservation.", "ReportSmall"),
            p("Mesure exploitable selon les critères pilotes." if room["reliable"] else
              "Couverture ou durée observée insuffisante pour une décision d’aménagement.", "ReportSmall"),
        ]))
    other_actions = [action for action in report["eligible_actions"] if action not in report["recommendations"]]
    if other_actions:
        flow.extend([PageBreak(), p("Pistes complémentaires", "ReportTitle")])
        for action in other_actions:
            flow.append(KeepTogether([
                p(f"{action['room_name']} - {action['title']}", "Heading2"),
                p(action["evidence"]), p(action["action"]),
                p(f"Suivi proposé. {action['follow_up']}", "ReportSmall"),
            ]))
    flow.extend([PageBreak(), p("Méthode et traçabilité", "ReportTitle")])
    for title, body in (
        ("Occupation", "Minutes occupées divisées par les minutes observables dans les horaires retenus. Les périodes sans mesure sont comptées à part."),
        ("Usage hors réservation", "Minutes de présence sans réservation effective, divisées par le temps occupé. Le calendrier provient de la base OptiSpace. Cette mesure décrit un usage hors planning."),
        ("Réservé et observé vide", "Minutes de réservation effective avec absence observée, divisées par les minutes de réservation effective observables. Les minutes après libération sont exclues de cette réservation."),
        ("Première présence", "Délai entre le début réservé et la première minute de présence avant la fin effective. Toutes les minutes jusqu’à cette présence doivent être observées et horodatées avec une horloge synchronisée. Les autres réservations sont comptées comme non évaluables pour ce délai."),
        ("Agrégation", "Les durées sont additionnées avant le calcul des taux. La comparaison entre périodes utilise uniquement les mêmes salles exploitables dans les deux périodes."),
        ("Critères pilotes à valider", f"Mesure exploitable à partir de {RULE_VALUE(report, 'coverage_pct')} % de couverture et {RULE_VALUE(report, 'observed_min')} minutes observées. "
         f"Signal hors réservation à {RULE_VALUE(report, 'unreserved_pct')} % avec au moins 30 minutes. "
         f"Signal réservé vide à {RULE_VALUE(report, 'reserved_empty_pct')} % avec au moins 120 minutes réservées observables. "
         f"Délai à examiner à partir de {RULE_VALUE(report, 'arrival_delay_min')} minutes sur au moins {RULE_VALUE(report, 'arrival_sample_count')} réservations. "
         f"Sous-utilisation sous {RULE_VALUE(report, 'underuse_pct')} % sur au moins {RULE_VALUE(report, 'underuse_days')} jours du périmètre."),
        (f"Rôle de l’IA via {provider_name}", "OptiSpace calcule les valeurs et les actions admissibles. L’IA rédige une synthèse, justifie jusqu’à trois priorités et propose des étapes à examiner. Le serveur contrôle le format et les références, puis ajoute les preuves chiffrées. Ce contrôle ne garantit pas la justesse de chaque interprétation : une relecture humaine reste nécessaire. Aucune action n’est exécutée par la génération du rapport."),
    ):
        flow.extend([p(title, "Heading2"), p(body)])
    for limitation in report["limitations"]:
        flow.append(p(limitation, "ReportSmall"))
    trace = report["summary"].get("generation")
    if analysis and trace:
        flow.append(p(f"Génération {provider_name} : consigne {trace['prompt_version']}, "
                      f"données envoyées {trace['payload_revision']}, durée {trace['duration_ms']} ms.", "ReportSmall"))
        if trace.get("response_id"):
            flow.append(p(f"Identifiant de réponse fournisseur : {trace['response_id']}", "ReportSmall"))
    flow.append(p(f"Calcul du {local(report['generated_at'])}. Révision {report['data_revision']}. Faits {report.get('facts_revision', 'indisponible')}. "
                  f"Règles {report['rules_version']}. Fournisseur {report['summary']['provider_status']}.", "ReportSmall"))

    def footer(canvas, document):
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 12 * mm, f"OptiSpace | {source} | {report['data_revision']}")
        canvas.drawRightString(192 * mm, 12 * mm, str(document.page))

    document = SimpleDocTemplate(output, pagesize=(210 * mm, 297 * mm), leftMargin=18 * mm,
                                 rightMargin=18 * mm, topMargin=17 * mm, bottomMargin=20 * mm,
                                 title="OptiSpace - Décisions pour les salles", author="OptiSpace")
    document.build(flow, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


def RULE_VALUE(report, key):
    return report["rules"][key]
