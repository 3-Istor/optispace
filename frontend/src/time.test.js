// npm test: Europe/Paris <-> UTC conversions and 5-minute slots.
import assert from 'node:assert/strict'
import { ceilTime, fmtDuration, fmtTime, fromParis, nextSlot, presenceSpans, toParis } from './time.js'

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
console.log('time.js ok')
