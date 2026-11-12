import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { errorText, floorLabel, NOTIFICATIONS, SPACE_TYPES } from '../messages.js'
import { dayLabel, fmtLongDay, fmtTime, fromParis, toParis } from '../time.js'
import { usePolling } from '../usePolling.js'
import { Button } from '../ui/Button.jsx'
import { ConfirmDialog } from '../ui/ConfirmDialog.jsx'
import { EmptyState } from '../ui/EmptyState.jsx'
import { Icon, ICONS } from '../ui/Icon.jsx'
import { Loader } from '../ui/Loader.jsx'
import { EXIT_MS } from '../ui/motion.jsx'
import { PageHeader } from '../ui/Shell.jsx'
import { StatusBadge } from '../ui/StatusBadge.jsx'
import { toast } from '../ui/Toast.jsx'

const PAST_DAYS = 7
const PAST_SHOWN = 10

async function load() {
  const from = new Date(Date.now() - PAST_DAYS * 864e5).toISOString()
  const [reservations, spaces, alerts] = await Promise.all([
    api.get(`/reservations/mine?from=${encodeURIComponent(from)}`),
    api.get('/spaces'),
    api.get('/alerts/mine'),
  ])
  return { reservations, spaces: Object.fromEntries(spaces.map((s) => [s.id, s])), alerts }
}

// Section of a reservation; released_at ends it early (effective_end, spec §4.1).
function section(r, now) {
  if (r.status !== 'active' || Date.parse(r.released_at ?? r.end_at) <= now) return 'past'
  return Date.parse(r.start_at) <= now ? 'now' : 'next'
}

const Dot = ({ color, children }) => <span className="st"><span className="dot" style={{ background: color }} />{children}</span>

function status(r, kind, space) {
  if (kind === 'now') return <StatusBadge state={space?.space_state} />
  if (kind === 'next') return <Dot color="#1E56D6">À venir</Dot>
  if (r.status === 'cancelled') return <Dot color="#8A94A3">Annulée</Dot>
  if (r.status === 'released') return <Dot color="#8A94A3">Libérée à {fmtTime(r.released_at)}</Dot>
  return <Dot color="#1A8F4E">Terminée</Dot>
}

