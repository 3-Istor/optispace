import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { errorText, floorLabel, SPACE_TYPES } from '../messages.js'
import { useRoute } from '../router.jsx'
import { ceilTime, fmtDuration, fmtTime, fromParis, nextSlot, toParis } from '../time.js'
import { usePolling } from '../usePolling.js'
import { Button } from '../ui/Button.jsx'
import { EmptyState } from '../ui/EmptyState.jsx'
import { Loader } from '../ui/Loader.jsx'
import { PageHeader } from '../ui/Shell.jsx'
import { StatusBadge } from '../ui/StatusBadge.jsx'
import { toast } from '../ui/Toast.jsx'

// Spec §3 type defaults as [min, max, initial] minutes, used until /spaces gives each space's
// effective min/max (employees cannot read /settings). The server still judges: 422 INVALID_SLOT.
const DURATIONS = { meeting_room: [30, 180, 60], individual_booth: [15, 60, 30] }
const ABSENCE_DELAY_MIN = 10
const CAPACITIES = [[0, 'Tous'], [4, '4+'], [8, '8+'], [12, '12+']]

// A SPACE_AVAILABLE notification links here with type, start_at and end_at.
function initialCriteria(query) {
  const type = SPACE_TYPES[query.get('type')] ? query.get('type') : 'meeting_room'
  const [lo, hi, dflt] = DURATIONS[type]
  const from = new Date(query.get('start_at'))
  const start = from > nextSlot() ? nextSlot(from) : nextSlot()
  const asked = Math.round((new Date(query.get('end_at')) - start) / 300000) * 5
  const { date, time } = toParis(start)
  return { type, date, time, dur: asked > 0 ? Math.min(hi, Math.max(lo, asked)) : dflt, cap: 0, floor: '', eq: [] }
}

