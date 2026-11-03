// Vérifie que le texte des écrans (téléphone, ordinateur) n'est jamais coupé, à chaque étape et sur plusieurs tailles.
// Usage : npm run verif   (code de sortie 1 en cas de problème)
// Règles : tout texte visible de l'ordinateur reste dans son écran et dans la scène ;
// sur le téléphone, le bas de l'appareil peut sortir du cadre (choix voulu), mais les éléments clés doivent rester entiers.
const { chromium, ouvrir, allerA } = require('./navigateur');
const SIZES = (process.argv[2] || '1440x900,1280x720,768x1024,390x844,360x740').split(',');
const LABELS = (process.argv[3] || 's1,s4,s5,s6j,s7,s8,s9b,s10').split(',');
(async () => {
  const b = await chromium.launch(); let errors = 0;
  for (const sz of SIZES) {
    const [w, h] = sz.split('x').map(Number); const p = await ouvrir(b, w, h);
    for (const L of LABELS) {
      await allerA(p, L);
      const bad = await p.evaluate(() => {
        const stage = document.getElementById('stage').getBoundingClientRect(), out = [];
        const vis = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05) return false; } return true; };
        const hasText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        function check(root, screen, keys) {
          if (!vis(root)) return;
          const S = screen.getBoundingClientRect();
          const L = { l: Math.max(S.left, stage.left), r: Math.min(S.right, stage.right), t: Math.max(S.top, stage.top), b: Math.min(S.bottom, stage.bottom) };
          root.querySelectorAll('b,strong,p,span,em,h3').forEach((el) => {
            if (!hasText(el) || !vis(el) || el.closest('.dv-owner')) return;
            if (keys && !el.closest(keys)) return;
            const R = el.getBoundingClientRect(); if (R.width < 1) return;
            if (R.left < L.l - 0.5 || R.right > L.r + 0.5 || R.top < L.t - 0.5 || R.bottom > L.b + 0.5) out.push(el.textContent.trim().slice(0, 40));
          });
        }
        check(document.getElementById('devPc'), document.querySelector('.pc-screen'), null);
        check(document.getElementById('devPhone'), document.querySelector('.dp-screen'), '.dp-push,.dp-toast,.dp-lock,#phBookH,#phStH,#phBookJ,#phStJ,#phMineH,.dp-res');
        return out;
      });
      errors += bad.length;
      console.log(sz.padEnd(10), L.padEnd(4), bad.length ? 'TEXTE COUPÉ : ' + bad.join(' | ') : 'ok');
    }
    await p.close();
  }
  await b.close();
  process.exit(errors ? 1 : 0);
})();
