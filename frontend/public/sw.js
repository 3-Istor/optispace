// Web Push only: shows the backend payload {title, body, url} and opens url on click.
self.addEventListener('push', (event) => {
  const { title = 'OptiSpace', body = '', url = '/' } = event.data ? event.data.json() : {}
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/3istor.png', data: { url } }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data.url))
})
