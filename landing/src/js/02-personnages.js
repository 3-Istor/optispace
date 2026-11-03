
/* =====================================================================
   3. Personnages : corps lisses en pâte blanche, sans visage (esprit « Human: Fall Flat »),
      un haut pastel par personne pour les reconnaître de loin, et une étiquette au-dessus de la tête
   ===================================================================== */
const PEOPLE_DEF = {
  hugo:    { name: 'Hugo', top: '#9FD8B8', dot: '#2F8F5B' },
  joe:     { name: 'Joe', top: '#EED9A8', dot: '#B37F46' },
  newfel:  { name: 'Newfel', top: '#A9BCE0', dot: '#23305A' },
  raphael: { name: 'Raphaël', top: '#ECE3CF', dot: '#9C8F6E' },
  brian:   { name: 'Brian', top: '#E7AEBA', dot: '#7A1F34' },
  arthur:  { name: 'Arthur', role: 'Facility manager', top: '#C9DAF5', dot: '#1E56D6' },
  ceo:     { name: 'CEO', top: '#F2C9A9', dot: '#B4613A' },
  f1: { top: null }, f2: { top: null }, f3: { top: null }, l1: { top: '#F3E2A9' }, l2: { top: '#D8CFEF' },
};
const capGeo = new Map();
function capsule(r, len) { const k = r + '|' + len; if (!capGeo.has(k)) capGeo.set(k, new THREE.CapsuleGeometry(r, len, 4, 12)); return capGeo.get(k); }
const sphereGeo = new THREE.SphereGeometry(1, 22, 16);
const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(40,30,20,0.42)'); r.addColorStop(1, 'rgba(40,30,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const blobMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const blobGeo = new THREE.PlaneGeometry(0.9, 0.9);
const P = {};
const uiLayer = $('#isoUI');

function makePerson(id, init) {
  const def = PEOPLE_DEF[id], clay = MAT.clay;
  const topM = def.top ? new THREE.MeshStandardMaterial({ color: def.top, roughness: 0.7 }) : clay;
  const root = new THREE.Group(); scene.add(root);
  const piv = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const part = (parent, geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
  const hips = piv(root, 0, 0.66, 0);
  part(hips, sphereGeo, topM === clay ? clay : MAT.clay, 0, 0, 0, 0.2, 0.13, 0.15);
  // jambes : cuisse, genou, tibia, pied arrondi
  const legs = [-1, 1].map(s => {
    const thigh = piv(hips, s * 0.1, -0.02, 0);
    part(thigh, capsule(0.085, 0.16), clay, 0, -0.15, 0);
    const knee = piv(thigh, 0, -0.3, 0);
    part(knee, capsule(0.08, 0.16), clay, 0, -0.14, 0);
    part(knee, sphereGeo, clay, 0, -0.29, 0.05, 0.09, 0.055, 0.14);
    return { thigh, knee };
  });
  // buste : gros œuf, haut pastel ; bras courts et ronds ; tête ronde sans visage
  const spine = piv(hips, 0, 0.02, 0);
  part(spine, capsule(0.205, 0.2), topM, 0, 0.27, 0, 1.05, 1, 0.82);
  const arms = [-1, 1].map(s => {
    const sh = piv(spine, s * 0.26, 0.42, 0);
    part(sh, capsule(0.068, 0.14), topM === clay ? clay : topM, 0, -0.1, 0);
    const el = piv(sh, 0, -0.22, 0);
    part(el, capsule(0.062, 0.12), clay, 0, -0.09, 0);
    part(el, sphereGeo, clay, 0, -0.22, 0.01, 0.075, 0.08, 0.07);
    return { sh, el };
  });
  const neck = piv(spine, 0, 0.55, 0);
  const head = part(neck, sphereGeo, clay, 0, 0.17, 0.01, 0.2, 0.19, 0.19);
  // accessoires : téléphone, casque, ordinateur sous le bras
  const phone = part(arms[1].el, rbox(0.07, 0.13, 0.015, 0.01), MAT.dark, 0.0, -0.27, 0.06); phone.visible = false;
  const headset = new THREE.Group(); neck.add(headset); headset.visible = false;
  const hsm = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.018, 8, 28, Math.PI), MAT.dark); hsm.position.set(0, 0.2, 0); hsm.rotation.z = 0; headset.add(hsm);
  [-1, 1].forEach(s => { const cup = new THREE.Mesh(sphereGeo, MAT.dark); cup.scale.set(0.035, 0.06, 0.06); cup.position.set(s * 0.2, 0.18, 0); headset.add(cup); });
  const laptop = part(arms[0].el, rbox(0.026, 0.26, 0.34, 0.012), MAT.metal, -0.07, -0.3, 0.04); laptop.visible = false;
  const blob = new THREE.Mesh(blobGeo, blobMat); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; scene.add(blob);
  // étiquette (comme dans un jeu de simulation) : nom et pastille de couleur
  let label = null;
  if (def.name) {
    label = document.createElement('div'); label.className = 'iso-label';
    label.innerHTML = `<i style="background:${def.dot}"></i>${def.name}${def.role ? `<em>${def.role}</em>` : ''}`; uiLayer.appendChild(label);
  }
  const st = Object.assign({
    x: 0, z: 0, ry: 0, y: 0, op: 1, sit: 0, wk: 0, d: 0, mv: 0, lean: 0, head: 0, headY: 0,
    aL: 4, aR: 4, eL: -10, eR: -10, sL: 6, sR: 6, typing: 0, phone: 0, laptop: 0, headset: 0, point: 0, chat: 0, hop: 0, sq: 1, lab: 0,
  }, init);
  P[id] = { id, st, root, hips, spine, neck, head, legs, arms, phone, headset, laptop, blob, label, path: [{ x: st.x, z: st.z, d: 0 }], phase: Object.keys(P).length * 1.37 };
  return P[id];
}