export function MyReservations({ me }) {
  const { data, error, refresh } = usePolling(load, 5000)
  const [edit, setEdit] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [cancelling, setCancelling] = useState(null) // reservation awaiting the cancel confirmation
  const [goneId, setGoneId] = useState(null) // row folding away until the reloaded list arrives
  useEffect(() => setGoneId(null), [data])

  if (!data) return error ? <EmptyState title="Chargement impossible">{errorText(error)}</EmptyState> : <Loader label="Chargement de vos réservations" />

  const spaceName = (r) => data.spaces[r.space_id]?.name ?? r.space_name ?? 'Espace'
  const spaceLabel = (r) => {
    const s = data.spaces[r.space_id]
    return s ? `${s.name} · ${floorLabel(s.floor)}` : spaceName(r)
  }

  const now = Date.now()
  const groups = { now: [], next: [], past: [] }
  for (const r of data.reservations) groups[section(r, now)].push(r)
  const byStart = (a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)
  groups.now.sort(byStart)
  groups.next.sort(byStart)
  groups.past = groups.past.sort((a, b) => byStart(b, a)).slice(0, PAST_SHOWN)
  const alerts = data.alerts.filter((a) => a.status === 'active' && Date.parse(a.end_at) > now)

  async function run(id, call, done) {
    setBusyId(id)
    try {
      await call()
      toast(done)
      setGoneId(id)
      await new Promise((r) => setTimeout(r, EXIT_MS))
    } catch (e) {
      toast(errorText(e), 'err')
    }
    setBusyId(null)
    refresh()
  }

  const card = (r, kind) => {
    // Pending absence deadline: on the reservation if the API adds it, else on its space's current_reservation.
    const current = data.spaces[r.space_id]?.current_reservation
    const releaseAt = r.release_at ?? (current?.id === r.id ? current.release_at : null)
    const banner = kind === 'now' && releaseAt && NOTIFICATIONS.ABSENCE_WARNING.text({ space_name: spaceName(r), at: releaseAt })
    return (
      <div key={r.id} className={goneId === r.id ? 'fold gone' : 'fold'}><article className="card" style={{ overflow: 'hidden', borderColor: banner ? '#F2D3B0' : undefined, background: kind === 'past' ? '#FBFBFC' : undefined }}>
        {banner && (
          <div className="banner" role="status">
            <Icon d={ICONS.warn} style={{ color: '#D9771F', flex: 'none' }} />
            <span style={{ flex: 1 }}>{banner}</span>
          </div>
        )}
        <div className="item">
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 64 }}>
            <span className="muted" style={{ fontSize: 11 }}>{dayLabel(r.start_at)}</span>
            <span className="num" style={{ fontFamily: "'Sora', sans-serif", fontSize: 17 }}>{fmtTime(r.start_at)}</span>
          </div>
          <div className="item-main">
            <span style={{ fontWeight: 500 }}>{spaceLabel(r)}</span>
            <span className="muted num" style={{ fontSize: 13 }}>{fmtTime(r.start_at)} à {fmtTime(r.end_at)}</span>
          </div>
          {status(r, kind, data.spaces[r.space_id])}
          {kind !== 'past' && (
            <span style={{ display: 'flex', gap: 6 }}>
              <Button onClick={() => setEdit(r)} aria-label={`Modifier la réservation de ${spaceName(r)}`}>Modifier</Button>
              <Button variant="g" busy={busyId === r.id} aria-label={`Annuler la réservation de ${spaceName(r)}`}
                onClick={() => setCancelling(r)}>Annuler</Button>
            </span>
          )}
        </div>
      </article></div>
    )
  }

  return (
    <>
      <PageHeader title="Mes réservations" />
      <div className="cols-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="stack" aria-labelledby="now-h">
            <h2 id="now-h" style={{ fontSize: 14 }}>En cours</h2>
            {groups.now.map((r) => card(r, 'now'))}
            {!groups.now.length && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Aucune réservation en cours.</p>}
          </section>
          <section className="stack" aria-labelledby="next-h">
            <h2 id="next-h" style={{ fontSize: 14 }}>À venir</h2>
            {groups.next.map((r) => card(r, 'next'))}
            {!groups.next.length && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Aucune réservation à venir.</p>}
          </section>
          {groups.past.length > 0 && (
            <section className="stack" aria-labelledby="past-h">
              <h2 id="past-h" style={{ fontSize: 14 }}>Passées</h2>
              {groups.past.map((r) => card(r, 'past'))}
            </section>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="card side-card" aria-labelledby="alerts-h">
            <h2 id="alerts-h">Mes alertes</h2>
            {alerts.map((a) => {
              const where = [a.floor != null && floorLabel(a.floor), a.equipment?.join(', ')].filter(Boolean).join(' · ')
              return (
                <div className={goneId === a.id ? 'line gone' : 'line'} key={a.id}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 500 }}>{SPACE_TYPES[a.space_type]}{a.min_capacity > 1 && ` · ${a.min_capacity} places ou plus`}</span>
                    <span className="muted num" style={{ fontSize: 12 }}>{fmtLongDay(a.start_at)}, {fmtTime(a.start_at)} à {fmtTime(a.end_at)}</span>
                    {where && <span className="muted" style={{ fontSize: 12 }}>{where}</span>}
                  </span>
                  <Button variant="g" busy={busyId === a.id} aria-label="Annuler l’alerte"
                    onClick={() => run(a.id, () => api.del(`/alerts/${a.id}`), 'Alerte annulée.')}>Annuler</Button>
                </div>
              )
            })}
            {!alerts.length && (
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5 }}>
                Aucune alerte active. Vous pouvez en créer une depuis la recherche quand aucun espace ne correspond.
              </p>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog open={!!cancelling} title="Annuler cette réservation ?" confirmLabel="Annuler la réservation" cancelLabel="Garder" danger
        busy={!!cancelling && busyId === cancelling.id} onCancel={() => setCancelling(null)}
        onConfirm={() => run(cancelling.id, () => api.del(`/reservations/${cancelling.id}`), `Réservation de ${spaceName(cancelling)} annulée.`)
          .then(() => setCancelling(null))}>
        {cancelling && `${spaceLabel(cancelling)}, ${fmtLongDay(cancelling.start_at).toLowerCase()}, ${fmtTime(cancelling.start_at)} à ${fmtTime(cancelling.end_at)}.`}
      </ConfirmDialog>

      {edit && (
        <EditReservation reservation={edit} spaces={Object.values(data.spaces)} name={spaceLabel(edit)}
          onClose={() => setTimeout(() => setEdit(null), EXIT_MS)} onSaved={() => { setEdit(null); refresh() }} />
      )}
    </>
  )
}

