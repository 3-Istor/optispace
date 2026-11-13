// npm test: Europe/Paris <-> UTC conversions and 5-minute slots.
import assert from 'node:assert/strict'
import { busySpans, ceilTime, fmtDuration, fmtTime, freeUntil, fromParis, nextFree, nextSlot, presenceSpans, toParis } from './time.js'

assert.equal(fromParis('2026-11-03', '14:10').toISOString(), '2026-11-03T13:10:00.000Z') // winter, UTC+1
assert.equal(fromParis('2026-07-01', '14:10').toISOString(), '2026-07-01T12:10:00.000Z') // summer, UTC+2
assert.deepEqual(toParis(new Date('2026-11-02T23:30:00Z')), { date: '2026-11-03', time: '00:30' })
assert.equal(fmtTime('2026-11-03T13:10:00Z'), '14:10')
assert.equal(ceilTime('14:03'), '14:05')
assert.equal(ceilTime('14:05'), '14:05')
assert.equal(ceilTime('23:58'), '23:55')
assert.equal(nextSlot(new Date('2026-11-03T13:10:00Z')).toISOString(), '2026-11-03T13:10:00.000Z')
assert.equal(nextSlot(new Date('2026-11-03T13:10:01Z')).toISOString(), '2026-11-03T13:15:00.000Z')
assert.deepEqual([45, 60, 65, 90].map(fmtDuration), ['45 min', '1 h', '1 h 05', '1 h 30'])
const at = (s, presence) => ({ observed_at: `2026-11-03T10:00:${String(s).padStart(2, '0')}Z`, presence })
const t0 = Date.parse('2026-11-03T10:00:00Z')
// Unsorted input; an absent sample cuts the span; the last sample lasts 30 s.
assert.deepEqual(presenceSpans([at(20, 'absent'), at(0, 'present'), at(10, 'present'), at(50, 'present')]),
  [[t0, t0 + 20000], [t0 + 50000, t0 + 80000]])
// Day strip: 10:00-11:00, 11:00-12:00 released at 11:20, a cancelled one, 14:00-15:00 (UTC here).
const h = (hhmm) => Date.parse(`2026-11-03T${hhmm}:00Z`)
const res = (start, end, extra) => ({ start_at: new Date(h(start)).toISOString(), end_at: new Date(h(end)).toISOString(), status: 'active', released_at: null, ...extra })
const spans = busySpans([
  res('14:00', '15:00'), res('10:00', '11:00'), res('12:00', '13:00', { status: 'cancelled' }),
  res('11:00', '12:00', { status: 'released', released_at: new Date(h('11:20')).toISOString() }),
])
assert.deepEqual(spans, [[h('10:00'), h('11:20')], [h('14:00'), h('15:00')]]) // sorted, touching spans merged, release ends early
assert.equal(freeUntil(spans, h('12:00')), h('14:00'))
assert.equal(freeUntil(spans, h('15:00')), null) // nothing after: free for the rest of the day
const HOUR = 3600000
assert.equal(nextFree(spans, h('10:30'), HOUR, h('23:00')), h('11:20')) // right after the release
assert.equal(nextFree(spans, h('10:30'), 3 * HOUR, h('23:00')), h('15:00')) // the 11:20-14:00 gap is too short
assert.equal(nextFree(spans, h('13:30'), HOUR, h('23:00')), h('15:00'))
assert.equal(nextFree([[h('10:00'), h('11:22')]], h('10:30'), HOUR, h('23:00')), h('11:25')) // starts on a 5-minute boundary
assert.equal(nextFree(spans, h('14:30'), HOUR, h('15:30')), null) // would end after the known day
console.log('time.js ok')
