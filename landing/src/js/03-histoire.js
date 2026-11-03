
/* =====================================================================
   4. Timeline principale (une seule, liée au scroll) : même histoire, mêmes étapes
   ===================================================================== */
const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' }, paused: true });
const LED_EVENTS = [[0, 'green']];
const ENV = { clock: 540 }, DASH = { k1: 0, k2: 0, k3: 0 };
for (const id in P) P[id].plan = { d: 0, ry: P[id].st.ry };

function pose(id, at, props, dur = 0.08, ease = 'back.out(1.5)') { tl.to(P[id].st, Object.assign({ duration: dur, ease }, props), at); }
const nearDeg = (from, to) => from + ((((to - from) % 360) + 540) % 360 - 180);
// marche le long d'une suite de points (mètres), à vitesse constante (mètres par unité de timeline)
function walk(id, at, pts, speed = 11) {
  const p = P[id], st = p.st; let last = p.path[p.path.length - 1], d = last.d;
  const d0 = p.plan.d;
  for (const [x, z] of pts) { d += Math.hypot(x - last.x, z - last.z); last = { x, z, d }; p.path.push(last); }
  const first = p.path[p.path.length - pts.length], prev = p.path[p.path.length - pts.length - 1];
  const h0 = Math.atan2(first.x - prev.x, first.z - prev.z) / D2R, ry0 = nearDeg(p.plan.ry, h0);
  const dur = (d - d0) / speed;
  tl.to(st, { ry: ry0, duration: 0.04, ease: 'sine.out' }, at - 0.04);
  tl.set(st, { mv: 1 }, at);
  tl.to(st, { wk: 1, duration: 0.05, ease: 'sine.out' }, at);
  tl.to(st, { d, duration: dur, ease: 'none' }, at);
  tl.to(st, { wk: 0, duration: 0.05, ease: 'sine.in' }, at + dur - 0.04);
  const pl = p.path[p.path.length - 2], hl = Math.atan2(last.x - pl.x, last.z - pl.z) / D2R, ryE = nearDeg(ry0, hl);
  tl.set(st, { mv: 0, ry: ryE }, at + dur);
  p.plan = { d, ry: ryE };
  return { start: at, end: at + dur };
}
// déplacement instantané hors champ (saut dans l'itinéraire)
function teleport(id, at, x, z, ry) {
  const p = P[id]; const last = p.path[p.path.length - 1]; const n = { x, z, d: last.d + 0.0001, jump: true };
  p.path.push(n); tl.set(p.st, { d: n.d, ry }, at); p.plan = { d: n.d, ry };
}
function standUp(id, at) {
  const st = P[id].st;
  tl.to(st, { lean: 20, typing: 0, chat: 0, duration: 0.04, ease: 'sine.in' }, at);
  tl.to(st, Object.assign({ sit: 0, duration: 0.12, ease: 'back.out(1.4)' }, REST), at + 0.04);
  return at + 0.16;
}
function sitDown(id, at, seat, arms) {
  const p = P[id], ry = nearDeg(p.plan.ry, seat.ry / D2R);
  tl.to(p.st, { ry, duration: 0.06, ease: 'sine.inOut' }, at);
  tl.to(p.st, Object.assign({ sit: 1, duration: 0.12, ease: 'power2.out' }, arms), at + 0.04);
  p.plan.ry = ry; return at + 0.16;
}
function take(id, at) {
  // réaction de surprise : petit saut, étirement, bras qui s'ouvrent, puis retour élastique
  const st = P[id].st;
  tl.to(st, { sq: 0.9, duration: 0.025, ease: 'power2.in' }, at);
  tl.to(st, { sq: 1.08, hop: 0.12, sL: 30, sR: 30, duration: 0.04, ease: 'power2.out' }, at + 0.025);
  tl.to(st, { sq: 1, hop: 0, duration: 0.1, ease: 'bounce.out' }, at + 0.065);
  tl.to(st, { sL: 8, sR: 18, duration: 0.08 }, at + 0.12);
}
function clock(at, dur, to, ease = 'power1.inOut') { tl.to(ENV, { clock: to, duration: dur, ease }, at); }
const LEDP = { pulse: 0 };
function led(at, color, dur = 0.05) {
  const c = new THREE.Color(LED[color]).convertLinearToSRGB(); LED_EVENTS.push([at, color]);
  const cs = new THREE.Color(LED[color]);
  tl.to(LEDC, { r: cs.r, g: cs.g, b: cs.b, duration: dur, ease: 'none' }, at);
  tl.to('.ledFill', { fill: LED[color], duration: dur, ease: 'none' }, at);
  tl.fromTo(LEDP, { pulse: 1 }, { pulse: 0, duration: 0.18, ease: 'power2.out', immediateRender: false }, at);
}
// ondes radar et signaux sur chaque personne détectée
const pingSprites = [];
const PING = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(64, 64, 60, 0, 6.2832); g.fill();
  g.lineWidth = 7; g.strokeStyle = '#FFFFFF'; g.beginPath(); g.arc(64, 64, 54, 0, 6.2832); g.stroke();
  g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(64, 64, 22, 0, 6.2832); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function radar(at, ids, color, hold) {
  rings.forEach((R, i) => {
    tl.fromTo(R.st, { s: 0.15, o: 0.9 }, { s: 3.4, o: 0, duration: 0.34, ease: 'power1.out', immediateRender: false }, at + i * 0.07);
    tl.set(R.m.color, { r: new THREE.Color(color).r, g: new THREE.Color(color).g, b: new THREE.Color(color).b }, at);
  });
  ids.forEach((id) => {
    const p = P[id], sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: PING, color, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false }));
    sp.scale.setScalar(0.01); scene.add(sp); const S = { s: 0.01, o: 0 }; pingSprites.push({ sp, S, id });
    const t = at + 0.12;
    tl.fromTo(S, { s: 0.05, o: 0 }, { s: 0.42, o: 1, duration: 0.08, ease: 'back.out(2)', immediateRender: false }, t);
    tl.to(S, { s: 0.3, duration: 0.1 }, t + 0.1);
    tl.to(S, { o: 0, s: 0.05, duration: 0.1 }, hold);
  });
}
// caméra : le cadrage grand écran (VIEW) et petit écran (NVIEW) sont animés ensemble
function camTo(at, dur, v, ease = 'power2.inOut', vn = v) {
  tl.to(VIEW, Object.assign({ duration: dur, ease }, v), at);
  tl.to(NVIEW, Object.assign({ duration: dur, ease }, vn), at);
}
const CAM = {
  building: { tx: 0, ty: 1.0, tz: 0, h: 34 },
  floor: { tx: 0.5, ty: 0, tz: 0, h: 19 },
  both: { tx: 0.6, ty: 0.6, tz: -3.4, h: 11.5 },
  atlas: { tx: 6.4, ty: 0.7, tz: -4.4, h: 7.4 },
  meet: { tx: 6.5, ty: 0.9, tz: -5.0, h: 6.6 },
  box: { tx: 6.5, ty: 0.75, tz: -5, h: 2.6 },
  clock: { tx: 7.8, ty: 0.85, tz: -8.0, h: 2.3 },
  corr: { tx: -3.6, ty: 0.6, tz: 2.4, h: 9.0 },
  corr2: { tx: 2.4, ty: 0.6, tz: -0.6, h: 8.2 },
  hugo: { tx: -5.6, ty: 0.7, tz: -3.2, h: 5.4 },
  joe: { tx: -7.2, ty: 0.7, tz: -3.0, h: 6.2 },
  arthur: { tx: 7.7, ty: 1.0, tz: 6.3, h: 7.2 },
  // cadrages avec un écran à l'image : le personnage reste dans la partie libre de la scène
  hugoP: { tx: -3.38, ty: 0.7, tz: -5.57, h: 8 }, hugoPN: { tx: -2.66, ty: 0.7, tz: -6.3, h: 8.5 },
  joeP: { tx: -6.83, ty: 0.7, tz: -5.32, h: 7 }, joePN: { tx: -6.18, ty: 0.7, tz: -5.98, h: 7.5 },
  visio: { tx: 3.7, ty: 0.6, tz: -2.2, h: 8.6 },
  present: { tx: 10.05, ty: 1.1, tz: 2.25, h: 8.2 },
};
Object.assign(VIEW, CAM.building); Object.assign(NVIEW, CAM.building);

