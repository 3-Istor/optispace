import { useState } from 'react'
import { api } from '../../api.js'
import { errorText } from '../../messages.js'
import { fromParis, toParis, fmtDuration } from '../../time.js'
import { Button } from '../../ui/Button.jsx'
import { buildChart, CHART } from './reportChart.js'

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const value = (number, unit = '') => number == null ? 'Indisponible' : `${nf.format(number)}${unit}`
const day = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' })
const shiftDate = (date, days) => new Date(Date.parse(date) + days * 864e5).toISOString().slice(0, 10)
const SERIES = [
  ['occupancy_pct', 'Occupation / temps observable', '#1E56D6'],
  ['unreserved_pct', 'Hors réservation / temps occupé', '#BD650B'],
  ['reserved_empty_pct', 'Réservé vide / réservé observable', '#8056A5'],
]
const PROVIDER = {
  ready: 'Priorisation assistée par Gemini',
  not_configured: 'Gemini à configurer · priorisation par les règles OptiSpace',
  unavailable: 'Gemini indisponible · priorisation par les règles OptiSpace',
  insufficient_data: 'Données insuffisantes pour une priorisation Gemini',
  no_action: 'Aucune action déclenchée par les critères pilotes',
}

function TrendChart({ report }) {
  const [selected, setSelected] = useState(null)
  if (!report.totals.observed_min || !report.trend.length) return <p className="muted">Aucune mesure disponible sur cette période.</p>
  const latestIndex = Math.max(0, report.trend.findLastIndex((point) => point.coverage_pct >= report.rules.coverage_pct))
  const selectedIndex = Math.min(selected ?? latestIndex, report.trend.length - 1)
  function selectNearest(event, points) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = (event.clientX - bounds.left) * CHART.width / bounds.width
    const nearest = points.reduce((best, point, index) => Math.abs(point.x - pointerX) < Math.abs(points[best].x - pointerX) ? index : best, 0)
    setSelected(nearest)
  }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 16 }}>
    {SERIES.map(([field, label, color]) => {
      const chart = buildChart(report.trend, field, report.rules.coverage_pct)
      const active = chart.points[selectedIndex]
      return <figure key={field} style={{ margin: 0, paddingBottom: 16, borderBottom: '1px solid #E4E8EE' }}>
        <figcaption style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 15, color }}>{label}</strong>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <strong className="num" style={{ color, fontSize: 24 }}>{value(active?.value, ' %')}</strong>
            <span className="muted" style={{ fontSize: 13 }}>{active && day(active.date)}</span>
          </span>
        </figcaption>
        <p className="muted" style={{ margin: '4px 0 10px', fontSize: 12 }}>Échelle {chart.lower} à {chart.upper} %</p>
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={`${label}. Échelle de ${chart.lower} à ${chart.upper} pour cent.`}
            onPointerMove={(event) => selectNearest(event, chart.points)} onPointerDown={(event) => selectNearest(event, chart.points)}
            style={{ display: 'block', width: '100%', minWidth: 660 }}>
            {chart.ticks.map((tick) => <g key={tick.value}>
              <line x1={CHART.left} x2={CHART.right} y1={tick.y} y2={tick.y} stroke="#DEE5EF" />
              <text x={CHART.left - 12} y={tick.y + 5} textAnchor="end" fontSize="14" fill="#465366">{tick.value} %</text>
            </g>)}
            {chart.segments.map((segment, index) => {
              const path = segment.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
              return <g key={index}>
                <path d={`${path} L ${segment.at(-1).x} ${CHART.bottom} L ${segment[0].x} ${CHART.bottom} Z`} fill={color} fillOpacity=".07" />
                <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            })}
            {active && <line x1={active.x} x2={active.x} y1={CHART.top} y2={CHART.bottom} stroke={color} strokeDasharray="4 4" opacity=".55" />}
            {chart.points.filter((point) => point.value !== null).map((point) => <circle key={point.date} cx={point.x} cy={point.y} r={point === active ? 6 : 3.5} fill={point === active ? '#FFFFFF' : color} stroke={color} strokeWidth="2">
              <title>{day(point.date)} · {value(point.value, ' %')} · couverture {value(point.coverage_pct, ' %')}</title>
            </circle>)}
            {!chart.segments.length && <text x="405" y="110" textAnchor="middle" fontSize="15" fill="#465366">Aucune valeur calculable pour ce KPI</text>}
            {chart.dateIndexes.map((index) => <text key={index} x={chart.points[index].x} y="216" textAnchor="middle" fontSize="14" fill="#465366">{day(chart.points[index].date)}</text>)}
          </svg>
        </div>
      </figure>
    })}
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
      Jour consulté · {day(report.trend[selectedIndex].date)} · couverture {value(report.trend[selectedIndex].coverage_pct, ' %')}
      <input type="range" aria-label="Jour consulté sur les trois courbes" aria-valuetext={day(report.trend[selectedIndex].date)} min="0" max={report.trend.length - 1} value={selectedIndex} onChange={(event) => setSelected(Number(event.target.value))} style={{ width: '100%', minHeight: 44, accentColor: '#1E56D6' }} />
    </label>
    <p className="muted" style={{ fontSize: 12, margin: 0 }}>Survolez une courbe ou déplacez le curseur pour lire les valeurs du même jour. Les interruptions signalent une couverture insuffisante ou un dénominateur vide.</p>
  </div>
}

