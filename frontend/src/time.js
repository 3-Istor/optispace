// The API speaks UTC ISO strings; the UI shows and reads Europe/Paris wall-clock time.
const TZ = 'Europe/Paris'
const SLOT_MS = 5 * 60 * 1000

const hm = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const longDay = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
const shortDay = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
})

export const fmtTime = (iso) => hm.format(new Date(iso)) // "14:10"
export const fmtLongDay = (iso) => longDay.format(new Date(iso)).replace(/^./, (c) => c.toUpperCase()) // "Mardi 3 novembre"

// "1 h", "1 h 30", "45 min"
export function fmtDuration(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${m} min`
}

// Paris date ("2026-11-03") and time ("14:10") of an instant, for <input type="date|time">.
export function toParis(date) {
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

// Instant of a Paris date and time.
// ponytail: offset taken at the naive instant, so times inside the DST switch hour may shift by 1 h.
export function fromParis(date, time) {
  const naive = new Date(`${date}T${time}:00Z`)
  const p = toParis(naive)
  return new Date(naive - (new Date(`${p.date}T${p.time}:00Z`) - naive))
}

// Next 5-minute boundary at or after d (Paris offsets are whole hours, so UTC alignment holds).
export const nextSlot = (d = new Date()) => new Date(Math.ceil(d / SLOT_MS) * SLOT_MS)

// "14:03" -> "14:05"
export function ceilTime(time) {
  const [h, m] = time.split(':').map(Number)
  const t = Math.min(Math.ceil((h * 60 + m) / 5) * 5, 23 * 60 + 55)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

// "AUJ.", "HIER", "DEMAIN", else "JEU. 5 NOV."
export function dayLabel(iso) {
  const days = (Date.parse(toParis(new Date(iso)).date) - Date.parse(toParis(new Date()).date)) / 864e5
  return { 0: 'AUJ.', '-1': 'HIER', 1: 'DEMAIN' }[days] ?? shortDay.format(new Date(iso)).toUpperCase()
}

// "il y a 4 s", "il y a 3 min", "à 09:12", "hier à 09:12", "jeu. 5 nov. à 09:12"
export function fmtAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return `il y a ${s} s`
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  const day = dayLabel(iso)
  return `${day === 'AUJ.' ? '' : `${day.toLowerCase()} `}à ${fmtTime(iso)}`
}

// Observations ({observed_at, presence}) -> merged [startMs, endMs] spans of presence.
// A sample counts until the next one, at most 30 s (staleness rule, spec §3).
export function presenceSpans(observations) {
  const obs = observations.map((o) => [Date.parse(o.observed_at), o.presence]).sort((a, b) => a[0] - b[0])
  const spans = []
  obs.forEach(([t, presence], i) => {
    if (presence !== 'present') return
    const end = Math.min(t + 30000, obs[i + 1]?.[0] ?? Infinity)
    const last = spans[spans.length - 1]
    if (last && last[1] >= t) last[1] = Math.max(last[1], end)
    else spans.push([t, end])
  })
  return spans
}

// Reservations of a space's day ({start_at, end_at, status, released_at}) -> merged, sorted [startMs, endMs]
// spans when it is taken. Cancelled ones do not count and released_at ends one early, as the booking rules do.
export function busySpans(reservations) {
  const spans = []
  reservations.filter((r) => r.status !== 'cancelled')
    .map((r) => [Date.parse(r.start_at), Date.parse(r.released_at ?? r.end_at)]).sort((a, b) => a[0] - b[0])
    .forEach(([start, end]) => {
      const last = spans[spans.length - 1]
      if (last && last[1] >= start) last[1] = Math.max(last[1], end)
      else spans.push([start, end])
    })
  return spans
}

// When the free time holding `from` ends: the start of the next span, null when nothing follows that day.
export const freeUntil = (spans, from) => spans.find(([start]) => start >= from)?.[0] ?? null

// First 5-minute start at or after `from` (a slot start) where `ms` fit without touching a span; null when
// it would end after `limit`, the end of the day the spans describe.
export function nextFree(spans, from, ms, limit) {
  let t = from
  for (const [start, end] of spans) {
    if (end <= t) continue
    if (start >= t + ms) break
    t = Math.ceil(end / SLOT_MS) * SLOT_MS
  }
  return t + ms <= limit ? t : null
}
