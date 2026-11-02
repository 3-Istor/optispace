// Centered card for an empty list: title, explanation (children) and optional action buttons.
export function EmptyState({ title, children, actions }) {
  return (
    <div className="card" style={{ padding: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <span style={{ fontFamily: "'Sora', sans-serif", fontSize: 16 }}>{title}</span>
      {children && <span className="muted" style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.5 }}>{children}</span>}
      {actions && <div className="actions" style={{ justifyContent: 'center', marginTop: 4, gap: 8 }}>{actions}</div>}
    </div>
  )
}
