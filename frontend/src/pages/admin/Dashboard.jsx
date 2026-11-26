import { useCallback, useState } from 'react'
import { api } from '../../api.js'
import { DEVICE_STATES, deviceState, errorText, floorLabel, WARNINGS } from '../../messages.js'
import { Link } from '../../router.jsx'
import { dayLabel, fmtAgo, fmtDuration, fmtLongDay, fmtTime, fromParis, toParis } from '../../time.js'
import { usePolling } from '../../usePolling.js'
import { Button } from '../../ui/Button.jsx'
import { EmptyState } from '../../ui/EmptyState.jsx'
import { Icon, ICONS } from '../../ui/Icon.jsx'
import { Loader } from '../../ui/Loader.jsx'
import { Count } from '../../ui/motion.jsx'
import { PageHeader } from '../../ui/Shell.jsx'
import { UsageReport } from './UsageReport.jsx'

const PERIODS = { today: ['Aujourd’hui', 1], '7d': ['7 jours', 7], '30d': ['30 jours', 30] }
const SOURCES = { simulated: 'Données simulées', real: 'Données réelles', mixed: 'Données mixtes' }
const TODO = ['new', 'offline', 'sealed']
const byName = (a, b) => a.name.localeCompare(b.name, 'fr')

const loadLive = async () => {
  const [spaces, devices] = await Promise.all([api.get('/spaces'), api.get('/devices')])
  return { spaces: spaces.sort(byName), devices }
}

// One decimal, half up (exigences §6.1): 56.25 -> "56,3".
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const pct = (v) => `${nf.format(v)} %`
const dur = (v) => fmtDuration(Math.round(v))
const s = (k) => (k > 1 ? 's' : '')
const text = (x) => (typeof x === 'string' ? x : x?.text ?? x?.message ?? '')

// Below this share of measured minutes a rate says more about the gaps than about the room.
const MIN_COVERAGE = 25
const FEW = 'Pas assez de mesures'
const fewMeasures = (k) => !(k.coverage_pct >= MIN_COVERAGE)

// [label, value, detail] from the kpis of GET /spaces/{id}/insights. A string value is words, not a figure.
function kpiTiles(k) {
  const low = fewMeasures(k)
  const unreserved = k.occupied_unreserved_min ? `${fmtDuration(k.occupied_unreserved_min)} utilisées sans réservation` : ''
  return [
    ['Réservé et utilisé',
      low ? FEW : k.reserved_initial_min ? <Count value={100 * k.occupied_reserved_min / k.reserved_initial_min} format={pct} /> : 'Aucune réservation',
      [k.reserved_initial_min ? `${low ? '' : `${fmtDuration(k.occupied_reserved_min)} sur `}${fmtDuration(k.reserved_initial_min)} réservées` : 'sur cette période',
        !low && unreserved].filter(Boolean).join(' · ')],
    ['Réservations sans personne',
      k.evaluated_count ? <><Count value={k.no_show_count} format={Math.round} /> sur {k.evaluated_count}</> : 'Aucune',
      [k.no_show_count ? `libérée${s(k.no_show_count)} automatiquement` : k.evaluated_count ? 'tout le monde est venu' : !k.not_evaluated_count && 'aucune réservation à vérifier',
        k.not_evaluated_count && `${k.not_evaluated_count} réservation${s(k.not_evaluated_count)} sans mesure`].filter(Boolean).join(' · ')],
    ['Temps libéré', <Count value={k.released_min} format={dur} />,
      k.releases_succeeded || k.releases_failed
        ? `${k.releases_succeeded} libération${s(k.releases_succeeded)}${k.releases_failed ? `, ${k.releases_failed} échouée${s(k.releases_failed)}` : ''}`
        : 'aucune libération'],
    ['Fiabilité des mesures', low ? FEW : <Count value={k.coverage_pct} format={pct} />,
      low ? `${fmtDuration(k.observed_min)} mesurées sur ${fmtDuration(k.period_min)}`
        : k.unknown_min ? `de la période couverte · ${fmtDuration(k.unknown_min)} sans mesure` : 'toute la période est couverte'],
  ]
}

