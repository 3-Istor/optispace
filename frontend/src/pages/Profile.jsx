import { useState } from 'react'
import { api } from '../api.js'
import { errorText } from '../messages.js'
import { disablePush, enablePush } from '../push.js'
import { Icon } from '../ui/Icon.jsx'
import { Tick } from '../ui/motion.jsx'
import { initials, PageHeader, roleLabel } from '../ui/Shell.jsx'
import { toast } from '../ui/Toast.jsx'

// Keycloak account console; set at build time, the link is hidden when empty.
const ACCOUNT_URL = import.meta.env.VITE_KEYCLOAK_ACCOUNT_URL
const ALERTS = [['alert_device_offline', 'Boîtier hors ligne'], ['alert_device_sealed', 'Boîtier rescellé']]
const CHANNELS = [['notify_push', 'Notifications du navigateur'], ['notify_in_app', 'Notifications dans l’application']]

// AdminProfil.dc.html, at /profile for everyone and /admin/profile for Facility managers, who also
// get the device alerts. Identity comes from Keycloak and is read-only here.
export function Profile({ me, setMe }) {
  const [phone, setPhone] = useState(me.phone ?? '')
  const [phoneSaved, setPhoneSaved] = useState(false)
  const name = me.display_name || me.email || ''
  const fm = me.role === 'facility_manager'

  async function savePhone(e) {
    e.preventDefault()
    try {
      // "" clears the phone; null would leave it unchanged.
      setMe(await api.patch('/me', { phone: phone.trim() }))
      setPhoneSaved(true)
    } catch (err) {
      toast(errorText(err), 'err')
    }
  }

  async function toggle(key) {
    const on = !me[key]
    try {
      // Permission prompt first, while the click still counts as a user gesture.
      if (key === 'notify_push' && on) await enablePush().catch(() => false)
      setMe(await api.patch('/me', { [key]: on }))
      if (key === 'notify_push' && !on) await disablePush().catch(() => {})
    } catch (e) {
      toast(errorText(e), 'err')
    }
  }

  const switches = (title, list) => (
    <section className="card side-card" aria-labelledby={`${list[0][0]}-h`}>
      <h2 id={`${list[0][0]}-h`}>{title}</h2>
      {list.map(([key, label]) => (
        <div className="line" key={key}>
          <span>{label}</span>
          <button type="button" role="switch" className="tog" aria-checked={!!me[key]} aria-label={label}
            style={{ background: me[key] ? '#BE185D' : '#C9D0DA' }} onClick={() => toggle(key)}><span /></button>
        </div>
      ))}
    </section>
  )

  return (
    <>
      <PageHeader title="Profil" />
      <div className="cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <section className="card" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
            <span className="avatar" aria-hidden="true" style={{ width: 52, height: 52, fontSize: 18 }}>{initials(name)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span style={{ fontFamily: "'Sora', sans-serif", fontSize: 18 }}>{name}</span>
              <span className="muted" style={{ fontSize: 13 }}>{roleLabel(me)}</span>
            </span>
            {me.role === 'employee' && <a href="/logout" className="btn btn-s only-narrow">Déconnexion</a>}
            {ACCOUNT_URL && (
              <a href={ACCOUNT_URL} className="btn btn-s" target="_blank" rel="noopener noreferrer">
                Gérer mon compte <Icon d="M5 12h14M13 6l6 6-6 6" size={14} />
              </a>
            )}
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 140px) minmax(0, 1fr)', gap: '12px 16px', margin: 0, paddingTop: 18, borderTop: '1px solid #EEF1F5' }}>
            <dt className="muted">Nom</dt><dd style={{ margin: 0 }}>{me.display_name || 'Non renseigné'}</dd>
            <dt className="muted">E-mail</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{me.email || 'Non renseigné'}</dd>
          </dl>
          <p className="muted" style={{ margin: '-6px 0 0', fontSize: 12, lineHeight: 1.5 }}>
            Nom, e-mail, mot de passe et double authentification se gèrent depuis votre compte Keycloak.
          </p>
          <form onSubmit={savePhone} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 16, borderTop: '1px solid #EEF1F5' }}>
            <label htmlFor="tel" className="lbl">Téléphone</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input id="tel" className="input num" type="tel" autoComplete="tel" maxLength={32} placeholder="+33 6 00 00 00 00"
                value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneSaved(false) }} style={{ width: 260, maxWidth: '100%' }} />
              <button type="submit" className="btn btn-p" disabled={phone.trim() === (me.phone ?? '')}>Enregistrer</button>
            </div>
            <span role="status" style={{ fontSize: 12, color: '#156B3C' }}>{phoneSaved && <span className="fade" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Tick size={14} />Téléphone enregistré.</span>}</span>
          </form>
        </section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {fm && switches('Alertes', ALERTS)}
          {switches(fm ? 'Canaux' : 'Notifications', CHANNELS)}
        </div>
      </div>
    </>
  )
}
