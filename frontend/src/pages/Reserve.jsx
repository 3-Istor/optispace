import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { errorText, floorLabel, SPACE_STATES, SPACE_TYPES } from '../messages.js'
import { useRoute } from '../router.jsx'
import { busySpans, ceilTime, fmtDuration, fmtLongDay, fmtTime, freeUntil, fromParis, nextFree, nextSlot, toParis } from '../time.js'
import { usePolling } from '../usePolling.js'
import { Button } from '../ui/Button.jsx'
import { ConfirmDialog } from '../ui/ConfirmDialog.jsx'
import { EmptyState } from '../ui/EmptyState.jsx'
import { Icon, ICONS } from '../ui/Icon.jsx'
import { Loader } from '../ui/Loader.jsx'
import { Roll, Seg, Tick } from '../ui/motion.jsx'
import { PageHeader } from '../ui/Shell.jsx'
import { StatusBadge } from '../ui/StatusBadge.jsx'
import { toast } from '../ui/Toast.jsx'

// Spec §3 type defaults as [min, max, initial] minutes, used until /spaces gives each space's
// effective min/max (employees cannot read /settings). The server still judges: 422 INVALID_SLOT.
const DURATIONS = { meeting_room: [30, 180, 60], individual_booth: [15, 60, 30] }
const CAPACITIES = [[0, 'Tous'], [4, '4+'], [8, '8+'], [12, '12+']]
const HOUR = 3600000
const SOON = 30 * 60000 // a slot starting within this shows the space's live state

