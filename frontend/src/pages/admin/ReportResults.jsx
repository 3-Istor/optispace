import { useState } from 'react'
import { fmtDuration, toParis } from '../../time.js'
import { Button } from '../../ui/Button.jsx'
import { Icon, ICONS } from '../../ui/Icon.jsx'
import { ReportTrend } from './ReportTrend.jsx'

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const value = (number, unit = '') => number == null ? 'Indisponible' : `${nf.format(number)}${unit}`
// Display the server's evidence in familiar units without changing its facts.
const formatEvidence = (text) => text
  .replace(/\b(\d+) minutes\b/g, (_, minutes) => fmtDuration(Number(minutes)))
  .replace(/\b(\d+(?:\.\d+)?) min\b/g, (_, number) => `${nf.format(Number(number))} min`)
  .replace(/\b(\d+(?:\.\d+)?) %/g, (_, number) => `${nf.format(Number(number))} %`)
const dateLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' })
const TABS = [['actions', 'Recommandations'], ['indicators', 'Indicateurs'], ['rooms', 'Salles']]
const providerStates = (name) => ({
  ready: [`Sélection assistée par ${name}`, 'L’IA classe les actions. OptiSpace calcule les chiffres et prépare les textes.'],
  unavailable: [`Analyse ${name} non obtenue`, 'Aucune analyse IA acceptée pour ce rapport. Les mesures et les pistes issues des règles restent disponibles.'],
  not_configured: ['Sélection par les règles OptiSpace', `${name} non configuré : aucune analyse IA n’a été générée.`],
  insufficient_data: ['Mesures insuffisantes', 'Les mesures disponibles ne permettent pas cette analyse IA.'],
  no_action: ['Aucune action déclenchée', 'Les données observées ne déclenchent aucune action selon les critères actuels. L’IA n’a pas été sollicitée.'],
})

