import { createContext, useContext, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useRoute } from '../router.jsx'
import { Bell } from './Bell.jsx'
import { Icon, ICONS } from './Icon.jsx'

const MeContext = createContext(null)
export const useMe = () => useContext(MeContext)

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

const TABS = EMPLOYEE_NAV.flatMap(([, items]) => items)

const STAFF_NAV = [['Installation', [['/', 'Boîtiers', ICONS.device]]]]

const navOf = (me) => (me.role === 'staff' ? STAFF_NAV : me.role === 'facility_manager' ? FM_NAV : EMPLOYEE_NAV)

const ROLE_LABELS = { facility_manager: 'Facility manager', staff: 'Admin OptiSpace' }
export const roleLabel = (me) => ROLE_LABELS[me.role] ?? 'Employé'
export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')

// Same breakpoint as the sidebar fold in app.css. One Bell is mounted at a time: in the top bar when
// narrow, else in the PageHeader.
const NARROW = window.matchMedia('(max-width:960px)')
const onNarrow = (listener) => {
  NARROW.addEventListener('change', listener)
  return () => NARROW.removeEventListener('change', listener)
}
const useNarrow = () => useSyncExternalStore(onNarrow, () => NARROW.matches)

function NavLink({ to, children }) {
  const { path } = useRoute()
  return <Link className="nav-i" to={to} aria-current={path === to ? 'page' : undefined}>{children}</Link>
}

// The gateway serves /logout; a full page load, not an in-app navigation.
const Logout = () => (
  <a href="/logout" className="btn btn-g icon-btn" aria-label="Déconnexion"><Icon d={ICONS.logout} /></a>
)

// Frame of every signed-in page: sidebar, then the page, whose PageHeader holds the bell.
// me is the GET /api/v1/me body; me.role picks the links. On phones employees get the tab bar instead of the menu.
export function Shell({ me, children }) {
  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        <Sidebar me={me} />
        <main className="shell-main">{children}</main>
        {me.role === 'employee' && <TabBar />}
      </div>
    </MeContext.Provider>
  )
}

// Shown under 960px only (app.css); the sky dot slides to the current tab.
function TabBar() {
  const { path } = useRoute()
  const at = TABS.findIndex(([to]) => to === path)
  return (
    <nav className="tabs" aria-label="Onglets">
      {at >= 0 && <span className="td" style={{ transform: `translateX(${at * 100}%)` }} aria-hidden="true"><i /></span>}
      {TABS.map(([to, label, d]) => (
        <Link key={to} to={to} aria-current={path === to ? 'page' : undefined}><Icon d={d} size={20} />{label}</Link>
      ))}
    </nav>
  )
}

// Under 960px (app.css) the sidebar folds into a top bar with the bell; its Menu button lays the links
// over the page. Employees have the tab bar, so no Menu.
function Sidebar({ me }) {
  const [open, setOpen] = useState(false)
  const narrow = useNarrow()
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
            <img src="/optispace.svg" alt="" style={{ height: 30 }} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span className="brand-name">OptiSpace</span>
              <span style={{ fontSize: 11, color: '#5B6676' }}>par 3istor</span>
            </span>
          </Link>
          <span className="actions">
            {narrow && me.role !== 'staff' && <Bell me={me} />}
            {me.role !== 'employee' && (
              <button ref={button} type="button" className="btn btn-s side-menu" aria-expanded={open} aria-controls="side-nav"
                onClick={() => setOpen(!open)}><Icon d={open ? ICONS.close : ICONS.menu} />Menu</button>
            )}
          </span>
        </div>
        <div id="side-nav" className={open ? 'side-nav open' : 'side-nav'}>
          <nav aria-label="Navigation" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
            onClick={(e) => e.target.closest('a') && setOpen(false)}>
            {navOf(me).map(([title, items]) => (
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

// Title row of every page: crumb, h1 and actions (children). It also holds the bell (the top bar does
// under 960px), so every page must render it. Staff get none: /notifications answers them 403.
// The crumb is "group / link" of the current path in the user's navigation.
export function PageHeader({ title, children }) {
  const me = useMe()
  const { path } = useRoute()
  const narrow = useNarrow()
  const bell = me && me.role !== 'staff' && !narrow
  const group = me && navOf(me).find(([, items]) => items.some(([to]) => to === path))
  const crumb = group && `${group[0]} / ${group[1].find(([to]) => to === path)[1]}`
  return (
    <div className="page-h">
      <div className="page-h-t">
        {crumb && <span className="crumb">{crumb}</span>}
        <h1>{title}</h1>
      </div>
      {(children || bell) && <div className="actions">{children}{bell && <Bell me={me} />}</div>}
    </div>
  )
}
