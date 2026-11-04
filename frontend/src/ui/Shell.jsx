import { createContext, useContext, useRef, useState } from 'react'
import { Link, useRoute } from '../router.jsx'
import { Bell } from './Bell.jsx'
import { Icon, ICONS } from './Icon.jsx'

const MeContext = createContext(null)

const EMPLOYEE_NAV = [
  ['Réservations', [['/', 'Réserver', ICONS.search], ['/reservations', 'Mes réservations', ICONS.calendar]]],
  ['Compte', [['/profile', 'Profil', ICONS.profile]]],
]
// Facility managers also book (spec §2), hence the "Réservations" group.
const FM_NAV = [
  ['Pilotage', [['/admin', 'Tableau de bord', ICONS.dashboard]]],
  ['Espaces', [['/admin/spaces', 'Salles et bulles', ICONS.spaces], ['/admin/devices', 'Boîtiers', ICONS.device], ['/admin/settings', 'Paramètres', ICONS.settings]]],
  ['Réservations', [['/', 'Réserver', ICONS.search], ['/reservations', 'Mes réservations', ICONS.calendar]]],
  ['Compte', [['/admin/profile', 'Profil', ICONS.profile]]],
]

export const roleLabel = (me) => (me.role === 'facility_manager' ? 'Facility manager' : 'Employé')
export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')

function NavLink({ to, children }) {
  const { path } = useRoute()
  return <Link className="nav-i" to={to} aria-current={path === to ? 'page' : undefined}>{children}</Link>
}

// The gateway serves /logout; a full page load, not an in-app navigation.
const Logout = () => (
  <a href="/logout" className="btn btn-g icon-btn" aria-label="Déconnexion"><Icon d={ICONS.logout} /></a>
)

// Frame of every signed-in page: sidebar, then the page, whose PageHeader holds the bell.
// me is the GET /api/v1/me body; me.role picks the links.
export function Shell({ me, children }) {
  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        <Sidebar me={me} />
        <main className="shell-main">{children}</main>
      </div>
    </MeContext.Provider>
  )
}

// Under 960px (app.css) the sidebar folds into a top bar whose Menu button shows the links.
function Sidebar({ me }) {
  const [open, setOpen] = useState(false)
  const button = useRef(null)
  const fm = me.role === 'facility_manager'
  const name = me.display_name || me.email || ''
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) { setOpen(false); button.current.focus() }
  }
  return (
    <aside className="side" onKeyDown={onKeyDown}>
      <div className="side-in">
        <div className="side-top">
          <Link to={fm ? '/admin' : '/'} className="brand" style={{ padding: '2px 6px' }}>
            <img src="/3istor.png" alt="3istor" style={{ height: 30 }} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span className="brand-name">OptiSpace</span>
              {fm && <span style={{ fontSize: 11, color: '#5B6676' }}>Facility management</span>}
            </span>
          </Link>
          <button ref={button} type="button" className="btn btn-s side-menu" aria-expanded={open} aria-controls="side-nav"
            onClick={() => setOpen(!open)}><Icon d={open ? ICONS.close : ICONS.menu} />Menu</button>
        </div>
        <div id="side-nav" className={open ? 'side-nav open' : 'side-nav'}>
          <nav aria-label="Navigation" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
            onClick={(e) => e.target.closest('a') && setOpen(false)}>
            {(fm ? FM_NAV : EMPLOYEE_NAV).map(([title, items]) => (
              <div className="side-group" key={title}>
                <span className="side-title">{title}</span>
                {items.map(([to, label, d]) => <NavLink key={to} to={to}><Icon d={d} />{label}</NavLink>)}
              </div>
            ))}
          </nav>
          <div className="side-user">
            <span className="avatar" aria-hidden="true">{initials(name)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
              <span style={{ fontSize: 11, color: '#5B6676' }}>{roleLabel(me)}</span>
            </span>
            <Logout />
          </div>
        </div>
      </div>
    </aside>
  )
}

// Title row of every page: crumb, h1 and actions (children). It also holds the bell, as in the
// admin mockups, so every page must render it.
export function PageHeader({ crumb, title, children }) {
  const me = useContext(MeContext)
  return (
    <div className="page-h">
      <div className="page-h-t">
        {crumb && <span className="crumb">{crumb}</span>}
        <h1>{title}</h1>
      </div>
      {(children || me) && <div className="actions">{children}{me && <Bell me={me} />}</div>}
    </div>
  )
}