function download(report) {
  const bytes = Uint8Array.from(atob(report.pdf_base64), (character) => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `OptiSpace-rapport-${report.period.to.slice(0, 10)}.pdf`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ActionList({ actions, ranked = false, analysis, providerName, rooms = [] }) {
  const authored = new Map((analysis?.recommendations ?? []).map((item) => [item.action_id, item]))
  return <ol className="report-actions">
    {actions.map((action, index) => {
      const advice = authored.get(action.id)
      const current = rooms.find((room) => room.id === action.room_id)?.current
      const metric = {
        COVERAGE: ['coverage_pct', 'de couverture', ' %'],
        UNRESERVED: ['unreserved_pct', 'de l’usage sans réservation', ' %'],
        RESERVED_EMPTY: ['reserved_empty_pct', 'du temps réservé vide', ' %'],
        UNDERUSE: ['occupancy_pct', 'd’occupation mesurée', ' %'],
        ARRIVAL: ['arrival_avg_min', 'avant la première présence', ' min'],
      }[action.kind]
      return <li className="hl report-action" key={action.id} id={ranked ? `report-action-${index}` : undefined}>
      <details className="report-action-detail">
        <summary>
          {ranked && <span className="report-priority" aria-label={`Priorité ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>}
          <span className="report-action-intro">
            <span className="report-action-room">{action.room_name}</span>
            <span className="report-action-title">{action.title}</span>
            <span className="report-first-step"><span>{advice ? 'Première étape · IA' : 'Piste · OptiSpace'}</span>{advice?.steps[0] ?? action.action}</span>
          </span>
          {current && metric && <span className="report-action-metric"><strong className="num">{value(current[metric[0]], metric[2])}</strong><span>{metric[1]}</span></span>}
          <span className="report-action-more"><span>Détails</span><Icon d="M6 9l6 6 6-6" /></span>
        </summary>
        <div className="report-action-body">
        <dl className="report-action-facts">
          <div><dt>Constat mesuré · OptiSpace</dt><dd>{formatEvidence(action.evidence)}</dd></div>
          {advice && <div><dt>Pourquoi cette priorité · {providerName}</dt><dd>{advice.rationale}</dd></div>}
        </dl>
        {advice && <div className="report-ai-steps"><h5>Étapes proposées par l’IA · {providerName}</h5>
          <ol>{advice.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
          <p><strong>À vérifier ensuite :</strong> {advice.check}</p>
        </div>}
        <div className="report-follow-up"><strong>Indicateur de suivi · OptiSpace</strong><p>{action.follow_up}</p></div>
        </div>
      </details>
    </li>})}
  </ol>
}

function AIAnalysis({ report, providerName }) {
  const [expanded, setExpanded] = useState(false)
  const analysis = report.analysis
  return <section className="report-ai-analysis" aria-labelledby="report-ai-title">
    <div className="report-ai-heading"><h4 id="report-ai-title">Le regard de l’IA</h4><span>Rédigé via {providerName}</span></div>
    <p id="report-ai-overview" className={`report-ai-overview${expanded ? '' : ' is-condensed'}`}>{analysis.overview}</p>
    <Button variant="g" aria-expanded={expanded} aria-controls="report-ai-detail report-ai-overview" onClick={() => setExpanded(!expanded)}>{expanded ? 'Réduire la synthèse' : 'Lire toute la synthèse'}</Button>
    <div id="report-ai-detail" hidden={!expanded}>
    <p className="report-ai-caution"><strong>Point de vigilance :</strong> {analysis.caution}</p>
    <details className="report-follow-up"><summary>Constats utilisés</summary>
      {analysis.evidence_action_ids.map((id) => {
        const action = report.recommendations.find((item) => item.id === id)
        return action ? <p key={id}><strong>{action.room_name}</strong> · {formatEvidence(action.evidence)}</p> : null
      })}
    </details>
    </div>
  </section>
}

function MeasurementQuality({ report }) {
  // The current backend exposes coverage actions; IOT-86 also sends explicit warnings.
  const warnings = report.measurement_warnings ?? report.eligible_actions.filter((action) => action.kind === 'COVERAGE')
  const noMeasures = !report.totals.observed_min
  return <div className={`report-quality${warnings.length || noMeasures ? ' report-quality-warning' : ''}`} role="note">
    <Icon d={warnings.length || noMeasures ? ICONS.warn : ICONS.device} size={20} />
    <div>
      <p><strong>{noMeasures ? 'Aucune présence mesurée sur ce périmètre' : `Couverture des mesures : ${value(report.totals.coverage_pct, ' %')}`}</strong>
        {!noMeasures && <span> · {fmtDuration(report.totals.unknown_min)} sans mesure</span>}</p>
      {warnings.length > 0 ? <details><summary>{warnings.length} salle{warnings.length > 1 ? 's' : ''} à vérifier avant de conclure</summary>
        {warnings.map((warning) => <p key={warning.id}><strong>{warning.room_name}</strong> · {formatEvidence(warning.evidence)} {warning.action}</p>)}
      </details> : noMeasures ? <p>Vérifiez les capteurs ou choisissez une période avec des mesures. Une absence de mesure ne signifie pas une salle vide.</p> : null}
    </div>
  </div>
}

function Metrics({ report }) {
  const totals = report.totals
  return <dl className="report-metrics" aria-label="Indicateurs du rapport calculés par OptiSpace">
      {[
        ['Occupation mesurée', totals.occupancy_pct, '%', `${fmtDuration(totals.occupied_min)} occupées sur ${fmtDuration(totals.observed_min)} observables`],
        ['Usage sans réservation', totals.unreserved_pct, '%', `${fmtDuration(totals.unreserved_min)} sur le temps occupé`],
        ['Réservé mais vide', totals.reserved_empty_pct, '%', `${fmtDuration(totals.reserved_empty_min)} vides sur ${fmtDuration(totals.reserved_observed_min)} réservées observables`],
        ['Première présence', totals.arrival_avg_min, 'min', `Délai moyen · ${totals.arrival_sample_count} réservations évaluables`],
      ].map(([label, number, unit, detail], index) => <div key={label} className={`report-metric report-metric-${index}`}><dt>{label}</dt><dd className={`num${number == null ? ' report-metric-empty' : ''}`}>{value(number)}{number != null && <span className="report-metric-unit"> {unit}</span>}</dd><dd className="report-help">{detail}</dd></div>)}
    </dl>
}

function Indicators({ report }) {
  const totals = report.totals
  return <>
    <div className="report-panel-heading"><h4>Comment les usages évoluent-ils ?</h4><p>Choisissez un indicateur, puis un jour pour explorer les mesures.</p></div>
    <ReportTrend report={report} />
    <details className="report-fold"><summary>Comprendre les quatre indicateurs</summary>
      <dl className="report-definitions">
        <div><dt>Occupation mesurée</dt><dd>Temps avec une présence détectée, divisé par le temps mesuré.</dd></div>
        <div><dt>Usage sans réservation</dt><dd>Temps occupé sans réservation effective, divisé par tout le temps occupé.</dd></div>
        <div><dt>Réservé mais vide</dt><dd>Temps réservé et observé vide, divisé par le temps réservé observable.</dd></div>
        <div><dt>Première présence</dt><dd>Délai moyen entre le début de la réservation et la première présence détectée. Médiane : {value(totals.arrival_median_min, ' min')}.</dd></div>
      </dl>
    <p className="report-help">{totals.arrival_unevaluated_count} réservation(s) non évaluables pour le délai. La présence détectée ne permet pas d’identifier le réservant.</p>
    </details>
    <div className="report-comparison">
      <h4>Par rapport à la période précédente</h4>
      <p>Période de même durée · {report.comparison.room_count} salle(s) avec des mesures exploitables sur les deux périodes.</p>
      {report.comparison.room_count > 0 && <dl className="report-comparison-values">
        {[
          ['occupancy_pct', 'Occupation mesurée'], ['unreserved_pct', 'Usage sans réservation'], ['reserved_empty_pct', 'Réservé mais vide'],
        ].map(([field, label]) => {
          const current = report.comparison.current[field]
          const before = report.comparison.previous[field]
          return <div key={field}><dt>{label}</dt><dd>{value(before, ' %')} → {value(current, ' %')}</dd>
            <dd className="report-help">{before != null && current != null ? `${current - before > 0 ? '+' : ''}${value(current - before, ' points')}` : 'Comparaison indisponible'}</dd></div>
        })}
      </dl>}
    </div>
  </>
}

function Rooms({ report }) {
  return <>
    <div className="report-panel-heading"><h4>Détail par salle</h4><p>Repérez les écarts et vérifiez la couverture avant de comparer les salles.</p></div>
    <div className="report-table-scroll" role="region" aria-label="Indicateurs par salle" tabIndex={0}>
      <table className="report-room-table">
        <thead><tr>{['Salle', 'Occupation', 'Sans réservation', 'Réservé mais vide', 'Première présence', 'Couverture'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{report.rooms.map((room) => <tr key={room.id}>
          <th scope="row">{room.name}<small>{room.capacity} places · {room.equipment.join(', ') || 'Aucun équipement déclaré'}</small></th>
          {[
            ['Occupation', value(room.current.occupancy_pct, ' %')],
            ['Sans réservation', `${fmtDuration(room.current.unreserved_min)} · ${value(room.current.unreserved_pct, ' %')}`],
            ['Réservé mais vide', `${fmtDuration(room.current.reserved_empty_min)} · ${value(room.current.reserved_empty_pct, ' %')}`],
            ['Première présence', `${value(room.current.arrival_avg_min, ' min')} · ${room.current.arrival_sample_count} évaluables`],
            ['Couverture', `${value(room.current.coverage_pct, ' %')}${room.reliable ? '' : ' · à vérifier'}`],
          ].map(([label, cell]) => <td key={label} data-label={label}>{cell}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </>
}

export function ReportResults({ report, headingRef, retry }) {
  const [tab, setTab] = useState('actions')
  const start = toParis(new Date(report.period.from)).date
  const end = toParis(new Date(Date.parse(report.period.to) - 1)).date
  const count = report.recommendations.length
  const providerName = report.summary.provider === 'groq' ? 'Groq' : 'Gemini'
  const [providerTitle, providerExplanation] = providerStates(providerName)[report.summary.provider_status] ?? ['Mode non renseigné', 'Consultez les informations du rapport.']
  const assisted = report.summary.mode === 'llm_assisted' && report.summary.provider_status === 'ready'
  const authored = assisted && report.analysis
  const trace = report.summary.generation
  function navigateTabs(event, index) {
    const next = { ArrowRight: (index + 1) % TABS.length, ArrowLeft: (index + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setTab(TABS[next][0])
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus()
  }
  return <div className="report-results">
    <div className="report-result-header">
      <div><p className="report-eyebrow">Votre rapport d’usage</p>
        <h3 ref={headingRef} tabIndex={-1} className="report-result-title">{report.rooms.length === 1 ? report.rooms[0].name : `${report.rooms.length} salles, une vue d’ensemble.`}</h3>
        <p className="report-period">Du {dateLabel(start)} au {dateLabel(end)} · {report.schedule.start_hour} h–{report.schedule.end_hour} h · {report.schedule.weekdays_only ? 'lundi–vendredi' : 'tous les jours'}</p>
        <p className="report-scope"><span className="report-source">{({ simulated: 'Données simulées', real: 'Données réelles', mixed: 'Données mixtes' })[report.source_mode] ?? 'Source indisponible'}</span><span>Chiffres calculés par OptiSpace</span></p>
      </div>
      <Button onClick={() => download(report)}><Icon d="M12 3v12M8 11l4 4 4-4M5 17v4h14v-4" />Télécharger le PDF</Button>
    </div>
    <Metrics report={report} />
    {!authored && <div className={`report-provider${assisted ? ' report-provider-ai' : ''}`} role="status">
      <strong>{authored ? `Analyse rédigée par l’IA · ${providerName}` : providerTitle}</strong>
      <span>{authored ? 'Synthèse, priorités et étapes proposées par l’IA. Chiffres calculés par OptiSpace.' : providerExplanation}</span>
      {report.summary.provider_status === 'unavailable' && retry && <Button onClick={retry}>Réessayer l’analyse {providerName}</Button>}
    </div>}
    <MeasurementQuality report={report} />

    <div className="report-tabs" role="tablist" aria-label="Explorer le rapport">
      {TABS.map(([key, label], index) => <button key={key} type="button" role="tab" id={`report-tab-${key}`} aria-selected={tab === key}
        aria-controls={`report-panel-${key}`} tabIndex={tab === key ? 0 : -1} onKeyDown={(event) => navigateTabs(event, index)} onClick={() => setTab(key)}>
        {label}{key === 'actions' && <span>{count}</span>}
      </button>)}
    </div>
    <div id="report-panel-actions" role="tabpanel" aria-labelledby="report-tab-actions" tabIndex={0} hidden={tab !== 'actions'} className="report-panel">
      <div className="report-priorities-heading"><div className="report-panel-heading"><h4>{count ? `${count} priorité${count > 1 ? 's' : ''} à examiner` : 'Aucune recommandation sur cette période'}</h4><p>Des propositions à valider par vos soins.</p></div>
        {authored && <span className="report-ai-badge" role="status">Analyse rédigée par l’IA · {providerName}</span>}
      </div>
      {count ? <ActionList actions={report.recommendations} rooms={report.rooms} ranked analysis={authored ? report.analysis : null} providerName={providerName} /> : <div className="report-no-actions">
        <Icon d={ICONS.search} size={24} /><p>{!report.totals.observed_min ? 'Choisissez une autre période ou vérifiez les mesures dans l’onglet Salles.' : 'Les critères actuels ne déclenchent aucune recommandation. Consultez les indicateurs pour examiner les usages.'}</p>
      </div>}
      {authored && <AIAnalysis report={report} providerName={providerName} />}
      {report.baseline_recommendations && <details className="report-fold">
        <summary>Comprendre la sélection des priorités</summary>
        <p>OptiSpace calcule les indicateurs et les pistes possibles. L’IA sélectionne jusqu’à trois pistes et, lorsqu’une analyse est disponible, rédige la synthèse, les justifications et les étapes proposées. Les constats chiffrés et les indicateurs de suivi viennent d’OptiSpace.</p>
        <p>{assisted ? report.summary.selection_changed ? 'L’IA a modifié la sélection ou son ordre. Cela ne suffit pas à démontrer une meilleure décision.' : 'L’IA a retenu les mêmes priorités, dans le même ordre que les règles.' : 'Les règles OptiSpace déterminent les priorités de ce rapport.'}</p>
        <h4>Priorités proposées par les règles sur ces mêmes données</h4>
        <ol>{report.baseline_recommendations.map((action) => <li key={action.id}>{action.room_name} · {action.title}</li>)}</ol>
        {!report.baseline_recommendations.length && <p>Aucune piste déclenchée.</p>}
      </details>}
      <details className="report-fold"><summary>Toutes les pistes à examiner <span>{report.eligible_actions.length}</span></summary>
        <ActionList actions={report.eligible_actions} rooms={report.rooms} />
        {!report.eligible_actions.length && <p>Aucune piste déclenchée sur les données disponibles.</p>}
      </details>
    </div>
    <div id="report-panel-indicators" role="tabpanel" aria-labelledby="report-tab-indicators" tabIndex={0} hidden={tab !== 'indicators'} className="report-panel"><Indicators report={report} /></div>
    <div id="report-panel-rooms" role="tabpanel" aria-labelledby="report-tab-rooms" tabIndex={0} hidden={tab !== 'rooms'} className="report-panel"><Rooms report={report} /></div>
    <footer className="report-footer">
      {authored && <details className="report-fold report-method"><summary>Vérifier la génération {providerName}</summary>
        <p>Un appel au fournisseur a renvoyé cette analyse. Le serveur a accepté sa structure et ses références ; cela ne garantit pas la justesse de chaque interprétation. Relisez les propositions avant de décider.</p>
        <p>Fournisseur : {providerName} · Modèle : {report.summary.model_version}{trace?.received_at && ` · Réponse reçue le ${new Date(trace.received_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`}</p>
        {trace && <>
          <p>Durée de l’appel : {value(trace.duration_ms / 1000, ' s')}{trace.input_tokens != null && ` · Jetons d’entrée : ${trace.input_tokens}`}{trace.output_tokens != null && ` · Jetons de sortie : ${trace.output_tokens}`}</p>
          {trace.response_id && <p>Identifiant de réponse fournisseur : <code>{trace.response_id}</code></p>}
          <p>Version de consigne : {trace.prompt_version} · Données envoyées : {trace.payload_revision}</p>
        </>}
      </details>}
      <details className="report-fold report-method"><summary>Méthode de calcul et limites</summary>
        <p>Les taux sont calculés après addition des durées. La réservation effective se termine à la libération. Le temps réservé sans mesure est compté séparément. Le PDF conserve les chiffres et la sélection de ce rapport.</p>
        <p>Critères pilotes à valider avec le métier : couverture d’au moins {report.rules.coverage_pct} % et {report.rules.observed_min} minutes observées ; usage sans réservation à partir de {report.rules.unreserved_pct} % et 30 minutes ; réservé vide à partir de {report.rules.reserved_empty_pct} % et 120 minutes réservées observables ; délai moyen à partir de {report.rules.arrival_delay_min} minutes sur {report.rules.arrival_sample_count} réservations ; sous-utilisation sous {report.rules.underuse_pct} % sur {report.rules.underuse_days} jours du périmètre.</p>
        {report.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
        <p>L’IA analyse les agrégats et rédige une synthèse, les justifications des priorités et des étapes à examiner. OptiSpace conserve les chiffres, les preuves et les indicateurs de suivi. En cas d’échec, seules les pistes rédigées dans les règles sont présentées.</p>
        {report.summary.model_version && <p>Modèle ayant répondu : {report.summary.model_version}</p>}
        <p>Révision {report.data_revision}{report.facts_revision && ` · Faits ${report.facts_revision}`}</p>
      </details>
      <p className="report-help">Rapport calculé le {new Date(report.generated_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · Europe/Paris</p>
    </footer>
  </div>
}
