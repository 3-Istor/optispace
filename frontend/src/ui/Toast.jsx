import { useEffect, useState } from 'react'

// One <Toaster /> in App; any module calls toast(text) or toast(text, 'err').
let show = () => {}
export const toast = (text, kind = 'ok') => show({ text, kind, at: Date.now() })

export function Toaster() {
  const [t, setT] = useState(null)
  useEffect(() => {
    show = setT
    return () => { show = () => {} }
  }, [])
  useEffect(() => {
    if (!t) return
    const timer = setTimeout(() => setT(null), 3800)
    return () => clearTimeout(timer)
  }, [t])
  // Always mounted so screen readers announce changes of the live region.
  return (
    <div role="status" aria-live="polite" className={`toast ${t ? 'on' : ''} ${t?.kind === 'err' ? 'toast-err' : ''}`}>
      {t && <><i aria-hidden="true" /><span>{t.text}</span></>}
    </div>
  )
}
