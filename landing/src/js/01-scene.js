import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
gsap.registerPlugin(ScrollTrigger);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const LED = { green: '#2FA66B', orange: '#F08A24', red: '#E5484D' };
const LED_LABEL = { green: 'Libre', orange: 'Réservée, en attente', red: 'Occupée' };
const D2R = Math.PI / 180;

/* =====================================================================
   1. Rendu 3D : une maquette d'architecte blanche, vue en plongée trois-quarts (caméra orthographique)
   ===================================================================== */
const stageEl = $('#stage'), canvas = $('#iso');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.1, 400);
const CAMDIR = new THREE.Vector3(1, 1.72, 1.0).normalize();
const VIEW = { tx: 0, ty: 0, tz: 0, h: 17 };
let SW = 1, SH = 1;
// deux cadrages suivis en parallèle : VIEW (grand écran) et NVIEW (petit écran, où les maquettes d'écran prennent plus de place)
const NVIEW = { tx: 0, ty: 0, tz: 0, h: 17 };
let CAMV = VIEW;
function placeCamera() {
  const V = CAMV, a = SW / SH, h = V.h;
  cam.left = -h * a / 2; cam.right = h * a / 2; cam.top = h / 2; cam.bottom = -h / 2;
  cam.position.set(V.tx + CAMDIR.x * 90, V.ty + CAMDIR.y * 90, V.tz + CAMDIR.z * 90);
  cam.lookAt(V.tx, V.ty, V.tz);
  cam.updateProjectionMatrix();
}
function resize() {
  const r = stageEl.getBoundingClientRect();
  SW = Math.max(1, Math.round(r.width)); SH = Math.max(1, Math.round(r.height));
  renderer.setSize(SW, SH, false);
  needRender = true;
}
let needRender = true;

// Lumières : ciel doux, soleil à ombres douces, et une lumière d'appoint froide
const hemi = new THREE.HemisphereLight(0xFFFFFF, 0xE3E7EE, 1.3);
scene.add(hemi);
const sunL = new THREE.DirectionalLight(0xFFF4E6, 2.1);
sunL.castShadow = true;
sunL.shadow.mapSize.set(2048, 2048);
sunL.shadow.camera.left = -19; sunL.shadow.camera.right = 19; sunL.shadow.camera.top = 15; sunL.shadow.camera.bottom = -15;
sunL.shadow.camera.near = 1; sunL.shadow.camera.far = 90;
sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.03; sunL.shadow.radius = 5;
scene.add(sunL); scene.add(sunL.target);
const fillL = new THREE.DirectionalLight(0xE6EEFF, 0.45);
fillL.position.set(30, 40, 26); scene.add(fillL);
const SUN = { az: 330, el: 55, i: 2.0, color: '#FFF4E6' };
function placeSun() {
  const a = SUN.az * D2R, e = SUN.el * D2R;
  sunL.position.set(Math.cos(e) * Math.sin(a) * 40, Math.sin(e) * 40, Math.cos(e) * Math.cos(a) * 40);
  sunL.target.position.set(0, 0, 0);
  sunL.intensity = SUN.i; sunL.color.set(SUN.color);
}

/* ---- Matériaux mats : blanc maquette, pastels, verre ---- */
const MAT = {};
const mat = (k, color, o = {}) => (MAT[k] = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.88, metalness: 0 }, o)));
mat('white', '#F5F5F3'); mat('wall', '#F7F7F5'); mat('floor', '#ECECEA'); mat('corr', '#E4E5E3'); mat('slab', '#F2F2F0');
mat('mint', '#BFE3D0'); mat('sky', '#C6DAF1'); mat('butter', '#F3E2A9'); mat('blush', '#F1C8C8'); mat('lilac', '#D8CFEF'); mat('sage', '#CFE0C3');
mat('rugA', '#DCE6F3'); mat('rugB', '#E9E5F0'); mat('rugC', '#EEE7DA'); mat('wood', '#E9DCC8'); mat('leaf', '#A9CFA0'); mat('pot', '#E9E2D6');
mat('dark', '#2A2D34', { roughness: 0.5 }); mat('screen', '#3A4252', { roughness: 0.35 }); mat('metal', '#C9CDD3', { roughness: 0.5 });
mat('boxBlack', '#16181D', { roughness: 0.42 }); mat('grey', '#D5D8DD');
mat('clay', '#F6F3EE', { roughness: 0.62 });
MAT.glass = new THREE.MeshStandardMaterial({ color: '#DDEBF6', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.26, depthWrite: false });
MAT.window = new THREE.MeshStandardMaterial({ color: '#CFE2F3', roughness: 0.2, transparent: true, opacity: 0.45, depthWrite: false, emissive: '#000000' });

