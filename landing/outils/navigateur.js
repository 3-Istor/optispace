// Ouvre la page construite dans Chromium (Playwright). GSAP et Three.js sont servis depuis node_modules
// s'ils y sont installés (tests hors ligne), sinon depuis leur CDN.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), NM = path.join(ROOT, 'node_modules');
const local = (p) => { const f = path.join(NM, p); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };

async function ouvrir(browser, w, h, page = 'optispace-landing-3d.html') {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +(process.env.DSF || 1) });
  p.on('pageerror', (e) => console.log('ERREUR JS', e.message));
  await p.route('**/*', (r) => {
    const u = r.request().url(); let body = null;
    if (u.endsWith('gsap.min.js')) body = local('gsap/dist/gsap.min.js');
    else if (u.endsWith('ScrollTrigger.min.js')) body = local('gsap/dist/ScrollTrigger.min.js');
    else { const m = u.match(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.+)$/); if (m) body = local('three/' + m[1]); }
    return body ? r.fulfill({ contentType: 'application/javascript', body }) : r.continue();
  });
  await p.addInitScript(() => { window.__NOSNAP = true; });   // sauts instantanés sur la timeline (tests)
  await p.goto('file://' + path.join(ROOT, page));
  await p.waitForTimeout(900);
  return p;
}
// Place l'histoire exactement sur un label (s1 … s10, s6j, s3r, s4t, s6n, s9b) ou un temps de timeline
async function allerA(p, L) {
  const t = await p.evaluate((L) => {
    const st = ScrollTrigger.getAll().find((s) => s.trigger && s.trigger.id === 'histoire'), tl = window.__optispace.tl;
    const t = isNaN(+L) ? tl.labels[L] : +L;
    window.scrollTo(0, st.start + (st.end - st.start) * (t / tl.duration())); return t;
  }, L);
  await p.waitForTimeout(400);
  await p.evaluate((t) => { const O = window.__optispace; O.tl.time(t); O.render(); }, t);
  await p.waitForTimeout(350);
  return t;
}
module.exports = { chromium, ouvrir, allerA };
