import { useState } from 'react'
import { Button } from '../ui/Button.jsx'
import { Icon, ICONS } from '../ui/Icon.jsx'

// Public Keycloak registration page; set at build time, the link is hidden when empty.
const REGISTER_URL = import.meta.env.VITE_KEYCLOAK_REGISTER_URL

// Shown when GET /me answers 401. The gateway does the login, so signing in is a reload.
export function Login() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="login">
      <div className="bgdots" aria-hidden="true" />
      <div className="bgfade" aria-hidden="true" />
      <main style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 20px' }}>
        <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <span className="brand" style={{ alignSelf: 'center' }}>
            <img src="/3istor.png" alt="3istor" style={{ height: 38 }} />
            <span className="brand-name" style={{ fontSize: 18 }}>OptiSpace</span>
          </span>
          <section className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 1px 2px rgba(14,23,38,0.04), 0 12px 32px rgba(14,23,38,0.06)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h1 style={{ fontSize: 22 }}>Bienvenue sur OptiSpace</h1>
              <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>Connectez-vous avec le compte de votre entreprise.</p>
            </div>
            <Button variant="p" busy={busy} style={{ height: 42 }} onClick={() => { setBusy(true); location.reload() }}>
              {busy ? 'Redirection vers Keycloak' : 'Se connecter'}
            </Button>
            {REGISTER_URL && <a href={REGISTER_URL} className="btn btn-s" style={{ height: 42 }}>Créer un compte</a>}
            <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Icon d={ICONS.lock} size={14} style={{ flex: 'none', color: '#8A94A3' }} />
              <span>Vous serez redirigé vers la page d’authentification sécurisée (Keycloak).</span>
            </p>
          </section>
        </div>
      </main>
      <footer style={{ position: 'relative', display: 'flex', justifyContent: 'center', padding: 18, fontSize: 12, color: '#8A94A3' }}>OptiSpace par 3istor</footer>
    </div>
  )
}