const GEO = new Map();
function rbox(w, h, d, r = 0.04) {
  const k = `${w}|${h}|${d}|${r}`;
  if (!GEO.has(k)) GEO.set(k, r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)) : new THREE.BoxGeometry(w, h, d));
  return GEO.get(k);
}
function cyl(rt, rb, h, seg = 24) { const k = `c${rt}|${rb}|${h}|${seg}`; if (!GEO.has(k)) GEO.set(k, new THREE.CylinderGeometry(rt, rb, h, seg)); return GEO.get(k); }
function add(parent, geo, m, x, y, z, o = {}) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  if (o.ry) mesh.rotation.y = o.ry;
  if (o.rx) mesh.rotation.x = o.rx;
  if (o.rz) mesh.rotation.z = o.rz;
  mesh.castShadow = o.cast !== false; mesh.receiveShadow = o.receive !== false;
  parent.add(mesh); return mesh;
}
// boîte posée : (x, z) = centre au sol, y0 = altitude du dessous
const BX = (p, w, h, d, m, x, y0, z, o = {}) => add(p, rbox(w, h, d, o.r ?? 0.035), m, x, y0 + h / 2, z, o);

/* =====================================================================
   2. L'étage : open space, couloir, salle Atlas, bulles, bureau d'Arthur, salle Lyra, coin détente
      Repère : x vers l'est, z vers le sud (vers la caméra), y vers le haut ; 1 unité = 1 mètre
   ===================================================================== */
