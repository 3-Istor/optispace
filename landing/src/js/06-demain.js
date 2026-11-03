/* =====================================================================
   10. Demain : vue éclatée du bâtiment
   ===================================================================== */
const bsvg = $('#bsvg'), B = { v: 0 };
const seg = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const bnums = $$('[data-bnum]'), bchaps = $$('.bchap');
function renderB(v, now) {
  const COL = { free: '#2FA66B', wait: '#F08A24', busy: '#E5484D' }, FILL = { free: '#C9EED6', wait: '#FFD9B0', busy: '#F8C3C6' };
  const gap = ease(seg(v, 1.0, 1.7)) * 28;
  for (let f = 0; f < 5; f++) {
    const g = bsvg.querySelector(`[data-floor="${f}"]`); if (!g) continue;
    const a = ease(seg(v, 0.05 + f * 0.12, 0.35 + f * 0.12));
    g.setAttribute('opacity', a.toFixed(3));
    g.setAttribute('transform', `translate(0 ${(-(1 - a) * 60 - gap * f).toFixed(1)})`);
    const fa = g.querySelector('[data-facade]'); if (fa) fa.setAttribute('opacity', (1 - ease(seg(v, 0.95, 1.5))).toFixed(3));
    const roof = g.querySelector('[data-roof]'); if (roof) roof.setAttribute('opacity', (1 - ease(seg(v, 0.95, 1.4))).toFixed(3));
    for (let r = 0; r < 8; r++) {
      const atlas = f === 2 && r === 7;
      const dist = Math.abs(f - 2) * 1.2 + Math.abs((r % 4) - 3) * 0.5 + (r < 4 ? 0.4 : 0);
      const lit = atlas ? v > 0.6 : v > 1.45 + dist * 0.18;
      let s = 'free';
      if (atlas && v < 1.4) s = 'busy';
      else if (lit) {
        const q = (f * 8 + r) * 9301 + Math.floor((now + (f * 8 + r) * 377) / 2600) * 49297;
        const k = ((q % 233280) + 233280) % 233280 / 233280;
        s = k < 0.45 ? 'busy' : (k < 0.62 ? 'wait' : 'free');
        if (v < 2.1) s = atlas ? 'busy' : 'free';
      }
      const room = bsvg.querySelector(`[data-room="${f}-${r}"]`), dot = bsvg.querySelector(`[data-rdot="${f}-${r}"]`);
      if (room) room.setAttribute('fill', lit ? FILL[s] : '#EEF1F6');
      if (dot) { dot.setAttribute('fill', lit ? COL[s] : '#C9D3E3'); dot.setAttribute('r', lit ? (s === 'wait' && !REDUCE ? 4.6 + Math.abs(Math.sin(now / 400)) * 1.8 : 4.8).toFixed(1) : '3.2'); }
    }
    for (let w = 0; w < 10; w++) {
      const fw = bsvg.querySelector(`[data-fw="${f}-${w}"]`); if (!fw) continue;
      const on = v > 0.4 + f * 0.12 && ((f * 10 + w) * 7 % 5) < 3;
      fw.setAttribute('opacity', on ? (0.25 * (1 - seg(v, 0.95, 1.4))).toFixed(2) : '0');
    }
  }
  const at = bsvg.querySelector('[data-atlas]');
  if (at) { at.setAttribute('opacity', seg(v, 0.5, 0.7).toFixed(2)); at.setAttribute('transform', `translate(0 ${(-gap * 2).toFixed(1)})`); }
  if (bnums[0]) bnums[0].textContent = Math.round(1 + 39 * seg(v, 1.45, 2.3));
  if (bnums[1]) bnums[1].textContent = Math.max(1, Math.min(5, Math.round(1 + 4 * seg(v, 1.5, 2.25))));
  const bi = Math.min(2, Math.floor(v * 0.999));
  bchaps.forEach((c, k) => { c.style.opacity = k === bi ? 1 : 0; });
}
const tlB = gsap.timeline({ paused: true });
tlB.to(B, { v: 3, duration: 3, ease: 'none', onUpdate: () => renderB(B.v, performance.now()) });
const buildST = ScrollTrigger.create({
  animation: tlB, trigger: '#demain', start: 'top top', end: () => '+=' + Math.round(window.innerHeight * 3),
  pin: true, scrub: REDUCE ? true : 0.8, invalidateOnRefresh: true,
});
renderB(0, 0);
gsap.ticker.add(() => { if (B.v > 2.1) { const r = bsvg.getBoundingClientRect(); if (r.bottom > 0 && r.top < window.innerHeight) renderB(B.v, performance.now()); } });

// Après l'histoire, l'en-tête et la page reviennent à la lumière du jour
ScrollTrigger.create({
  trigger: '#demain', start: 'top 70px',
  onEnter: () => { gsap.to(headerEl, { '--hbg': HEAD.day[0], '--hink': HEAD.day[1], '--hline': HEAD.day[2], duration: 0.4, overwrite: 'auto' }); gsap.to(document.body, { backgroundColor: AMB.day.bodyBg, duration: 0.4, overwrite: 'auto' }); },
  onLeaveBack: () => { gsap.to(headerEl, { '--hbg': HEAD.evening[0], '--hink': HEAD.evening[1], '--hline': HEAD.evening[2], duration: 0.3, overwrite: 'auto' }); gsap.to(document.body, { backgroundColor: AMB.evening.bodyBg, duration: 0.3, overwrite: 'auto' }); },
});
$$('.reveal').forEach(el => gsap.from(el, { y: 24, autoAlpha: 0, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } }));
window.addEventListener('load', () => ScrollTrigger.refresh());