const Swatch = ({ color, children }) => (
  <span className="st" style={{ fontSize: 12, color: '#5B6676' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />{children}</span>
)

// Bars per Paris hour of day: `hourly` items of several days add up. Working hours by default, widened to the
// hours that hold data. Full height is one hour, or the largest bar when days add up beyond it.
function HourChart({ hourly, days, low }) {
  const by = {}
  for (const h of hourly) {
    const sum = (by[Number(toParis(new Date(h.start_at)).time.slice(0, 2))] ??= [0, 0])
    sum[0] += h.reserved_min
    sum[1] += h.used_min
  }
  const filled = Object.keys(by).map(Number).filter((h) => by[h][0] || by[h][1])
  const lo = Math.min(8, ...filled)
  const hours = Array.from({ length: Math.max(18, ...filled) - lo + 1 }, (_, i) => lo + i)
  const top = Math.max(60, ...filled.flatMap((h) => by[h]))
  const every = Math.ceil(hours.length / 6) // at most six hour labels, so they fit a phone
  const total = (i) => fmtDuration(filled.reduce((n, h) => n + by[h][i], 0))
  return (
    <section className="card" aria-labelledby="chart-h" style={{ alignSelf: 'stretch', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px 14px' }}>
        <h2 id="chart-h" style={{ fontSize: 15 }}>Minutes réservées et réellement utilisées</h2>
        <span style={{ display: 'flex', gap: 14 }}><Swatch color="#C9D6F5">Réservé</Swatch><Swatch color="#1E56D6">Utilisé</Swatch></span>
      </div>
      <div className="chart" role="img" aria-label={`Par heure, de ${lo} h à ${hours.at(-1) + 1} h : ${total(0)} réservées, ${total(1)} utilisées.`}>
        <span className="chart-top num">{fmtDuration(top)}</span>
        {hours.map((h, i) => {
          const [reserved, used] = by[h] ?? [0, 0]
          return (
            <span key={h} style={{ '--i': i }} title={`${h} h : ${fmtDuration(reserved)} réservées, ${fmtDuration(used)} utilisées`}>
              <i style={{ height: `${(reserved / top) * 100}%` }} /><i style={{ height: `${(used / top) * 100}%` }} />
            </span>
          )
        })}
      </div>
      <div className="chart-x num" aria-hidden="true">{hours.map((h, i) => <span key={h}>{i % every ? '' : `${h} h`}</span>)}</div>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
        {!filled.length ? 'Aucune réservation ni présence sur cette période.'
          : low ? `${FEW} : les minutes utilisées sont sous-estimées.`
            : days > 1 ? `Par heure de la journée, cumul sur ${days} jours.` : 'Par heure de la journée.'}
      </span>
    </section>
  )
}

// [tile colour class, state in words] of a space; a space with no device has no state to show.
function tileOf(sp, hasDevice) {
  const r = sp.current_reservation
  if (!hasDevice) return ['', 'sans boîtier']
  switch (sp.space_state) {
    case 'free': return ['free', 'libre']
    case 'awaiting_presence': return ['wait', r?.release_at ? `attendue avant ${fmtTime(r.release_at)}` : 'attendue']
    case 'occupied_reserved': return ['busy', r ? `jusqu’à ${fmtTime(r.end_at)}` : 'occupée']
    case 'occupied_unreserved': return ['busy', 'occupée sans réservation']
    case 'sealed': return ['', 'boîtier scellé']
    default: return ['', 'boîtier hors ligne']
  }
}

function todo(d) {
  const st = deviceState(d)
  if (st === 'new') return [`${d.id} à affecter et desceller`, `Scellé, non affecté · apparu ${fmtAgo(d.first_seen_at)}`]
  if (st === 'sealed') return [`Boîtier de ${d.space.name} scellé`, 'La présence n’y est pas mesurée : aucune libération automatique.']
  return [`${d.space?.name ?? d.id} hors ligne`, `Dernière connexion ${fmtAgo(d.last_seen_at)}.`]
}

export function PeriodSummary({ ins, loadError, period, onPeriodChange }) {
  const [generated, setGenerated] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const assisted = generated?.summary?.mode === 'llm_assisted'
  const recos = generated?.recommendations ?? []
  const details = generated ?? ins
  const hasMeasures = ins?.kpis.observed_min > 0
  const provider = details?.summary?.provider_status
  const providerMessage = {
    not_configured: 'Clé Groq absente de la configuration du serveur. La synthèse disponible utilise les règles OptiSpace.',
    unavailable: 'Groq est indisponible ou sa réponse a été rejetée. La synthèse affichée utilise les règles OptiSpace. Vous pouvez réessayer.',
  }[provider]
  const noShows = Array.isArray(details?.no_shows) ? details.no_shows : []
  const sub = { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid #EEF1F5' }

  async function generate() {
    if (!hasMeasures || busy) return
    setBusy(true)
    setError(null)
    try {
      setGenerated(await api.post(ins.summaryPath))
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" aria-labelledby="syn-h" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <h2 id="syn-h" style={{ fontSize: 15 }}>Synthèse de la salle</h2>
        {generated && hasMeasures && <span className="muted" style={{ fontSize: 12 }}>{assisted ? 'Assistée par Groq' : 'Synthèse par règles OptiSpace'}</span>}
        <Button variant="p" style={{ marginLeft: 'auto' }} disabled={!hasMeasures} busy={busy} onClick={generate}>
          {busy ? 'Génération en cours…' : 'Générer la synthèse'}
        </Button>
      </div>
      {!ins ? <span className="muted" style={{ fontSize: 13 }}>{loadError ? errorText(loadError) : 'Calcul des indicateurs en cours.'}</span> : <>
        <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13 }}>
          Période analysée
          <select className="input" aria-label="Période de la synthèse" value={period} onChange={(event) => onPeriodChange(event.target.value)}>
            {Object.entries(PERIODS).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          Du {fmtLongDay(details.period.from).toLowerCase()} à {fmtTime(details.period.from)} au {fmtLongDay(details.period.to).toLowerCase()} à {fmtTime(details.period.to)}
          {details.source_mode && ` · ${SOURCES[details.source_mode] ?? details.source_mode}`}
        </span>
        {!hasMeasures ? <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <p style={{ margin: 0, lineHeight: 1.6 }}>Aucune mesure de présence disponible sur cette période. Choisissez une période contenant des observations pour générer une synthèse.</p>
          {period === 'today' && <Button onClick={() => onPeriodChange('7d')}>Consulter les 7 derniers jours</Button>}
        </div> : <>
          {providerMessage && <p role="status" style={{ margin: 0, lineHeight: 1.5, color: '#8A4A0E', fontSize: 13 }}>{providerMessage}</p>}
          {error && <p role="alert" style={{ margin: 0 }}>{errorText(error)}</p>}
          {generated ? <>
            <p aria-live="polite" style={{ margin: 0, lineHeight: 1.65 }}>{generated.summary.text}</p>
          </> : <p className="muted" style={{ margin: 0 }}>Générez une synthèse pour obtenir les constats principaux et une piste à vérifier.</p>}
          {recos.length > 0 && (
            <div style={sub}>
              <span className="lbl">À vérifier</span>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.5 }}>
                {recos.map((r, i) => <li key={i}>{r?.title ? <><strong style={{ fontWeight: 600 }}>{r.title}</strong>{r.text && ` · ${r.text}`}</> : text(r)}</li>)}
              </ul>
            </div>
          )}
          {noShows.length > 0 && (
            <div style={sub}>
              <span className="lbl">Réservations sans personne</span>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }} className="num">
                {noShows.map((r, i) => (
                  <li key={r.reservation_id ?? i}>
                    {r.start_at ? `${dayLabel(r.start_at).toLowerCase()}, ${fmtTime(r.start_at)} à ${fmtTime(r.end_at)}` : text(r)}
                    {r.start_at && (r.released_at ? `, libérée à ${fmtTime(r.released_at)}` : ', non libérée')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {details.warnings?.length > 0 && (
            <ul aria-label="Avertissements" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {details.warnings.map((w, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: '#8A4A0E', fontSize: 12, lineHeight: 1.45 }}>
                  <Icon d={ICONS.warn} size={14} style={{ color: '#D9771F', flex: 'none', marginTop: 1 }} />{WARNINGS[w] ?? text(w)}
                </li>
              ))}
            </ul>
          )}
        </>}
      </>}
    </section>
  )
}

// Figures first, then the hourly chart and the live state, then the written summary. The figures come from
// GET /spaces/{id}/insights; only the coverage guard and the reserved-and-used rate are worked out here.
export function Dashboard() {
  const live = usePolling(loadLive, 5000)
  const [view, setView] = useState('analysis')
  const [picked, setPicked] = useState(null)
  const [period, setPeriod] = useState('today')
  const spaceId = picked ?? live.data?.spaces[0]?.id
  const key = `${spaceId}|${period}`

  const loadInsights = useCallback(async () => {
    if (!spaceId) return null
    const from = fromParis(toParis(new Date(Date.now() - (PERIODS[period][1] - 1) * 864e5)).date, '00:00')
    // At least one minute after from: "Aujourd’hui" just after midnight would otherwise send from == to.
    const to = new Date(Math.max(+from + 6e4, Math.floor(Date.now() / 6e4) * 6e4))
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
    const path = `/spaces/${spaceId}/insights`
    return { key: `${spaceId}|${period}`, ...(await api.get(`${path}?${q}`)), summaryPath: `${path}/summary?${q}` }
  }, [spaceId, period])
  // ponytail: recomputed server-side on each call, so 60 s instead of the 5 s live polling.
  const insights = usePolling(loadInsights, 60000)

  const { spaces = [], devices = [] } = live.data ?? {}
  const header = (
    <PageHeader title="Tableau de bord">
      {view === 'live' && spaces.length > 0 && <>
        <select className="input" aria-label="Espace" value={spaceId} onChange={(e) => setPicked(e.target.value)} style={{ maxWidth: '100%' }}>
          {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.is_active === false ? ' (hors service)' : ''}</option>)}
        </select>
        <select className="input" aria-label="Période" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {Object.entries(PERIODS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </>}
    </PageHeader>
  )
  if (!live.data) return <>{header}{live.error ? <EmptyState title="Chargement impossible">{errorText(live.error)}</EmptyState> : <Loader label="Chargement du tableau de bord" />}</>
  if (!spaces.length) {
    return <>{header}<EmptyState title="Aucun espace" actions={<Link to="/admin/spaces" className="btn btn-p">Ajouter un espace</Link>}>
      Créez un espace et affectez-lui un boîtier pour suivre son occupation.
    </EmptyState></>
  }

  const ins = insights.data?.key === key ? insights.data : null
  const pending = devices.filter((d) => TODO.includes(deviceState(d))).sort((a, b) => TODO.indexOf(deviceState(a)) - TODO.indexOf(deviceState(b)))
  const equipped = new Set(devices.map((d) => d.space?.id))
  const active = spaces.filter((sp) => sp.is_active !== false)
  const floors = [...new Set(active.map((sp) => sp.floor))].sort((a, b) => a - b)

  return (
    <>
      {header}
      <div className="fm-view-switch" role="group" aria-label="Vue du tableau de bord">
        <button type="button" aria-pressed={view === 'analysis'} onClick={() => setView('analysis')}><Icon d={ICONS.dashboard} />Analyse des espaces</button>
        <button type="button" aria-pressed={view === 'live'} onClick={() => setView('live')}><Icon d={ICONS.spaces} />Suivi des salles</button>
      </div>
      <div hidden={view !== 'analysis'}><UsageReport spaces={spaces} /></div>
      <div className="fm-live-view" hidden={view !== 'live'}>
      {!ins ? (
        insights.error ? <EmptyState title="Indicateurs indisponibles">{errorText(insights.error)}</EmptyState> : <Loader label="Calcul des indicateurs" />
      ) : (
        <section className="kpis" aria-label="Indicateurs">
          {kpiTiles(ins.kpis).map(([label, value, detail]) => (
            <div key={label} className="card kpi">
              <span className="lbl">{label}</span>
              <b className={typeof value === 'string' ? 'txt' : 'num'}>{value}</b>
              <span className="muted num" style={{ fontSize: 12, lineHeight: 1.45 }}>{detail}</span>
            </div>
          ))}
        </section>
      )}

      <div className="cols-2">
        {ins ? <HourChart hourly={ins.hourly ?? []} days={PERIODS[period][1]} low={fewMeasures(ins.kpis)} /> : <span />}
        <section className="card" aria-labelledby="now-h" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="now-h" style={{ fontSize: 15 }}>En ce moment</h2>
          {floors.map((floor) => (
            <div key={floor} role="group" aria-label={floorLabel(floor)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>{floorLabel(floor)}</span>
              <div className="tiles">
                {active.filter((sp) => sp.floor === floor).map((sp) => {
                  const [tone, state] = tileOf(sp, equipped.has(sp.id))
                  return <Link key={sp.id} to={`/admin/spaces?id=${sp.id}`} className={`tile ${tone}`}>{sp.name}<small>{state}</small></Link>
                })}
              </div>
            </div>
          ))}
          {!active.length && <span className="muted" style={{ fontSize: 13 }}>Aucun espace en service.</span>}
        </section>
      </div>

      <div className="cols-2">
        <PeriodSummary key={key} ins={ins} loadError={insights.error} period={period} onPeriodChange={setPeriod} />
        <section className="card" aria-labelledby="todo-h" style={{ padding: '8px 0' }}>
          <h2 id="todo-h" style={{ fontSize: 15, padding: '12px 18px 6px' }}>À traiter</h2>
          {pending.length ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {pending.map((d) => {
                const [title, detail] = todo(d)
                return (
                  <li key={d.id}>
                    <Link to={`/admin/devices?id=${encodeURIComponent(d.id)}`} className="row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', color: '#0E1726' }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: DEVICE_STATES[deviceState(d)][1] }} />
                      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</span>
                        <span className="muted" style={{ fontSize: 12 }}>{detail}</span>
                      </span>
                      <Icon d="M5 12h14M13 6l6 6-6 6" size={14} style={{ color: '#8A94A3', flex: 'none' }} />
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : <p className="muted" style={{ margin: 0, padding: '4px 18px 14px', fontSize: 13, lineHeight: 1.5 }}>Rien à traiter : tous les boîtiers sont affectés, descellés et en ligne.</p>}
        </section>
      </div>
      </div>
    </>
  )
}