const FLOOR = new THREE.Group(); scene.add(FLOOR);
// cloisons coupées à mi-hauteur, comme une maquette : on voit dans chaque pièce depuis la plongée
const WALL_H = 2.4, PART_H = 1.25, GLASS_H = 1.25;
function wall(p, x0, z0, x1, z1, h = PART_H, m = MAT.wall, t = 0.14) {
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
  return add(p, rbox(t, h, len, 0.02), m, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, { ry: ang });
}
function glassWall(p, x0, z0, x1, z1, gaps = []) {
  // cloison vitrée : vitrage, montants et lisses blancs ; gaps = portions [a, b] (0..1) laissées ouvertes (portes)
  const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  const pts = [0]; gaps.forEach(([a, b]) => pts.push(a, b)); pts.push(1);
  for (let i = 0; i < pts.length; i += 2) {
    const a = pts[i], b = pts[i + 1]; if (b - a < 0.01) continue;
    const ax = x0 + dx * len * a, az = z0 + dz * len * a, bx = x0 + dx * len * b, bz = z0 + dz * len * b;
    const L = len * (b - a), ang = Math.atan2(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2;
    add(p, rbox(0.03, GLASS_H - 0.08, L, 0), MAT.glass, cx, GLASS_H / 2, cz, { ry: ang, cast: false });
    add(p, rbox(0.07, 0.07, L, 0.02), MAT.white, cx, GLASS_H, cz, { ry: ang });
    add(p, rbox(0.07, 0.06, L, 0.02), MAT.white, cx, 0.03, cz, { ry: ang });
    for (let k = 0; k <= Math.ceil(L / 1.2); k++) { const t = Math.min(1, k / Math.ceil(L / 1.2)); add(p, rbox(0.07, GLASS_H, 0.07, 0.02), MAT.white, ax + (bx - ax) * t, GLASS_H / 2, az + (bz - az) * t); }
  }
}
function exteriorWall(p, x0, z0, x1, z1) {
  // façade : allège pleine, bandeau vitré, linteau ; montants réguliers
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  add(p, rbox(0.22, 0.75, len, 0.03), MAT.wall, cx, 0.375, cz, { ry: ang });
  add(p, rbox(0.22, 0.3, len, 0.03), MAT.wall, cx, WALL_H + 0.05, cz, { ry: ang });
  add(p, rbox(0.06, WALL_H - 0.95, len, 0), MAT.window, cx, 0.75 + (WALL_H - 0.95) / 2 + 0.05, cz, { ry: ang, cast: false });
  const n = Math.round(len / 1.6);
  for (let k = 0; k <= n; k++) { const t = k / n; add(p, rbox(0.24, WALL_H - 0.7, 0.1, 0.02), MAT.wall, x0 + (x1 - x0) * t, 0.75 + (WALL_H - 0.75) / 2, z0 + (z1 - z0) * t); }
}
function plant(p, x, z, s = 1) {
  BX(p, 0.34 * s, 0.36 * s, 0.34 * s, MAT.pot, x, 0, z, { r: 0.06 });
  const g = new THREE.Group(); g.position.set(x, 0.36 * s, z); p.add(g);
  [[0, 0.32, 0, 0.26], [0.12, 0.22, 0.08, 0.18], [-0.1, 0.24, -0.06, 0.2], [0.02, 0.48, -0.04, 0.17]].forEach(([dx, dy, dz, r]) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), MAT.leaf); m.position.set(dx * s, dy * s, dz * s); m.castShadow = true; g.add(m);
  });
}
function chair(p, x, z, ry, m = MAT.sky) {
  // chaise de réunion : assise, dossier arrondi, pied central
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; p.add(g);
  add(g, cyl(0.06, 0.18, 0.04), MAT.metal, 0, 0.02, 0);
  add(g, cyl(0.025, 0.025, 0.26), MAT.metal, 0, 0.16, 0);
  BX(g, 0.46, 0.08, 0.44, m, 0, 0.29, 0, { r: 0.035 });
  BX(g, 0.46, 0.4, 0.07, m, 0, 0.37, -0.22, { r: 0.035 });
  return g;
}
function desk(p, x, z, w = 1.3, d = 0.7, ry = 0, m = MAT.white) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; p.add(g);
  BX(g, w, 0.04, d, m, 0, 0.64, 0, { r: 0.015 });
  BX(g, 0.04, 0.64, d - 0.08, m, -w / 2 + 0.04, 0, 0, { r: 0.01 });
  BX(g, 0.04, 0.64, d - 0.08, m, w / 2 - 0.04, 0, 0, { r: 0.01 });
  return g;
}
function monitor(p, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0.68, z); g.rotation.y = ry; p.add(g);
  add(g, rbox(0.2, 0.015, 0.14, 0.006), MAT.dark, 0, 0.008, 0);
  add(g, rbox(0.03, 0.2, 0.03, 0.01), MAT.dark, 0, 0.11, 0);
  add(g, rbox(0.56, 0.34, 0.03, 0.015), MAT.dark, 0, 0.36, 0.02);
  return g;
}
function sofa(p, x, z, ry, m, w = 1.8) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; p.add(g);
  BX(g, w, 0.32, 0.8, m, 0, 0.04, 0, { r: 0.08 });
  BX(g, w, 0.42, 0.2, m, 0, 0.2, -0.32, { r: 0.08 });
  BX(g, 0.2, 0.3, 0.8, m, -w / 2 + 0.1, 0.24, 0, { r: 0.08 });
  BX(g, 0.2, 0.3, 0.8, m, w / 2 - 0.1, 0.24, 0, { r: 0.08 });
  return g;
}

