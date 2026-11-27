import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

// Browser APIs read at import time by the router and shared UI components.
globalThis.window = { addEventListener() {}, matchMedia() { return { matches: false } } }
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { PeriodSummary } = await server.ssrLoadModule('/src/pages/admin/Dashboard.jsx')
  const insights = {
    kpis: { observed_min: 0 },
    period: { from: '2026-11-17T00:00:00Z', to: '2026-11-17T10:00:00Z' },
    summary: { provider_status: 'insufficient_data', text: 'Texte de repli sans observation.' },
    warnings: ['MISSING_SENSOR_DATA'],
  }
  const render = (ins, period = 'today', loadError = null) => renderToStaticMarkup(createElement(PeriodSummary, {
    ins, period, loadError, onPeriodChange() {},
  }))

  const empty = render(insights)
  assert.match(empty, /disabled=""[^>]*>Générer la synthèse/)
  assert.match(empty, /Aucune mesure de présence disponible/)
  assert.match(empty, /Consulter les 7 derniers jours/)
  assert.match(empty, /aria-describedby="summary-no-measures"/)
  assert.match(empty, /La génération est désactivée/)
  assert.doesNotMatch(empty, /Texte de repli sans observation|Gabarit OptiSpace/)
  assert.doesNotMatch(render(insights, '7d'), /Consulter les 7 derniers jours/)
  assert.match(render(insights, '7d'), /Consulter les 30 derniers jours/)
  assert.match(render(insights, '30d'), /Vérifiez le boîtier/)
  assert.doesNotMatch(render(insights, '30d'), /Consulter les (7|30) derniers jours/)

  const available = { ...insights, kpis: { observed_min: 60 }, source_mode: 'simulated',
    summary: { provider_status: 'not_configured' } }
  const fallback = render(available, '7d')
  assert.doesNotMatch(fallback, /disabled=""[^>]*>Générer la synthèse/)
  assert.match(fallback, /Clé Groq absente/)
  assert.match(fallback, /Données simulées/)
  assert.match(fallback, /value="7d" selected=""/)

  const configured = render({ ...available, summary: { provider_status: 'not_requested' } })
  assert.doesNotMatch(configured, /Clé Groq absente|Assistée par Groq/)
  assert.match(render(null), /Calcul des indicateurs en cours/)
  assert.match(render(null, 'today', { status: 0, code: 'NETWORK' }), /connexion/i)
  console.log('Dashboard summary states ok')
} finally {
  await server.close()
  delete globalThis.window
}
