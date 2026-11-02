/* =====================================================================
   9. Hero : une trame de points, comme les salles d'un bâtiment vues d'en haut ;
      certaines s'allument en vert, orange (réservée, en attente : un halo pulse) ou rouge, et changent d'état
   ===================================================================== */
gsap.from('.hero-in', { y: 24, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, delay: 0.1 });
(() => {
  const cv = $('#heroDots'), hero = $('#top');
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d'), GAP = 46, STATE = ['green', 'orange', 'red'];
  const COL = { green: [34, 161, 90], orange: [240, 138, 36], red: [229, 72, 77] };
  const C0 = [214, 224, 244], C1 = [86, 128, 228];
  let W = 0, H = 0, dpr = 1, pts = [], marks = [], running = false, mouse = { x: -1e4, y: -1e4 }, lastDraw = 0, lastSwap = 0;
  const r = rng(29);
  const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  const lerp = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
  function layout() {
    const b = hero.getBoundingClientRect(); W = b.width; H = b.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const wide = W > 900, cx = W * (wide ? 0.7 : 0.62), cy = H * (wide ? 0.36 : 0.26), R = Math.max(W, H) * (wide ? 0.58 : 0.75);
    const ox = (W % GAP) / 2 + GAP / 2, oy = 30;
    pts = [];
    for (let y = oy; y < H; y += GAP) for (let x = ox; x < W; x += GAP) {
      const d = Math.hypot((x - cx) * 0.85, (y - cy) * 1.2) / R, f = Math.max(0, Math.min(1, 1 - d));
      pts.push({ x, y, f: f * f * (3 - 2 * f) });
    }
    const cand = pts.map((p, i) => i).filter(i => pts[i].f > 0.2);
    marks = [];
    for (let k = 0; k < 40 && marks.length < Math.min(15, cand.length); k++) {
      const i = cand[Math.floor(r() * cand.length)];
      if (!marks.some(m => m.i === i)) marks.push({ i, col: STATE[Math.floor(r() * 3)], prev: null, t0: -1e9, ph: r() });
    }
    draw(performance.now());
  }
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    for (const p of pts) {
      const dm = Math.hypot(p.x - mouse.x, p.y - mouse.y), hov = dm < 150 ? 1 - dm / 150 : 0;
      const f = Math.min(1, p.f + hov * 0.4);
      ctx.fillStyle = rgb(lerp(C0, C1, f), 0.3 + 0.7 * f);
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 + f * 3 + hov * 0.9, 0, 6.2832); ctx.fill();
    }
    for (const m of marks) {
      const p = pts[m.i], a = Math.max(0, Math.min(1, (now - m.t0) / 650));
      if (m.prev && a < 1) { ctx.fillStyle = rgb(COL[m.prev], 1 - a); ctx.beginPath(); ctx.arc(p.x, p.y, 5.2, 0, 6.2832); ctx.fill(); }
      if (m.col === 'orange' && !REDUCE) {
        const q = (now / 1600 + m.ph) % 1;
        ctx.strokeStyle = rgb(COL.orange, 0.45 * (1 - q) * a); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(p.x, p.y, 7 + q * 10, 0, 6.2832); ctx.stroke();
      }
      ctx.fillStyle = rgb(COL[m.col], a); ctx.beginPath(); ctx.arc(p.x, p.y, 5.2, 0, 6.2832); ctx.fill();
    }
  }
  function swap(now) {
    // une salle change d'état ; de temps en temps, une autre salle prend le relais
    const m = marks[Math.floor(r() * marks.length)];
    if (!m) return;
    if (r() < 0.3) {
      const free = pts.map((p, i) => i).filter(i => pts[i].f > 0.2 && !marks.some(o => o.i === i));
      if (free.length) { m.prev = null; m.i = free[Math.floor(r() * free.length)]; }
    } else m.prev = m.col;
    m.col = STATE[(STATE.indexOf(m.col) + 1 + Math.floor(r() * 2)) % 3]; m.t0 = now;
  }
  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (now - lastDraw < 32) return; // 30 images par seconde suffisent
    lastDraw = now;
    if (now - lastSwap > 1100) { swap(now); lastSwap = now; }
    draw(now);
  }
  layout();
  window.addEventListener('resize', () => { clearTimeout(layout.t); layout.t = setTimeout(layout, 120); });
  if (REDUCE) return;
  marks.forEach((m, k) => { m.t0 = performance.now() + 300 + k * 90; });
  hero.addEventListener('pointermove', (e) => { const b = hero.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; });
  hero.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4; });
  new IntersectionObserver(([en]) => { const on = en.isIntersecting; if (on && !running) { running = true; requestAnimationFrame(loop); } else if (!on) running = false; }).observe(hero);
})();