// dalle et sols
BX(FLOOR, 26.4, 0.34, 18.4, MAT.slab, 0, -0.34, 0, { r: 0.08 });
add(FLOOR, rbox(26, 0.02, 18, 0), MAT.floor, 0, 0.0, 0, { cast: false });
add(FLOOR, rbox(15, 0.02, 4, 0), MAT.corr, 5.5, 0.012, 1, { cast: false });
// façades nord et ouest, bordures basses au sud et à l'est (coupe de maquette)
exteriorWall(FLOOR, -13, -9, 13, -9);
exteriorWall(FLOOR, -13, -9, -13, 9);
BX(FLOOR, 26.2, 0.14, 0.16, MAT.wall, 0, 0, 9.02, { r: 0.03 });
BX(FLOOR, 0.16, 0.14, 18.2, MAT.wall, 13.02, 0, 0, { r: 0.03 });

// noyau ascenseurs
BX(FLOOR, 3.6, 1.6, 3.4, MAT.wall, 0, 0, -7.3, { r: 0.04 });
add(FLOOR, rbox(0.9, 1.4, 0.03, 0.01), MAT.grey, -0.8, 0.7, -5.59);
add(FLOOR, rbox(0.9, 1.4, 0.03, 0.01), MAT.grey, 0.8, 0.7, -5.59);

// ---- Salle Atlas (nord-est) : cloisons vitrées, table, quatre chaises, écran, horloge, suspensions ----
const ATLAS = new THREE.Group(); FLOOR.add(ATLAS);
add(ATLAS, rbox(7, 0.02, 8, 0), MAT.rugA, 6.5, 0.02, -5, { cast: false });
glassWall(ATLAS, 3, -1, 10, -1, [[0.05, 0.2]]);
glassWall(ATLAS, 3, -9, 3, -1);
wall(ATLAS, 10, -9, 10, -1);
// plaque « Atlas » sur la cloison vitrée, côté couloir
(() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#0E2140'; g.beginPath(); g.roundRect(0, 0, 256, 96, 18); g.fill();
  g.fillStyle = '#FFFFFF'; g.font = '600 52px Sora, DM Sans, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Atlas', 128, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
  m.position.set(5.0, 1.05, -0.94); ATLAS.add(m);
})();
const TABLE = { x: 6.5, z: -5, w: 3.0, d: 1.4, h: 0.66 };
BX(ATLAS, TABLE.w, 0.05, TABLE.d, MAT.white, TABLE.x, TABLE.h - 0.05, TABLE.z, { r: 0.02 });
BX(ATLAS, 0.12, TABLE.h - 0.05, 0.8, MAT.white, TABLE.x - 1.0, 0, TABLE.z, { r: 0.02 });
BX(ATLAS, 0.12, TABLE.h - 0.05, 0.8, MAT.white, TABLE.x + 1.0, 0, TABLE.z, { r: 0.02 });
const SEAT = {
  A: { x: 5.7, z: -3.95, ry: Math.PI },        // côté sud, face au nord
  B: { x: 7.3, z: -3.95, ry: Math.PI },
  C: { x: 5.7, z: -6.05, ry: 0 },              // côté nord, face au sud
  D: { x: 7.3, z: -6.05, ry: 0 },
};
Object.values(SEAT).forEach(s => chair(ATLAS, s.x, s.z + (s.ry ? 0.12 : -0.12), s.ry, MAT.sky));
// écran mural et horloge sur la façade nord
// meuble bas devant la baie : écran sur pied, horloge de table tournée vers la salle
BX(ATLAS, 3.4, 0.5, 0.5, MAT.white, 6.9, 0, -8.45, { r: 0.04 });
BX(ATLAS, 0.06, 0.4, 0.06, MAT.dark, 6.2, 0.5, -8.5, { r: 0.02 });
BX(ATLAS, 1.5, 0.86, 0.05, MAT.screen, 6.2, 0.86, -8.5, { r: 0.02 });
const CLOCK = new THREE.Group(); CLOCK.position.set(8.0, 0.86, -8.4); ATLAS.add(CLOCK);
BX(ATLAS, 0.34, 0.08, 0.2, MAT.white, 8.0, 0.5, -8.42, { r: 0.03 });
add(CLOCK, cyl(0.3, 0.3, 0.07, 40), MAT.white, 0, 0, 0, { rx: Math.PI / 2 });
add(CLOCK, new THREE.TorusGeometry(0.3, 0.025, 8, 40), MAT.butter, 0, 0, 0.03, { cast: false });
for (let k = 0; k < 12; k++) add(CLOCK, rbox(0.016, k % 3 ? 0.03 : 0.05, 0.01, 0), MAT.dark, Math.sin(k * Math.PI / 6) * 0.24, Math.cos(k * Math.PI / 6) * 0.24, 0.04, { rz: -k * Math.PI / 6, cast: false });
const hourHand = new THREE.Group(), minHand = new THREE.Group(), secHand = new THREE.Group();
[hourHand, minHand, secHand].forEach(h => { h.position.z = 0.045; CLOCK.add(h); });
add(hourHand, rbox(0.03, 0.15, 0.012, 0.006), MAT.dark, 0, 0.06, 0, { cast: false });
add(minHand, rbox(0.022, 0.22, 0.012, 0.006), MAT.dark, 0, 0.1, 0.006, { cast: false });
const secMat = new THREE.MeshBasicMaterial({ color: '#E5484D', transparent: true, opacity: 0 });
add(secHand, rbox(0.01, 0.25, 0.01, 0), secMat, 0, 0.1, 0.014, { cast: false });
plant(ATLAS, 9.4, -8.4, 1.2); plant(ATLAS, 3.5, -8.4, 1);
// crédence et machine à café le long de la cloison est
BX(ATLAS, 0.5, 0.72, 2.0, MAT.wood, 9.62, 0, -4.2, { r: 0.04 });
BX(ATLAS, 0.3, 0.36, 0.26, MAT.dark, 9.62, 0.72, -4.7, { r: 0.04 });
[[-3.95, MAT.butter], [-3.7, MAT.mint]].forEach(([z, m]) => add(ATLAS, cyl(0.045, 0.04, 0.1, 14), m, 9.6, 0.77, z));
// suspensions (allumées le soir)
const lampMat = new THREE.MeshStandardMaterial({ color: '#F4EBD8', emissive: '#FFE3A6', emissiveIntensity: 0, roughness: 0.6 });
const lampLight = new THREE.PointLight('#FFD9A0', 0, 6, 1.6); lampLight.position.set(6.5, 1.6, TABLE.z); ATLAS.add(lampLight);

