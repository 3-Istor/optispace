import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import { DEVICE_STATES, deviceState, errorText, floorLabel, SPACE_TYPES } from '../../messages.js'
import { fmtDuration, fmtTime, fromParis, presenceSpans, toParis } from '../../time.js'
import { usePolling } from '../../usePolling.js'
import { Button } from '../../ui/Button.jsx'
import { EmptyState } from '../../ui/EmptyState.jsx'
import { Icon, ICONS } from '../../ui/Icon.jsx'
import { Loader } from '../../ui/Loader.jsx'
import { PageHeader } from '../../ui/Shell.jsx'
import { StatusBadge } from '../../ui/StatusBadge.jsx'
import { Stepper } from '../../ui/Stepper.jsx'
import { toast } from '../../ui/Toast.jsx'

const load = async () => {
  const [spaces, devices, settings] = await Promise.all([api.get('/spaces'), api.get('/devices'), api.get('/settings')])
  return { spaces, devices, settings }
}

const EQUIPMENT = ['Écran', 'Visioconférence', 'Tableau blanc', 'Accessible PMR', 'Paperboard', 'Vidéoprojecteur']
const FLOORS = Array.from({ length: 13 }, (_, i) => i - 2)
const TYPE_KEYS = { meeting_room: ['meeting_min_min', 'meeting_max_min'], individual_booth: ['booth_min_min', 'booth_max_min'] }
const byName = (a, b) => a.name.localeCompare(b.name, 'fr')
const H = 36e5

// min/max_duration_min are effective; the *_override fields are null when the type's default applies.
const durations = (s) => `${fmtDuration(s.min_duration_min)} à ${fmtDuration(s.max_duration_min)}`
  + (s.min_duration_override == null && s.max_duration_override == null ? ' (type)' : '')

const status = (s) => (s.is_active === false
  ? <StatusBadge state="sealed">Hors service</StatusBadge>
  : <StatusBadge state={s.space_state} releaseAt={s.current_reservation?.release_at} />)

// "Camille Martin · 14:00 à 15:00" for the current reservation (booker_name is sent to Facility managers only).
function booking(r) {
  if (!r) return null
  return [r.booker_name, r.start_at && `${fmtTime(r.start_at)} à ${fmtTime(r.end_at)}`].filter(Boolean).join(' · ') || null
}

function deviceText(d) {
  if (!d) return ['Aucun', '#5B6676']
  const st = deviceState(d)
  return [DEVICE_STATES[st][0], st === 'offline' ? '#B4232A' : st === 'active' ? '#3A4555' : '#1747B3']
}

const tabStyle = (on) => ({
  height: 38, padding: 0, border: 0, background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
  borderBottom: `2px solid ${on ? '#1E56D6' : 'transparent'}`, color: on ? '#0E1726' : '#5B6676', marginBottom: -1,
})

