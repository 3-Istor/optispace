import { useState } from 'react'
import { api } from '../../api.js'
import { DEVICE_STATES, deviceState, errorText, floorLabel, SPACE_TYPES } from '../../messages.js'
import { useRoute } from '../../router.jsx'
import { fmtAgo } from '../../time.js'
import { usePolling } from '../../usePolling.js'
import { Button } from '../../ui/Button.jsx'
import { ConfirmDialog } from '../../ui/ConfirmDialog.jsx'
import { EmptyState } from '../../ui/EmptyState.jsx'
import { Icon, ICONS } from '../../ui/Icon.jsx'
import { Loader } from '../../ui/Loader.jsx'
import { LiveDot } from '../../ui/motion.jsx'
import { PageHeader } from '../../ui/Shell.jsx'
import { StatusBadge } from '../../ui/StatusBadge.jsx'
import { toast } from '../../ui/Toast.jsx'

const loader = (spacesPath) => async () => {
  const [devices, spaces] = await Promise.all([api.get('/devices'), api.get(spacesPath)])
  return { devices, spaces }
}
const loadFm = loader('/spaces')
const loadStaff = loader('/staff/spaces') // every company's spaces, with their organization

const ORDER = ['new', 'offline', 'sealed', 'active'] // what needs action first
// Fleet summary, also the list filter: [key, word after the count, states, dot colour]
const FLEET = [['all', 'boîtier', ORDER], ['active', 'en ligne', ['active'], '#1A8F4E'], ['offline', 'hors ligne', ['offline'], '#D63F45'], ['sealed', 'scellé', ['new', 'sealed'], '#D9771F']]
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, color: '#5B6676', overflowWrap: 'anywhere' }
const STEPS = ['Affecter', 'Desceller', 'Actif']

const Dot = ({ state, children }) => <span className="st" style={{ fontSize: 12, color: '#3A4555' }}><LiveDot color={DEVICE_STATES[state][1]} quiet={state !== 'active'} />{children ?? DEVICE_STATES[state][0]}</span>

// "depuis 34 s", "depuis 09:12", "depuis hier à 09:12"
const since = (iso) => `depuis ${fmtAgo(iso).replace(/^(il y a|à) /, '')}`

