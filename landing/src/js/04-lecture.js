/* =====================================================================
   8. Lecture de l'histoire : la section est épinglée et le scroll fixe une cible ; l'animation rejoint
      cette cible à vitesse limitée (jamais d'à-coup, jamais de défilement automatique de la page)
   ===================================================================== */
const PX_PER_UNIT = () => window.innerHeight * 1.2;   // hauteur de scroll par unité de timeline
const MAX_SPEED = 0.8;                                // unités de timeline par seconde, au plus vite (≈ 2,5 s par étape)
const PLAY = { cur: 0, target: 0, v: 0 };
const INSTANT = () => REDUCE || window.__NOSNAP;
function snapTo(t) { PLAY.cur = PLAY.target = t; PLAY.v = 0; tl.time(t); }
const storyST = ScrollTrigger.create({
  trigger: '#histoire', start: 'top top',
  end: () => '+=' + Math.round(tl.duration() * PX_PER_UNIT()),
  pin: true, anticipatePin: 1, invalidateOnRefresh: true,
  onUpdate: (self) => { PLAY.target = self.progress * tl.duration(); if (INSTANT()) snapTo(PLAY.target); },
  // sortie rapide (bouton « Passer », barre de défilement) : l'histoire se cale sur sa fin ou son début
  onLeave: () => { if (tl.duration() - PLAY.cur > 0.6) snapTo(tl.duration()); },
  onLeaveBack: () => { if (PLAY.cur > 0.6) snapTo(0); },
});
// La scène reste vivante (respiration, clignements, frappe au clavier) quand l'histoire est à l'écran
let storyVisible = false;
ScrollTrigger.create({ trigger: '#histoire', start: 'top bottom', end: () => storyST.end + window.innerHeight, onToggle: (self) => { storyVisible = self.isActive; } });

// Molette et pavé tactile : dans l'histoire, le défilement de la page est plafonné à la vitesse de l'animation,
// avec au plus une demi-seconde d'élan en réserve (rien ne continue de défiler une fois le geste fini).
let wheelPending = 0, scrollAcc = 0;
window.addEventListener('wheel', (e) => {
  if (INSTANT() || e.ctrlKey || !storyST.isActive) return;
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
  const p = storyST.progress;
  if ((dy < 0 && p <= 0.0005) || (dy > 0 && p >= 0.9995)) return; // aux deux bouts, on laisse sortir de l'histoire
  e.preventDefault();
  const cap = 0.45 * MAX_SPEED * PX_PER_UNIT();
  wheelPending = Math.max(-cap, Math.min(cap, wheelPending + dy));
}, { passive: false });

let lastTick = performance.now(), lastAmb = 0;
gsap.ticker.add(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
  if (wheelPending) {
    const maxPx = MAX_SPEED * 1.05 * PX_PER_UNIT() * dt;
    const s = Math.max(-maxPx, Math.min(maxPx, wheelPending));
    wheelPending -= s; if (Math.abs(wheelPending) < 0.5) wheelPending = 0;
    scrollAcc += s; const whole = Math.trunc(scrollAcc);
    if (whole) { window.scrollBy(0, whole); scrollAcc -= whole; }
  }
  // l'animation rejoint la cible : accélération douce, vitesse plafonnée, décélération en approche
  const d = PLAY.target - PLAY.cur;
  if (Math.abs(d) > 0.0004 || Math.abs(PLAY.v) > 0.001) {
    const want = Math.sign(d) * Math.min(MAX_SPEED, Math.max(Math.abs(d) * 2.4, 0.12));
    PLAY.v += (want - PLAY.v) * Math.min(1, dt * 5);
    let step = PLAY.v * dt;
    if (Math.sign(step) === Math.sign(d) && Math.abs(step) > Math.abs(d)) step = d;
    PLAY.cur = Math.max(0, Math.min(tl.duration(), PLAY.cur + step));
    if (Math.abs(PLAY.target - PLAY.cur) <= 0.0004) { PLAY.cur = PLAY.target; PLAY.v = 0; }
    tl.time(PLAY.cur);
    return;
  }
  // vie de fond : 30 images par seconde suffisent
  if (!storyVisible || REDUCE || document.hidden || now - lastAmb < 31) return;
  lastAmb = now; render();
});

// Boutons : étape précédente, étape suivante, passer l'histoire
const MAIN_STEPS = () => ['s1', 's2', 's3', 's4', 's5', 's6', 's6j', 's7', 's8', 's9', 's10'].map(k => tl.labels[k]).filter(v => v !== undefined);
function scrollToTime(t) { window.scrollTo(0, Math.round(storyST.start + (storyST.end - storyST.start) * (t / tl.duration()))); }
const btnPrev = $('#stepPrev'), btnNext = $('#stepNext');
if (btnNext) btnNext.addEventListener('click', () => { const t = MAIN_STEPS().find(v => v > PLAY.target + 0.02); scrollToTime(t === undefined ? tl.duration() : t); });
if (btnPrev) btnPrev.addEventListener('click', () => { const t = MAIN_STEPS().reverse().find(v => v < PLAY.target - 0.02); scrollToTime(t === undefined ? 0 : t); });
function skipTo(sel, offset = 0) {
  const st = ScrollTrigger.getAll().find(s => s.trigger && s.trigger.matches && s.trigger.matches(sel) && s.pin);
  const y = st ? st.start + 1 : $(sel).getBoundingClientRect().top + window.scrollY - offset;
  wheelPending = 0; window.scrollTo(0, Math.round(y));
}
$$('[data-skip]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); skipTo(b.getAttribute('data-skip'), 64); }));
// le compteur d'étapes active ou non les flèches
let lastNav = '';
setInterval(() => {
  if (!btnPrev) return;
  const k = `${PLAY.target > 0.02}|${PLAY.target < tl.duration() - 0.02}`;
  if (k !== lastNav) { btnPrev.disabled = PLAY.target <= 0.02; btnNext.disabled = PLAY.target >= tl.duration() - 0.02; lastNav = k; }
}, 250);

