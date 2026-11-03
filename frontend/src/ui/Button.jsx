// variant: p (primary), s (secondary), g (ghost), d (danger). busy shows a spinner and disables.
export function Button({ variant = 's', busy = false, disabled, className = '', children, ...props }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {busy && <span className="spin" aria-hidden="true" />}
      {children}
    </button>
  )
}