// AdminSalles.dc.html: table, detail panel (Détails / Historique) and the create/edit drawer.
export function Spaces() {
  const { data, error, refresh } = usePolling(load, 5000)
  const [type, setType] = useState('meeting_room')
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState(null)
  const [tab, setTab] = useState('details')
  const [form, setForm] = useState(null) // the space being edited; {type} for a new one

  const header = (
    <PageHeader crumb="Espaces / Salles et bulles" title="Salles et bulles">
      <Button variant="p" disabled={!data} onClick={() => setForm({ type })}><Icon d="M12 5v14M5 12h14" />Ajouter un espace</Button>
    </PageHeader>
  )
  const drawer = form && data && (
    <SpaceForm space={form} settings={data.settings} onClose={() => setForm(null)}
      onSaved={(s) => { setForm(null); setType(s.type); setSelId(s.id); refresh() }} />
  )
  if (!data) return <>{header}{error ? <EmptyState title="Chargement impossible">{errorText(error)}</EmptyState> : <Loader label="Chargement des espaces" />}</>

  const { spaces, devices } = data
  const deviceOf = Object.fromEntries(devices.filter((d) => d.space).map((d) => [d.space.id, d]))
  const ofType = spaces.filter((s) => s.type === type).sort(byName)
  const needle = q.trim().toLowerCase()
  const rows = ofType.filter((s) => s.name.toLowerCase().includes(needle))
  const cur = ofType.find((s) => s.id === selId) ?? rows[0] ?? ofType[0]

  return (
    <>
      {header}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div className="seg" role="group" aria-label="Type d’espace">
          {[['meeting_room', 'Salles de réunion'], ['individual_booth', 'Bulles individuelles']].map(([t, label]) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => { setType(t); setSelId(null) }}>
              {label} <span className="num" style={{ color: '#8A94A3', marginLeft: 2 }}>{spaces.filter((s) => s.type === t).length}</span>
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto', maxWidth: '100%' }}>
          <Icon d={ICONS.search} style={{ position: 'absolute', left: 10, top: 10, color: '#8A94A3' }} />
          <input className="input" type="search" placeholder="Rechercher" aria-label="Rechercher un espace" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ width: 220, maxWidth: '100%', paddingLeft: 34 }} />
        </div>
      </div>

      {!ofType.length ? (
        <EmptyState title="Aucun espace de ce type" actions={<Button variant="p" onClick={() => setForm({ type })}>Ajouter un espace</Button>}>
          Les espaces créés ici apparaissent dans la recherche des employés.
        </EmptyState>
      ) : (
        <div className="cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 360px)', gap: 16, alignItems: 'start' }}>
          <section className="card" aria-label="Espaces" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 640 }}>
                <thead><tr><th style={{ paddingLeft: 20 }}>Espace</th><th>Capacité</th><th>Durées</th><th>Boîtier</th><th>Statut</th></tr></thead>
                <tbody>
                  {rows.map((s) => {
                    const [devLabel, devColor] = deviceText(deviceOf[s.id])
                    return (
                      <tr key={s.id} className="row" aria-selected={s.id === cur.id} onClick={() => setSelId(s.id)}>
                        <td style={{ paddingLeft: 20 }}>
                          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.35 }}>
                            <button type="button" className="link" style={{ fontSize: 14, fontWeight: 500, color: '#0E1726', textAlign: 'left', whiteSpace: 'nowrap' }}>{s.name}</button>
                            <span className="muted" style={{ fontSize: 12 }}>{floorLabel(s.floor)}</span>
                          </span>
                        </td>
                        <td className="num">{s.capacity}</td>
                        <td className="num muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{durations(s)}</td>
                        <td><span style={{ fontSize: 13, color: devColor, whiteSpace: 'nowrap' }}>{devLabel}</span></td>
                        <td>
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {status(s)}
                            {booking(s.current_reservation) && <span className="muted" style={{ fontSize: 12 }}>{booking(s.current_reservation)}</span>}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!rows.length && <p className="muted" style={{ margin: 0, padding: '28px 20px', textAlign: 'center' }}>Aucun espace ne correspond à « {q.trim()} ».</p>}
          </section>

          <aside className="card fade" key={cur.id} aria-labelledby="sp-h" style={{ overflow: 'hidden', position: 'sticky', top: 20 }}>
            <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="lbl">{SPACE_TYPES[cur.type]}</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <h2 id="sp-h" style={{ fontSize: 18 }}>{cur.name}</h2>
                <Button style={{ height: 30 }} onClick={() => setForm(cur)} aria-label={`Modifier ${cur.name}`}>Modifier</Button>
              </div>
              <span style={{ marginTop: 4 }}>{status(cur)}</span>
            </div>
            <div role="tablist" aria-label="Fiche" style={{ display: 'flex', gap: 18, padding: '0 20px', marginTop: 14, borderBottom: '1px solid #E4E8EE' }}>
              {[['details', 'Détails'], ['history', 'Historique']].map(([k, label]) => (
                <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="sp-panel"
                  onClick={() => setTab(k)} style={tabStyle(tab === k)}>{label}</button>
              ))}
            </div>
            <div role="tabpanel" id="sp-panel" aria-labelledby={`tab-${tab}`}>
              {tab === 'details' ? (
                <dl className="fade" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 110px) minmax(0, 1fr)', gap: '10px 12px', margin: 0, padding: '16px 20px 20px', fontSize: 13 }}>
                  <dt className="muted">Description</dt><dd style={{ margin: 0 }}>{cur.description || 'Aucune'}</dd>
                  <dt className="muted">Étage</dt><dd style={{ margin: 0 }}>{floorLabel(cur.floor)}</dd>
                  <dt className="muted">Capacité</dt><dd className="num" style={{ margin: 0 }}>{cur.capacity}</dd>
                  <dt className="muted">Équipements</dt><dd style={{ margin: 0 }}>{cur.equipment?.join(', ') || 'Aucun'}</dd>
                  <dt className="muted">Durées</dt><dd className="num" style={{ margin: 0 }}>{durations(cur)}</dd>
                  <dt className="muted">Boîtier</dt>
                  <dd className="num" style={{ margin: 0, overflowWrap: 'anywhere' }}>{deviceOf[cur.id] ? `${deviceOf[cur.id].id} · ${deviceText(deviceOf[cur.id])[0]}` : 'Aucun'}</dd>
                  {booking(cur.current_reservation) && <><dt className="muted">En cours</dt><dd style={{ margin: 0 }}>{booking(cur.current_reservation)}</dd></>}
                </dl>
              ) : <History key={cur.id} space={cur} />}
            </div>
          </aside>
        </div>
      )}
      {drawer}
    </>
  )
}