// ===== Écrans de l'application : téléphone et ordinateur =====
// Les maquettes ont une taille logique fixe (300 × 620 pour le téléphone) et sont mises à l'échelle d'un bloc :
// le texte ne se recompose jamais, quelle que soit la taille de la scène.
const devPhone = $('#devPhone'), devPhoneIn = $('#devPhoneIn'), dpApp = $('#dpApp');
const devPc = $('#devPc'), devPcIn = $('#devPcIn'), pcApp = $('#pcApp'), devDim = $('#devDim');
const pcCursor = $('#pcCursor'), pcClick = $('#pcClick'), dpTap = $('#dpTap'), caretEl = $('#pcStart .caret');
const PH_VIEWS = $$('.dpv'), PC_VIEWS = $$('.pcv'), VZ_TILES = $$('#vzGrid .vz-t');
const DEV = { pz: 0 }, CUR = { p: 0 }, TAP = { i: 0 }, CARET = { on: 0 };
gsap.set([devPhone, devPc, devDim], { autoAlpha: 0 });
gsap.set(devPhoneIn, { y: 60 });
gsap.set([...PH_VIEWS, ...PC_VIEWS, '#pcSkel', '#pcEmpty', '.dv .sw > .swB', pcCursor, pcClick, dpTap], { autoAlpha: 0 });
gsap.set(['.dp-push', '.pc-notif'], { autoAlpha: 0, y: -14 });
gsap.set(['.dp-toast', '.ap-toast'], { autoAlpha: 0, y: 8 });
gsap.set('#pcStart', { '--tw': '0px' });
const JOE_SCREEN = new THREE.Vector3(-8.6, 1.04, -2.6), HUGO_SCREEN = new THREE.Vector3(-5.4, 1.04, -2.6);