function download(report) {
  const bytes = Uint8Array.from(atob(report.pdf_base64), (character) => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `OptiSpace-rapport-${report.period.to.slice(0, 10)}.pdf`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function UsageReport({ spaces }) {
  const today = toParis(new Date()).date
  const [filters, setFilters] = useState({ from: shiftDate(today, -28), to: shiftDate(today, -1), start: 9, end: 18, weekdays: true, space: '' })
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const rooms = spaces.filter((space) => space.type === 'meeting_room' && space.is_active !== false)
  const valid = filters.from && filters.to && filters.from <= filters.to && filters.to < today && filters.start < filters.end
  function update(key, next) {
    setFilters((current) => ({ ...current, [key]: next }))
    setReport(null)
    setError(null)
  }
  async function generate(event) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    setReport(null)
    const query = new URLSearchParams({
      from: fromParis(filters.from, '00:00').toISOString(),
      to: fromParis(shiftDate(filters.to, 1), '00:00').toISOString(),
      start_hour: filters.start, end_hour: filters.end, weekdays_only: filters.weekdays,
    })
    if (filters.space) query.set('space_id', filters.space)
    try {
      setReport(await api.post(`/reports/usage?${query}`))
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  const totals = report?.totals
  return <section className="card" aria-labelledby="report-heading" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <h2 id="report-heading" style={{ fontSize: 20 }}>Décisions pour les salles</h2>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>Comparez les usages, examinez les écarts et générez un rapport avec les actions suggérées et leurs indicateurs de suivi.</p>
      </div>
      {report && <Button onClick={() => download(report)}>Télécharger le PDF</Button>}
    </div>
    <form onSubmit={generate}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'flex', alignItems: 'end', flexWrap: 'wrap', gap: 12 }}>
        <label className="lbl">Salles
          <select className="input" value={filters.space} onChange={(event) => update('space', event.target.value)} style={{ display: 'block', marginTop: 6, maxWidth: 260 }}>
            <option value="">Toutes les salles de réunion actives</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
        </label>
        <label className="lbl">Du<input className="input" type="date" required max={filters.to} value={filters.from} onChange={(event) => update('from', event.target.value)} style={{ display: 'block', marginTop: 6 }} /></label>
        <label className="lbl">Au inclus<input className="input" type="date" required min={filters.from} max={shiftDate(today, -1)} value={filters.to} onChange={(event) => update('to', event.target.value)} style={{ display: 'block', marginTop: 6 }} /></label>
        <label className="lbl">De
          <select className="input" value={filters.start} onChange={(event) => update('start', Number(event.target.value))} style={{ display: 'block', marginTop: 6 }}>
            {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hour} h</option>)}
          </select>
        </label>
        <label className="lbl">À
          <select className="input" value={filters.end} onChange={(event) => update('end', Number(event.target.value))} style={{ display: 'block', marginTop: 6 }}>
            {Array.from({ length: 24 }, (_, hour) => <option key={hour + 1} value={hour + 1}>{hour + 1} h</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 13 }}><input type="checkbox" checked={filters.weekdays} onChange={(event) => update('weekdays', event.target.checked)} />Lundi au vendredi</label>
        <Button variant="p" type="submit" busy={busy} disabled={!valid || !rooms.length}>{busy ? 'Génération du rapport…' : 'Générer le rapport'}</Button>
      </fieldset>
    </form>
    {error && <p role="alert" style={{ color: '#AC352D', margin: 0 }}>{error.code === 'INVALID_REPORT_PERIOD' ? 'Choisissez une période de 1 à 93 jours et une plage horaire valide.' : errorText(error)}</p>}
    {busy && <p role="status" className="muted">Calcul des indicateurs, priorisation des actions et préparation du PDF.</p>}
    {report && <>
      <div style={{ borderTop: '1px solid #EEF1F5', paddingTop: 16 }}>
        <p role="status" style={{ margin: '0 0 8px', fontSize: 13, color: '#1E56D6' }}>{PROVIDER[report.summary.provider_status]}</p>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {({ simulated: 'Données simulées', real: 'Données réelles', mixed: 'Données mixtes' })[report.source_mode] ?? 'Données de présence indisponibles'}
          {' · '}{report.rooms.length} salle(s){' · '}Calcul du {new Date(report.generated_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}{' · '}Révision {report.data_revision}
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20 }}>
        {[
          ['Occupation mesurée', value(totals.occupancy_pct, ' %'), `${fmtDuration(totals.occupied_min)} sur ${fmtDuration(totals.observed_min)} observables`],
          ['Usage hors réservation', value(totals.unreserved_pct, ' %'), `${fmtDuration(totals.unreserved_min)} sur le temps occupé`],
          ['Réservé et observé vide', value(totals.reserved_empty_pct, ' %'), `${fmtDuration(totals.reserved_empty_min)} sur ${fmtDuration(totals.reserved_observed_min)} réservées observables`],
          ['Première présence', value(totals.arrival_avg_min, ' min'), `Médiane ${value(totals.arrival_median_min, ' min')} · ${totals.arrival_sample_count} évaluables`],
        ].map(([label, main, detail]) => <div key={label}>
          <span className="lbl">{label}</span><strong className="num" style={{ display: 'block', fontSize: 26, margin: '6px 0' }}>{main}</strong><span className="muted" style={{ fontSize: 12 }}>{detail}</span>
        </div>)}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>Couverture {value(totals.coverage_pct, ' %')} · {fmtDuration(totals.unknown_min)} sans mesure · {totals.arrival_unevaluated_count} réservation(s) non évaluables pour le délai. La présence détectée décrit l’usage de la salle.</p>
      <div style={{ borderTop: '1px solid #EEF1F5', paddingTop: 16 }}>
        <h3 style={{ fontSize: 15 }}>Évolution dans le temps</h3>
        <TrendChart report={report} />
        <p className="muted" style={{ fontSize: 12 }}>Comparaison avec la période précédente de même durée · {report.comparison.room_count} salle(s) exploitables sur les deux périodes.</p>
        {report.comparison.room_count > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: 13 }}>
          {SERIES.map(([field, label]) => {
            const current = report.comparison.current[field]
            const before = report.comparison.previous[field]
            return <span key={field}>{label.split(' / ')[0]} · {value(before, ' %')} → {value(current, ' %')} {before != null && current != null && `(${value(current - before, ' points')})`}</span>
          })}
        </div>}
      </div>
      <div style={{ borderTop: '1px solid #EEF1F5', paddingTop: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Décisions suggérées</h3>
        <p className="muted" style={{ fontSize: 14 }}>Choisissez les problèmes à examiner. Les vérifications proposées restent à votre initiative.</p>
        {report.measurement_warnings?.length > 0 && <div role="note" style={{ margin: '12px 0', fontSize: 14 }}>
          <strong>Mesures à vérifier avant de conclure</strong>
          {report.measurement_warnings.map((warning) => <p key={warning.id}>{warning.room_name} · {warning.evidence} {warning.action}</p>)}
        </div>}
        {report.recommendations.map((action) => <div key={action.id} style={{ padding: '14px 0', borderBottom: '1px solid #EEF1F5', fontSize: 13, lineHeight: 1.55 }}>
          <strong>{action.room_name} · {action.title}</strong>
          <p style={{ margin: '6px 0' }}>{action.evidence}</p>
          <p style={{ margin: '6px 0' }}>{action.action}</p>
          <span className="muted">Suivi proposé · {action.follow_up}</span>
        </div>)}
        {!report.recommendations.length && <p className="muted">Les données disponibles ne déclenchent aucune action selon les critères pilotes.</p>}
        {report.baseline_recommendations && <details style={{ marginTop: 16, fontSize: 14, lineHeight: 1.6 }}>
          <summary style={{ cursor: 'pointer', minHeight: 44 }}>Comprendre la sélection des priorités</summary>
          <p>OptiSpace calcule les indicateurs et les pistes possibles. L’IA peut sélectionner et ordonner jusqu’à trois pistes ; les chiffres et les textes restent issus des calculs et des règles.</p>
          <p>{report.summary.mode === 'llm_assisted'
            ? report.summary.selection_changed ? 'L’IA a modifié la sélection ou son ordre. Cela ne suffit pas à démontrer une meilleure décision.' : 'L’IA a retenu les mêmes priorités, dans le même ordre que les règles.'
            : 'Priorités calculées par les règles, sans assistance de l’IA.'}</p>
          <strong>Priorités proposées par les règles sur ces mêmes données</strong>
          <ol>{report.baseline_recommendations.map((action) => <li key={action.id}>{action.room_name} · {action.title}</li>)}</ol>
          {!report.baseline_recommendations.length && <p>Aucune piste déclenchée.</p>}
          <p>Les règles placent d’abord les problèmes de mesure, puis les écarts de réservation selon leur durée observée. Les autres pistes suivent. Ces priorités pilotes restent à valider avec le métier.</p>
        </details>}
      </div>
      <div style={{ borderTop: '1px solid #EEF1F5', paddingTop: 16 }}>
        <h3 style={{ fontSize: 15 }}>Détail par salle</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left', marginTop: 12 }}>
            <thead><tr>{['Salle et équipements', 'Occupation', 'Hors réservation', 'Réservé vide', 'Première présence', 'Couverture'].map((label) => <th key={label} style={{ padding: '10px 12px', fontWeight: 500, borderBottom: '1px solid #E4E8EE' }}>{label}</th>)}</tr></thead>
            <tbody>{report.rooms.map((room) => <tr key={room.id}>
              <th scope="row" style={{ padding: '14px 12px', minWidth: 190, fontWeight: 500, borderBottom: '1px solid #EEF1F5' }}>{room.name}<small className="muted" style={{ display: 'block', fontWeight: 400, marginTop: 4 }}>{room.capacity} places · {room.equipment.join(', ') || 'Aucun équipement déclaré'}</small></th>
              {[value(room.current.occupancy_pct, ' %'), `${fmtDuration(room.current.unreserved_min)} · ${value(room.current.unreserved_pct, ' %')}`, `${fmtDuration(room.current.reserved_empty_min)} · ${value(room.current.reserved_empty_pct, ' %')}`, `${value(room.current.arrival_avg_min, ' min')} · n = ${room.current.arrival_sample_count}`, `${value(room.current.coverage_pct, ' %')}${room.reliable ? '' : ' · insuffisante'}`].map((cell, i) => <td key={i} style={{ padding: '14px 12px', minWidth: 110, verticalAlign: 'top', borderBottom: '1px solid #EEF1F5' }}>{cell}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </div>
      <details style={{ borderTop: '1px solid #EEF1F5', paddingTop: 16, fontSize: 13, lineHeight: 1.6 }}>
        <summary style={{ cursor: 'pointer' }}>Toutes les pistes étayées · {report.eligible_actions.length}</summary>
        {report.eligible_actions.map((action) => <div key={action.id} style={{ padding: '12px 0', borderBottom: '1px solid #EEF1F5' }}>
          <strong>{action.room_name} · {action.title}</strong>
          <p style={{ margin: '6px 0' }}>{action.evidence}</p>
          <p style={{ margin: '6px 0' }}>{action.action}</p>
          <span className="muted">Suivi proposé · {action.follow_up}</span>
        </div>)}
        {!report.eligible_actions.length && <p className="muted">Aucune piste déclenchée sur les données disponibles.</p>}
      </details>
      <details style={{ borderTop: '1px solid #EEF1F5', paddingTop: 16, fontSize: 12, color: '#5B6676', lineHeight: 1.6 }}>
        <summary style={{ cursor: 'pointer' }}>Méthode, critères pilotes et limites</summary>
        <p>Les taux sont calculés après addition des durées. La réservation effective se termine à la libération. Le temps réservé sans mesure est compté séparément. Le PDF conserve les chiffres et la révision affichés ici.</p>
        <p>Critères pilotes à valider avec le PO · couverture d’au moins {report.rules.coverage_pct} % et {report.rules.observed_min} minutes observées. Usage hors réservation à partir de {report.rules.unreserved_pct} % et 30 minutes. Réservé vide à partir de {report.rules.reserved_empty_pct} % et 120 minutes réservées observables. Délai moyen à partir de {report.rules.arrival_delay_min} minutes sur {report.rules.arrival_sample_count} réservations. Sous-utilisation sous {report.rules.underuse_pct} % sur {report.rules.underuse_days} jours du périmètre.</p>
        {report.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
        <p>Gemini sélectionne et ordonne jusqu’à trois actions admissibles à partir des faits agrégés. OptiSpace construit les textes avec les chiffres calculés.</p>
      </details>
    </>}
  </section>
}