const KIND = { no_show: 'Absence au début du créneau', early_departure: 'Départ anticipé' }
const OUTCOME = {
  pending: 'en cours',
  presence_detected: 'présence détectée, réservation conservée',
  released: 'réservation libérée',
  release_blocked: 'libération bloquée, présence à vérifier',
  cancelled: 'réservation annulée',
}

function reservationStatus(r, now) {
  if (r.status === 'cancelled') return 'Annulée'
  if (r.status === 'released') return `Libérée à ${fmtTime(r.released_at)}`
  return Date.parse(r.end_at) <= now ? 'Terminée' : Date.parse(r.start_at) <= now ? 'En cours' : 'À venir'
}

// Positioned colored spans over [lo, hi[ on a grey track.
function Band({ items, lo, hi }) {
  return (
    <div style={{ position: 'relative', height: 14, borderRadius: 4, background: '#F1F3F6', overflow: 'hidden' }}>
      {items.filter(([a, b]) => b > lo && a < hi).map(([a, b, color], i) => (
        <span key={i} style={{ position: 'absolute', top: 0, bottom: 0, background: color, left: `${((Math.max(a, lo) - lo) / (hi - lo)) * 100}%`, width: `${((Math.min(b, hi) - Math.max(a, lo)) / (hi - lo)) * 100}%` }} />
      ))}
    </div>
  )
}

