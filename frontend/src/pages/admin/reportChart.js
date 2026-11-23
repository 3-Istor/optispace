export const CHART = { width: 800, height: 240, left: 60, right: 750, top: 24, bottom: 184 }

// Each series has an explicitly labelled scale. Missing observations interrupt the line.
export function buildChart(trend, field, coverageMin) {
  const values = trend.map((point) => {
    const number = point[field]
    return Number.isFinite(number) && number >= 0 && number <= 100 && point.coverage_pct >= coverageMin ? number : null
  })
  const observed = values.filter((number) => number !== null)
  let lower = 0
  let upper = 100
  let step = 25
  if (observed.length) {
    const minimum = Math.min(...observed)
    const maximum = Math.max(...observed)
    const padding = Math.max(2, (maximum - minimum) * .2)
    const range = Math.max(10, maximum - minimum + padding * 2)
    step = [2, 5, 10, 20, 25].find((candidate) => candidate >= range / 4) ?? 25
    lower = Math.max(0, Math.floor((minimum - padding) / step) * step)
    upper = Math.min(100, Math.ceil((maximum + padding) / step) * step)
    if (upper - lower < 10) {
      lower = Math.max(0, upper - 10)
      upper = Math.min(100, lower + 10)
    }
  }
  const first = Date.parse(trend[0]?.date)
  const span = Date.parse(trend.at(-1)?.date) - first
  const y = (number) => CHART.bottom - (number - lower) * (CHART.bottom - CHART.top) / (upper - lower)
  const points = trend.map((point, index) => ({
    ...point, value: values[index],
    x: span > 0 ? CHART.left + (Date.parse(point.date) - first) * (CHART.right - CHART.left) / span : (CHART.left + CHART.right) / 2,
    y: values[index] === null ? null : y(values[index]),
  }))
  const segments = []
  let segment = []
  for (const point of points) {
    if (point.value === null) {
      if (segment.length) segments.push(segment)
      segment = []
    } else {
      segment.push(point)
    }
  }
  if (segment.length) segments.push(segment)
  const ticks = Array.from({ length: Math.round((upper - lower) / step) + 1 }, (_, index) => ({ value: lower + index * step, y: y(lower + index * step) }))
  const labelCount = Math.min(5, points.length)
  const dateIndexes = Array.from({ length: labelCount }, (_, index) => {
    const position = index * (points.length - 1) / Math.max(1, labelCount - 1)
    return Math.round(position)
  })
  return { lower, upper, ticks, points, segments, dateIndexes }
}
