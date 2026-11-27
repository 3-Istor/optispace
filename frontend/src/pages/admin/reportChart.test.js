import assert from 'node:assert/strict'
import { buildChart, CHART } from './reportChart.js'

const series = (values) => values.map((number, index) => ({
  date: new Date(Date.UTC(2026, 10, index + 1)).toISOString().slice(0, 10),
  occupancy_pct: number, coverage_pct: 100,
}))
const chart = (values) => buildChart(series(values), 'occupancy_pct', 80)

const varying = chart([35, 46, 40])
assert.deepEqual([varying.lower, varying.upper], [30, 50])
assert.deepEqual(varying.ticks.map((tick) => tick.value), [30, 35, 40, 45, 50])
assert.deepEqual(varying.points.map((point) => point.value), [35, 46, 40])
assert(varying.points.every((point) => point.y >= CHART.top && point.y <= CHART.bottom))

const zero = chart([0, 0])
assert.deepEqual([zero.lower, zero.upper], [0, 10])
assert(zero.points.every((point) => Number.isFinite(point.y)))
const full = chart([100])
assert.deepEqual([full.lower, full.upper], [90, 100])
assert.equal(full.points[0].x, (CHART.left + CHART.right) / 2)

const missing = chart([35, null, 40])
assert.deepEqual(missing.segments.map((segment) => segment.length), [1, 1])
const partial = series([35, 36, 40])
partial[1].coverage_pct = 79
assert.deepEqual(buildChart(partial, 'occupancy_pct', 80).segments.map((segment) => segment.length), [1, 1])

const unavailable = chart([null, -1, 101, NaN, Infinity])
assert.equal(unavailable.segments.length, 0)
assert.deepEqual([unavailable.lower, unavailable.upper], [0, 100])
assert.equal(chart([]).dateIndexes.length, 0)

const irregular = series([20, 30, 40])
irregular[2].date = '2026-11-10'
const spaced = buildChart(irregular, 'occupancy_pct', 80)
assert.equal(spaced.points[0].x, CHART.left)
assert.equal(spaced.points[2].x, CHART.right)
assert(Math.abs((spaced.points[1].x - CHART.left) / (CHART.right - CHART.left) - 1 / 9) < 1e-9)
assert.equal(chart(Array(20).fill(40)).dateIndexes.length, 5)

console.log('reportChart.js ok - scales, gaps, boundary values, single point and dates')