function phView(v, at, dur = 0.04) { PH_VIEWS.forEach(el => tl.to(el, { autoAlpha: el.dataset.v === v ? 1 : 0, duration: dur, ease: 'none' }, at)); }
function pcView(v, at, dur = 0.04) { PC_VIEWS.forEach(el => tl.to(el, { autoAlpha: el.dataset.v === v ? 1 : 0, duration: dur, ease: 'none' }, at)); }
function phoneShow(at, v) {
  if (v) phView(v, at - 0.002, 0.001);
  tl.to(devPhone, { autoAlpha: 1, duration: 0.06, ease: 'power2.out' }, at);
  tl.to(devPhoneIn, { y: 0, duration: 0.1, ease: 'power3.out' }, at);
}
function phoneHide(at) {
  tl.to(devPhone, { autoAlpha: 0, duration: 0.06, ease: 'power2.in' }, at);
  tl.to(devPhoneIn, { y: 60, duration: 0.07, ease: 'power2.in' }, at);
}
// l'ordinateur sort de l'écran de la scène (zoom depuis le moniteur), puis y retourne ou s'efface
const PC_MODES = [];   // [début, mode, point d'ancrage dans la scène, propriétaire]
function pcShow(at, mode, anchor, owner, view, dim) {
  PC_MODES.push([at - 0.003, mode, anchor, owner]);
  pcView(view, at - 0.002, 0.001);
  tl.to(devPc, { autoAlpha: 1, duration: 0.05, ease: 'none' }, at);
  tl.to(DEV, { pz: 1, duration: 0.2, ease: 'power3.out' }, at);
  if (dim) tl.to(devDim, { autoAlpha: dim, duration: 0.12, ease: 'none' }, at);
}
function pcHide(at, zoomBack = false) {
  if (zoomBack) tl.to(DEV, { pz: 0, duration: 0.15, ease: 'power2.in' }, at);
  tl.to(devPc, { autoAlpha: 0, duration: zoomBack ? 0.15 : 0.07, ease: zoomBack ? 'power4.in' : 'power2.in' }, at);
  tl.to(devDim, { autoAlpha: 0, duration: 0.1, ease: 'none' }, at);
  tl.set(DEV, { pz: 0 }, at + 0.16);
}
function swap(sel, at, d = 0.05) { tl.to(sel + ' > .swA', { autoAlpha: 0, duration: d, ease: 'none' }, at); tl.to(sel + ' > .swB', { autoAlpha: 1, duration: d, ease: 'none' }, at); }
function push(sel, at) { tl.to(sel, { autoAlpha: 1, y: 0, duration: 0.07, ease: 'back.out(1.4)' }, at); }
function pushOut(sel, at) { tl.to(sel, { autoAlpha: 0, y: -14, duration: 0.05, ease: 'power2.in' }, at); }
function toast(sel, at) { tl.to(sel, { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power2.out' }, at); }
function toastOut(sel, at) { tl.to(sel, { autoAlpha: 0, y: 8, duration: 0.05, ease: 'power2.in' }, at); }
function vibrate(at) { tl.to(devPhone, { keyframes: { x: [0, -4, 4, -3, 3, -2, 0] }, duration: 0.07, ease: 'none' }, at); }
function tap(id, at) { pose(id, at, { eR: -100 }, 0.03); pose(id, at + 0.035, { eR: -88 }, 0.03); }
// toucher sur le téléphone (cible : TAP_PTS[i]) et clic de souris sur l'ordinateur
function tapOn(i, at, who) {
  tl.set(TAP, { i }, at - 0.002);
  tl.set(dpTap, { autoAlpha: 0.95, scale: 0.45 }, at);
  tl.to(dpTap, { autoAlpha: 0, scale: 1.25, duration: 0.07, ease: 'power2.out' }, at + 0.001);
  if (who) tap(who, at - 0.02);
}
function click(at) {
  tl.set(pcClick, { autoAlpha: 0.95, scale: 0.4 }, at);
  tl.to(pcClick, { autoAlpha: 0, scale: 1.3, duration: 0.07, ease: 'power2.out' }, at + 0.001);
}
function face(id, at, deg, dur = 0.07) { const p = P[id], ry = nearDeg(p.plan.ry, deg); pose(id, at, { ry }, dur, 'sine.inOut'); p.plan.ry = ry; }

// ambiances : lumière de la maquette, fond de la scène, couleurs du texte et de l'en-tête
const AMB = {
  day:     { bg: ['#EEF2F7', '#DDE5EF'], sky: '#FFFFFF', gnd: '#E3E7EE', hi: 1.3, sun: '#FFF4E6', si: 2.0, az: 330, el: 55, lamps: 0, night: 0, fill: 0.45, bodyBg: '#F5F7FA', ink: '#0B1B33', muted: '#4A5A72', accent: '#1E56D6', line: '#DCE3EC', glass: 'rgba(255,255,255,0.78)', gl: 'rgba(11,27,51,0.08)' },
  late:    { bg: ['#F4EFE9', '#E5DDD3'], sky: '#FFFAF2', gnd: '#E6E3DE', hi: 1.25, sun: '#FFF0DE', si: 1.7, az: 305, el: 40, lamps: 0, night: 0, fill: 0.3, bodyBg: '#F7F3EE', ink: '#0B1B33', muted: '#4A5A72', accent: '#1E56D6', line: '#E2DDD6', glass: 'rgba(255,255,255,0.78)', gl: 'rgba(11,27,51,0.08)' },
  evening: { bg: ['#F2E2DA', '#DCD3E6'], sky: '#FFF0E6', gnd: '#DCDCE8', hi: 1.2, sun: '#FFCDA6', si: 1.15, az: 300, el: 32, lamps: 1, night: 0.2, fill: 0.3, bodyBg: '#F3EAE3', ink: '#0B1B33', muted: '#4A5A72', accent: '#1E56D6', line: '#E3D9D0', glass: 'rgba(255,255,255,0.78)', gl: 'rgba(11,27,51,0.08)' },
  night:   { bg: ['#1B2542', '#0D1428'], sky: '#8EA4E0', gnd: '#252E4A', hi: 0.34, sun: '#9DB2EA', si: 0.32, az: 330, el: 42, lamps: 0, night: 1, fill: 0.05, bodyBg: '#0A1124', ink: '#EEF2F8', muted: '#A9B6CA', accent: '#8FB2FF', line: '#25324F', glass: 'rgba(16,26,48,0.72)', gl: 'rgba(255,255,255,0.10)' },
  dawn:    { bg: ['#F2E4DD', '#DCD7E7'], sky: '#FFE8D9', gnd: '#D6D3E2', hi: 1.0, sun: '#FFC6A2', si: 1.2, az: 80, el: 20, lamps: 0, night: 0.15, fill: 0.25, bodyBg: '#F3EEEA', ink: '#0B1B33', muted: '#4A5A72', accent: '#1E56D6', line: '#E2DDD6', glass: 'rgba(255,255,255,0.78)', gl: 'rgba(11,27,51,0.08)' },
};
const HEAD = { day: ['rgba(245,247,250,0.78)', '#0B1B33', 'rgba(11,27,51,0.06)'], late: ['rgba(247,243,238,0.8)', '#0B1B33', 'rgba(11,27,51,0.06)'], evening: ['rgba(243,234,227,0.82)', '#0B1B33', 'rgba(11,27,51,0.06)'], night: ['rgba(10,17,36,0.72)', '#EEF2F8', 'rgba(255,255,255,0.08)'], dawn: ['rgba(243,238,234,0.82)', '#0B1B33', 'rgba(11,27,51,0.06)'] };
const LIGHT = { sky: '#FFFFFF', gnd: '#E3E7EE', hi: 1.3, lamps: 0, fill: 0.45 };
const storyEl = $('#histoire'), headerEl = $('.site-header');
function ambience(at, dur, k) {
  const a = AMB[k], o = { duration: dur, ease: 'sine.inOut' };
  tl.to(LIGHT, Object.assign({ sky: a.sky, gnd: a.gnd, hi: a.hi, lamps: a.lamps, fill: a.fill }, o), at);
  tl.to(SUN, Object.assign({ color: a.sun, i: a.si, az: a.az, el: a.el }, o), at);
  tl.to(LEDC, Object.assign({ night: a.night }, o), at);
  tl.to(stageEl, Object.assign({ '--bg0': a.bg[0], '--bg1': a.bg[1] }, o), at);
  tl.to(document.body, Object.assign({ backgroundColor: a.bodyBg }, o), at);
  tl.to(headerEl, Object.assign({ '--hbg': HEAD[k][0], '--hink': HEAD[k][1], '--hline': HEAD[k][2] }, o), at);
  tl.to(storyEl, Object.assign({ '--ink': a.ink, '--muted': a.muted, '--accent': a.accent, '--line': a.line, '--glass': a.glass, '--glass-line': a.gl }, o), at);
}
const steps = $$('#copy .step');
gsap.set(steps, { autoAlpha: 0, y: 26 }); gsap.set(steps[0], { autoAlpha: 1, y: 0 });
function textTo(i, at) { tl.to(steps[i - 1], { autoAlpha: 0, y: -22, duration: 0.1, ease: 'power2.in' }, at).to(steps[i], { autoAlpha: 1, y: 0, duration: 0.14, ease: 'power3.out' }, at + 0.07); }
const dbars = $$('#devPc .dbar'), dvals = $$('#devPc .dval');
gsap.set(dbars, { scaleY: 0, transformOrigin: '50% 100%' }); gsap.set(dvals, { opacity: 0 });
gsap.set('#dashSyn', { autoAlpha: 0, y: 8 });
const labels = (ids, at, on) => ids.forEach(id => tl.set(P[id].st, { lab: on ? 1 : 0 }, at));

/* ---------- 1 · Mardi 9:00 : le bâtiment, l'étage d'Atlas, Hugo réserve depuis son téléphone ---------- */
tl.to(EXPLODE, { v: 0, duration: 0.55, ease: 'power2.inOut' }, 0.06);
camTo(0.08, 0.6, CAM.floor, 'power2.inOut');
camTo(0.7, 0.28, CAM.both, 'power2.inOut');
camTo(0.98, 0.3, CAM.hugoP, 'power2.inOut', CAM.hugoPN);
phoneShow(0.96, 'bookH');
tapOn(0, 1.2, 'hugo'); swap('#phBookH', 1.23); swap('#phStH', 1.23);
toast('#phToastH', 1.28);
pose('hugo', 1.3, { head: 26 }, 0.04); pose('hugo', 1.35, { head: 22 }, 0.04);
tl.addLabel('s1', 1.56);

/* ---------- 2 · Mardi 14:00 : Atlas vide, orange ---------- */
const S2 = 1.62;
textTo(1, S2);
toastOut('#phToastH', S2 + 0.01); phoneHide(S2 + 0.04);
pose('hugo', S2 + 0.05, Object.assign({ phone: 0 }, DESK_TYPE, { typing: 1 }), 0.1);
camTo(S2 + 0.12, 0.55, CAM.atlas);
clock(S2 + 0.07, 0.72, 840);
tl.to(SUN, { az: 338, el: 58, duration: 0.72 }, S2 + 0.07);
tl.set(P.hugo.st, { lab: 1 }, 0.7);
led(S2 + 0.84, 'orange');
tl.addLabel('s2', S2 + 1.04);

/* ---------- 3 · Mardi 14:02 : Hugo rejoint l'équipe dans le couloir ; ils s'installent ; gros plan radar, rouge ---------- */
const S3 = S2 + 1.1;
textTo(2, S3);
clock(S3 + 0.06, 0.6, 842);
camTo(S3 + 0.04, 0.4, CAM.corr);
camTo(S3 + 0.5, 0.75, CAM.corr2, 'sine.inOut');
labels(['newfel', 'brian', 'raphael'], S3, true);
standUp('raphael', S3 + 0.04);
standUp('hugo', S3 + 0.08); tl.set(P.hugo.st, { phone: 0 }, S3 + 0.08);
const DOOR = [3.9, -0.4], INSIDE = [3.9, -1.7];
const wB = walk('brian', S3 + 0.1, [[-5.6, 2.2], [-1.0, 1.0], [3.0, 0.4], DOOR, INSIDE, [6.5, -2.9], [8.45, -3.5], [8.45, -6.05], [SEAT.D.x, SEAT.D.z]]);
const wH = walk('hugo', S3 + 0.36, [[-4.3, -3.6], [-3.4, 0.2], [-1.0, 0.8], [3.0, 0.3], DOOR, INSIDE, [4.4, -5.0], [4.65, -6.05], [SEAT.C.x, SEAT.C.z]]);
const wR = walk('raphael', S3 + 0.22, [[-9.6, 4.6], [-5.6, 2.5], [-1.0, 1.3], [3.0, 0.5], DOOR, INSIDE, [6.5, -2.8], [8.45, -3.3], [8.45, -3.95], [SEAT.B.x, SEAT.B.z]]);
const wN = walk('newfel', S3 + 0.42, [[-5.6, 2.4], [-1.0, 1.2], [3.0, 0.6], DOOR, INSIDE, [5.1, -3.3], [5.1, -3.95], [SEAT.A.x, SEAT.A.z]]);
sitDown('brian', wB.end + 0.02, SEAT.D, TABLE_ARMS);
sitDown('hugo', wH.end + 0.02, SEAT.C, TABLE_ARMS);
sitDown('raphael', wR.end + 0.02, SEAT.B, TABLE_ARMS);
sitDown('newfel', wN.end + 0.02, SEAT.A, TABLE_ARMS);
camTo(S3 + 1.28, 0.5, CAM.meet);
const R3 = Math.max(wB.end, wH.end, wR.end, wN.end) + 0.24;
camTo(R3, 0.24, CAM.box);
radar(R3 + 0.2, ['newfel', 'raphael', 'brian', 'hugo'], LED.orange, R3 + 0.74);
led(R3 + 0.5, 'red');
tl.addLabel('s3r', R3 + 0.62);
camTo(R3 + 0.74, 0.28, CAM.meet);
['newfel', 'raphael', 'brian', 'hugo'].forEach(id => tl.set(P[id].st, { chat: 1 }, R3 + 0.78));
tl.addLabel('s3', R3 + 1.02);

/* ---------- 4 · Mardi 14:20 : ils repartent ; accéléré de 14:10 à 14:20 ; Hugo, rentré à son bureau, est prévenu ---------- */
const S4 = R3 + 1.08;
textTo(3, S4);
clock(S4 + 0.04, 0.34, 850, 'none');
camTo(S4 + 0.04, 0.45, CAM.atlas);
standUp('newfel', S4 + 0.06); standUp('raphael', S4 + 0.08); standUp('hugo', S4 + 0.1); standUp('brian', S4 + 0.12);
const LIFT = [0, -4.9];
const oN = walk('newfel', S4 + 0.18, [[5.1, -3.95], [5.1, -3.0], INSIDE, DOOR, [2.4, 0.2], [0.8, -4.6], LIFT]);
const oR = walk('raphael', S4 + 0.22, [[8.45, -3.95], [8.45, -3.0], [6.0, -2.4], INSIDE, DOOR, [2.4, 0.4], [-0.6, -4.6], LIFT]);
const oH = walk('hugo', S4 + 0.26, [[4.65, -6.05], [4.3, -4.8], INSIDE, DOOR, [2.4, 0.6], [-1.0, 0.8], [-3.4, 0.2], [-4.3, -3.6], [SEAT_DESK.hugo.x, SEAT_DESK.hugo.z]]);
const oB = walk('brian', S4 + 0.3, [[8.45, -6.05], [8.45, -3.4], [6.2, -2.4], INSIDE, DOOR, [2.4, 0.2], [0.4, -4.6], LIFT]);
[['newfel', oN], ['raphael', oR], ['brian', oB]].forEach(([id, w]) => tl.to(P[id].st, { op: 0, duration: 0.03 }, w.end));
sitDown('hugo', oH.end + 0.02, SEAT_DESK.hugo, Object.assign({ typing: 1 }, DESK_TYPE));
labels(['newfel', 'brian', 'raphael'], oB.end, false);
// accéléré : l'horloge défile, le soleil tourne, aucune présence, le boîtier reste rouge
const TL4 = Math.max(oN.end, oR.end, oB.end) - 0.3;
camTo(TL4, 0.22, CAM.clock);
tl.to(secMat, { opacity: 1, duration: 0.05 }, TL4 + 0.14);
tl.to('#absChip', { autoAlpha: 1, y: 0, duration: 0.08, ease: 'power2.out' }, TL4 + 0.16);
clock(TL4 + 0.18, 0.56, 860, 'none');
tl.to(SUN, { az: 312, el: 48, duration: 0.56, ease: 'none' }, TL4 + 0.18);
tl.addLabel('s4t', TL4 + 0.76);
tl.to(secMat, { opacity: 0, duration: 0.05 }, TL4 + 0.76);
camTo(TL4 + 0.8, 0.34, CAM.hugoP, 'power2.inOut', CAM.hugoPN);
tl.to('#absChip', { autoAlpha: 0, y: -6, duration: 0.06 }, TL4 + 1.0);
led(TL4 + 1.16, 'orange');
phoneShow(TL4 + 1.2, 'mineH'); push('#pushWarn1', TL4 + 1.27); vibrate(TL4 + 1.27); take('hugo', TL4 + 1.18);
pose('hugo', TL4 + 1.22, Object.assign({ typing: 0, phone: 1 }, PHONE_POSE), 0.1);
tl.addLabel('s4', TL4 + 1.6);

/* ---------- 5 · Mardi 14:40 : libérée, vert, la lumière décline ---------- */
const S5 = TL4 + 1.66;
textTo(4, S5);
clock(S5 + 0.01, 0.3, 880);
pushOut('#pushWarn1', S5 + 0.22); led(S5 + 0.32, 'green'); swap('#phMineH', S5 + 0.32); push('#pushRel1', S5 + 0.38);
ambience(S5 + 0.05, 0.75, 'late');
pose('hugo', S5 + 0.65, Object.assign({ phone: 0, typing: 1 }, DESK_TYPE), 0.1);
tl.addLabel('s5', S5 + 0.85);

/* ---------- 6 · Mardi soir, la nuit, puis l'aube ---------- */
const S6 = S5 + 0.9;
textTo(5, S6);
pushOut('#pushRel1', S6); phoneHide(S6 + 0.02);
camTo(S6 + 0.04, 0.6, CAM.atlas);
clock(S6, 0.85, 1320); clock(S6 + 1.0, 0.2, 1440 + 330, 'power1.in'); clock(S6 + 1.2, 0.65, 1440 + 420, 'power1.out');
ambience(S6 + 0.07, 0.33, 'evening');
const NIGHT_GONE = ['hugo', 'joe', 'arthur', 'f1', 'f2', 'f3', 'l1', 'l2'];
NIGHT_GONE.forEach(id => tl.to(P[id].st, { op: 0, duration: 0.05 }, S6 + 0.3));
ambience(S6 + 0.4, 0.4, 'night');
tl.addLabel('s6n', S6 + 0.95);
ambience(S6 + 1.1, 0.3, 'dawn');
ambience(S6 + 1.43, 0.34, 'day');
tl.addLabel('s6', S6 + 1.9);

/* ---------- 7 · Mercredi 9:30 : Joe cherche une salle pour 14 h, rien n'est libre, il demande à être prévenu ---------- */
const J = S6 + 1.96;
textTo(6, J);
clock(J, 0.22, 1440 + 570);
NIGHT_GONE.forEach(id => tl.to(P[id].st, { op: 1, duration: 0.05 }, J));
tl.set(P.hugo.st, Object.assign({ phone: 0, typing: 1 }, DESK_TYPE), J);
camTo(J + 0.02, 0.4, CAM.joe);
labels(['joe'], J, true);
pose('joe', J + 0.3, { lean: 15, head: 12 }, 0.08);                       // il se penche vers son écran
pcShow(J + 0.44, 'search', JOE_SCREEN, 'joe', 'search', 1);
tl.to(pcCursor, { autoAlpha: 1, duration: 0.04, ease: 'none' }, J + 0.6);
tl.to(CUR, { p: 1, duration: 0.2, ease: 'none' }, J + 0.64);               // vers le champ « Début »
click(J + 0.86);
tl.to('#pcStart .ph', { autoAlpha: 0, duration: 0.01 }, J + 0.88); tl.to(CARET, { on: 1, duration: 0.01 }, J + 0.88);
tl.to('#pcStart', { '--tw': '42px', duration: 0.26, ease: 'steps(5)' }, J + 0.92);   // il tape « 14:00 »
tl.to(CARET, { on: 0, duration: 0.01 }, J + 1.22);
tl.to('#pcSkel', { autoAlpha: 1, duration: 0.04, ease: 'none' }, J + 1.24);           // recherche en cours
tl.to('#pcSkel', { autoAlpha: 0, duration: 0.04, ease: 'none' }, J + 1.44);
tl.to('#pcEmpty', { autoAlpha: 1, duration: 0.06, ease: 'none' }, J + 1.46);         // aucun espace libre
pose('joe', J + 1.5, { headY: -10, head: 16 }, 0.06, 'sine.out');
tl.to(CUR, { p: 2, duration: 0.24, ease: 'none' }, J + 1.68);              // vers « M'avertir si un espace se libère »
click(J + 1.96); swap('#pcAlert', J + 1.98);
toast('#pcToast', J + 2.02);
tl.to(CUR, { p: 3, duration: 0.14, ease: 'none' }, J + 2.06);
pose('joe', J + 2.1, { lean: 10, head: 8, headY: 0 }, 0.08);
tl.addLabel('s6j', J + 2.4);
toastOut('#pcToast', J + 2.46); tl.to(pcCursor, { autoAlpha: 0, duration: 0.04, ease: 'none' }, J + 2.46);
pcHide(J + 2.5, true);

/* ---------- 8 · Mercredi 14:00 : Hugo en visio à son bureau, Atlas vide ---------- */
const S7 = J + 2.75;
textTo(7, S7);
clock(S7, 0.3, 1440 + 840);
tl.set(P.hugo.st, { headset: 1, typing: 0 }, S7 + 0.04);
camTo(S7 + 0.04, 0.4, CAM.visio);
pcShow(S7 + 0.3, 'visio', HUGO_SCREEN, 'hugo', 'visio', 0);
led(S7 + 0.51, 'orange');
push('#pcN1', S7 + 0.6);
tl.addLabel('s7', S7 + 1.0);

/* ---------- 9 · Mercredi 14:10 : libérée instantanément ---------- */
const S8 = S7 + 1.05;
textTo(8, S8);
clock(S8, 0.13, 1440 + 850);
pushOut('#pcN1', S8 + 0.12); led(S8 + 0.15, 'green', 0.005); push('#pcN2', S8 + 0.18);
tl.addLabel('s8', S8 + 0.8);

/* ---------- 10 · Mercredi 14:11 : Joe est prévenu, réserve, prend ordinateur et casque, rejoint Atlas ---------- */
const S9 = S8 + 0.85;
textTo(9, S9);
clock(S9, 0.05, 1440 + 851);
pushOut('#pcN2', S9 + 0.1); pcHide(S9 + 0.14);
camTo(S9 + 0.1, 0.4, CAM.joeP, 'power2.inOut', CAM.joePN);
phoneShow(S9 + 0.5, 'lockJ'); push('#pushAvail', S9 + 0.56); vibrate(S9 + 0.56); take('joe', S9 + 0.52);
pose('joe', S9 + 0.58, Object.assign({ typing: 0, phone: 1 }, PHONE_POSE), 0.09);
tapOn(1, S9 + 0.76, 'joe');
pushOut('#pushAvail', S9 + 0.8); phView('bookJ', S9 + 0.8, 0.05);          // la notification ouvre l'application
tapOn(2, S9 + 0.96, 'joe'); swap('#phBookJ', S9 + 0.99); swap('#phStJ', S9 + 0.99);
toast('#phToastJ', S9 + 1.03);
tl.addLabel('s9b', S9 + 1.16);
pose('joe', S9 + 1.18, { phone: 0 }, 0.04);
toastOut('#phToastJ', S9 + 1.18); phoneHide(S9 + 1.2);
standUp('joe', S9 + 1.23);
pose('joe', S9 + 1.38, { aR: -150, eR: -60, headset: 1 }, 0.05);
tl.set(LAPTOP_DESK, { visible: false }, S9 + 1.46);
pose('joe', S9 + 1.44, Object.assign({ laptop: 1, aR: 4, eR: -10 }, CARRY), 0.06);
const wJ = walk('joe', S9 + 1.54, [[-7.4, -3.6], [-7.0, 0.4], [-3.0, 1.0], [3.0, 0.4], DOOR, INSIDE, [5.1, -3.3], [5.1, -3.95], [SEAT.A.x, SEAT.A.z]]);
camTo(S9 + 1.58, wJ.end - S9 - 1.58, CAM.atlas, 'sine.inOut');
led(wJ.end - 0.32, 'red');
sitDown('joe', wJ.end + 0.02, SEAT.A, TABLE_ARMS);
tl.set(P.joe.st, { laptop: 0 }, wJ.end + 0.12); tl.set(LAPTOP_TABLE, { visible: true }, wJ.end + 0.12);
tl.set(P.joe.st, { typing: 1 }, wJ.end + 0.2);
camTo(wJ.end + 0.1, 0.3, CAM.meet);
tl.addLabel('s9', wJ.end + 0.5);

/* ---------- 11 · Mercredi 18:00 : Joe repart ; Arthur, Facility manager, présente le bilan au CEO ---------- */
const S10 = wJ.end + 0.56;
textTo(10, S10);
clock(S10 + 0.01, 0.24, 1440 + 900, 'power1.in'); clock(S10 + 0.27, 0.3, 1440 + 1080, 'power1.out');
tl.set(LAPTOP_TABLE, { visible: false }, S10 + 0.03); tl.set(P.joe.st, { typing: 0, laptop: 1 }, S10 + 0.03);
standUp('joe', S10 + 0.05); pose('joe', S10 + 0.2, CARRY, 0.04);
camTo(S10 + 0.05, 0.4, CAM.atlas);
const oJ = walk('joe', S10 + 0.2, [[5.1, -3.95], [5.1, -3.0], INSIDE, DOOR, [2.4, 0.4], [0.4, -4.6], LIFT], 13);
led(oJ.start + 0.22, 'green');
tl.to(P.joe.st, { op: 0, duration: 0.03 }, oJ.end);
labels(['joe'], oJ.end, false);
ambience(S10 + 0.1, 0.5, 'evening');
camTo(S10 + 0.62, 0.42, CAM.arthur);
labels(['arthur'], S10 + 0.6, true);
// le CEO arrive par le couloir et entre dans le bureau d'Arthur
tl.to(P.ceo.st, { op: 1, duration: 0.04 }, S10 + 0.64);
labels(['ceo'], S10 + 0.7, true);
const wC = walk('ceo', S10 + 0.66, [[5.8, 2.5], [6.6, 3.0], [6.7, 4.4], [7.6, 5.4], [7.65, 6.4]], 10);
face('ceo', wC.end + 0.01, -96);
// Arthur se lève, l'accueille d'un geste, puis se place à côté de l'écran mural
standUp('arthur', wC.end - 0.34);
face('arthur', wC.end - 0.18, -150, 0.06);
pose('arthur', wC.end - 0.12, { aR: -150, eR: -30, sR: 26 }, 0.06);
pose('arthur', wC.end - 0.02, { aR: 4, eR: -10, sR: 6 }, 0.06);
const wA = walk('arthur', wC.end + 0.04, [[9.8, 8.35], [8.6, 7.6], [7.4, 5.2], [6.25, 4.75]], 9);
face('arthur', wA.end + 0.01, 39);
pose('arthur', wA.end + 0.08, { aL: -72, sL: 48, eL: -8, headY: -34 }, 0.08);    // il désigne l'écran
tl.to(tvMat, { opacity: 0.95, duration: 0.08, ease: 'none' }, wA.end + 0.06);
camTo(wA.end + 0.1, 0.36, CAM.present, 'power2.inOut', CAM.arthur);
pcShow(wA.end + 0.3, 'dash', DASH_SCREEN, 'arthur', 'dash', 0);
pose('arthur', wA.end + 0.36, { aL: -40, sL: 14, eL: -40, headY: 0 }, 0.08);
labels(['arthur', 'ceo'], wA.end + 0.3, false);
tl.to(DASH, { k1: 34, k2: 70, k3: 49, duration: 0.34, ease: 'power2.out' }, wA.end + 0.44);
dbars.forEach((b, i) => tl.to(b, { scaleY: 1, duration: 0.2, ease: 'power3.out' }, wA.end + 0.46 + i * 0.04));
tl.to(dvals, { opacity: 1, duration: 0.08 }, wA.end + 0.66);
tl.to('#dashSyn', { autoAlpha: 1, y: 0, duration: 0.12, ease: 'power2.out' }, wA.end + 0.72);
tl.addLabel('s10', wA.end + 1.0);
tl.to({}, { duration: 0.1 }, wA.end + 1.0);

const STEP_START = [0, S2, S3, S4, S5, S6, J, S7, S8, S9, S10];
const OWNER_JOE = [[S9 + 0.3, 1e9]];
const PC_OWNER = {
  joe: ['J', 'Ordinateur de Joe', '#B37F46'],
  hugo: ['H', 'Ordinateur de Hugo', '#2F8F5B'],
  arthur: ['A', 'Arthur présente le bilan au CEO', '#1E56D6'],
};
LED_EVENTS.sort((a, b) => a[0] - b[0]);
PC_MODES.sort((a, b) => a[0] - b[0]);

/* =====================================================================
   5. Rendu : à chaque mise à jour de la timeline, et 30 fois par seconde pour la vie de fond
   ===================================================================== */
const railFill = $$('.rail i'), stepNo = $('#stepNo'), timeLabel = $('#timeLabel'), statusLabel = $('#statusLabel'), phoneTime = $('#phoneTime'), lockTime = $('#lockTime');
const icSun = $('#icSun'), icMoon = $('#icMoon'), ownerName = $('#ownerName'), ownerAv = $('#ownerAv'), absText = $('#absText');
const pcOwnerName = $('#pcOwnerName'), pcOwnerAv = $('#pcOwnerAv');
const k1 = $('#dk1'), k2 = $('#dk2'), k3 = $('#dk3'), visioTime = $('#visioTime');
const DAYS = ['Mardi', 'Mercredi', 'Jeudi'];
function fmtClock(m) { const mm = Math.round(m), d = Math.floor(mm / 1440), r = mm - d * 1440; return { day: DAYS[d] || 'Mardi', hm: `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`, h: r / 60 }; }
let lastStatus = '', lastStep = -1, lastTime = '', lastOwner = '', lastPcOwner = '', lastAbs = -1, lastK = '', lastSpk = -1;

/* ---- Mise en page des écrans : taille à l'écran, échelle de la maquette, points visés par le curseur et le doigt ---- */
let NARROW = false, PCG = null, layKey = '', CUR_PTS = [], TAP_PTS = [];
function offIn(el, root) { let x = 0, y = 0, e = el; while (e && e !== root) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; }
function pcGeom(mode) {
  let x, y, w, bz = 0, lw, ratio, fh = 0, bare = false, tv = false, sh;
  if (NARROW && mode !== 'visio') {            // petit écran : on entre dans l'écran, qui remplit la scène
    bare = true; x = 0; y = 0; w = SW; lw = mode === 'dash' ? 470 : 480; sh = SH;
  } else if (NARROW) {                          // visio : écran à gauche, la salle reste visible à droite
    w = SW * 0.66; bz = 4; lw = 330; ratio = 4 / 3; x = 8; y = 8;
  } else if (mode === 'search') {
    w = SW * 0.88; bz = Math.max(6, Math.round(SW * 0.011)); lw = 860; ratio = 1.6; fh = SW * 0.045;
  } else if (mode === 'visio') {
    w = SW * 0.6; bz = Math.max(5, Math.round(SW * 0.009)); lw = 560; ratio = 1.6; fh = SW * 0.032; x = SW * 0.03; y = SH * 0.09;
  } else {                                      // écran mural du bureau d'Arthur
    w = SW * 0.78; bz = Math.max(5, Math.round(SW * 0.009)); lw = 740; ratio = 1.56; tv = true;
  }
  if (sh === undefined) sh = (w - 2 * bz) / ratio;
  const k = (w - 2 * bz) / lw, bh = sh + 2 * bz, H = bh + fh;
  if (x === undefined) x = mode === 'dash' ? SW - w - SW * 0.02 : (SW - w) / 2;
  if (y === undefined) y = Math.max(8, (SH - H) / 2 + (tv ? 10 : 0));
  return { x, y, w, H, bz, bh, fh, k, lw, lh: sh / k, bare, tv };
}
function applyPc(mode) {
  const g = PCG = pcGeom(mode), st = devPc.style;
  st.left = g.x.toFixed(1) + 'px'; st.top = g.y.toFixed(1) + 'px'; st.width = g.w.toFixed(1) + 'px'; st.height = g.H.toFixed(1) + 'px';
  st.setProperty('--k', g.k.toFixed(4)); st.setProperty('--lw', g.lw + 'px'); st.setProperty('--lh', g.lh.toFixed(1) + 'px');
  st.setProperty('--bz', g.bz + 'px'); st.setProperty('--bh', g.bh.toFixed(1) + 'px'); st.setProperty('--fh', g.fh.toFixed(1) + 'px');
  devPc.classList.toggle('dv-bare', g.bare); devPc.classList.toggle('dv-tv', g.tv);
  if (mode === 'search') {
    const a = offIn($('#pcStart'), pcApp), b = offIn($('#pcAlert'), pcApp);
    CUR_PTS = [{ x: g.lw * 0.72, y: g.lh * 0.86 }, { x: a.x + a.w * 0.6, y: a.y + a.h * 0.58 }, { x: b.x + b.w * 0.5, y: b.y + b.h * 0.6 }, NARROW ? { x: b.x + b.w * 0.55, y: b.y + b.h + 30 } : { x: g.lw * 0.86, y: b.y + b.h * 0.5 + 4 }];
  }
}
function applyPhone() {
  let k, b;
  if (NARROW) { k = 0.68 * Math.min(1.25, Math.max(0.85, SW / 350)); b = 4; }
  else { const H = SH * 1.08; b = Math.max(5, Math.round(H * 0.016)); k = (H - 2 * b) / 620; }
  const H = 620 * k + 2 * b, W = 300 * k + 2 * b, st = devPhone.style;
  st.left = (SW - W - (NARROW ? 10 : SW * 0.05)).toFixed(1) + 'px'; st.top = (SH * 0.07).toFixed(1) + 'px';
  st.width = W.toFixed(1) + 'px'; st.height = H.toFixed(1) + 'px';
  st.setProperty('--k', k.toFixed(4)); st.setProperty('--b', b + 'px');
  TAP_PTS = ['#phBookH', '#pushAvail', '#phBookJ'].map(s => { const r = offIn($(s), dpApp); return { x: r.x + r.w * 0.5, y: r.y + r.h * 0.5 }; });
}
function layoutDevices() {
  NARROW = SW < 560;
  stageEl.classList.toggle('dv-narrow', NARROW); stageEl.classList.toggle('is-narrow', NARROW);
  CAMV = NARROW ? NVIEW : VIEW;
  applyPhone(); layKey = '';
}
function renderDevices(t, now) {
  // ordinateur : mode courant, position, zoom depuis l'écran de la scène
  let m = PC_MODES[0]; for (const e of PC_MODES) if (t >= e[0]) m = e;
  const key = m[1] + '|' + SW + '|' + SH + '|' + NARROW;
  if (key !== layKey) { applyPc(m[1]); layKey = key; }
  if (m[3] !== lastPcOwner) { const o = PC_OWNER[m[3]]; pcOwnerAv.textContent = o[0]; pcOwnerName.textContent = o[1]; pcOwnerAv.style.backgroundColor = o[2]; lastPcOwner = m[3]; }
  if (devPc.style.visibility !== 'hidden') {
    const g = PCG; tmpV.copy(m[2]).project(cam);
    const ax = (tmpV.x * 0.5 + 0.5) * SW - g.x - g.w / 2, ay = (-tmpV.y * 0.5 + 0.5) * SH - g.y - g.H / 2;
    const e = DEV.pz, s = 0.05 + 0.95 * e;
    devPcIn.style.transform = `translate(${(ax * (1 - e)).toFixed(1)}px, ${(ay * (1 - e)).toFixed(1)}px) scale(${s.toFixed(4)})`;
    // curseur : interpolation douce entre les points visés
    if (CUR_PTS.length) {
      const n = CUR_PTS.length - 1, p = Math.max(0, Math.min(n, CUR.p)), i = Math.min(n - 1, Math.floor(p)), f = p - i, u = f * f * (3 - 2 * f);
      const A = CUR_PTS[i], B = CUR_PTS[i + 1], x = A.x + (B.x - A.x) * u, y = A.y + (B.y - A.y) * u - Math.sin(f * Math.PI) * 14;
      pcCursor.style.transform = `translate(${(x - 2).toFixed(1)}px, ${(y - 1.5).toFixed(1)}px)`;
      pcClick.style.left = x.toFixed(1) + 'px'; pcClick.style.top = y.toFixed(1) + 'px';
    }
    caretEl.style.opacity = CARET.on > 0.5 && (REDUCE || Math.floor(now / 480) % 2 === 0) ? '1' : '0';
    // visio : l'orateur change toutes les quelques secondes
    if (m[1] === 'visio') { const k = Math.floor(now / 2300) % 3; if (k !== lastSpk) { VZ_TILES.forEach((el, j) => el.classList.toggle('spk', j === k)); lastSpk = k; } }
  }
  const tp = TAP_PTS[TAP.i]; if (tp) { dpTap.style.left = tp.x.toFixed(1) + 'px'; dpTap.style.top = tp.y.toFixed(1) + 'px'; }
}

function render() {
  const now = performance.now(), t = tl.time();
  placeCamera();
  placeSun();
  hemi.color.set(LIGHT.sky); hemi.groundColor.set(LIGHT.gnd); hemi.intensity = LIGHT.hi; fillL.intensity = LIGHT.fill;
  lampMat.emissiveIntensity = LIGHT.lamps * 1.6; lampLight.intensity = LIGHT.lamps * 2.2;
  applyLed();
  const breatheLed = REDUCE ? 1 : 0.85 + Math.sin(now / 700) * 0.15;
  haloMat.opacity *= breatheLed;
  if (LEDP.pulse > 0.001) { haloMat.opacity = Math.min(1, haloMat.opacity + LEDP.pulse * 0.5); halo.scale.setScalar(1 + LEDP.pulse * 1.4); } else halo.scale.setScalar(1);
  applyExplode();
  TV_GLOW.visible = tvMat.opacity > 0.01;
  for (const R of rings) { R.mesh.scale.setScalar(R.st.s); R.m.opacity = R.st.o; R.mesh.visible = R.st.o > 0.01; }
  for (const k of pingSprites) { const p = P[k.id], hipsY = 0.66 - 0.26 * p.st.sit; const pos = pathAt(p, p.st.d); k.sp.position.set(pos.x, hipsY + 1.3, pos.z); k.sp.scale.setScalar(k.S.s); k.sp.material.opacity = k.S.o; k.sp.visible = k.S.o > 0.01; }
  // horloge de la salle (et trotteuse pendant l'accéléré)
  const c = fmtClock(ENV.clock);
  hourHand.rotation.z = -((c.h % 12) * 30) * D2R; minHand.rotation.z = -((ENV.clock % 60) * 6) * D2R; secHand.rotation.z = -(((ENV.clock % 1) + 1) % 1) * 360 * D2R;
  // réunions : un orateur à la fois
  const chatting = []; for (const id in P) if (P[id].st.chat > 0.5 && P[id].st.op > 0.5 && P[id].st.d >= 0) chatting.push(id);
  const groupA = chatting.filter(id => !id.startsWith('l')), groupL = chatting.filter(id => id.startsWith('l'));
  const spk = (g, o) => g.length ? g[Math.floor(now / 2300 + o) % g.length] : null;
  SPEAKER = spk(groupA, 0); const SPK2 = spk(groupL, 0.5);
  for (const id in P) { const sv = SPEAKER; if (id.startsWith('l')) SPEAKER = SPK2; renderPerson(P[id], now); SPEAKER = sv; }
  renderer.render(scene, cam);
  renderDevices(t, now);
  // interface : heure, statut, propriétaire du téléphone, étape
  const tlab = `${c.day} · ${c.hm}`;
  if (tlab !== lastTime) { timeLabel.textContent = tlab; phoneTime.textContent = c.hm; lockTime.textContent = c.hm; visioTime.textContent = c.hm; lastTime = tlab; const night = c.h >= 19.5 || c.h < 6.5; icSun.setAttribute('opacity', night ? 0 : 1); icMoon.setAttribute('opacity', night ? 1 : 0); }
  const owner = OWNER_JOE.some(([a, b]) => t >= a && t < b) ? 'joe' : 'hugo';
  if (owner !== lastOwner) { ownerName.innerHTML = '<span class="dv-wo">Téléphone de </span>' + PEOPLE_DEF[owner].name; ownerAv.textContent = PEOPLE_DEF[owner].name[0]; ownerAv.style.backgroundColor = owner === 'joe' ? '#B37F46' : '#2F8F5B'; lastOwner = owner; }
  let stt = 'green'; for (const [at, col] of LED_EVENTS) if (t >= at + 0.025) stt = col;
  if (stt !== lastStatus) { statusLabel.textContent = LED_LABEL[stt]; lastStatus = stt; }
  const NS = STEP_START.length;
  let i = 0; for (let k = 0; k < NS; k++) if (t >= STEP_START[k]) i = k;
  if (i !== lastStep) { stepNo.textContent = String(i + 1).padStart(2, '0'); lastStep = i; }
  for (let k = 0; k < NS; k++) { const a = STEP_START[k], b = k < NS - 1 ? STEP_START[k + 1] : tl.duration(); railFill[k].style.width = (Math.max(0, Math.min(1, (t - a) / (b - a))) * 100).toFixed(1) + '%'; }
  const am = Math.max(0, Math.min(10, Math.floor(ENV.clock - 850 + 0.001)));
  if (am !== lastAbs) { absText.textContent = `Aucune présence détectée · ${am} min`; lastAbs = am; }
  const kk = `${Math.round(DASH.k1)}|${Math.round(DASH.k2)}|${Math.round(DASH.k3)}`;
  if (kk !== lastK) { k1.textContent = `${Math.round(DASH.k1)} %`; k2.textContent = `${Math.round(DASH.k2)} min`; k3.textContent = `${Math.round(DASH.k3)} min`; lastK = kk; }
}
tl.eventCallback('onUpdate', render);
new ResizeObserver(() => { resize(); layoutDevices(); render(); }).observe(stageEl);
resize(); layoutDevices(); render();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { applyPhone(); layKey = ''; render(); });
window.__optispace = { tl, P, VIEW, NVIEW, render, pings: pingSprites, renderer, scene, DEV, geo: () => PCG };