// ---- Le boîtier : cube noir, bandeau LED tout autour, halo et lumière colorée sur la table ----
const BOX = new THREE.Group(); BOX.position.set(TABLE.x, TABLE.h, TABLE.z); BOX.rotation.y = 0.5; ATLAS.add(BOX);
add(BOX, rbox(0.22, 0.17, 0.22, 0.03), MAT.boxBlack, 0, 0.085, 0);
const ledMat = new THREE.MeshBasicMaterial({ color: LED.green, toneMapped: false });
add(BOX, rbox(0.228, 0.022, 0.228, 0.012), ledMat, 0, 0.045, 0, { cast: false });
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW = glowTexture();
const haloMat = new THREE.MeshBasicMaterial({ map: GLOW, color: LED.green, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), haloMat); halo.rotation.x = -Math.PI / 2; halo.position.set(TABLE.x, TABLE.h + 0.006, TABLE.z); ATLAS.add(halo);
const haloV = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: LED.green, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
haloV.scale.set(0.9, 0.5, 1); haloV.position.set(TABLE.x, TABLE.h + 0.06, TABLE.z); ATLAS.add(haloV);
const ledLight = new THREE.PointLight(LED.green, 0.6, 2.6, 2); ledLight.position.set(TABLE.x, TABLE.h + 0.25, TABLE.z); ATLAS.add(ledLight);
const LEDC = (() => { const c = new THREE.Color(LED.green); return { r: c.r, g: c.g, b: c.b, night: 0 }; })();
function applyLed() {
  ledMat.color.setRGB(LEDC.r, LEDC.g, LEDC.b);
  haloMat.color.copy(ledMat.color); haloV.material.color.copy(ledMat.color); ledLight.color.copy(ledMat.color);
  ledLight.intensity = 0.6 + LEDC.night * 2.4;
  haloMat.opacity = 0.3 + LEDC.night * 0.55; haloV.material.opacity = 0.22 + LEDC.night * 0.5;
  for (const m of extraLeds) m.color.copy(ledMat.color);
}
const extraLeds = [];
// ondes radar : anneaux qui s'étendent sur la table et au-delà
const rings = [0, 1, 2].map(() => {
  const m = new THREE.MeshBasicMaterial({ color: LED.orange, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const r = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), m); r.rotation.x = -Math.PI / 2; r.position.set(TABLE.x, TABLE.h + 0.12, TABLE.z); r.scale.setScalar(0.1); ATLAS.add(r);
  return { mesh: r, m, st: { s: 0.1, o: 0 } };
});

