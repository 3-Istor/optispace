import { Link } from '../router.jsx'
import { Icon, ICONS } from '../ui/Icon.jsx'

// The single blocking-error template of Erreurs.dc.html. home: the action goes to "/", logout: to the gateway's /logout, else it reloads; no action: none.
const KINDS = {
  notFound: {
    code: 'ERREUR 404', icon: ICONS.notFound, dot: '#1E56D6', home: true, action: 'Trouver un espace',
    title: 'Cette page n’existe pas.', text: 'Le lien est peut-être erroné ou la page a été déplacée.',
  },
  forbidden: {
    code: 'ERREUR 403', icon: ICONS.forbidden, dot: '#E5484D', home: true, action: 'Revenir à mon espace',
    title: 'Vous n’avez pas accès à cette page.',
    text: 'Cette section est réservée aux Facility managers de votre entreprise. Demandez-leur d’ajuster vos droits si besoin.',
  },
  noOrganization: {
    code: 'ERREUR 403', icon: ICONS.forbidden, dot: '#E5484D', logout: true, action: 'Se déconnecter',
    title: 'Votre compte n’est rattaché à aucune entreprise.',
    text: 'Demandez au support OptiSpace de rattacher votre compte à votre entreprise.',
  },
  server: {
    code: 'ERREUR 500', icon: ICONS.server, dot: '#E5484D', action: 'Réessayer',
    title: 'Un problème est survenu de notre côté.',
    text: 'Vos réservations et le statut des espaces ne sont pas affectés. Réessayez dans quelques instants.',
  },
  session: {
    code: 'SESSION EXPIRÉE', icon: ICONS.clock, dot: '#F08A24', action: 'Se reconnecter',
    title: 'Votre session a expiré.',
    text: 'Pour protéger votre compte, la session a été fermée après une période d’inactivité. Reconnectez-vous pour continuer.',
  },
  unauthenticated: {
    code: 'IDENTITÉ NON TRANSMISE', icon: ICONS.lock, dot: '#E5484D', action: 'Réessayer',
    title: 'OptiSpace ne sait pas qui vous êtes.',
    text: 'Vous êtes connecté, mais votre identité n’est pas parvenue à l’application. Ce n’est pas de votre fait.',
  },
  offline: {
    code: 'HORS CONNEXION', icon: ICONS.offline, dot: '#F08A24', action: 'Réessayer',
    title: 'Pas de connexion internet.',
    text: 'Vérifiez votre réseau. Les statuts affichés seront mis à jour dès le retour de la connexion.',
  },
}

// kind: notFound | forbidden | noOrganization | server | session | unauthenticated | offline. standalone: outside the Shell (before sign-in).
export function ErrorPage({ kind, standalone = false }) {
  const e = KINDS[kind] ?? KINDS.server
  const action = { className: 'btn btn-p', style: { height: 42, padding: '0 22px', fontSize: 15 } }
  const card = (
    <section className="err" aria-labelledby="err-title">
      <div className="err-icon">
        <Icon d={e.icon} size={52} strokeWidth={1.8} />
        <i style={{ background: e.dot }} aria-hidden="true" />
      </div>
      <span className="err-code">{e.code}</span>
      <h1 id="err-title">{e.title}</h1>
      <p>{e.text}</p>
      {e.action && (e.home
        ? <Link to="/" {...action}>{e.action}</Link>
        : e.logout
        ? <a href="/logout" {...action}>{e.action}</a>
        : <button type="button" onClick={() => location.reload()} {...action}>{e.action}</button>)}
      {e.action && <span style={{ fontSize: 12, color: '#6A7A92' }}>Si le problème persiste, contactez votre administrateur.</span>}
    </section>
  )
  if (!standalone) return card
  return (
    <div className="err-page">
      <header className="topbar">
        <div className="topbar-in"><span className="brand"><img src="/3istor.png" alt="3istor" /><span className="brand-name">OptiSpace</span></span></div>
      </header>
      <main>{card}</main>
    </div>
  )
}
