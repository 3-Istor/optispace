import { useCallback, useState } from 'react'
import { api } from '../../api.js'
import { DEVICE_STATES, deviceState, errorText, floorLabel, WARNINGS } from '../../messages.js'
import { Link } from '../../router.jsx'
import { dayLabel, fmtAgo, fmtTime, fromParis, toParis } from '../../time.js'
import { usePolling } from '../../usePolling.js'
import { EmptyState } from '../../ui/EmptyState.jsx'
import { Icon, ICONS } from '../../ui/Icon.jsx'
import { Loader } from '../../ui/Loader.jsx'
import { PageHeader } from '../../ui/Shell.jsx'
import { StatusBadge } from '../../ui/StatusBadge.jsx'

const PERIODS = { today: ['Aujourd’hui', 1], '7d': ['7 jours', 7], '30d': ['30 jours', 30] }
const TODO = ['new', 'offline', 'sealed']
const byName = (a, b) => a.name.localeCompare(b.name, 'fr')

const loadLive = async () => {
  const [spaces, devices] = await Promise.all([api.get('/spaces'), api.get('/devices')])
  return { spaces: spaces.sort(byName), devices }
}

// One decimal, half up (exigences §6.1): 56.25 -> "56,3".
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const num = (v) => (v == null ? '?' : nf.format(v))
const pct = (v) => (v == null ? 'Non calculable' : `${nf.format(v)} %`)
const s = (k) => (k > 1 ? 's' : '')
const text = (x) => (typeof x === 'string' ? x : x?.text ?? x?.message ?? '')

// K-01, K-02, K-05, K-06, K-07 (exigences §6). IOT-36 does not name the fields yet: this mapping is
// the single place to align with the backend. Rates are null when not computable.
function kpiCards(k) {
  return [
    ['Occupation réelle', pct(k.occupancy_pct),
      `${num(k.occupied_min)} min sur ${num(k.observed_min)} observées · ${num(k.occupied_reserved_min)} avec réservation, ${num(k.occupied_unreserved_min)} sans`],
    ['Réservation initiale', pct(k.reserved_initial_pct), `${num(k.reserved_initial_min)} min réservées sur ${num(k.period_min)}`],
    ['No-shows', pct(k.no_show_pct),
      `${num(k.no_show_count)} sur ${num(k.evaluated_count)} réservation${s(k.evaluated_count)} évaluée${s(k.evaluated_count)}`
      + (k.not_evaluated_count ? `, ${num(k.not_evaluated_count)} non évaluée${s(k.not_evaluated_count)}` : '')],
    ['Temps libéré', `${num(k.released_min)} min`,
      `${num(k.releases_succeeded)} libération${s(k.releases_succeeded)} réussie${s(k.releases_succeeded)}, ${num(k.releases_failed)} échouée${s(k.releases_failed)}`],
    ['Couverture des mesures', pct(k.coverage_pct), k.unknown_min ? `${num(k.unknown_min)} min sans mesure` : 'toute la période est observée'],
  ]
}

function todo(d) {
  const st = deviceState(d)
  if (st === 'new') return [`${d.id} à affecter et desceller`, `Scellé, non affecté · apparu ${fmtAgo(d.first_seen_at)}`]
  if (st === 'sealed') return [`Boîtier de ${d.space.name} scellé`, 'La présence n’y est pas mesurée : aucune libération automatique.']
  return [`${d.space?.name ?? d.id} hors ligne`, `Dernière connexion ${fmtAgo(d.last_seen_at)}.`]
}

