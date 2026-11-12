// full: boot screen where the OptiSpace symbol draws itself; else skeleton lines in place of the content.
// The symbol is public/optispace.svg inlined so its parts can be animated (app.css, .boot-*).
function Symbol() {
  return (
    <svg className="boot" viewBox="180 180 640 640" width="96" height="96" aria-hidden="true">
      <defs>
        <mask id="boot-s" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
          <rect width="1000" height="1000" fill="#fff" />
          <polygon points="456.7,500 543.3,500 475,774 388.4,774" fill="#000" stroke="#000" strokeWidth="20" />
        </mask>
        <mask id="boot-i" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
          <rect width="1000" height="1000" fill="#fff" />
          <path d="M440.3 483.4A116 116 0 0 0 500 500A116 116 0 0 1 580 532" fill="none" stroke="#000" strokeWidth="104" />
        </mask>
      </defs>
      <circle className="boot-dot" cx="500" cy="384" r="52" fill="#38B6FF" />
      <path className="boot-s" pathLength="1" d="M616 384A116 116 0 1 0 500 500A116 116 0 1 1 384 616" fill="none" stroke="#09234A" strokeWidth="84" mask="url(#boot-s)" />
      <polygon className="boot-i" points="456.7,500 543.3,500 475,774 388.4,774" fill="#38B6FF" mask="url(#boot-i)" />
      <path className="boot-s" pathLength="1" d="M440.3 483.4A116 116 0 0 0 500 500A116 116 0 0 1 580 532" fill="none" stroke="#09234A" strokeWidth="84" />
    </svg>
  )
}

export function Loader({ full = false, label = 'Chargement' }) {
  if (!full) {
    return (
      <div className="sk-list" role="status">
        <span className="sr-only">{label}</span>
        <span className="sk" style={{ width: '72%' }} /><span className="sk" style={{ width: '94%' }} /><span className="sk" style={{ width: '56%' }} />
      </div>
    )
  }
  return (
    <section className="loader-full" role="status" aria-label={label}>
      <Symbol />
      <span className="brand-name" style={{ fontSize: 22 }}>OptiSpace</span>
    </section>
  )
}