export function Reserve() {
  const { query } = useRoute()
  const [c, setC] = useState(() => initialCriteria(query))
  const [booked, setBooked] = useState([]) // ids booked here for the current criteria
  const [alertSet, setAlertSet] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const set = (patch) => {
    setC((prev) => ({ ...prev, ...patch }))
    setBooked([])
    setAlertSet(false)
  }

  const start = c.date && c.time ? fromParis(c.date, ceilTime(c.time)) : new Date(NaN)
  const startAt = isNaN(start) ? null : start.toISOString()
  const endAt = startAt && new Date(+start + c.dur * 60000).toISOString()
  const eqKey = c.eq.join('|')

  const load = useCallback(async () => {
    if (!startAt) return null
    const q = new URLSearchParams({ start_at: startAt, end_at: endAt, type: c.type })
    if (c.cap) q.set('min_capacity', c.cap)
    if (c.floor !== '') q.set('floor', c.floor)
    c.eq.forEach((e) => q.append('equipment', e))
    // /spaces gives every space with its live state; /availability says which are free on the slot.
    const [spaces, free] = await Promise.all([api.get(`/spaces?type=${c.type}`), api.get(`/spaces/availability?${q}`)])
    return { spaces, freeIds: new Set(free.map((s) => s.id)) }
  }, [startAt, endAt, c.type, c.cap, c.floor, eqKey])
  const { data, error, refresh } = usePolling(load, 5000)

  // The type filter also hides the previous type's spaces until the new fetch lands.
  const spaces = (data?.spaces ?? []).filter((s) => s.is_active !== false && s.type === c.type)
  const floors = [...new Set(spaces.map((s) => s.floor))].sort((a, b) => a - b)
  const equipment = [...new Set(spaces.flatMap((s) => s.equipment ?? []))].sort()
  const bounds = (s) => [s.min_duration_min ?? DURATIONS[c.type][0], s.max_duration_min ?? DURATIONS[c.type][1]]
  // Stepper range: widest effective bounds among the type's spaces (spec defaults before they load).
  const ranges = spaces.length ? spaces.map(bounds) : [DURATIONS[c.type]]
  const lo = Math.min(...ranges.map((r) => r[0]))
  const hi = Math.max(...ranges.map((r) => r[1]))
  useEffect(() => {
    if (c.dur < lo || c.dur > hi) setC((p) => ({ ...p, dur: Math.min(hi, Math.max(lo, p.dur)) }))
  }, [c.dur, lo, hi])
  const fits = (s) => c.dur >= bounds(s)[0] && c.dur <= bounds(s)[1]
  const isFree = (s) => booked.includes(s.id) || (data?.freeIds.has(s.id) && fits(s))
  const shown = spaces
    .filter((s) => s.capacity >= c.cap && (c.floor === '' || s.floor === Number(c.floor)) && c.eq.every((e) => s.equipment?.includes(e)))
    .sort((a, b) => isFree(b) - isFree(a) || a.name.localeCompare(b.name, 'fr'))
  const freeCount = shown.filter(isFree).length

  async function book(s) {
    setBusyId(s.id)
    try {
      await api.post('/reservations', { space_id: s.id, start_at: startAt, end_at: endAt })
      setBooked((b) => [...b, s.id])
      toast(`${s.name} réservée de ${fmtTime(startAt)} à ${fmtTime(endAt)}. Votre présence sera détectée automatiquement.`)
    } catch (e) {
      toast(errorText(e), 'err')
    }
    setBusyId(null)
    refresh()
  }

  async function createAlert() {
    try {
      await api.post('/alerts', { start_at: startAt, end_at: endAt, space_type: c.type, min_capacity: c.cap || 1 })
      setAlertSet(true)
      toast('Alerte créée. Nous vous préviendrons dès qu’un espace correspondant se libère.')
    } catch (e) {
      toast(errorText(e), 'err')
    }
  }

  let results
  if (!startAt) results = <EmptyState title="Choisissez un créneau">Indiquez une date et une heure de début.</EmptyState>
  else if (error) results = <EmptyState title="Recherche impossible">{errorText(error)}</EmptyState>
  else if (!data) results = <Loader label="Recherche des espaces libres" />
  else if (!freeCount) {
    results = (
      <EmptyState
        title="Aucun espace ne correspond"
        actions={<>
          <Button variant="p" disabled={alertSet} onClick={createAlert}>{alertSet ? 'Alerte active' : 'M’avertir si un espace se libère'}</Button>
          <Button onClick={() => set({ cap: 0, floor: '', eq: [] })}>Réinitialiser les critères</Button>
        </>}
      >
        Aucun espace libre ne répond à ces critères pour ce créneau. Nous pouvons vous prévenir dès qu’un espace correspondant se libère.
      </EmptyState>
    )
  } else {
    results = <>
      <span className="muted" role="status" style={{ fontSize: 13 }}>
        {freeCount} {freeCount > 1 ? 'espaces libres' : 'espace libre'} pour {fmtDuration(c.dur)}, de {fmtTime(startAt)} à {fmtTime(endAt)}
      </span>
      {shown.map((s) => {
        const mine = booked.includes(s.id)
        const bookable = !mine && isFree(s)
        const [min, max] = bounds(s)
        return (
          <article className="card item" key={s.id}>
            <div className="item-main">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <h2 style={{ fontSize: 15 }}>{s.name}</h2>
                <span className="muted" style={{ fontSize: 12 }}>{floorLabel(s.floor)}</span>
              </div>
              <span className="muted" style={{ fontSize: 13 }}>
                {[c.type === 'meeting_room' && `${s.capacity} places`, s.equipment?.join(', ')].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 300px' }}>
              <StatusBadge state={s.space_state} releaseAt={s.current_reservation?.release_at} />
              {!mine && !bookable && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {fits(s) ? 'Déjà réservé sur ce créneau' : `Durée autorisée : ${fmtDuration(min)} à ${fmtDuration(max)}`}
                </span>
              )}
            </div>
            <Button variant={bookable ? 'p' : 's'} disabled={!bookable} busy={busyId === s.id} style={{ minWidth: 112 }}
              aria-label={bookable ? `Réserver ${s.name}` : undefined} onClick={() => book(s)}>
              {mine ? 'Réservée' : bookable ? 'Réserver' : 'Indisponible'}
            </Button>
          </article>
        )
      })}
    </>
  }

  return (
    <>
      <PageHeader title="Réserver un espace">
        <div className="seg" role="group" aria-label="Type d’espace">
          {Object.entries(SPACE_TYPES).map(([t, label]) => (
            <button key={t} type="button" aria-pressed={c.type === t}
              onClick={() => set({ type: t, dur: DURATIONS[t][2], cap: 0, floor: '', eq: [] })}>{label}</button>
          ))}
        </div>
      </PageHeader>

      <section className="card" aria-label="Critères" style={{ padding: '16px 18px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 18 }}>
        <label className="field"><span className="lbl">Date</span>
          <input className="input" type="date" required min={toParis(new Date()).date} value={c.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label className="field"><span className="lbl">Début</span>
          <input className="input num" type="time" required step="300" value={c.time}
            onChange={(e) => set({ time: e.target.value })} onBlur={() => c.time && ceilTime(c.time) !== c.time && set({ time: ceilTime(c.time) })} />
        </label>
        <div className="field" role="group" aria-labelledby="dur-l">
          <span className="lbl" id="dur-l">Durée</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36 }}>
            <button type="button" className="step" aria-label="Réduire la durée" disabled={c.dur <= lo} onClick={() => set({ dur: c.dur - 5 })}>−</button>
            <span className="num" style={{ minWidth: 64, textAlign: 'center', fontWeight: 500 }} aria-live="polite">{fmtDuration(c.dur)}</span>
            <button type="button" className="step" aria-label="Allonger la durée" disabled={c.dur >= hi} onClick={() => set({ dur: c.dur + 5 })}>+</button>
          </span>
        </div>
        <label className="field"><span className="lbl">Étage</span>
          <select className="input" value={c.floor} onChange={(e) => set({ floor: e.target.value })}>
            <option value="">Tous les étages</option>
            {floors.map((f) => <option key={f} value={f}>{floorLabel(f)}</option>)}
          </select>
        </label>
        {c.type === 'meeting_room' && (
          <div className="field" role="group" aria-labelledby="cap-l">
            <span className="lbl" id="cap-l">Participants</span>
            <div className="seg">
              {CAPACITIES.map(([n, label]) => (
                <button key={n} type="button" aria-pressed={c.cap === n} onClick={() => set({ cap: n })}>{label}</button>
              ))}
            </div>
          </div>
        )}
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto', maxWidth: 230, lineHeight: 1.45 }}>
          {c.type === 'meeting_room' ? 'Salles de réunion' : 'Bulles individuelles'} : de {fmtDuration(lo)} à {fmtDuration(hi)}, par pas de 5 min.
          Sans présence détectée, la réservation est libérée au bout de {ABSENCE_DELAY_MIN} min.
        </span>
        {equipment.length > 0 && (
          <div role="group" aria-labelledby="eq-l" style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 12, borderTop: '1px solid #EEF1F5' }}>
            <span className="lbl" id="eq-l" style={{ alignSelf: 'center', marginRight: 6 }}>Équipements</span>
            {equipment.map((e) => (
              <button key={e} type="button" className="chip" aria-pressed={c.eq.includes(e)}
                onClick={() => set({ eq: c.eq.includes(e) ? c.eq.filter((x) => x !== e) : [...c.eq, e] })}>{e}</button>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Résultats" className="stack">{results}</section>
    </>
  )
}