// Day strip of a space: grey where it is taken (spans, in ms), blue frame on the searched slot.
// The window is 8 h to 19 h, widened to whole hours when the slot goes beyond.
function Strip({ spans, day, start, end }) {
  const from = Math.min(+fromParis(day, '08:00'), Math.floor(start / HOUR) * HOUR)
  const to = Math.max(+fromParis(day, '19:00'), Math.ceil(end / HOUR) * HOUR)
  const pct = (t) => (Math.min(to, Math.max(from, t)) - from) / (to - from) * 100
  const box = (a, b) => ({ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` })
  const shown = spans.filter(([a, b]) => b > from && a < to)
  const ticks = []
  for (let t = from; t <= to; t += HOUR) {
    const h = Number(toParis(new Date(t)).time.slice(0, 2))
    if (t === from || t === to || (h % 4 === 0 && t - from >= 2 * HOUR && to - t >= 2 * HOUR)) ticks.push([t, h])
  }
  return (
    <div className="tl">
      <div className="tl-b" role="img"
        aria-label={shown.length ? `Pris ${shown.map(([a, b]) => `de ${fmtTime(a)} à ${fmtTime(b)}`).join(', ')}` : 'Aucune réservation ce jour'}>
        {shown.map(([a, b]) => <i key={a} style={box(a, b)} />)}
        <i className="sel" style={box(start, end)} />
      </div>
      <div className="tl-x num" aria-hidden="true">
        {ticks.map(([t, h]) => <span key={t} style={t === to ? { right: 0 } : { left: `${pct(t)}%`, transform: t === from ? 'none' : undefined }}>{h} h</span>)}
      </div>
    </div>
  )
}

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
  const [pending, setPending] = useState(null) // space awaiting the booking confirmation

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
    const [all, free] = await Promise.all([api.get(`/spaces?type=${c.type}`), api.get(`/spaces/availability?${q}`)])
    const spaces = all.filter((s) => s.is_active !== false)
    // ponytail: one request per space for its day's reservations; a batch route when a company has dozens of spaces.
    const days = await Promise.all(spaces.map((s) => api.get(`/spaces/${s.id}?date=${c.date}`).catch(() => null)))
    const busy = Object.fromEntries(spaces.map((s, i) => [s.id, busySpans(days[i]?.reservations ?? [])]))
    return { spaces, freeIds: new Set(free.map((s) => s.id)), busy }
  }, [startAt, endAt, c.date, c.type, c.cap, c.floor, eqKey])
  const { data, error, refresh } = usePolling(load, 5000)

  // The type filter also hides the previous type's spaces until the new fetch lands.
  const spaces = (data?.spaces ?? []).filter((s) => s.type === c.type)
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
  const hit = (s) => s.capacity >= c.cap && (c.floor === '' || s.floor === Number(c.floor)) && c.eq.every((e) => s.equipment?.includes(e))
  const freeCount = spaces.filter((s) => hit(s) && isFree(s)).length
  // Free spaces first, then the ones taken on the slot.
  const listed = [...spaces].sort((a, b) => isFree(b) - isFree(a) || a.name.localeCompare(b.name, 'fr'))

  async function book() {
    const s = pending
    setBusyId(s.id)
    try {
      await api.post('/reservations', { space_id: s.id, start_at: startAt, end_at: endAt })
      setBooked((b) => [...b, s.id])
      toast(`${s.name} réservée de ${fmtTime(startAt)} à ${fmtTime(endAt)}. Votre présence sera détectée automatiquement.`)
    } catch (e) {
      toast(errorText(e), 'err')
    }
    setPending(null)
    setBusyId(null)
    refresh()
  }

  async function createAlert() {
    try {
      const { status } = await api.post('/alerts', {
        start_at: startAt, end_at: endAt, space_type: c.type, min_capacity: c.cap || 1,
        floor: c.floor === '' ? null : Number(c.floor), equipment: c.eq,
      }, true)
      setAlertSet(true)
      // 200: the same alert was already active.
      toast(status === 201 ? 'Alerte activée. Vous serez prévenu si un espace correspondant se libère.' : 'Cette alerte est déjà active.')
    } catch (e) {
      toast(errorText(e), 'err')
    }
  }

  let results
  if (!startAt) results = <EmptyState title="Choisissez un créneau">Indiquez une date et une heure de début.</EmptyState>
  else if (error) results = <EmptyState title="Recherche impossible">{errorText(error)}</EmptyState>
  else if (!data) results = <Loader label="Recherche des espaces libres" />
  else {
    const dayEnd = +fromParis(c.date, '00:00') + 24 * HOUR // the strips know this day only
    const soon = start - Date.now() < SOON
    results = <>
      {freeCount ? (
        <span className="muted" role="status" style={{ fontSize: 13 }}>
          {freeCount} {freeCount > 1 ? 'espaces libres' : 'espace libre'} pour {fmtDuration(c.dur)}, de {fmtTime(startAt)} à {fmtTime(endAt)}
        </span>
      ) : (
        <EmptyState
          title="Aucun espace ne correspond"
          actions={<>
            <Button variant={alertSet ? 's' : 'p'} className={alertSet ? 'btn-ok' : ''} disabled={alertSet} onClick={createAlert}>
              {alertSet ? <><span className="swing lit"><Icon d={ICONS.bell} /></span>Alerte active</> : 'M’avertir si un espace se libère'}
            </Button>
            <Button onClick={() => set({ cap: 0, floor: '', eq: [] })}>Réinitialiser les critères</Button>
          </>}
        >
          Aucun espace libre ne répond à ces critères pour ce créneau. Nous pouvons vous prévenir dès qu’un espace correspondant se libère.
        </EmptyState>
      )}
      {/* One surface for the whole list. Spaces the criteria exclude stay mounted, folded and inert. */}
      {spaces.some(hit) && (
        <div className="card rows">
          {listed.map((s) => {
            const out = !hit(s)
            const spans = data.busy[s.id] ?? []
            const title = <><b>{s.name}</b> <span className="muted">· {floorLabel(s.floor)}</span></>
            if (!isFree(s)) {
              // Taken on the slot: one line, with the next start that fits the same duration that day.
              const [min, max] = bounds(s)
              const next = fits(s) ? nextFree(spans, +start, c.dur * 60000, dayEnd) : null
              const later = next > +start
              return (
                <div className={out ? 'fold gone' : 'fold'} inert={out} key={s.id}><div className="hl hl-2">
                  <span>{title} <span className="muted">· {!fits(s) ? `durée autorisée : ${fmtDuration(min)} à ${fmtDuration(max)}`
                    : later ? <>pris sur ce créneau, libre à partir de <span className="num">{fmtTime(next)}</span></>
                      : next === null ? 'pris sur ce créneau, plus de place ce jour pour cette durée' : 'pris sur ce créneau'}</span></span>
                  {later && <Button variant="g" onClick={() => set({ time: toParis(new Date(next)).time })}>Chercher à {fmtTime(next)}</Button>}
                </div></div>
              )
            }
            const mine = booked.includes(s.id)
            const until = freeUntil(spans, +start)
            // The dot is the live state when the slot is about to start, else the slot's: free.
            const state = soon ? s.space_state : 'free'
            const live = state === 'free' ? '' : ` · ${(SPACE_STATES[state] ?? SPACE_STATES.unknown)[0].toLowerCase()} en ce moment`
            return (
              <div className={out ? 'fold gone' : 'fold'} inert={out} key={s.id}><article className="hl">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <h2 style={{ fontSize: 15, fontFamily: 'inherit', letterSpacing: 0 }}>{title}</h2>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {c.type === 'meeting_room' && <>
                      <Icon d={ICONS.people} size={15} style={{ verticalAlign: -3, marginRight: 6 }} />{s.capacity}
                      <span className="sr-only"> places</span>{s.equipment?.length > 0 && ' · '}
                    </>}
                    {s.equipment?.join(' · ')}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  {mine
                    ? <span className="st" style={{ whiteSpace: 'normal' }}>Réservée pour vous, de {fmtTime(startAt)} à {fmtTime(endAt)}</span>
                    : <StatusBadge state={state}>Libre jusqu’à {until ? fmtTime(until) : 'la fin de journée'}{live}</StatusBadge>}
                  <Strip spans={spans} day={c.date} start={+start} end={+start + c.dur * 60000} />
                </div>
                <Button variant={mine ? 's' : 'p'} className={mine ? 'btn-ok' : ''} disabled={mine} busy={busyId === s.id} style={{ minWidth: 112 }}
                  aria-label={mine ? undefined : `Réserver ${s.name}`} onClick={() => setPending(s)}>
                  {mine && <Tick />}{mine ? 'Réservée' : 'Réserver'}
                </Button>
              </article></div>
            )
          })}
        </div>
      )}
    </>
  }

  return (
    <>
      <PageHeader title="Réserver un espace">
        <Seg role="group" aria-label="Type d’espace">
          {Object.entries(SPACE_TYPES).map(([t, label]) => (
            <button key={t} type="button" aria-pressed={c.type === t}
              onClick={() => set({ type: t, dur: DURATIONS[t][2], cap: 0, floor: '', eq: [] })}>{label}</button>
          ))}
        </Seg>
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
            <Roll value={c.dur} className="num" style={{ minWidth: 64, textAlign: 'center', fontWeight: 500 }} aria-live="polite">{fmtDuration(c.dur)}</Roll>
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
            <Seg>
              {CAPACITIES.map(([n, label]) => (
                <button key={n} type="button" aria-pressed={c.cap === n} onClick={() => set({ cap: n })}>{label}</button>
              ))}
            </Seg>
          </div>
        )}
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

      <ConfirmDialog open={!!pending} title="Réserver cet espace ?" confirmLabel="Confirmer la réservation" cancelLabel="Retour"
        busy={!!busyId} onConfirm={book} onCancel={() => setPending(null)}>
        {pending && startAt && (
          <dl className="summary">
            <dt>Espace</dt><dd>{pending.name} · {floorLabel(pending.floor)}</dd>
            <dt>Jour</dt><dd>{fmtLongDay(startAt)}</dd>
            <dt>Horaire</dt><dd className="num">{fmtTime(startAt)} à {fmtTime(endAt)}</dd>
            <dt>Durée</dt><dd>{fmtDuration(c.dur)}</dd>
          </dl>
        )}
      </ConfirmDialog>
    </>
  )
}