// Drawer of EmployeProfil.dc.html. Once started, only the end can change (spec §4.1).
function EditReservation({ reservation: r, spaces, name, onClose, onSaved }) {
  const ref = useRef(null)
  const started = Date.parse(r.start_at) <= Date.now()
  const [f, setF] = useState(() => ({
    space_id: r.space_id, date: toParis(new Date(r.start_at)).date,
    start: toParis(new Date(r.start_at)).time, end: toParis(new Date(r.end_at)).time,
  }))
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const close = () => ref.current.close() // fires onClose, like Escape

  useEffect(() => { if (!ref.current.open) ref.current.showModal() }, [])

  // [start, end] of the form; the submit only opens the confirmation, whose Enregistrer calls save().
  const slot = () => {
    const start = fromParis(f.date, f.start)
    const end = fromParis(f.date, f.end)
    return [start, end <= start ? new Date(+end + 864e5) : end] // ends after midnight
  }

  async function save() {
    const [start, end] = slot()
    setBusy(true)
    try {
      await api.patch(`/reservations/${r.id}`, started
        ? { end_at: end.toISOString() }
        : { space_id: f.space_id, start_at: start.toISOString(), end_at: end.toISOString() })
      toast('Réservation mise à jour.')
      onSaved()
    } catch (err) {
      toast(errorText(err), 'err')
      setBusy(false)
      setConfirming(false)
    }
  }

  const field = (key) => ({ value: f[key], onChange: (e) => setF({ ...f, [key]: e.target.value }) })
  const summary = () => {
    const s = spaces.find((x) => x.id === f.space_id)
    const [start, end] = slot()
    return `${s ? `${s.name} · ${floorLabel(s.floor)}` : name}, ${fmtLongDay(start).toLowerCase()}, ${fmtTime(start)} à ${fmtTime(end)}.`
  }
  return (
    <dialog ref={ref} className="drawer" aria-labelledby="edit-h" onClose={onClose}>
      <form className="drawer-form" onSubmit={(e) => { e.preventDefault(); setConfirming(true) }}>
        <div className="drawer-h">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h2 id="edit-h" style={{ fontSize: 17 }}>Modifier la réservation</h2>
            <span className="muted" style={{ fontSize: 13 }}>{name} · {fmtTime(r.start_at)} à {fmtTime(r.end_at)}</span>
          </div>
          <button type="button" className="btn btn-g icon-btn" style={{ width: 32, height: 32 }} aria-label="Fermer" onClick={close}><Icon d={ICONS.close} /></button>
        </div>
        <div className="drawer-b">
          {started && <div className="note">La réservation a commencé : seule l’heure de fin peut encore changer.</div>}
          <label className="field"><span className="lbl">Espace</span>
            <select className="input" disabled={started} style={{ width: '100%' }} {...field('space_id')}>
              {!spaces.some((s) => s.id === r.space_id) && <option value={r.space_id}>{name}</option>}
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.name} · {floorLabel(s.floor)}</option>)}
            </select>
          </label>
          {!started && (
            <label className="field"><span className="lbl">Date</span>
              <input className="input" type="date" required style={{ width: '100%' }} {...field('date')} />
            </label>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <label className="field"><span className="lbl">Début</span>
              <input className="input num" type="time" step="300" required disabled={started} style={{ width: '100%' }} {...field('start')} />
            </label>
            <label className="field"><span className="lbl">Fin</span>
              <input className="input num" type="time" step="300" required style={{ width: '100%' }} {...field('end')} />
            </label>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>Créneaux par pas de 5 minutes, dans les durées autorisées pour cet espace.</span>
        </div>
        <div className="drawer-f">
          <Button onClick={close}>Annuler</Button>
          <Button variant="p" type="submit" busy={busy}>Enregistrer</Button>
        </div>
      </form>
      <ConfirmDialog open={confirming} title="Enregistrer les modifications ?" confirmLabel="Enregistrer" cancelLabel="Retour"
        busy={busy} onConfirm={save} onCancel={() => setConfirming(false)}>
        {confirming && summary()}
      </ConfirmDialog>
    </dialog>
  )
}
