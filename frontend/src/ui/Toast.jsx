import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, ICONS } from './Icon.jsx'
import { EXIT_MS, Tick } from './motion.jsx'

// One <Toaster /> in App; any module calls toast(text) or toast(text, 'err').
let show = () => {}
let seq = 0
export const toast = (text, kind = 'ok') => show({ id: ++seq, text, kind })

const MAX = 3 // older toasts are dropped beyond this
const DELAY = { ok: 6000, err: 9000 }

export function Toaster() {
  const [list, setList] = useState([])
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const ref = useRef(null)
  const drop = useCallback((id) => setList((l) => l.filter((t) => t.id !== id)), [])
  useEffect(() => {
    show = (t) => setList((l) => [...l, t].slice(-MAX))
    return () => { show = () => {} }
  }, [])
  // A removed toast may take the pointer or focus with it without a leave or blur event.
  useEffect(() => {
    setHover(ref.current.matches(':hover'))
    setFocus(ref.current.contains(document.activeElement))
  }, [list])
  // Always mounted so screen readers announce what is added to the live region. Hovering or
  // focusing the stack pauses every toast, so none slides away from under the pointer.
  return (
    <div ref={ref} role="status" aria-live="polite" className="toasts"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}>
      {list.map((t) => <Toast key={t.id} t={t} paused={hover || focus} onClose={drop} />)}
    </div>
  )
}

// Hides after DELAY; a pause restarts the full delay when it ends. It sinks for EXIT_MS before it is removed.
function Toast({ t, paused, onClose }) {
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (out) {
      const gone = setTimeout(() => onClose(t.id), EXIT_MS)
      return () => clearTimeout(gone)
    }
    if (paused) return
    const timer = setTimeout(() => setOut(true), DELAY[t.kind] ?? DELAY.ok)
    return () => clearTimeout(timer)
  }, [paused, out, t, onClose])
  return (
    <div className={`toast ${t.kind === 'err' ? 'toast-err' : ''} ${out ? 'out' : ''}`}>
      <Tick bad={t.kind === 'err'} />
      <span style={{ flex: 1 }}>{t.text}</span>
      <button type="button" className="toast-x" aria-label="Fermer" onClick={() => setOut(true)}><Icon d={ICONS.close} size={14} /></button>
    </div>
  )
}
