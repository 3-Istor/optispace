import { useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import { errorText } from '../../messages.js'
import { fromParis, toParis } from '../../time.js'
import { Button } from '../../ui/Button.jsx'
import { Icon, ICONS } from '../../ui/Icon.jsx'
import { ReportResults } from './ReportResults.jsx'
import './usageReport.css'

const shiftDate = (date, days) => new Date(Date.parse(date) + days * 864e5).toISOString().slice(0, 10)

export function UsageReport({ spaces }) {
  const today = toParis(new Date()).date
  const [filters, setFilters] = useState({ from: shiftDate(today, -28), to: shiftDate(today, -1), start: 9, end: 18, weekdays: true, space: '' })
  const [report, setReport] = useState(null)
  const [generatedFilters, setGeneratedFilters] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const resultsHeading = useRef(null)
  const rooms = spaces.filter((space) => space.type === 'meeting_room' && space.is_active !== false)
  const periodDays = filters.from && filters.to ? (Date.parse(filters.to) - Date.parse(filters.from)) / 86400000 + 1 : 0
  const valid = periodDays >= 1 && periodDays <= 93 && filters.to < today && filters.start < filters.end
  const dirty = report && Object.keys(filters).some((key) => filters[key] !== generatedFilters[key])

  useEffect(() => {
    if (report) {
      resultsHeading.current?.focus({ preventScroll: true })
      resultsHeading.current?.closest('.report-result-header')?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
  }, [report])

  function update(key, next) {
    setFilters((current) => ({ ...current, [key]: next }))
    setError(null)
  }

  async function generate(event) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const query = new URLSearchParams({
      from: fromParis(filters.from, '00:00').toISOString(),
      to: fromParis(shiftDate(filters.to, 1), '00:00').toISOString(),
      start_hour: filters.start, end_hour: filters.end, weekdays_only: filters.weekdays,
    })
    if (filters.space) query.set('space_id', filters.space)
    try {
      const next = await api.post(`/reports/usage?${query}`)
      setGeneratedFilters({ ...filters })
      setFiltersOpen(false)
      setReport(next)
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return <section className={`card rows usage-report${report ? ' has-report' : ''}`} aria-labelledby="report-heading">
    <header className="report-header">
      <div className="report-heading-copy">
        <p className="report-eyebrow"><Icon d={ICONS.dashboard} size={16} />Pilotage des espaces</p>
        <h2 id="report-heading">Vos salles. Vos prochaines décisions.</h2>
        <p className="report-description">Les usages en un regard. Les priorités pour agir.</p>
      </div>
      {report && <Button aria-expanded={filtersOpen} aria-controls="report-filters" onClick={() => setFiltersOpen(!filtersOpen)} disabled={busy}>
        <Icon d={ICONS.settings} />{filtersOpen ? 'Fermer les filtres' : 'Modifier le périmètre'}
      </Button>}
      {!report && <div className="report-hero-detail"><strong>{rooms.length}</strong><span>salle{rooms.length > 1 ? 's' : ''} de réunion<br />à votre disposition</span></div>}
    </header>

    <form id="report-filters" onSubmit={generate} hidden={!filtersOpen} className="report-filters">
      <fieldset disabled={busy}>
        <legend className="sr-only">Périmètre du rapport</legend>
        <div className="report-preset-row"><span>Période d’analyse</span><div className="report-presets" role="group" aria-label="Périodes rapides">
          {[7, 28, 90].map((days) => <button key={days} type="button"
            aria-pressed={filters.from === shiftDate(today, -days) && filters.to === shiftDate(today, -1)}
            onClick={() => { update('from', shiftDate(today, -days)); update('to', shiftDate(today, -1)) }}>{days} jours</button>)}
        </div></div>
        <div className="report-filter-main">
        <label className="field report-room-filter">Salles à analyser
          <select className="input" aria-label="Salles du rapport" value={filters.space} onChange={(event) => update('space', event.target.value)}>
            <option value="">Toutes les salles de réunion</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
        </label>
        <label className="field">Du<input className="input" type="date" required max={filters.to} value={filters.from} onChange={(event) => update('from', event.target.value)} /></label>
        <label className="field">Au inclus<input className="input" type="date" required min={filters.from} max={shiftDate(today, -1)} value={filters.to} onChange={(event) => update('to', event.target.value)} /></label>
        <Button variant="p" type="submit" busy={busy} disabled={!valid || !rooms.length}><Icon d={ICONS.dashboard} />{busy ? 'Analyse en cours…' : 'Générer le rapport'}</Button>
        </div>
        <details className="report-schedule">
          <summary><Icon d={ICONS.clock} />{filters.start} h – {filters.end} h · {filters.weekdays ? 'Lundi au vendredi' : 'Tous les jours'}<span>Adapter les horaires</span></summary>
          <div className="report-schedule-fields">
        <label className="field">De
          <select className="input" aria-label="Heure de début" value={filters.start} onChange={(event) => update('start', Number(event.target.value))}>
            {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hour} h</option>)}
          </select>
        </label>
        <label className="field">À
          <select className="input" aria-label="Heure de fin" value={filters.end} onChange={(event) => update('end', Number(event.target.value))}>
            {Array.from({ length: 24 }, (_, hour) => <option key={hour + 1} value={hour + 1}>{hour + 1} h</option>)}
          </select>
        </label>
        <label className="report-weekdays"><input type="checkbox" checked={filters.weekdays} onChange={(event) => update('weekdays', event.target.checked)} />Lundi au vendredi</label>
          </div>
          <p className="report-help">De 1 à 93 jours terminés · horaires de Paris.</p>
        </details>
      </fieldset>
      {!valid && <p role="alert" className="report-error">Choisissez une période de 1 à 93 jours, terminée avant aujourd’hui, et une heure de fin après l’heure de début.</p>}
      {!rooms.length && <p className="report-help">Aucune salle de réunion active à analyser.</p>}
    </form>

    {error && <p role="alert" className="report-error report-message">{error.code === 'INVALID_REPORT_PERIOD' ? 'Choisissez une période de 1 à 93 jours et une plage horaire valide.' : errorText(error)}{report && ' Le dernier rapport reste disponible ci-dessous.'}</p>}
    {dirty && <p role="status" className="report-notice report-message">Filtres modifiés. Générez à nouveau le rapport pour les appliquer ; le résultat ci-dessous et son PDF conservent le périmètre affiché.</p>}
    {busy && <div role="status" className="report-message report-loading"><strong>Votre analyse se prépare…</strong><span>Mesures, propositions de l’IA et rapport PDF. Cela peut prendre quelques instants.</span></div>}
    {!report && !busy && <div className="report-start">
      {[[ICONS.dashboard, '01', 'Comprendre les usages', 'Quatre indicateurs pour lire la situation.'], [ICONS.search, '02', 'Repérer les priorités', 'Jusqu’à trois pistes à examiner avec l’IA.'], [ICONS.calendar, '03', 'Préparer la suite', 'Des étapes proposées et un PDF à partager.']].map(([icon, number, title, detail]) => <div key={number}>
        <span className="report-start-number"><Icon d={icon} size={22} /><span>{number}</span></span><h3>{title}</h3><p>{detail}</p>
      </div>)}
    </div>}
    {report && <ReportResults key={report.data_revision} report={report} headingRef={resultsHeading}
      retry={!dirty && valid && !busy ? generate : null} />}
  </section>
}
