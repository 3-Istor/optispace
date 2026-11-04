import { SPACE_STATES } from '../messages.js'
import { fmtTime } from '../time.js'

// Dot + label of a space_state (spec §5). releaseAt (current_reservation.release_at) adds
// "(libération à 14:10)"; children replace the label.
export function StatusBadge({ state, releaseAt, children }) {
  const [label, color] = SPACE_STATES[state] ?? SPACE_STATES.unknown
  return (
    <span className="st" style={{ whiteSpace: 'normal' }}>
      <span className="dot" style={{ background: color }} />
      {children ?? label}{releaseAt && ` (libération à ${fmtTime(releaseAt)})`}
    </span>
  )
}
