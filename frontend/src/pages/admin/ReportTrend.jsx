import { useState } from 'react'
import { buildChart, CHART } from './reportChart.js'

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const value = (number, unit = '') => number == null ? 'Indisponible' : `${nf.format(number)}${unit}`
const day = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' })
const SERIES = [
  ['occupancy_pct', 'Occupation / temps observable', '#1E56D6'],
  ['unreserved_pct', 'Hors réservation / temps occupé', '#BD650B'],
  ['reserved_empty_pct', 'Réservé vide / réservé observable', '#8056A5'],
]

export function ReportTrend({ report }) {
  const [selected, setSelected] = useState(null)
  const [metric, setMetric] = useState(SERIES[0][0])
  if (!report.totals.observed_min || !report.trend.length) return <p className="muted">Aucune mesure disponible sur cette période.</p>
  const latestIndex = Math.max(0, report.trend.findLastIndex((point) => point.coverage_pct >= report.rules.coverage_pct))
  const selectedIndex = Math.min(selected ?? latestIndex, report.trend.length - 1)
  function selectNearest(event, points) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = (event.clientX - bounds.left) * CHART.width / bounds.width
    const nearest = points.reduce((best, point, index) => Math.abs(point.x - pointerX) < Math.abs(points[best].x - pointerX) ? index : best, 0)
    setSelected(nearest)
  }
  return <div className="report-trends">
    <div className="report-series-switch" role="group" aria-label="Indicateur de la courbe">
      {SERIES.map(([field], index) => <button type="button" key={field} aria-pressed={metric === field} onClick={() => setMetric(field)}>{['Occupation', 'Sans réservation', 'Réservé mais vide'][index]}</button>)}
    </div>
    {SERIES.filter(([field]) => field === metric).map(([field, label, color]) => {
      const chart = buildChart(report.trend, field, report.rules.coverage_pct)
      const active = chart.points[selectedIndex]
      return <figure key={field} className="report-trend">
        <figcaption style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 16, color }}>{label}</strong>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <strong className="num" style={{ color, fontSize: 24 }}>{value(active?.value, ' %')}</strong>
            <span className="muted" style={{ fontSize: 13 }}>{active && day(active.date)}</span>
          </span>
        </figcaption>
        <p className="muted" style={{ margin: '4px 0 10px', fontSize: 12 }}>Échelle {chart.lower} à {chart.upper} %</p>
        <div className="report-chart-scroll" role="region" aria-label={`Courbe ${label}`} tabIndex={0}>
          <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={`${label}. Échelle de ${chart.lower} à ${chart.upper} pour cent.`}
            onPointerMove={(event) => selectNearest(event, chart.points)} onPointerDown={(event) => selectNearest(event, chart.points)}
            className="report-chart-svg">
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
      Jour consulté · {day(report.trend[selectedIndex].date)} · couverture {value(report.trend[selectedIndex].coverage_pct, ' %')}
      <input type="range" aria-label="Jour consulté sur la courbe" aria-valuetext={day(report.trend[selectedIndex].date)} min="0" max={report.trend.length - 1} value={selectedIndex} onChange={(event) => setSelected(Number(event.target.value))} style={{ width: '100%', minHeight: 44, accentColor: '#1E56D6' }} />
    </label>
    <p className="muted" style={{ fontSize: 14, margin: 0 }}>Les interruptions signalent une couverture insuffisante ou l’absence de données pour calculer ce taux.</p>
  </div>
}

