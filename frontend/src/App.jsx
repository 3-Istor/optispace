import { useEffect, useState } from 'react'
import { api } from './api.js'
import { useRoute } from './router.jsx'
import { Dashboard } from './pages/admin/Dashboard.jsx'
import { Devices } from './pages/admin/Devices.jsx'
import { Settings } from './pages/admin/Settings.jsx'
import { Spaces } from './pages/admin/Spaces.jsx'
import { ErrorPage } from './pages/Errors.jsx'
import { MyReservations } from './pages/MyReservations.jsx'
import { Profile } from './pages/Profile.jsx'
import { Reserve } from './pages/Reserve.jsx'
import { Loader } from './ui/Loader.jsx'
import { Shell } from './ui/Shell.jsx'
import { Toaster } from './ui/Toast.jsx'

// path -> page component, rendered as <Page me={me} setMe={setMe} />.
const ROUTES = { '/': Reserve, '/reservations': MyReservations, '/profile': Profile }
// Served to role facility_manager only (the backend enforces it anyway); /admin/* for others is a 403 page.
const FM_ROUTES = {
  '/admin': Dashboard, '/admin/spaces': Spaces, '/admin/devices': Devices, '/admin/settings': Settings, '/admin/profile': Profile,
}

// GET /me failure -> what to show. A 401 that survives one reload means the gateway does not pass the token.
const FAILURE = { 0: 'offline', 401: 'unauthenticated', 403: 'forbidden' }
const RELOADED = 'optispace.reloaded-on-401'

// Keycloak signs users in before the app loads, so a reload is the whole login. The flag is cleared only by a
// successful /me: parallel 401s (StrictMode runs effects twice) must not reload again.
function reloadOnce() {
  try {
    if (sessionStorage.getItem(RELOADED)) return false
    sessionStorage.setItem(RELOADED, '1')
  } catch {
    return false
  }
  location.reload()
  return true
}

function forgetReload() {
  try { sessionStorage.removeItem(RELOADED) } catch { /* storage blocked: nothing to forget */ }
}

export default function App() {
  const [me, setMe] = useState(null)
  const [failure, setFailure] = useState(null)
  const { path, url } = useRoute()

  useEffect(() => {
    const expired = () => setFailure((f) => f ?? 'session')
    window.addEventListener('api:unauthorized', expired)
    api.get('/me').then((m) => { forgetReload(); setMe(m) }, (e) => {
      if (e.status === 401 && reloadOnce()) return
      setFailure(FAILURE[e.status] ?? 'server')
    })
    return () => window.removeEventListener('api:unauthorized', expired)
  }, [])

  if (failure) return <ErrorPage kind={failure} standalone />
  if (!me) return <Loader full label="Chargement de vos espaces" />

  const fm = me.role === 'facility_manager'
  const Page = ROUTES[path] ?? (fm ? FM_ROUTES[path] : undefined)
  return (
    <Shell me={me}>
      {Page
        ? <Page key={url} me={me} setMe={setMe} />
        : <ErrorPage kind={path.startsWith('/admin') && !fm ? 'forbidden' : 'notFound'} />}
      <Toaster />
    </Shell>
  )
}