const Swatch = ({ color, children }) => (
  <span className="st" style={{ fontSize: 12, color: '#5B6676' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />{children}</span>
)

// Historique tab: one Paris day of GET /spaces/{id}/history, as a timeline and a list.
function History({ space }) {
  const [date, setDate] = useState(() => toParis(new Date()).date)
  const next = new Date(Date.parse(date) + 864e5).toISOString().slice(0, 10)
  const fetchDay = useCallback(async () => {
    const q = new URLSearchParams({ from: fromParis(date, '00:00').toISOString(), to: fromParis(next, '00:00').toISOString() })
    return { date, ...(await api.get(`/spaces/${space.id}/history?${q}`)) }
  }, [space.id, date, next])
  // ponytail: a day of 10 s observations is heavy, hence 60 s; add a summary endpoint if it hurts.
  const { data, error } = usePolling(fetchDay, 60000)

  let body
  if (error && data?.date !== date) body = <p className="muted" style={{ margin: 0, fontSize: 13 }}>{errorText(error)}</p>
  else if (data?.date !== date) body = <Loader label="Chargement de l’historique" />
  else {
    const now = Date.now()
    const day0 = +fromParis(date, '00:00')
    const day1 = +fromParis(next, '00:00')
    const reservations = [...(data.reservations ?? [])].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    const episodes = data.episodes ?? []
    const booked = reservations.filter((r) => r.status !== 'cancelled').map((r) => [Date.parse(r.start_at), Date.parse(r.released_at ?? r.end_at), '#9DB8EE'])
    const absent = episodes.map((e) => [Date.parse(e.opened_at), Date.parse(e.closed_at ?? e.deadline_at), '#F2C59A'])
    const present = presenceSpans(data.observations ?? []).map(([a, b]) => [a, b, '#1E56D6'])
    const all = [...booked, ...absent, ...present]
    // Working hours by default, widened to whole hours around the day's events.
    const lo = Math.max(day0, Math.min(day0 + 8 * H, ...all.map(([a]) => Math.floor(a / H) * H)))
    const hi = Math.min(day1, Math.max(day0 + 19 * H, ...all.map(([, b]) => Math.ceil(b / H) * H)))
    const label = (t) => (t >= day1 ? '24:00' : fmtTime(t))

    body = (
      <>
        <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Band items={[...booked, ...absent]} lo={lo} hi={hi} />
          <Band items={present} lo={lo} hi={hi} />
          <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8A94A3' }}>
            <span>{label(lo)}</span><span>{label((lo + hi) / 2)}</span><span>{label(hi)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          <Swatch color="#9DB8EE">Réservée</Swatch><Swatch color="#F2C59A">Épisode d’absence</Swatch><Swatch color="#1E56D6">Présence détectée</Swatch>
        </div>
        {!reservations.length && (
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.45 }}>
            {present.length ? 'Aucune réservation ce jour-là ; la présence détectée apparaît sur la frise.' : 'Aucun événement ce jour-là. Les présences, réservations et épisodes d’absence apparaîtront ici.'}
          </p>
        )}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reservations.map((r) => (
            <li key={r.id} style={{ display: 'flex', gap: 10 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flex: 'none', background: r.status === 'cancelled' ? '#C9D0DA' : r.status === 'released' ? '#D9771F' : '#1E56D6' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{r.booker_name ? `Réservation de ${r.booker_name}` : 'Réservation'}</span>
                  <span className="num muted" style={{ fontSize: 12 }}>{fmtTime(r.start_at)} à {fmtTime(r.end_at)}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#3A4555' }}>{reservationStatus(r, now)}</span>
                {episodes.filter((e) => e.reservation_id === r.id).map((e) => (
                  <span key={e.id ?? e.opened_at} className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
                    {KIND[e.kind] ?? 'Absence'} à {fmtTime(e.opened_at)} : {OUTCOME[e.outcome] ?? e.outcome}
                    {e.outcome === 'pending' && e.deadline_at && `, libération prévue à ${fmtTime(e.deadline_at)}`}.
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </>
    )
  }

  return (
    <div className="fade" style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="field"><span className="lbl">Jour</span>
        <input className="input" type="date" required value={date} max={toParis(new Date()).date}
          onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: '100%' }} />
      </label>
      {body}
    </div>
  )
}

// Create/edit drawer. f.min/max_duration_min hold the overrides sent: null follows the type's default (Paramètres).
function SpaceForm({ space, settings, onClose, onSaved }) {
  const ref = useRef(null)
  const isNew = !space.id
  const [f, setF] = useState(() => ({
    name: space.name ?? '', type: space.type, description: space.description ?? '',
    capacity: space.capacity ?? (space.type === 'individual_booth' ? 1 : 6), floor: space.floor ?? 0, equipment: space.equipment ?? [],
    min_duration_min: space.min_duration_override ?? null, max_duration_min: space.max_duration_override ?? null, is_active: space.is_active ?? true,
  }))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => ref.current.close() // fires onClose, like Escape
  const set = (patch) => { setF({ ...f, ...patch }); setErr('') }

  useEffect(() => { if (!ref.current.open) ref.current.showModal() }, [])

  const [dMin, dMax] = TYPE_KEYS[f.type].map((k) => settings[k])
  const [min, max] = [f.min_duration_min ?? dMin, f.max_duration_min ?? dMax]
  const custom = f.min_duration_min != null || f.max_duration_min != null

  async function save(e) {
    e.preventDefault()
    if (!f.name.trim()) return setErr('Donnez un nom à l’espace.')
    if (min > max) return setErr('La durée minimum doit être inférieure ou égale à la durée maximum.')
    setBusy(true)
    try {
      const body = { ...f, name: f.name.trim(), capacity: Number(f.capacity) }
      const saved = await (isNew ? api.post('/spaces', body) : api.patch(`/spaces/${space.id}`, body))
      toast(isNew ? 'Espace ajouté.' : 'Espace mis à jour.')
      onSaved(saved ?? { ...space, ...body })
    } catch (e2) {
      // The only conflict on a space is its unique name.
      setErr(e2.status === 409 ? 'Un espace porte déjà ce nom.' : errorText(e2))
      setBusy(false)
    }
  }

  const title = isNew ? 'Ajouter un espace' : 'Modifier l’espace'
  return (
    <dialog ref={ref} className="drawer drawer-wide" aria-labelledby="sf-h" onClose={onClose}>
      <form className="drawer-form" onSubmit={save}>
        <div className="drawer-h">
          <h2 id="sf-h" style={{ fontSize: 17 }}>{title}</h2>
          <button type="button" className="btn btn-g icon-btn" style={{ width: 32, height: 32 }} aria-label="Fermer" onClick={close}><Icon d={ICONS.close} /></button>
        </div>
        <div className="drawer-b">
          <label className="field"><span className="lbl">Nom</span>
            <input className="input" value={f.name} maxLength={80} placeholder="Ex. Cervin" aria-invalid={err && !f.name.trim() ? true : undefined}
              onChange={(e) => set({ name: e.target.value })} style={{ width: '100%', borderColor: err && !f.name.trim() ? '#D63F45' : undefined }} />
          </label>
          <div className="pair">
            <div className="field" role="group" aria-labelledby="sf-type">
              <span className="lbl" id="sf-type">Type</span>
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                {Object.entries(SPACE_TYPES).map(([t, label]) => (
                  <button key={t} type="button" aria-pressed={f.type === t} onClick={() => set({ type: t })}>{label}</button>
                ))}
              </div>
            </div>
            <label className="field"><span className="lbl">Capacité</span>
              <input className="input num" type="number" min={1} step={1} required value={f.capacity}
                onChange={(e) => set({ capacity: e.target.value })} style={{ width: '100%' }} />
            </label>
            <label className="field"><span className="lbl">Étage</span>
              <select className="input" value={f.floor} onChange={(e) => set({ floor: Number(e.target.value) })} style={{ width: '100%' }}>
                {[...new Set([...FLOORS, f.floor])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{floorLabel(n)}</option>)}
              </select>
            </label>
            <div className="field">
              <span className="lbl">Statut</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, height: 36 }}>
                <button type="button" role="switch" className="tog" aria-checked={f.is_active} aria-label="Espace actif"
                  style={{ background: f.is_active ? '#1E56D6' : '#C9D0DA' }} onClick={() => set({ is_active: !f.is_active })}><span /></button>
                <span style={{ fontWeight: 500 }}>{f.is_active ? 'Actif' : 'Hors service'}</span>
              </span>
            </div>
          </div>
          {!f.is_active && <span className="muted" style={{ fontSize: 12, lineHeight: 1.45, marginTop: -6 }}>Un espace hors service n’apparaît plus dans la recherche et n’accepte plus de réservation. Les réservations existantes sont conservées.</span>}
          <label className="field"><span className="lbl">Description</span>
            <textarea className="input" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })}
              style={{ width: '100%', height: 'auto', padding: '10px 12px', lineHeight: 1.5, resize: 'vertical' }} />
          </label>
          <div className="field" role="group" aria-labelledby="sf-eq">
            <span className="lbl" id="sf-eq">Équipements</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[...new Set([...EQUIPMENT, ...f.equipment])].map((e) => {
                const on = f.equipment.includes(e)
                return <button key={e} type="button" className="chip" aria-pressed={on} onClick={() => set({ equipment: on ? f.equipment.filter((x) => x !== e) : [...f.equipment, e] })}>{e}</button>
              })}
            </div>
          </div>
          <div role="group" aria-labelledby="sf-dur" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 8, background: '#F8F9FB', border: '1px solid #EEF1F5' }}>
            <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span className="lbl" id="sf-dur">Durées de réservation</span>
              <span className="muted" style={{ fontSize: 12 }}>Par défaut pour ce type : {fmtDuration(dMin)} à {fmtDuration(dMax)}</span>
            </span>
            <div className="pair">
              {[['min_duration_min', 'Minimum', min], ['max_duration_min', 'Maximum', max]].map(([key, label, v]) => (
                <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, minWidth: 64 }}>{label}</span>
                  <Stepper label={`Durée ${label.toLowerCase()}`} value={v} text={fmtDuration(v)} step={5} min={5} max={480} onChange={(x) => set({ [key]: x })} />
                </span>
              ))}
            </div>
            {custom
              ? <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => set({ min_duration_min: null, max_duration_min: null })}>Revenir aux durées du type</button>
              : <span className="muted" style={{ fontSize: 12 }}>Suit les durées du type, réglables dans Paramètres.</span>}
          </div>
          <span role="alert" style={{ fontSize: 13, color: '#B4232A' }}>{err}</span>
        </div>
        <div className="drawer-f">
          <Button onClick={close}>Annuler</Button>
          <Button variant="p" type="submit" busy={busy}>Enregistrer</Button>
        </div>
      </form>
    </dialog>
  )
}
