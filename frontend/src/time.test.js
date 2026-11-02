// npm test: Europe/Paris <-> UTC conversions and 5-minute slots.
import assert from 'node:assert/strict'
import { ceilTime, fmtDuration, fmtTime, fromParis, nextSlot, toParis } from './time.js'

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
console.log('time.js ok')
