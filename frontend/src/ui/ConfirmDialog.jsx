import { useEffect, useId, useRef } from 'react'
import { Button } from './Button.jsx'

// Modal confirmation on a native <dialog>: the browser traps focus, Escape calls onCancel.
// Keep it rendered and drive it with `open`; children is the summary under the title.
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Annuler', onConfirm, onCancel, busy = false, danger = false }) {
  const ref = useRef(null)
  const id = useId()

  useEffect(() => {
    const d = ref.current
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    // React bubbles close/cancel up its tree: stop them so a parent drawer's onClose does not fire.
    <dialog ref={ref} className="modal" aria-labelledby={id}
      onCancel={(e) => { e.stopPropagation(); if (busy) e.preventDefault() }}
      onClose={(e) => { e.stopPropagation(); if (open) onCancel() }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 id={id} style={{ fontSize: 18 }}>{title}</h2>
        {children && <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{children}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={danger ? 'd' : 'p'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  )
}