// ---- Bulles (nord-est) ----
wall(FLOOR, 10, -5, 13, -5);
glassWall(FLOOR, 10, -1, 13, -1, [[0.1, 0.4], [0.6, 0.9]]);
sofa(FLOOR, 11.5, -8.3, 0, MAT.blush, 1.6); BX(FLOOR, 0.5, 0.42, 0.5, MAT.white, 12.5, 0, -6.4, { r: 0.05 });
sofa(FLOOR, 11.5, -4.3, 0, MAT.sage, 1.6); plant(FLOOR, 10.5, -1.6, 0.8);

// ---- Bureau d'Arthur (sud-est) : cloisons vitrées, bureau, écran mural ----
glassWall(FLOOR, 5.5, 3.5, 13, 3.5, [[0.08, 0.22]]);
wall(FLOOR, 5.5, 3.5, 5.5, 9);
add(FLOOR, rbox(7.4, 0.02, 5.4, 0), MAT.rugB, 9.25, 0.02, 6.25, { cast: false });
desk(FLOOR, 10.8, 7.4, 1.6, 0.8, 0, MAT.white); monitor(FLOOR, 10.8, 7.2, 0);
chair(FLOOR, 10.8, 8.2, Math.PI, MAT.lilac);
const DASH_SCREEN = new THREE.Vector3(5.62, 1.45, 6.2);
add(FLOOR, rbox(0.05, 1.0, 1.7, 0.02), MAT.screen, 5.6, 1.45, 6.2);
// l'écran mural s'allume quand Arthur présente le tableau de bord
const tvMat = new THREE.MeshBasicMaterial({ color: '#EEF3FD', transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
const TV_GLOW = add(FLOOR, new THREE.PlaneGeometry(1.58, 0.9), tvMat, 5.632, 1.45, 6.2, { ry: Math.PI / 2, cast: false, receive: false });
plant(FLOOR, 12.4, 4.2, 1.1);

// ---- Salle Lyra (sud) : deux personnes en réunion, son propre boîtier ----
glassWall(FLOOR, -1.5, 3.5, 5.5, 3.5, [[0.06, 0.2]]);
wall(FLOOR, -1.5, 3.5, -1.5, 9);
add(FLOOR, cyl(0.7, 0.7, 0.04, 40), MAT.white, 2, 0.64, 6.3);
add(FLOOR, cyl(0.08, 0.2, 0.64, 20), MAT.white, 2, 0.32, 6.3);
chair(FLOOR, 1.05, 6.3, Math.PI / 2, MAT.butter); chair(FLOOR, 2.95, 6.3, -Math.PI / 2, MAT.butter);
const LYRA_BOX = new THREE.Group(); LYRA_BOX.position.set(2, 0.66, 6.3); LYRA_BOX.rotation.y = 0.3; FLOOR.add(LYRA_BOX);
add(LYRA_BOX, rbox(0.2, 0.15, 0.2, 0.03), MAT.boxBlack, 0, 0.075, 0);
add(LYRA_BOX, rbox(0.206, 0.02, 0.206, 0.01), new THREE.MeshBasicMaterial({ color: LED.red, toneMapped: false }), 0, 0.04, 0, { cast: false });
plant(FLOOR, 4.9, 8.4, 1);

// ---- Open space (ouest) : îlots de bureaux ----
const DESKS = { hugo: { x: -5.4, z: -2.4 }, joe: { x: -8.6, z: -2.4 } };
function bench(cx, cz) {
  desk(FLOOR, cx, cz - 0.36, 1.3, 0.7, 0); desk(FLOOR, cx, cz + 0.36, 1.3, 0.7, 0);
  BX(FLOOR, 1.3, 0.34, 0.03, MAT.sage, cx, 0.68, cz, { r: 0.01 });
  monitor(FLOOR, cx, cz - 0.2, Math.PI); monitor(FLOOR, cx, cz + 0.2, 0);
  BX(FLOOR, 0.36, 0.015, 0.12, MAT.white, cx + 0.05, 0.68, cz - 0.45, { r: 0.004 });
  BX(FLOOR, 0.36, 0.015, 0.12, MAT.white, cx - 0.05, 0.68, cz + 0.45, { r: 0.004 });
}
// îlots : chacun a deux places, côté nord (face au sud) et côté sud (face au nord)
[[-5.4, -2.4], [-8.6, -2.4], [-5.4, -6.4], [-8.6, -6.4]].forEach(([x, z]) => bench(x, z));
const SEAT_DESK = {
  hugo: { x: -5.4, z: -3.55, ry: 0 },          // côté nord de l'îlot 1, face au sud (vers la caméra)
  joe: { x: -8.6, z: -3.55, ry: 0 },
  f1: { x: -5.4, z: -5.25, ry: Math.PI }, f2: { x: -8.6, z: -7.55, ry: 0 }, f3: { x: -8.6, z: -1.25, ry: Math.PI },
};
Object.values(SEAT_DESK).forEach(s => chair(FLOOR, s.x, s.z + (s.ry ? 0.12 : -0.12), s.ry, MAT.mint));
// l'ordinateur portable de Joe (fermé) et sa version ouverte sur la table d'Atlas
const LAPTOP_DESK = add(FLOOR, rbox(0.34, 0.025, 0.24, 0.01), MAT.metal, -8.15, 0.68, -2.9);
const LAPTOP_TABLE = new THREE.Group(); LAPTOP_TABLE.position.set(SEAT.A.x, TABLE.h, SEAT.A.z - 0.62); ATLAS.add(LAPTOP_TABLE);
add(LAPTOP_TABLE, rbox(0.34, 0.02, 0.24, 0.01), MAT.metal, 0, 0.01, 0);
add(LAPTOP_TABLE, rbox(0.34, 0.24, 0.015, 0.008), MAT.metal, 0, 0.12, -0.13, { rx: -0.25 });
LAPTOP_TABLE.visible = false;
plant(FLOOR, -3.4, -4.4, 1.1); plant(FLOOR, -10.6, -4.4, 1.1); plant(FLOOR, -12.3, -8.3, 1.3);

// ---- Coin détente (sud-ouest) ----
add(FLOOR, cyl(2.2, 2.2, 0.02, 48), MAT.rugC, -9.6, 0.02, 6.0, { cast: false });
sofa(FLOOR, -12.2, 6.0, Math.PI / 2, MAT.mint, 2.2);
add(FLOOR, cyl(0.5, 0.5, 0.04, 32), MAT.wood, -10.6, 0.4, 6.0); add(FLOOR, cyl(0.06, 0.12, 0.4, 16), MAT.white, -10.6, 0.2, 6.0);
BX(FLOOR, 0.9, 0.4, 0.9, MAT.butter, -9.0, 0, 7.6, { r: 0.12 });
BX(FLOOR, 2.6, 0.92, 0.62, MAT.white, -11.5, 0, 2.6, { r: 0.03 }); BX(FLOOR, 2.6, 0.04, 0.66, MAT.wood, -11.5, 0.92, 2.6, { r: 0.015 });
add(FLOOR, cyl(0.42, 0.42, 0.04, 32), MAT.white, -8.2, 1.04, 4.6); add(FLOOR, cyl(0.04, 0.16, 1.04, 12), MAT.white, -8.2, 0.52, 4.6);
plant(FLOOR, -12.3, 8.3, 1.3); plant(FLOOR, -6.8, 8.4, 1);

/* ---- Les autres étages (vue éclatée d'ouverture) : dalles simples, cloisons basses ---- */
const OTHER = [];
const ghostMat = new THREE.MeshStandardMaterial({ color: '#F4F4F2', roughness: 0.9, transparent: true, opacity: 1 });
const ghostGlass = new THREE.MeshStandardMaterial({ color: '#D8E6F2', roughness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
for (const lvl of [-2, -1, 1, 2]) {
  const g = new THREE.Group(); scene.add(g); OTHER.push({ g, lvl });
  BX(g, 26.4, 0.34, 18.4, ghostMat, 0, -0.34, 0, { r: 0.08 });
  add(g, rbox(0.22, 1.2, 18, 0.03), ghostMat, -13, 0.6, 0); add(g, rbox(26, 1.2, 0.22, 0.03), ghostMat, 0, 0.6, -9);
  add(g, rbox(26, 0.05, 0.22, 0.02), ghostGlass, 0, 1.25, -9, { cast: false });
  [[3, -1, 10, -1], [-1.5, 3.5, 13, 3.5], [10, -9, 10, -1], [5.5, 3.5, 5.5, 9], [3, -9, 3, -1]].forEach(([a, b, c, d]) => wall(g, a, b, c, d, 1.0, ghostMat, 0.12));
  BX(g, 3.6, 1.6, 3.4, ghostMat, 0, 0, -7.3, { r: 0.04 });
  for (let i = 0; i < 6; i++) BX(g, 1.3, 0.6, 1.4, ghostMat, -11 + (i % 3) * 3.2, 0, -6.4 + Math.floor(i / 3) * 4, { r: 0.03 });
}
const EXPLODE = { v: 1 }; // 1 = bâtiment éclaté visible, 0 = seul l'étage d'Atlas
function applyExplode() {
  const v = EXPLODE.v;
  for (const o of OTHER) { o.g.visible = v > 0.01; const u = 1 - v; o.g.position.y = o.lvl * 3.6 + Math.sign(o.lvl) * (u * u * 14 + u * 4); }
  ghostMat.opacity = Math.min(1, v * 1.25); ghostGlass.opacity = 0.35 * v;
}

// tous les décors projettent et reçoivent des ombres douces ; le verre ne projette pas
scene.traverse(o => { if (o.isMesh && (o.material === MAT.glass || o.material === MAT.window || o.material === ghostGlass)) o.castShadow = false; });

/* Fusion du décor fixe : un seul maillage par matériau (et par groupe), soit quelques dizaines d'appels de dessin
   au lieu de plusieurs centaines. Les objets animés sont marqués « dyn » et restent indépendants. */
[LAPTOP_DESK, LAPTOP_TABLE, TV_GLOW, BOX, halo, hourHand, minHand, secHand, ...rings.map(r => r.mesh)].forEach(o => { o.userData.dyn = true; });
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert(), buckets = new Map(), dead = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    for (let a = o; a && a !== group; a = a.parent) if (a.userData.dyn) return;
    const k = o.material.uuid + (o.castShadow ? '|c' : '|n');
    if (!buckets.has(k)) buckets.set(k, { m: o.material, cast: o.castShadow, geos: [] });
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    buckets.get(k).geos.push(g); dead.push(o);
  });
  dead.forEach(o => o.parent.remove(o));
  // groupes vidés : on les retire aussi
  const empty = []; group.traverse(o => { if (o !== group && o.isGroup && !o.userData.dyn && !o.children.length) empty.push(o); });
  empty.forEach(o => o.parent && o.parent.remove(o));
  for (const { m, cast, geos } of buckets.values()) {
    const merged = new THREE.Mesh(mergeGeometries(geos, false), m);
    merged.castShadow = cast; merged.receiveShadow = true; group.add(merged);
    geos.forEach(g => g.dispose());
  }
}
mergeStatic(FLOOR); OTHER.forEach(o => mergeStatic(o.g));