/* ---- Itinéraires : une polyligne par personnage ; la timeline fait avancer une distance parcourue ---- */
function pathAt(p, d) {
  const pts = p.path;
  if (d <= 0 || pts.length < 2) return { x: pts[0].x, z: pts[0].z, h: null };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (d <= b.d || i === pts.length - 1) {
      const L = Math.max(1e-6, b.d - a.d), t = Math.min(1, Math.max(0, (d - a.d) / L));
      let h = Math.atan2(b.x - a.x, b.z - a.z);
      // virage adouci à l'approche du point suivant
      const c = pts[i + 1];
      if (c && !b.jump && !c.jump && b.d - d < 0.35) { const h2 = Math.atan2(c.x - b.x, c.z - b.z); h = lerpAngle(h, h2, (0.35 - (b.d - d)) / 0.7); }
      if (a.jump || b.jump) h = null;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h };
    }
  }
}
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }

/* ---- Pose : angles en degrés, appliqués à chaque image ---- */
const tmpV = new THREE.Vector3();
function renderPerson(p, now) {
  const s = p.st, live = !REDUCE && s.op > 0.01;
  p.root.visible = s.op > 0.01; p.blob.visible = p.root.visible;
  if (!p.root.visible) { if (p.label) p.label.style.opacity = '0'; return; }
  const pos = pathAt(p, s.d);
  const heading = s.mv > 0.5 && pos.h !== null ? pos.h : s.ry * D2R;
  const ph = s.d / 1.05 * Math.PI * 2, wk = s.wk;
  const swing = Math.sin(ph) * wk, lift = Math.max(0, Math.cos(ph)) * wk, lift2 = Math.max(0, -Math.cos(ph)) * wk;
  const breathe = live ? Math.sin(now / 900 + p.phase) : 0;
  const talk = live && s.chat > 0.5 && SPEAKER === p.id;
  const type = live && s.typing > 0.5 ? 1 : 0;
  const bob = Math.abs(Math.sin(ph)) * 0.035 * wk;
  p.root.position.set(pos.x, s.y + bob + s.hop, pos.z);
  p.root.rotation.y = heading;
  p.root.scale.set(2 - s.sq, s.sq, 2 - s.sq);
  // jambes : marche (balancier, genou qui plie au passage) ou assis (cuisses à l'horizontale)
  const sit = s.sit;
  const hipsY = 0.66 - 0.26 * sit;
  p.hips.position.y = hipsY;
  p.legs[0].thigh.rotation.x = (-swing * 30 - 86 * sit) * D2R;
  p.legs[1].thigh.rotation.x = (swing * 30 - 86 * sit) * D2R;
  p.legs[0].knee.rotation.x = (lift2 * 38 + 74 * sit) * D2R;
  p.legs[1].knee.rotation.x = (lift * 38 + 74 * sit) * D2R;
  // buste
  p.spine.rotation.x = ((s.lean + breathe * 0.8) * D2R) + (talk ? Math.sin(now / 520) * 0.04 : 0);
  p.spine.rotation.z = Math.sin(ph) * 0.04 * wk;
  p.spine.scale.y = 1 + breathe * 0.008;
  // bras : balancier de marche + pose (frappe au clavier, téléphone, désigner)
  const tj = type ? Math.sin(now / 90 + p.phase) * 4 : 0, tj2 = type ? Math.sin(now / 103 + p.phase + 1.2) * 4 : 0;
  const ges = talk ? Math.sin(now / 260 + p.phase) * 12 - 8 : 0;
  p.arms[0].sh.rotation.x = (s.aL + swing * 26) * D2R; p.arms[0].sh.rotation.z = -s.sL * D2R;
  p.arms[1].sh.rotation.x = (s.aR - swing * 26 + ges * 0.5) * D2R; p.arms[1].sh.rotation.z = s.sR * D2R;
  p.arms[0].el.rotation.x = (s.eL + tj) * D2R; p.arms[1].el.rotation.x = (s.eR + tj2 + ges) * D2R;
  const look = live ? Math.sin(now / 1700 + p.phase * 2) * 6 : 0;
  p.neck.rotation.x = (s.head + (talk ? Math.sin(now / 430) * 4 : (s.chat > 0.5 && live ? Math.max(0, Math.sin(now / 700 + p.phase * 3)) * 5 : 0))) * D2R;
  p.neck.rotation.y = (s.headY + look) * D2R;
  p.phone.visible = s.phone > 0.5; p.headset.visible = s.headset > 0.5; p.laptop.visible = s.laptop > 0.5;
  p.blob.position.set(pos.x, 0.012, pos.z); p.blob.scale.setScalar(1 - 0.2 * sit);
  // étiquette au-dessus de la tête
  if (p.label) {
    const show = s.lab > 0.5 && s.op > 0.5;
    if (show) {
      tmpV.set(pos.x, s.y + 1.85 - 0.3 * sit + s.hop, pos.z).project(cam);
      const X = (tmpV.x * 0.5 + 0.5) * SW, Y = (-tmpV.y * 0.5 + 0.5) * SH;
      p.label.style.transform = `translate(${X.toFixed(1)}px, ${Y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    const o = show ? '1' : '0'; if (p.label.style.opacity !== o) p.label.style.opacity = o;
  }
}
let SPEAKER = null;

// distribution : Hugo et Joe à leur bureau, l'équipe au coin détente, Arthur dans son bureau, des collègues ailleurs
const SIT_Y = 0;
const DESK_TYPE = { aL: -46, aR: -46, eL: -58, eR: -58, sL: 8, sR: 8, lean: 10, head: 8 };
const TABLE_ARMS = { aL: -40, aR: -40, eL: -50, eR: -50, sL: 10, sR: 10, lean: 6, head: 4 };
const PHONE_POSE = { aR: -52, eR: -88, sR: 18, aL: -30, eL: -40, head: 22 };
const REST = { aL: 4, aR: 4, eL: -10, eR: -10, sL: 6, sR: 6, lean: 0, head: 0, headY: 0 };
const CARRY = { aL: 0, eL: -12, sL: 12 };
function seated(seat, extra) { return Object.assign({ x: seat.x, z: seat.z, ry: seat.ry / D2R, sit: 1, op: 1 }, extra); }
makePerson('hugo', Object.assign(seated(SEAT_DESK.hugo, DESK_TYPE), PHONE_POSE, { phone: 1, lab: 0 }));
makePerson('joe', Object.assign(seated(SEAT_DESK.joe, DESK_TYPE), { typing: 1 }));
makePerson('newfel', Object.assign({}, REST, { x: -8.9, z: 4.9, ry: 140, aR: -40, eR: -70 }));
makePerson('brian', Object.assign({}, REST, { x: -7.6, z: 5.2, ry: 230, aL: -40, eL: -70 }));
makePerson('raphael', Object.assign({}, REST, { x: -11.7, z: 6.5, ry: 90, sit: 1, aL: -20, eL: -40, aR: -20, eR: -40 }));
makePerson('arthur', Object.assign(seated({ x: 10.8, z: 8.1, ry: Math.PI }, DESK_TYPE), { typing: 1 }));
makePerson('ceo', Object.assign({}, REST, { x: 2.6, z: 1.8, ry: 70, op: 0 }));
makePerson('f1', Object.assign(seated(SEAT_DESK.f1, DESK_TYPE), { typing: 1 }));
makePerson('f2', Object.assign(seated(SEAT_DESK.f2, DESK_TYPE), { typing: 1 }));
makePerson('f3', Object.assign(seated(SEAT_DESK.f3, DESK_TYPE), { typing: 1 }));
makePerson('l1', Object.assign(seated({ x: 0.95, z: 6.3, ry: Math.PI / 2 }, TABLE_ARMS), { chat: 1 }));
makePerson('l2', Object.assign(seated({ x: 3.05, z: 6.3, ry: -Math.PI / 2 }, TABLE_ARMS), { chat: 1 }));
