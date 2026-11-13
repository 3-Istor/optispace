// Web Push only: shows the backend payload {title, body, url} and opens url on click. An absence warning also
// carries notification_id and reservation_id: its two buttons show where the browser supports actions.
self.addEventListener('push', (event) => {
  const { title = 'OptiSpace', body = '', url = '/', notification_id, reservation_id } = event.data ? event.data.json() : {}
  const actions = reservation_id ? [{ action: 'ack', title: 'J’y vais' }, { action: 'release', title: 'Libérer' }] : []
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: '/optispace-192.png', actions, data: { url, notification_id, reservation_id },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { url, notification_id, reservation_id } = event.notification.data
  const open = () => self.clients.openWindow(url)
  const call = (method, path) => fetch(`/api/v1${path}`, { method }).then((res) => { if (!res.ok) throw new Error(path) })
  // "J'y vais" only marks the warning read; null id when the user turned in-app notifications off.
  const read = () => (notification_id ? call('POST', `/notifications/${notification_id}/read`) : Promise.resolve())
  // A call that fails (expired session, reservation already over) opens the page, which has the same buttons.
  if (event.action === 'release') event.waitUntil(call('DELETE', `/reservations/${reservation_id}`).then(read).catch(open))
  else if (event.action === 'ack') event.waitUntil(read().catch(open))
  else event.waitUntil(open())
})
