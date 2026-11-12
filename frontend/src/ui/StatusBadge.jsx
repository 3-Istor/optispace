import { SPACE_STATES } from '../messages.js'
import { fmtTime } from '../time.js'
import { LiveDot } from './motion.jsx'
import { useMe } from './Shell.jsx'

// Dot + label of a space_state (spec §5). releaseAt (current_reservation.release_at) adds
// "(libération à 14:10)"; children replace the label. Facility managers also read "sans réservation".
export function StatusBadge({ state, releaseAt, children }) {
  const [label, color] = SPACE_STATES[state] ?? SPACE_STATES.unknown
  const fm = useMe()?.role === 'facility_manager'
  const unreserved = fm && state === 'occupied_unreserved'
  return (
    <span className="st" style={{ whiteSpace: 'normal' }}>
      <LiveDot color={color} quiet={color === SPACE_STATES.unknown[1]} />
      {children ?? label}{!children && unreserved && ' sans réservation'}{releaseAt && ` (libération à ${fmtTime(releaseAt)})`}
    </span>
  )
}