// AdminDashboard.dc.html. Displays GET /spaces/{id}/insights as is (spec §8): nothing is computed here.
export function Dashboard() {
  const live = usePolling(loadLive, 5000)
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
    return { key: `${spaceId}|${period}`, ...(await api.get(`/spaces/${spaceId}/insights?${q}`)) }
  }, [spaceId, period])
  // ponytail: recomputed server-side on each call, so 60 s instead of the 5 s live polling.
  const insights = usePolling(loadInsights, 60000)

  const { spaces = [], devices = [] } = live.data ?? {}
  const header = (
    <PageHeader title="Tableau de bord">
      {spaces.length > 0 && <>
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
  const llm = ins?.summary?.mode === 'llm_assisted'
  const recos = ins?.recommendations ?? []
  const noShows = Array.isArray(ins?.no_shows) ? ins.no_shows : []
  const pending = devices.filter((d) => TODO.includes(deviceState(d))).sort((a, b) => TODO.indexOf(deviceState(a)) - TODO.indexOf(deviceState(b)))

  return (
    <>
      {header}
      <section className="card" aria-labelledby="syn-h" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <h2 id="syn-h" style={{ fontSize: 15 }}>Synthèse de la période</h2>
          {ins?.summary && (
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, ...(llm ? { background: '#EAF0FD', color: '#1747B3' } : { background: '#F1F3F6', color: '#3A4555' }) }}>
              {llm ? 'IA' : 'Gabarit (repli)'}
            </span>
          )}
        </div>
        {!ins ? (
          insights.error ? <p className="muted" style={{ margin: 0 }}>{errorText(insights.error)}</p> : <Loader label="Calcul des indicateurs" />
        ) : <>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, maxWidth: 900 }}>{ins.summary?.text || 'Aucune synthèse pour cette période.'}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid #EEF1F5' }}>
            <span className="lbl">Recommandations</span>
            {recos.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.5 }}>
                {recos.map((r, i) => <li key={i}>{r?.title ? <><strong style={{ fontWeight: 600 }}>{r.title}</strong>{r.text && ` : ${r.text}`}</> : text(r)}</li>)}
              </ul>
            ) : <span className="muted" style={{ fontSize: 13 }}>Aucune recommandation pour cette période.</span>}
          </div>
          {noShows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid #EEF1F5' }}>
              <span className="lbl">No-shows</span>
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
          {ins.warnings?.length > 0 && (
            <ul aria-label="Avertissements" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ins.warnings.map((w, i) => (
                <li key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 26, padding: '0 10px', borderRadius: 6, background: '#FDF6EE', color: '#8A4A0E', fontSize: 12 }}>
                  <Icon d={ICONS.warn} size={14} style={{ color: '#D9771F', flex: 'none' }} />{WARNINGS[w] ?? text(w)}
                </li>
              ))}
            </ul>
          )}
        </>}
      </section>

      {ins?.kpis && (
        <section aria-label="Indicateurs" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {kpiCards(ins.kpis).map(([label, value, sub]) => (
            <div key={label} className="card" style={{ padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="lbl">{label}</span>
              <span className="num" style={{ fontFamily: "'Sora', sans-serif", fontSize: value === 'Non calculable' ? 18 : 26, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</span>
              <span className="muted num" style={{ fontSize: 12, lineHeight: 1.45 }}>{sub}</span>
            </div>
          ))}
        </section>
      )}

      <div className="cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.65fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <section className="card" aria-labelledby="now-h" style={{ padding: '8px 0' }}>
          <h2 id="now-h" style={{ fontSize: 15, padding: '12px 22px 6px' }}>En ce moment</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 440, overflow: 'auto' }}>
            {spaces.filter((sp) => sp.is_active !== false).map((sp) => (
              <li key={sp.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', padding: '10px 22px', borderTop: '1px solid #EEF1F5' }}>
                <span style={{ display: 'flex', flexDirection: 'column', flex: '1 1 160px', lineHeight: 1.35 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{sp.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{floorLabel(sp.floor)}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 220px' }}>
                  <StatusBadge state={sp.space_state} releaseAt={sp.current_reservation?.release_at} />
                  {sp.current_reservation?.booker_name && <span className="muted" style={{ fontSize: 12 }}>Réservée par {sp.current_reservation.booker_name}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="todo-h" style={{ padding: '8px 0' }}>
          <h2 id="todo-h" style={{ fontSize: 15, padding: '12px 22px 6px' }}>À traiter</h2>
          {pending.length ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {pending.map((d) => {
                const [title, sub] = todo(d)
                return (
                  <li key={d.id}>
                    <Link to={`/admin/devices?id=${encodeURIComponent(d.id)}`} className="row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 22px', color: '#0E1726' }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: DEVICE_STATES[deviceState(d)][1] }} />
                      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</span>
                        <span className="muted" style={{ fontSize: 12 }}>{sub}</span>
                      </span>
                      <Icon d="M5 12h14M13 6l6 6-6 6" size={14} style={{ color: '#8A94A3', flex: 'none' }} />
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : <p className="muted" style={{ margin: 0, padding: '4px 22px 14px', fontSize: 13, lineHeight: 1.5 }}>Rien à traiter : tous les boîtiers sont affectés, descellés et en ligne.</p>}
        </section>
      </div>
    </>
  )
}
