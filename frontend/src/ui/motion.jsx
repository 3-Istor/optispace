import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Shared motion pieces; durations and curves live in app.css (--t1, --t2, --t3).
export const EXIT_MS = 240 // --t2: how long a closing drawer or a removed row stays mounted

const COUNT_MS = 480 // --t3
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)')

// Number that counts from the value shown (0 at first) to `value`; format turns each step into text.
// Cubic ease-out stands in for --e-out. Instant under reduced motion.
export function Count({ value, format = String }) {
  const [shown, setShown] = useState(REDUCED.matches ? value : 0)
  const at = useRef(shown)
  at.current = shown
  useEffect(() => {
    if (REDUCED.matches) return setShown(value)
    const from = at.current
    const t0 = performance.now()
    let frame = requestAnimationFrame(function step(t) {
      const p = Math.min(1, Math.max(0, t - t0) / COUNT_MS)
      setShown(p < 1 ? from + (value - from) * (1 - (1 - p) ** 3) : value)
      if (p < 1) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [value])
  return format(shown)
}

// Drawn tick (done) or ring that draws back onto a dot (failed).
export function Tick({ bad = false, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle className={bad ? 'c-ring bad' : 'c-ring'} pathLength="1" cx="12" cy="12" r="10" strokeWidth="2" />
      {bad
        ? <circle className="c-dot" cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
        : <path className="c-mark" pathLength="1" d="M7 12.5l3.5 3.5L17 9" strokeWidth="2.4" />}
    </svg>
  )
}

// Busy mark of a button: an arc of the logo's S led by its dot.
export const Arc = () => (
  <svg className="arc" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <circle cx="12" cy="3" r="2.8" fill="#A78BFA" />
  </svg>
)

// Value that slides in from below when it grows and from above when it shrinks.
export function Roll({ value, children, className = '', ...props }) {
  const last = useRef(value)
  const dir = useRef('')
  if (last.current !== value) {
    dir.current = value > last.current ? 'r-in' : 'r-in d'
    last.current = value
  }
  return <span className={`roll ${className}`} {...props}><span key={value} className={dir.current}>{children}</span></span>
}

// State dot. A change of colour emits one ring; quiet (offline grey) changes silently.
export function LiveDot({ color, quiet = false }) {
  const last = useRef(color)
  const changes = useRef(0)
  if (last.current !== color) {
    last.current = color
    changes.current += 1
  }
  return (
    <span className="dot" style={{ background: color }}>
      {changes.current > 0 && !quiet && <i key={changes.current} className="rg" style={{ borderColor: color }} />}
    </span>
  )
}

// .seg whose white thumb slides to the pressed button. Children are the <button aria-pressed> options.
export function Seg({ children, className = '', ...props }) {
  const ref = useRef(null)
  const thumb = useRef(null)
  useLayoutEffect(() => {
    const place = () => {
      const on = ref.current.querySelector('[aria-pressed="true"]')
      thumb.current.style.width = `${on ? on.offsetWidth : 0}px`
      if (on) thumb.current.style.transform = `translateX(${on.offsetLeft}px)`
    }
    place()
    const watch = new ResizeObserver(place) // fonts loading or a wrap change the button widths
    watch.observe(ref.current)
    return () => watch.disconnect()
  })
  return <div ref={ref} className={`seg slide ${className}`} {...props}><i ref={thumb} className="seg-thumb" aria-hidden="true" />{children}</div>
}

// Ring around a state dot that empties between `from` and `to` (ms) as the release deadline nears; the dot
// breathes in the last 3 minutes. done: released, the ring closes in green.
export function Countdown({ from, to, now, done = false }) {
  const left = Math.max(0, to - now)
  const color = done ? '#1A8F4E' : '#D9771F'
  return (
    <svg className="cd" width="22" height="22" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15" fill="none" stroke="#E4E8EE" strokeWidth="4" />
      <circle className="cd-r" pathLength="1" cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray="1" strokeDashoffset={done ? 0 : 1 - Math.min(1, left / Math.max(1, to - from))} transform="rotate(-90 18 18)" />
      <circle className={!done && left < 180000 ? 'cd-d breathe' : 'cd-d'} cx="18" cy="18" r="6" fill={color} />
    </svg>
  )
}