// A space holds one device, so spaces equipped by another device are left out. Staff see
// every company, so their options are grouped by organization instead of by type.
function SpaceSelect({ device, devices, spaces, value, onChange, style, staff }) {
  const taken = new Set(devices.filter((d) => d.space && d.id !== device.id).map((d) => d.space.id))
  const free = spaces.filter((s) => !taken.has(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const groups = staff ? [...new Set(free.map((s) => s.organization))].sort().map((o) => [o, o]) : Object.entries(SPACE_TYPES)
  return (
    <label className="field" style={style}><span className="lbl">Espace</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
        <option value="">Aucun espace</option>
        {groups.map(([key, label]) => (
          <optgroup key={key} label={label}>
            {free.filter((s) => s[staff ? 'organization' : 'type'] === key).map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {staff ? `${SPACE_TYPES[s.type]} · ` : ''}{floorLabel(s.floor)}{s.is_active === false ? ' (hors service)' : ''}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function AssignForm({ busy, onAssign, ...pick }) {
  const [spaceId, setSpaceId] = useState('')
  return (
    <form onSubmit={(e) => { e.preventDefault(); onAssign(spaceId) }} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
      <SpaceSelect {...pick} value={spaceId} onChange={setSpaceId} style={{ flex: '0 1 300px', minWidth: 0 }} />
      <Button variant="p" type="submit" busy={busy} disabled={!spaceId}>Affecter</Button>
    </form>
  )
}

// AdminBoitier.dc.html: list, commissioning (assign then unseal), maintenance (seal).
// Staff assign, move and detach; facility managers seal and unseal.
export function Devices({ me }) {
  const staff = me.role === 'staff'
  const { query } = useRoute()
  const { data, error, refresh } = usePolling(staff ? loadStaff : loadFm, 5000)
  const [selId, setSelId] = useState(query.get('id'))
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(null)
  const [ask, setAsk] = useState(null) // open confirmation: 'unseal', 'seal' or 'move'
  const [moveTo, setMoveTo] = useState('')

  const count = data?.devices.length
  const header = <PageHeader title="Boîtiers" />
  if (!data) return <>{header}{error ? <EmptyState title="Chargement impossible">{errorText(error)}</EmptyState> : <Loader label="Chargement des boîtiers" />}</>
  if (!count) return <>{header}<EmptyState title="Aucun boîtier">Les boîtiers apparaissent ici dès leur première connexion.</EmptyState></>

  const devices = [...data.devices].sort((a, b) => ORDER.indexOf(deviceState(a)) - ORDER.indexOf(deviceState(b)) || a.id.localeCompare(b.id))
  const cur = devices.find((d) => d.id === selId) ?? devices[0]
  const st = deviceState(cur)
  const space = data.spaces.find((s) => s.id === cur.space?.id)
  const floorOf = (d) => data.spaces.find((x) => x.id === d.space?.id)?.floor
  // "2e étage · acme": what follows the room name
  const place = (d) => [floorOf(d) != null && floorLabel(floorOf(d)), staff && d.space?.organization].filter(Boolean).join(' · ')
  const where = cur.space ? [cur.space.name, place(cur)].filter(Boolean).join(' · ') : 'Non affecté'
  const sealed = cur.seal !== 'unsealed'
  const step = !cur.space ? 0 : sealed ? 1 : 2
  const path = `/devices/${encodeURIComponent(cur.id)}`

  // Pins the selection so a refresh reordering the list cannot retarget the open dialog.
  function openConfirm(kind) {
    setSelId(cur.id)
    setMoveTo(cur.space?.id ?? '')
    setAsk(kind)
  }

  async function run(name, call, done) {
    setBusy(name)
    try {
      await call()
      toast(done)
      setAsk(null)
    } catch (e) {
      toast(errorText(e), 'err')
    }
    setBusy(null)
    refresh()
  }

  const assign = (spaceId) => run('assign', () => api.patch(path, { space_id: spaceId || null }),
    spaceId ? 'Boîtier affecté. Descellez-le pour qu’il mesure la présence.' : 'Boîtier désaffecté et scellé.')
  const unseal = () => run('unseal', () => api.post(`${path}/unseal`, { confirm: true }),
    `Boîtier actif dans ${cur.space?.name}. Il mesure la présence.`)
  const seal = () => run('seal', () => api.post(`${path}/seal`), 'Boîtier en maintenance : il ne mesure plus la présence.')
  // PATCH reseals even on the same space, so an unchanged choice just closes.
  const move = () => (moveTo === (cur.space?.id ?? '') ? setAsk(null) : assign(moveTo))
  const pick = { device: cur, devices, spaces: data.spaces, staff }

  const counts = Object.fromEntries(FLEET.map(([key, , states]) => [key, devices.filter((d) => states.includes(deviceState(d))).length]))
  const shown = devices.filter((d) => FLEET.find((f) => f[0] === filter)[2].includes(deviceState(d)))

  return (
    <>
      {header}
      <div role="group" aria-label="Filtrer les boîtiers" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {FLEET.map(([key, word, , color]) => (
          <button key={key} type="button" className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            <span className="st">
              {color && <span className="dot" style={{ background: color }} />}
              <b className="num" style={{ fontWeight: 600, color: '#0E1726' }}>{counts[key]}</b>{word}{key !== 'offline' && key !== 'active' && counts[key] > 1 ? 's' : ''}
            </span>
          </button>
        ))}
      </div>
      <div className="cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 380px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <section className="card" aria-label="Liste des boîtiers" style={{ overflow: 'hidden' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
            {shown.map((d) => {
              const on = d.id === cur.id
              const s = deviceState(d)
              return (
                <li key={d.id}>
                  <button type="button" className="row" aria-pressed={on} onClick={() => setSelId(d.id)}
                    style={{ width: '100%', minHeight: 44, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '4px 12px', padding: '11px 16px', border: 0, background: on ? '#F3F6FD' : 'transparent', font: 'inherit', color: 'inherit', textAlign: 'left' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.35 }}>
                      <span style={{ fontWeight: 500 }}>{d.space?.name ?? 'Non affecté'}{place(d) && <span className="muted" style={{ fontWeight: 400 }}> · {place(d)}</span>}</span>
                      <span className="num" style={MONO}>{d.id}</span>
                    </span>
                    <Dot state={s}>{s === 'offline' ? `Hors ligne ${since(d.last_seen_at)}` : undefined}</Dot>
                  </button>
                </li>
              )
            })}
            {!shown.length && <li className="muted" style={{ padding: '12px 14px', fontSize: 13 }}>Aucun boîtier dans cette catégorie.</li>}
          </ul>
          <p className="muted" style={{ margin: 0, padding: '12px 14px', borderTop: '1px solid #EEF1F5', fontSize: 12, lineHeight: 1.5 }}>
            Les boîtiers apparaissent ici dès leur première connexion.
          </p>
        </section>

        <section className="card fade" key={cur.id} aria-labelledby="dev-h" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18, padding: '20px 24px', borderBottom: '1px solid #E4E8EE' }}>
            <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true" style={{ flex: 'none' }}>
              <rect x="1" y="1" width="52" height="52" rx="12" fill="#F7F8FA" stroke="#DCE1E8" />
              <rect x="8" y="8" width="38" height="38" rx="9" fill="#0E1726" />
              <circle cx="27" cy="27" r="9" fill="none" stroke={DEVICE_STATES[st][1]} strokeWidth="3" />
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 id="dev-h" style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{cur.space?.name ?? 'Boîtier non affecté'}</h2>
                <Dot state={st} />
              </div>
              <span className="muted" style={{ fontSize: 13 }}>{place(cur) && `${place(cur)} · `}<span className="num" style={MONO}>{cur.id}</span></span>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gridAutoFlow: 'column', gridTemplateRows: 'auto auto', gap: '4px 26px', margin: 0, fontSize: 12 }}>
              <dt className="muted">Dernière connexion</dt>
              <dd className="num" style={{ margin: 0, fontSize: 13, fontWeight: 500, color: cur.online ? '#0E1726' : '#B4232A' }}>{fmtAgo(cur.last_seen_at)}</dd>
              <dt className="muted">Firmware</dt>
              <dd className="num" style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{cur.firmware_version || 'Inconnu'}</dd>
            </dl>
          </div>

          {sealed && (
            <ol aria-label="Étapes de mise en service" style={{ listStyle: 'none', margin: 0, padding: '16px 24px', display: 'flex', gap: 18, flexWrap: 'wrap', borderBottom: '1px solid #EEF1F5' }}>
              {STEPS.map((label, i) => (
                <li key={label} aria-current={i === step ? 'step' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: i === step ? 500 : 400, color: i === step ? '#0E1726' : i < step ? '#3A4555' : '#8A94A3' }}>
                  <span aria-hidden="true" style={{
                    width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600,
                    ...(i < step ? { background: '#1E56D6', color: '#FFFFFF' } : i === step ? { background: '#EAF0FD', color: '#1747B3', boxShadow: 'inset 0 0 0 1px #BCD0F7' } : { background: '#F1F3F6', color: '#8A94A3' }),
                  }}>{i < step ? '✓' : i + 1}</span>
                  {label}{i < step && <span className="sr-only"> (fait)</span>}
                </li>
              ))}
            </ol>
          )}

          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {!cur.online && (
              <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 8, background: '#FCEFEF', color: '#8E1F25', lineHeight: 1.5 }}>
                <Icon d={ICONS.warn} size={18} style={{ color: '#D63F45', flex: 'none' }} />
                <span>
                  Le boîtier n’a plus donné de nouvelles depuis plus de 30 secondes. Dernière connexion {fmtAgo(cur.last_seen_at)}.
                  {!sealed && cur.space && ' L’espace passe en « Hors ligne » tant qu’il est hors ligne : aucune réservation n’y est libérée.'}
                </span>
              </div>
            )}

            {step === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <h3 style={{ fontSize: 17 }}>{staff ? 'Affecter le boîtier à un espace' : 'Boîtier non affecté'}</h3>
                  <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>Le boîtier est scellé : il ne mesure rien tant qu’il n’est pas affecté puis descellé.</p>
                </div>
                {staff
                  ? <AssignForm key={cur.id} {...pick} busy={busy === 'assign'} onAssign={assign} />
                  : <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>L’équipe OptiSpace l’affectera à l’un de vos espaces.</p>}
              </div>
            )}

            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <h3 style={{ fontSize: 17 }}>Desceller le boîtier</h3>
                  <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>{staff ? 'Un facility manager de l’entreprise le descellera.' : 'Descellez-le pour qu’il mesure la présence dans cet espace.'}</p>
                </div>
                <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 120px) minmax(0, 1fr)', gap: '8px 14px', margin: 0 }}>
                  <dt className="muted">Espace</dt><dd style={{ margin: 0, fontWeight: 500 }}>{where}</dd>
                  {space && <><dt className="muted">Type</dt><dd style={{ margin: 0 }}>{SPACE_TYPES[space.type]}</dd></>}
                </dl>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {!staff && <Button variant="p" onClick={() => openConfirm('unseal')}><Icon d={ICONS.lock} />Desceller</Button>}
                  {staff && <Button variant="g" onClick={() => openConfirm('move')}>Changer d’espace</Button>}
                </div>
              </div>
            )}

            {step === 2 && (
              <>
                {!staff && (
                  <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 160px) minmax(0, 1fr)', gap: '10px 14px', margin: 0 }}>
                    <dt className="muted">État de l’espace</dt><dd style={{ margin: 0 }}>{space ? <StatusBadge state={space.space_state} releaseAt={space.current_reservation?.release_at} /> : 'Inconnu'}</dd>
                  </dl>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {staff
                    ? <Button onClick={() => openConfirm('move')}>Changer d’espace</Button>
                    : <Button onClick={() => openConfirm('seal')}>Mettre en maintenance</Button>}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog open={ask === 'unseal'} title="Desceller le boîtier ?" confirmLabel="Desceller"
        busy={busy === 'unseal'} onConfirm={unseal} onCancel={() => setAsk(null)}>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>Le boîtier mesurera la présence dans {cur.space?.name}.</p>
      </ConfirmDialog>
      <ConfirmDialog open={ask === 'seal'} title="Mettre en maintenance ?" confirmLabel="Mettre en maintenance" danger
        busy={busy === 'seal'} onConfirm={seal} onCancel={() => setAsk(null)}>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>Le boîtier sera rescellé.</p>
      </ConfirmDialog>
      <ConfirmDialog open={ask === 'move'} title="Changer d’espace" confirmLabel={moveTo ? 'Affecter' : 'Désaffecter'}
        busy={busy === 'assign'} onConfirm={move} onCancel={() => setAsk(null)}>
        <SpaceSelect {...pick} value={moveTo} onChange={setMoveTo} />
        {!sealed && <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>Le boîtier sera rescellé.</p>}
      </ConfirmDialog>
    </>
  )
}
