// Captures de la scène de l'histoire à des étapes précises.
// Usage : npm run capture -- 1440x900 s1,s6j,s10        (ajouter "page" en 3e argument pour la page entière)
// Résultat : captures/<taille>_<label>.png
const fs = require('fs'), path = require('path');
const { chromium, ouvrir, allerA } = require('./navigateur');
(async () => {
  const [w, h] = (process.argv[2] || '1440x900').split('x').map(Number);
  const labels = (process.argv[3] || 's1,s2,s3,s4,s5,s6,s6j,s7,s8,s9,s10').split(',');
  const full = process.argv[4] === 'page';
  const out = path.join(__dirname, '..', 'captures'); fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(); const p = await ouvrir(b, w, h);
  for (const L of labels) {
    await allerA(p, L);
    const clip = full ? undefined : await p.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const f = path.join(out, `${w}x${h}_${L}.png`); await p.screenshot({ path: f, clip }); console.log(f);
  }
  await b.close();
})();
