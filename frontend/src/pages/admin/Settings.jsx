import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import { errorText } from '../../messages.js'
import { fmtDuration } from '../../time.js'
import { Button } from '../../ui/Button.jsx'
import { EmptyState } from '../../ui/EmptyState.jsx'
import { Loader } from '../../ui/Loader.jsx'
import { PageHeader } from '../../ui/Shell.jsx'
import { Stepper } from '../../ui/Stepper.jsx'
import { toast } from '../../ui/Toast.jsx'

// [title, min key, max key, spec §3 defaults]
const TYPES = [
  ['Salles de réunion', 'meeting_min_min', 'meeting_max_min', [30, 180]],
  ['Bulles individuelles', 'booth_min_min', 'booth_max_min', [15, 60]],
]

function Row({ title, hint, last, children }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: last ? 0 : '1px solid #EEF1F5' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 500 }}>{title}</span>
        <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
      </span>
      {children}
    </div>
  )
}

const Block = ({ title, text, children }) => (
  <section className="card cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 280px) minmax(0, 1fr)', gap: 28, padding: '22px 24px' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 style={{ fontSize: 15 }}>{title}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>{text}</p>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
  </section>
)

// AdminReglages.dc.html: global absence delay and default durations by type.
export function Settings() {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/settings').then((s) => { setSaved(s); setDraft(s) }, setError)
  }, [])

  const header = <PageHeader crumb="Espaces / Paramètres" title="Paramètres des espaces" />
  if (!draft) {
    return <>{header}{error ? <EmptyState title="Chargement impossible">{errorText(error)}</EmptyState> : <Loader label="Chargement des paramètres" />}</>
  }

  const changes = Object.fromEntries(Object.entries(draft).filter(([k, v]) => saved[k] !== v))
  const dirty = Object.keys(changes).length > 0
  const bad = TYPES.some(([, lo, hi]) => draft[lo] >= draft[hi])
  const set = (key) => (v) => setDraft({ ...draft, [key]: v })

  async function save() {
    setBusy(true)
    try {
      const s = await api.patch('/settings', changes)
      setSaved(s)
      setDraft(s)
      toast('Paramètres enregistrés.')
    } catch (e) {
      toast(errorText(e), 'err')
    }
    setBusy(false)
  }

  return (
    <>
      {header}
      <Block title="Délai d’absence" text="Avant notification et libération.">
        <Row title="Délai avant libération" hint="Par défaut 10 min" last>
          <Stepper label="Délai avant libération" value={draft.absence_delay_min} text={`${draft.absence_delay_min} min`}
            step={1} min={1} max={60} onChange={set('absence_delay_min')} />
        </Row>
      </Block>

      <Block title="Durées de réservation" text="Bornes par défaut, par type d’espace.">
        {TYPES.map(([title, lo, hi, [dLo, dHi]], i) => {
          const wrong = draft[lo] >= draft[hi]
          return (
            <div key={lo} style={{ display: 'flex', flexDirection: 'column', padding: '4px 0 8px', borderTop: i ? '1px solid #E4E8EE' : 0 }}>
              <h3 style={{ fontSize: 14, paddingTop: 8 }}>{title}</h3>
              <Row title="Durée minimum" hint={`Par défaut ${fmtDuration(dLo)}`}>
                <Stepper label={`${title}, durée minimum`} value={draft[lo]} text={fmtDuration(draft[lo])} step={5} min={5} max={480} onChange={set(lo)} />
              </Row>
              <Row title="Durée maximum" hint={`Par défaut ${fmtDuration(dHi)}`} last>
                <Stepper label={`${title}, durée maximum`} value={draft[hi]} text={fmtDuration(draft[hi])} step={5} min={5} max={480} onChange={set(hi)} />
              </Row>
              <p role="status" style={{ margin: wrong ? '10px 0 0' : 0, fontSize: 13, color: '#B4232A' }}>
                {wrong && 'La durée minimum doit être inférieure à la durée maximum.'}
              </p>
            </div>
          )
        })}
      </Block>

      {dirty && (
        <div style={{ position: 'sticky', bottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderRadius: 10, background: '#0E1726', color: '#FFFFFF', boxShadow: '0 10px 30px rgba(14,23,38,0.2)' }}>
          <span>{bad ? 'Corrigez les durées incohérentes avant d’enregistrer' : 'Modifications non enregistrées'}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => setDraft(saved)}>Annuler</Button>
            <Button variant="p" busy={busy} disabled={bad} onClick={save}>Enregistrer</Button>
          </span>
        </div>
      )}
    </>
  )
}
