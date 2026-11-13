import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { errorText, NOTIFICATIONS } from '../messages.js'
import { enablePush, pushSupported } from '../push.js'
import { navigate } from '../router.jsx'
import { dayLabel, fmtTime } from '../time.js'
import { usePolling } from '../usePolling.js'
import { Button } from './Button.jsx'
import { Icon, ICONS } from './Icon.jsx'
import { toast } from './Toast.jsx'

const fetchNotifications = () => api.get('/notifications')

// Where a click on a notification leads.
function target(n) {
  if (n.type.startsWith('DEVICE_')) return '/admin/devices'
  if (n.type !== 'SPACE_AVAILABLE') return '/reservations'
  const { space_type, start_at, end_at } = n.params ?? {}
  return `/?${new URLSearchParams({ ...(space_type && { type: space_type }), start_at, end_at })}`
}

// An unread absence warning whose deadline is still ahead offers "J'y vais" and "Libérer".
const answerable = (n) => n.type === 'ABSENCE_WARNING' && !n.read_at && n.reservation_id && Date.parse(n.params?.at) > Date.now()

const when = (iso) => (dayLabel(iso) === 'AUJ.' ? fmtTime(iso) : dayLabel(iso).toLowerCase())

function pushCardWanted(me) {
  try {
    return me.notify_push && pushSupported() && Notification.permission === 'default' && localStorage.getItem('push-later') !== '1'
  } catch {
    return false
  }
}

// Bell with unread count and the notification menu (Notifications.dc.html), polled every 5 s.
export function Bell({ me }) {
  const ref = useRef(null)
  const { data: loaded, refresh } = usePolling(fetchNotifications, 5000)
  const data = loaded ?? []
  const [card, setCard] = useState(() => pushCardWanted(me))
  const unread = data.filter((n) => !n.read_at)
  const seen = useRef(null)
  const [rings, setRings] = useState(0) // arrivals since the page loaded; each one swings the bell once

  // A new unread notification also pops a toast; the first load only records what is already there.
  useEffect(() => {
    if (!loaded) return
    const fresh = seen.current ? unread.filter((n) => !seen.current.has(n.id)) : []
    seen.current = new Set(data.map((n) => n.id))
    if (fresh.length) setRings((r) => r + 1)
    fresh.forEach((n) => {
      const t = NOTIFICATIONS[n.type]
      if (t) toast(`${t.title} : ${t.text(n.params ?? {})}`)
    })
  }, [loaded])

  // Permission given earlier: make sure this browser's subscription is registered.
  useEffect(() => {
    if (me.notify_push && pushSupported() && Notification.permission === 'granted') enablePush().catch(() => {})
  }, [me.notify_push])

  // <details> does not close on outside click or Escape by itself. composedPath, not contains():
  // a clicked button React already removed (Plus tard, Activer) is no longer inside the menu.
  useEffect(() => {
    const onClick = (e) => { if (ref.current?.open && !e.composedPath().includes(ref.current)) ref.current.open = false }
    const onKey = (e) => {
      if (e.key !== 'Escape' || !ref.current?.open) return
      ref.current.open = false
      ref.current.querySelector('summary').focus()
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const markRead = (list) => Promise.all(list.map((n) => api.post(`/notifications/${n.id}/read`))).finally(refresh)

  function open(n) {
    ref.current.open = false
    if (!n.read_at) markRead([n]).catch(() => {})
    navigate(target(n))
  }

  // "Libérer" cancels the reservation; "J'y vais" only marks the warning read, the deadline keeps running.
  async function release(n) {
    try {
      await api.del(`/reservations/${n.reservation_id}`)
      toast(`Réservation de ${n.params.space_name} libérée.`)
    } catch (e) {
      toast(errorText(e), 'err')
    }
    markRead([n]).catch(() => {})
  }

  async function activate() {
    setCard(false)
    const ok = await enablePush().catch(() => false)
    toast(ok ? 'Notifications du navigateur activées.' : 'Les notifications du navigateur n’ont pas pu être activées.', ok ? 'ok' : 'err')
  }

  function later() {
    setCard(false)
    try { localStorage.setItem('push-later', '1') } catch { /* private mode: ask again next visit */ }
  }

  return (
    <details className="bell" ref={ref}>
      <summary aria-label={`Notifications, ${unread.length} non lue${unread.length > 1 ? 's' : ''}`}>
        <span key={`bell${rings}`} className={rings ? 'swing' : undefined} style={{ display: 'inline-flex' }}><Icon d={ICONS.bell} size={18} /></span>
        {unread.length > 0 && <span key={`cnt${rings}`} className={rings ? 'cnt num pop' : 'cnt num'} aria-hidden="true">{unread.length > 99 ? '99+' : unread.length}</span>}
      </summary>
      <div className="menu">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
          <span style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 500 }}>Notifications</span>
          {unread.length > 0 && <button type="button" className="link" onClick={() => markRead(unread).catch(() => {})}>Tout marquer comme lu</button>}
        </div>
        {card && (
          <div className="push-card">
            <span style={{ fontSize: 13, fontWeight: 500 }}>Activer les notifications du navigateur</span>
            <span className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>Soyez prévenu d’une absence ou d’une libération même quand OptiSpace est fermé.</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <Button variant="p" style={{ height: 30, fontSize: 13 }} onClick={activate}>Activer</Button>
              <Button variant="g" style={{ height: 30, fontSize: 13 }} onClick={later}>Plus tard</Button>
            </span>
          </div>
        )}
        <div className="ntf-list">
          {data.map((n) => {
            const t = NOTIFICATIONS[n.type]
            return t && (
              <div key={n.id} className={n.read_at ? 'ntf-row' : 'ntf-row unread'}>
                <button type="button" className="ntf" onClick={() => open(n)}>
                  <i style={{ background: t.color }} aria-hidden="true" />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#3A4555' }}>{t.title}{!n.read_at && <span className="sr-only">, non lue</span>}</span>
                      <span className="num muted" style={{ fontSize: 12 }}>{when(n.created_at)}</span>
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.45 }}>{t.text(n.params ?? {})}</span>
                  </span>
                </button>
                {answerable(n) && (
                  <div className="ntf-act">
                    <Button onClick={() => markRead([n]).catch(() => {})}>J’y vais</Button>
                    <Button variant="d" onClick={() => release(n)}>Libérer</Button>
                  </div>
                )}
              </div>
            )
          })}
          {data.length === 0 && <p className="ntf-empty">Aucune notification.</p>}
        </div>
      </div>
    </details>
  )
}
