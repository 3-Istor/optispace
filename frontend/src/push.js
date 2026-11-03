import { api } from './api.js'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// Asks permission (call it from a click: browsers drop prompts without a user gesture),
// subscribes this browser with the server's VAPID key and registers the subscription.
// Returns false when refused or when the server has no key; safe to call again.
export async function enablePush() {
  if (!pushSupported() || (await Notification.requestPermission()) !== 'granted') return false
  const { key } = await api.get('/push/vapid-public-key')
  if (!key) return false
  await navigator.serviceWorker.register('/sw.js')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    }))
  // Standard PushSubscription JSON: {endpoint, expirationTime, keys: {p256dh, auth}}.
  await api.post('/push-subscriptions', sub.toJSON())
  return true
}
