// The three-arc loader of Chargement.dc.html. full: dark full-screen boot screen; else inline 48 px.
const ARC = { full: [[52, '#1E56D6', 2.4, 1.8], [42, '#5B8CF0', 1.9, 1.6], [32, '#A9C6FF', 1.4, 1.4]], inline: [[52, '#1E56D6', 2.4, 1.8], [36, '#5B8CF0', 1.9, 1.6], [20, '#A9C6FF', 1.4, 1.4]] }

function Arcs({ full }) {
  const size = full ? 140 : 48
  return (
    <div className="loader" style={{ width: size, height: size }} aria-hidden="true">
      {ARC[full ? 'full' : 'inline'].map(([r, color, spin, dash], i) => (
        <svg key={r} width={size} height={size} viewBox="0 0 120 120" style={{ animation: `osSpin ${spin}s linear infinite${i === 1 ? ' reverse' : ''}` }}>
          {full && i === 0 && <circle cx="60" cy="60" r="52" fill="none" stroke="#1B3157" strokeWidth="5" />}
          <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth={full ? 5 : 10} strokeLinecap="round"
            style={{ animation: `osDash ${dash}s ease-in-out infinite ${i * 0.2}s` }} />
        </svg>
      ))}
      {full && <div className="loader-core"><span /></div>}
    </div>
  )
}

export function Loader({ full = false, label = 'Chargement' }) {
  if (!full) {
    return <div className="loader-inline" role="status"><Arcs /><span>{label}</span></div>
  }
  return (
    <section className="loader-full" role="status" aria-label={label}>
      <Arcs full />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 500 }}>{label}<span className="dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></span>
        <span style={{ fontSize: 14, color: '#A9BBD8' }}>Synchronisation avec les boîtiers</span>
      </div>
    </section>
  )
}
