// Drive-in hideouts for Chor Police: Jugnupur ki Raat.
// A thief drives into a bay, kills the engine and lights, a door comes down, and police jeeps prowl past outside.
//
// Local space of every hideout: the bay floor is x from -w/2 to +w/2 and z from -d/2 to +d/2 (y up, ground at 0).
// The mouth is the +Z edge and the lane lies beyond it. The caller positions and rotates the returned group.
// The middle of the bay (0.6 wide, 1.1 long, below y = 0.5) is always left clear for the parked car. Doors that swing
// (the bungalow gate) cross a corner of that space while they move, but never come within 0.03 of a car of up to
// 0.42 x 0.4 x 0.86 parked in the middle; every other door drops or slides in the plane of the mouth.
//
// Cost per hideout: the props are baked into ONE mesh with vertex colours, the overhead surfaces into one mesh per
// roof colour (ctx.cutMat), plus the door and its depth mask (two of each for the two-leaf doors), a bulb, a signboard,
// a light pool (only while the bulb is lit) and the torchlight (only while searched). That is 7 to 9 draw calls with
// the door shut, at most 11 while searched, and about 800 to 1500 triangles. Textures, door materials and template
// geometries are made once and shared by all hideouts; they live as long as the page does.
//
// Light without lights: the bulb's glow on the props is baked per vertex and read through a two-texel light map, so
// an open hideout looks lit and a closed one goes dark without any THREE.Light. The props are MeshLambertMaterial,
// so the player's real headlight still lights them when the car noses in.
import * as THREE from '../vendor/three.module.min.js';

export const HIDEOUT_KINDS = ['garage', 'godown', 'shed', 'culvert', 'porch', 'grove', 'depot', 'boatshed', 'scrapyard'];

const OLD_KINDS = {
  'rooftop water tank': 'garage', 'sack stack': 'godown', 'covered handcart': 'shed', 'basket stack': 'shed',
  'drain niche': 'culvert', 'bush or hedge': 'porch', 'parked bus': 'depot', 'upturned boat': 'boatshed', 'scrap heap': 'scrapyard',
};

// Maps a hiding-spot kind from data/map.json to a hideout kind. Unknown strings give 'garage'.
// A string that already is one of HIDEOUT_KINDS is passed through unchanged.
export function kindFor(oldKind) {
  const k = typeof oldKind === 'string' ? oldKind.trim().toLowerCase() : '';
  if (OLD_KINDS[k]) return OLD_KINDS[k];
  return HIDEOUT_KINDS.indexOf(k) >= 0 ? k : 'garage';
}

// ---------------------------------------------------------------- small helpers
const PI = Math.PI, TAU = Math.PI * 2;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const pick = (r, list) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
function rng(seed) { // small seeded generator (mulberry32)
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _c = new THREE.Color();

// Brightness, tuned against the game's own setup: hemisphere 1.55, moon 1.05, a headlamp SpotLight of 16, ACES tone
// mapping at exposure 1.5 and a bloom that only picks up what is brighter than white.
const PROP_GAIN = 1.1;    // lift on the prop colours when baked
const PROP_MAX = 0.32;    // ...but no paler than the town's buildings, or the player's headlight burns the walls out to white
const LAMP_REACH = 7;     // strength of the bulb's baked light on the props
const LAMP_BOOST = 2.2;   // the bulb itself is brighter than white, so it blooms
const POOL = 0.4;         // the pool of light under the bulb

// template geometries: only ever read while baking, never drawn, so they hold no GPU memory
let UNIT = null;
const CYLS = new Map();
function units() {
  if (!UNIT) UNIT = {
    box: new THREE.BoxGeometry(1, 1, 1),
    ico: new THREE.IcosahedronGeometry(1, 0),
    ball: new THREE.SphereGeometry(1, 7, 5),
    dome: new THREE.SphereGeometry(1, 9, 4, 0, TAU, 0, PI / 2),
    ring: new THREE.TorusGeometry(1, 0.18, 5, 14),
    disc: new THREE.CircleGeometry(1, 14),
  };
  return UNIT;
}
function cylGeo(ratio, seg) {
  const key = seg + ':' + ratio.toFixed(3);
  let g = CYLS.get(key);
  if (!g) CYLS.set(key, g = new THREE.CylinderGeometry(ratio, 1, 1, seg));
  return g;
}

// Collects coloured primitives and bakes them into one BufferGeometry (one draw call).
class Bake {
  constructor(colours) { this.colours = colours; this.pos = []; this.nor = []; this.col = []; this.uvs = []; this.idx = []; this.n = 0; }
  // any geometry, placed with position, scale and rotation (scaled first, then turned)
  put(geo, hex, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    return this.add(geo, hex);
  }
  // a low-poly lump turned any way round and THEN squashed, so a flattened lump always stays flat
  lump(geo, hex, x, y, z, sx, sy, sz, rot) {
    _m2.makeRotationFromEuler(_e.set(rot * 0.7, rot, rot * 1.3));
    _m.makeScale(sx, sy, sz).multiply(_m2).setPosition(x, y, z);
    return this.add(geo, hex);
  }
  add(geo, hex) { // appends geo transformed by the matrix prepared in _m
    _n3.getNormalMatrix(_m);
    const pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv, ia = geo.index, base = this.n;
    _c.setHex(hex);
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(_m); this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(na, i).applyMatrix3(_n3).normalize(); this.nor.push(_v.x, _v.y, _v.z);
      if (this.colours) this.col.push(_c.r, _c.g, _c.b);
      else this.uvs.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0);
    }
    if (ia) for (let i = 0; i < ia.count; i++) this.idx.push(base + ia.getX(i));
    else for (let i = 0; i < pa.count; i++) this.idx.push(base + i);
    this.n += pa.count;
    return this;
  }
  box(w, h, d, x, y, z, hex, ry = 0, rx = 0, rz = 0) { return this.put(units().box, hex, x, y, z, w, h, d, rx, ry, rz); }
  cyl(rt, rb, h, x, y, z, hex, seg = 8, rx = 0, rz = 0) { return this.put(cylGeo(rt / rb, seg), hex, x, y, z, rb, h, rb, rx, 0, rz); }
  ball(ax, ay, az, x, y, z, hex, ry = 0, rz = 0) { return this.put(units().ball, hex, x, y, z, ax, ay, az, 0, ry, rz); }
  blob(r, x, y, z, hex, sy = 1, rot = 0) { return this.lump(units().ico, hex, x, y, z, r, r * sy, r, rot); }
  // lamp (optional, {x, y, z}): bakes how much of the bulb's light reaches each vertex into uv, read through a tiny light map
  build(lamp) {
    const g = new THREE.BufferGeometry();
    if (this.colours) { // fake ambient occlusion: everything gets darker towards the floor
      for (let i = 0; i < this.n; i++) {
        const k = PROP_GAIN * (0.7 + 0.3 * clamp01(this.pos[i * 3 + 1] / 0.42));
        for (let j = 0; j < 3; j++) this.col[i * 3 + j] = Math.min(PROP_MAX, this.col[i * 3 + j] * k);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      if (lamp) {
        const lit = new Float32Array(this.n * 2);
        for (let i = 0; i < this.n; i++) {
          const dx = lamp.x - this.pos[i * 3], dy = lamp.y - this.pos[i * 3 + 1], dz = lamp.z - this.pos[i * 3 + 2], dist = Math.hypot(dx, dy, dz) || 1e-4;
          const ndl = Math.max(0, (this.nor[i * 3] * dx + this.nor[i * 3 + 1] * dy + this.nor[i * 3 + 2] * dz) / dist);
          lit[i * 2] = 0.25 + 0.5 * clamp01((0.3 + 0.7 * ndl) / (1 + dist * dist * 0.75)); lit[i * 2 + 1] = 0.5;
        }
        g.setAttribute('uv', new THREE.BufferAttribute(lit, 2));   // the light map reads channel 0
      }
    } else g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.leafy) for (let i = 0; i < this.nor.length; i++) this.nor[i] *= LEAF_NORMAL;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Overhead surfaces (roofs, awnings, canopies): same baking, but the colour comes from the ctx.cutMat material.
// leafy: the game's building material paints every face whose normal ATTRIBUTE points up (y > 0.5) as a flat roof:
// darker, with slab seams and now and then a lit skylight. Right for a roof slab, wrong for a tree. Lighting
// normalises the normal, so a leafy bake stores its normals shortened: lit exactly the same, never taken for a roof.
const LEAF_NORMAL = 0.45;
class RoofBake extends Bake {
  constructor(leafy) { super(false); this.leafy = !!leafy; }
  box(w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) { return this.put(units().box, 0, x, y, z, w, h, d, rx, ry, rz); }
  cyl(rt, rb, h, x, y, z, seg = 8, rx = 0, rz = 0) { return this.put(cylGeo(rt / rb, seg), 0, x, y, z, rb, h, rb, rx, 0, rz); }
  blob(r, x, y, z, sy = 1, rot = 0) { return this.lump(units().ico, 0, x, y, z, r, r * sy, r, rot); }
}

// ---------------------------------------------------------------- textures (all painted in code, shared)
function canvasTex(w, h, paint, wrapS, scale = 1) { // scale > 1 paints the same picture on a finer canvas
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = h * scale;
  const c = cv.getContext('2d'); if (!c) return null;
  c.scale(scale, scale);
  paint(c, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  if (wrapS) t.wrapS = THREE.RepeatWrapping;
  return t;
}
const cut = (c, on) => { c.globalCompositeOperation = on ? 'destination-out' : 'source-over'; };
function grime(c, w, h, r, n, alpha) { // dirt and rust only where something is already painted
  c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = 2 + r() * 9, g = c.createRadialGradient(x, y, 0, x, y, rad);
    const rust = r() < 0.6;
    g.addColorStop(0, rust ? `rgba(${120 + r() * 50 | 0},${58 + r() * 26 | 0},26,${alpha})` : `rgba(18,16,14,${alpha})`);
    g.addColorStop(1, 'rgba(60,40,20,0)');
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  c.globalCompositeOperation = 'source-over';
}

// roller shutter: ribbed slats, two bands of punched slots and a few open joints (tiles sideways)
function paintShutter(c, w, h) {
  const r = rng(11), sh = 8;
  for (let y = 0; y < h; y += sh) {
    const g = c.createLinearGradient(0, y, 0, y + sh);
    g.addColorStop(0, '#e2e5e8'); g.addColorStop(0.4, '#b9bec3'); g.addColorStop(1, '#737a81');
    c.fillStyle = g; c.fillRect(0, y, w, sh);
    c.fillStyle = 'rgba(16,18,22,0.8)'; c.fillRect(0, y + sh - 1, w, 1);
  }
  for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(${96 + r() * 40 | 0},${52 + r() * 20 | 0},28,${0.1 + r() * 0.2})`; c.fillRect(r() * w, r() * h, 1 + r() * 3, 8 + r() * 44); }
  const gg = c.createLinearGradient(0, h - 44, 0, h); gg.addColorStop(0, 'rgba(18,16,14,0)'); gg.addColorStop(1, 'rgba(18,16,14,0.5)');
  c.fillStyle = gg; c.fillRect(0, h - 44, w, 44);
  c.fillStyle = '#50565d'; c.fillRect(0, h - 10, w, 10); c.fillStyle = '#9299a1'; c.fillRect(0, h - 10, w, 1);
  c.fillStyle = '#1f2226'; c.fillRect(w / 2 - 10, h - 7, 20, 4); c.fillStyle = '#b79a4a'; c.fillRect(w / 2 - 3, h - 8, 6, 6);
  for (const row of [2, 3, 4, 5, 9, 10]) for (let x = 2; x < w; x += 8) c.clearRect(x, row * sh + 2, 5, 3);   // rows 2 to 5 are at the hidden camera's eye level
  for (const row of [0, 7, 12]) c.clearRect(0, row * sh + sh - 1, w, 1);
}

// godown door leaf: old planks with open joints, iron straps, the meeting edge on the right
function paintPlanks(c, w, h) {
  const r = rng(23), pw = 16;
  for (let x = 0; x < w; x += pw) {
    const v = 0.78 + r() * 0.3;
    c.fillStyle = `rgb(${168 * v | 0},${142 * v | 0},${108 * v | 0})`; c.fillRect(x, 0, pw, h);
    for (let i = 0; i < 6; i++) { c.fillStyle = `rgba(44,30,18,${0.1 + r() * 0.16})`; c.fillRect(x + 2 + r() * (pw - 5), r() * h * 0.7, 1, 16 + r() * 70); }
    c.fillStyle = 'rgba(255,240,210,0.14)'; c.fillRect(x + 2, 0, 1, h);
  }
  const gg = c.createLinearGradient(0, h - 36, 0, h); gg.addColorStop(0, 'rgba(20,14,8,0)'); gg.addColorStop(1, 'rgba(20,14,8,0.5)');
  c.fillStyle = gg; c.fillRect(0, h - 36, w, 36);
  for (let x = pw; x < w - 6; x += pw) c.clearRect(x - 1, 0, 2, h);          // open joints between planks
  for (let x = 0; x < w; x += 4) c.clearRect(x, h - (r() * 5 | 0), 4, 6);      // rotten bottom edge
  for (const y of [16, 94]) {                                               // iron straps bridge the joints
    c.fillStyle = '#3a3d43'; c.fillRect(0, y, w, 10); c.fillStyle = '#737982'; c.fillRect(0, y, w, 1);
    for (let x = 8; x < w; x += 16) { c.fillStyle = '#9aa1aa'; c.fillRect(x - 1, y + 4, 3, 3); }
  }
  c.fillStyle = '#33363b'; c.fillRect(w - 6, 0, 6, h); c.fillStyle = '#6c727a'; c.fillRect(w - 6, 0, 1, h);
  c.fillStyle = '#a9afb6'; c.fillRect(w - 18, 54, 6, 20); c.fillStyle = '#25272a'; c.fillRect(w - 17, 58, 4, 12);
  grime(c, w, h, r, 26, 0.3);
}

// corrugated tin sheet for the scrap yard: rust, holes, an open seam (tiles sideways, leading edge on the right)
function paintTin(c, w, h) {
  const r = rng(37);
  for (let x = 0; x < w; x++) { const s = 0.5 + 0.5 * Math.sin(x / 8 * TAU), v = 104 + s * 92; c.fillStyle = `rgb(${v | 0},${v + 4 | 0},${v + 9 | 0})`; c.fillRect(x, 0, 1, h); }
  grime(c, w, h, r, 70, 0.55);
  for (let i = 0; i < 16; i++) { c.fillStyle = `rgba(110,56,26,${0.16 + r() * 0.2})`; c.fillRect(r() * w, 0, 2 + r() * 3, 20 + r() * 90); }
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(63, 0, 2, h);
  for (let x = 6; x < w; x += 20) { c.fillStyle = '#2a2622'; c.fillRect(x, 6, 2, 2); c.fillRect(x + 4, h - 12, 2, 2); }
  cut(c, true);
  c.fillRect(60, 14, 3, 40); c.fillRect(61, 66, 3, 44);
  for (let i = 0; i < 9; i++) { c.beginPath(); c.ellipse(8 + r() * (w - 16), 10 + r() * (h - 20), 2 + r() * 4, 1.5 + r() * 5, r() * 3, 0, TAU); c.fill(); }
  for (let x = 0; x < w; x += 3) { c.fillRect(x, h - (r() * 6 | 0), 3, 7); if (r() < 0.3) c.fillRect(x, 0, 3, r() * 4 | 0); }
  cut(c, false);
}

// tarpaulin: light cloth (tinted per hideout), folds, patches, rips and a torn hem (tiles sideways)
function paintTarp(c, w, h) {
  const r = rng(41);
  c.fillStyle = '#ccd0d4'; c.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const s = Math.sin(x / w * TAU * 3) * 0.6 + Math.sin(x / w * TAU * 7 + 1) * 0.3;
    c.fillStyle = s > 0 ? `rgba(255,255,255,${s * 0.2})` : `rgba(0,0,0,${-s * 0.34})`; c.fillRect(x, 0, 1, h);
  }
  c.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
  for (let i = 0; i < 5; i++) { c.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.1})`; c.fillRect(0, 12 + r() * (h - 30), w, 1 + r() * 2); }
  for (const [x, y, pw, ph, a] of [[18, 40, 28, 22, 0.5], [78, 76, 22, 26, 0.38]]) {
    c.fillStyle = `rgba(84,72,56,${a})`; c.fillRect(x, y, pw, ph);
    c.strokeStyle = 'rgba(240,236,220,0.7)'; c.setLineDash([3, 2]); c.lineWidth = 1; c.strokeRect(x + 1.5, y + 1.5, pw - 3, ph - 3); c.setLineDash([]);
  }
  const gg = c.createLinearGradient(0, h - 50, 0, h); gg.addColorStop(0, 'rgba(30,24,16,0)'); gg.addColorStop(1, 'rgba(30,24,16,0.5)');
  c.fillStyle = gg; c.fillRect(0, h - 50, w, 50);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 0, w, 6);
  for (let x = 8; x < w; x += 16) { c.fillStyle = '#2a2a2c'; c.beginPath(); c.arc(x, 4, 2.2, 0, TAU); c.fill(); }
  cut(c, true);
  for (const [x, y0, len] of [[36, 58, 52], [92, 22, 40], [112, 84, 40], [62, 92, 30]]) { // rips
    c.beginPath(); c.moveTo(x, y0);
    for (let y = y0; y < y0 + len; y += 6) c.lineTo(x + 2.2 + r() * 2.5, y + 3);
    for (let y = y0 + len; y > y0; y -= 6) c.lineTo(x - 2.2 - r() * 2.5, y - 3);
    c.closePath(); c.fill();
  }
  for (let i = 0; i < 7; i++) { c.beginPath(); c.arc(r() * w, 14 + r() * (h - 30), 1 + r() * 1.6, 0, TAU); c.fill(); }
  c.beginPath(); c.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) { c.lineTo(x, h - 3 - r() * 12); c.lineTo(x + 4, h - r() * 3); }
  c.lineTo(w, h); c.closePath(); c.fill();
  cut(c, false);
}

// fishing net: diamond mesh on nothing, a head rope, floats along the foot rope, two torn holes (tiles sideways)
function paintNet(c, w, h) {
  const r = rng(53);
  c.clearRect(0, 0, w, h);
  c.strokeStyle = 'rgba(176,204,190,0.95)'; c.lineWidth = 1.7;
  c.beginPath();
  for (let i = -h; i <= w + h; i += 16) { c.moveTo(i, 0); c.lineTo(i + h, h); c.moveTo(i, 0); c.lineTo(i - h, h); }
  c.stroke();
  c.fillStyle = '#e2efe4';
  for (let y = 0; y <= h; y += 8) for (let x = (y / 8 % 2) * 8; x <= w; x += 16) c.fillRect(x - 1.5, y - 1.5, 3, 3);
  cut(c, true);
  for (const [x, y, rad] of [[40, 58, 15], [100, 86, 11]]) { c.beginPath(); c.ellipse(x, y, rad, rad * 1.25, r(), 0, TAU); c.fill(); }
  cut(c, false);
  c.fillStyle = '#c1a373'; c.fillRect(0, 0, w, 4); c.fillRect(0, h - 6, w, 3);
  for (let x = 8; x < w; x += 32) {
    c.fillStyle = '#e09040'; c.beginPath(); c.ellipse(x, h - 6, 6, 4, 0, 0, TAU); c.fill();
    c.fillStyle = '#e8e2d0'; c.beginPath(); c.ellipse(x + 16, h - 5, 5, 3.4, 0, 0, TAU); c.fill();
  }
  for (let i = 0; i < 6; i++) { c.fillStyle = 'rgba(60,96,72,0.9)'; c.fillRect(r() * w, 10 + r() * (h - 30), 2, 6 + r() * 12); }
}

// culvert grille: one rusty frame with upright bars and two flats, one bar snapped
function paintGrille(c, w, h) {
  const r = rng(61);
  c.clearRect(0, 0, w, h);
  const bar = (x, y, bw, bh, vert) => {
    const g = vert ? c.createLinearGradient(x, 0, x + bw, 0) : c.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, '#5a3a2a'); g.addColorStop(0.4, '#b07a52'); g.addColorStop(1, '#3a241a');
    c.fillStyle = g; c.fillRect(x, y, bw, bh);
  };
  for (let i = 0, x = 20; x < w - 16; x += 22, i++) bar(x, 0, 7, i === 4 ? h * 0.66 : h, true);
  bar(0, 34, w, 8, false); bar(0, 84, w, 8, false);
  bar(0, 0, w, 8, false); bar(0, h - 8, w, 8, false); bar(0, 0, 8, h, true); bar(w - 8, 0, 8, h, true);
  grime(c, w, h, r, 120, 0.5);
  c.globalCompositeOperation = 'source-over';
  for (const [x, y] of [[60, h - 16], [150, h - 13], [206, h - 18]]) { c.fillStyle = 'rgba(70,92,66,0.95)'; c.beginPath(); c.ellipse(x, y, 10, 6, 0.2, 0, TAU); c.fill(); }
}

// bungalow gate leaf: bars with spear tips, a ring, a sheet-metal lower panel; hinge on the left, latch on the right
function paintGate(c, w, h) {
  c.clearRect(0, 0, w, h);
  const iron = '#4a515b', hi = '#99a3ae';
  for (let x = 14; x < w - 8; x += 12) {
    c.fillStyle = iron; c.fillRect(x, 13, 4, 74); c.fillStyle = hi; c.fillRect(x, 13, 1, 74);
    c.fillStyle = '#b89a4a'; c.beginPath(); c.moveTo(x - 1.5, 13); c.lineTo(x + 2, 1); c.lineTo(x + 5.5, 13); c.closePath(); c.fill();
  }
  c.strokeStyle = iron; c.lineWidth = 3.5; c.beginPath(); c.arc(w / 2, 50, 17, 0, TAU); c.stroke();
  c.strokeStyle = hi; c.lineWidth = 1; c.beginPath(); c.arc(w / 2, 50, 18.5, 3.4, 5.4); c.stroke();
  c.fillStyle = '#5c3530'; c.fillRect(0, 86, w, h - 86);
  c.strokeStyle = '#8a5a4e'; c.lineWidth = 2; c.beginPath(); c.moveTo(w / 2, 90); c.lineTo(w - 22, 106); c.lineTo(w / 2, 122); c.lineTo(22, 106); c.closePath(); c.stroke();
  for (let x = 10; x < w - 8; x += 9) { c.clearRect(x, 92, 2, 9); c.clearRect(x, 112, 2, 9); }
  c.fillStyle = iron;
  c.fillRect(0, 13, w, 6); c.fillRect(0, 82, w, 6); c.fillRect(0, h - 5, w, 5); c.fillRect(0, 8, 7, h - 8); c.fillRect(w - 7, 8, 7, h - 8);
  c.fillStyle = hi; c.fillRect(0, 13, w, 1); c.fillRect(0, 82, w, 1); c.fillRect(0, 8, 1, h - 8);
  c.fillStyle = '#c9b060'; c.fillRect(w - 14, 60, 10, 5);
}

// hanging branches for the grove: leafy strands of uneven length, dense at the top (tiles sideways)
function paintVines(c, w, h) {
  const r = rng(67), greens = ['#4a8a42', '#356e38', '#5c9a48', '#2c5c32', '#3f7a3c'];
  c.clearRect(0, 0, w, h);
  const leaf = (x, y, a, s) => { for (const dx of [-w, 0, w]) { c.beginPath(); c.ellipse(x + dx, y, 5.2 * s, 2.5 * s, a, 0, TAU); c.fill(); } };
  for (let i = 0; i < 16; i++) {
    const x0 = (i + 0.5) * 8 + (r() - 0.5) * 5, len = h * (0.5 + r() * 0.5), ph = r() * 6;
    c.strokeStyle = '#33482a'; c.lineWidth = 1.2; c.beginPath();
    for (let y = 0; y <= len; y += 4) c.lineTo(x0 + Math.sin(y / 11 + ph) * 3, y);
    c.stroke();
    for (let y = 4; y < len; y += 5 + r() * 3) { c.fillStyle = pick(r, greens); leaf(x0 + Math.sin(y / 11 + ph) * 3 + (r() < 0.5 ? -4 : 4), y, (r() - 0.5) * 1.6, 0.8 + r() * 0.5); }
  }
  for (let i = 0; i < 90; i++) { c.fillStyle = pick(r, greens); leaf(r() * w, r() * 20, (r() - 0.5) * 2, 1 + r() * 0.5); }
}

// soft round glow (additive, so black is "nothing")
function paintGlow(c, w, h) {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.22, '#b4b4b4'); g.addColorStop(0.55, '#4a4a4a'); g.addColorStop(0.85, '#101010'); g.addColorStop(1, '#000000');
  c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = g; c.fillRect(0, 0, w, h);
}

// torchlight atlas (additive): left half is the upright bar on the door, right half the streaks thrown across the floor
function paintTorch(c, w, h) {
  const im = c.createImageData(w, h), half = w / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 1 - y / (h - 1); let a;
    if (x < half) {
      const dx = (x - half / 2 + 0.5) / (half / 2), ends = Math.min(1, Math.min(v, 1 - v) * 9), win = Math.max(0, 1 - dx * dx * 1.5);
      a = Math.exp(-dx * dx * 5) * (0.35 + 0.65 * Math.exp(-dx * dx * 26)) * ends * win * win;
    } else {
      const dx = (x - half * 1.5 + 0.5) / (half / 2), band = (Math.floor(y / 5) % 2) ? 1 : 0.22, win = Math.max(0, 1 - dx * dx * 1.5);
      a = Math.exp(-dx * dx * 3) * Math.pow(1 - v, 1.4) * band * Math.min(1, v * 14) * win * win;   // fades to nothing before the quad's edges
    }
    const k = (y * w + x) * 4, u = Math.round(255 * Math.pow(clamp01(a), 0.45));
    im.data[k] = u; im.data[k + 1] = u; im.data[k + 2] = u; im.data[k + 3] = 255;
  }
  c.putImageData(im, 0, 0);
}

// signboard painted for one hideout (the caller of this owns and disposes the texture)
const SIGN_STYLE = {
  garage: [['#a8841f', '#1c1510', '#7a1f16'], ['#8a2f25', '#f0e3c2', '#f0e3c2'], ['#24567a', '#f1e6c8', '#e8c95a']],
  godown: [['#a39c86', '#1d1a16', '#1d1a16'], ['#8f8a78', '#3a1a14', '#3a1a14']],
  shed: [['#2a573d', '#e8cb5c', '#e8cb5c'], ['#5e3d24', '#efe2c2', '#efe2c2']],
  culvert: [['#74787a', '#17191a', '#17191a']],
  porch: [['#15171b', '#cdac5c', '#cdac5c'], ['#3a1f1a', '#e2cf9a', '#e2cf9a']],
  depot: [['#1f4a82', '#f0f0e6', '#e8c95a'], ['#1d5a4a', '#f0f0e6', '#f0f0e6']],
  boatshed: [['#6e573c', '#ece6d2', '#ece6d2'], ['#3d5a64', '#ece6d2', '#ece6d2']],
  scrapyard: [['#70492f', '#f0e8d4', '#f0e8d4'], ['#55595c', '#e8c040', '#e8c040']],
};
function paintSign(kind, text, seed, aspect) {
  // Painted as W x H, the board's own shape, onto a canvas whose height is the next power of two (the picture is
  // stretched to fit and the board squeezes it back). Old phones on WebGL1 can only mip-map power-of-two textures.
  const W = 256, H = Math.max(24, Math.min(128, W / aspect)), CH = H > 72 ? 128 : H > 36 ? 64 : 32;
  const styles = SIGN_STYLE[kind] || SIGN_STYLE.garage, st = styles[Math.abs(seed) % styles.length], r = rng(seed + 99);
  return canvasTex(W, CH, c => {
    c.scale(1, CH / H);
    c.fillStyle = st[0]; c.fillRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = st[2]; c.lineWidth = 3; c.strokeRect(4.5, 4.5, W - 9, H - 9);
    const label = String(text).toUpperCase();
    let px = Math.round(H * 0.6);
    const font = p => `900 ${p}px "Arial Black", "Arial Bold", Impact, "Helvetica Neue", Arial, sans-serif`;
    c.font = font(px);
    const tw = c.measureText(label).width, room = W - 26;
    if (tw > room) { px = Math.max(10, Math.floor(px * room / tw)); c.font = font(px); }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillText(label, W / 2 + 1.5, H / 2 + 3);
    c.fillStyle = st[1]; c.fillText(label, W / 2, H / 2 + 1);
    grime(c, W, H, r, 22, 0.28);
    for (let i = 0; i < 5; i++) { c.fillStyle = 'rgba(20,14,10,0.18)'; c.fillRect(r() * W, 0, 1 + r() * 2, H * (0.3 + r() * 0.7)); }
  });
}

// ---------------------------------------------------------------- shared materials and geometries
function hingedGeo(x0, x1, y0, y1) { // flat panel with white vertex colours; its hinge (or top edge) is the mesh origin
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x0, y1, 0, x1, y1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.computeBoundingSphere();
  return g;
}
function torchGeos() {
  // "over" is the spot of torchlight on the outside of the door; "under" is what gets through: streaks across
  // the floor inside and the same bar seen from behind. Unit height: the mesh is scaled to the door's height.
  const over = new THREE.BufferGeometry();
  over.setAttribute('position', new THREE.Float32BufferAttribute([-0.1, 0, 0.018, 0.1, 0, 0.018, -0.1, 1, 0.018, 0.1, 1, 0.018], 3));
  over.setAttribute('uv', new THREE.Float32BufferAttribute([0.03, 0, 0.47, 0, 0.03, 1, 0.47, 1], 2));
  over.setIndex([0, 1, 2, 2, 1, 3]);
  over.computeBoundingSphere();
  const under = new THREE.BufferGeometry();
  under.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.1, 0, 0.018, 0.1, 0, 0.018, -0.1, 1, 0.018, 0.1, 1, 0.018,
    -0.17, 0.045, -0.03, 0.17, 0.045, -0.03, -0.46, 0.045, -1.5, 0.46, 0.045, -1.5], 3));
  under.setAttribute('uv', new THREE.Float32BufferAttribute([0.03, 0, 0.47, 0, 0.03, 1, 0.47, 1, 0.53, 0, 0.97, 0, 0.53, 1, 0.97, 1], 2));
  under.setIndex([1, 0, 3, 3, 0, 2, 4, 5, 6, 6, 5, 7]);
  under.computeBoundingSphere();
  return { over, under };
}

let SH = null;
const MASKS = new Map();   // door material -> its depth mask
function shared() {
  if (SH) return SH;
  // forceSinglePass: a door is one flat sheet, so it needs no separate back and front pass. Without it three.js draws
  // every transparent double-sided mesh twice and looks its shader program up again each time, every frame.
  // Each door material carries a "mask": an invisible twin (no colour, depth only, cut out by the same texture) that is
  // drawn with the solid things. The door itself is blended and writes no depth, so without the mask anything
  // see-through that three.js happens to draw later (street-lamp cones, headlight beams, rain) would be painted
  // straight over a shut door from inside. With it, such light only shows where the door really has a gap.
  const doorMat = map => {
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
    MASKS.set(m, new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }));
    return m;
  };
  const tex = {
    shutter: canvasTex(128, 128, paintShutter, true, 2), planks: canvasTex(128, 128, paintPlanks, false, 2),
    tin: canvasTex(128, 128, paintTin, true, 2), tarp: canvasTex(128, 128, paintTarp, true, 2),
    net: canvasTex(128, 128, paintNet, true, 2), grille: canvasTex(256, 128, paintGrille, false, 2),
    gate: canvasTex(128, 128, paintGate, false, 2), vines: canvasTex(128, 128, paintVines, true, 2),
    glow: canvasTex(64, 64, paintGlow, false), torch: canvasTex(64, 128, paintTorch, false),
  };
  const torch = torchGeos();
  SH = {
    tex,
    door: {
      shutter: doorMat(tex.shutter), planks: doorMat(tex.planks), tin: doorMat(tex.tin), tarp: doorMat(tex.tarp),
      net: doorMat(tex.net), grille: doorMat(tex.grille), gate: doorMat(tex.gate), vines: doorMat(tex.vines),
    },
    bulbGeo: new THREE.SphereGeometry(1, 8, 6),
    signGeo: new THREE.PlaneGeometry(1, 1),
    leafGeo: hingedGeo(0, 1, 0, 1),        // gate leaf, hinge down its left edge
    hangGeo: hingedGeo(-0.5, 0.5, -1, 0),  // grille, hanging from its top edge
    torchOver: torch.over, torchUnder: torch.under,
    plainRoof: new Map(), lampTex: new Map(),
  };
  return SH;
}

// two texels, black and the bulb's colour: the baked uv picks a point between them
function lampTexture(hex) {
  const S = shared();
  let t = S.lampTex.get(hex);
  if (!t) {
    t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, hex >> 16 & 255, hex >> 8 & 255, hex & 255, 255]), 2, 1);
    t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    S.lampTex.set(hex, t);
  }
  return t;
}

// one cutMat material per colour, shared by every hideout built with the same ctx.cutMat
const CUT_CACHE = new WeakMap();
function cutMaterial(ctx, hex) {
  const fn = ctx && typeof ctx.cutMat === 'function' ? ctx.cutMat : null;
  let map = fn ? CUT_CACHE.get(fn) : shared().plainRoof;
  if (!map) CUT_CACHE.set(fn, map = new Map());
  let mat = map.get(hex);
  if (!mat) {
    try { mat = fn ? fn(hex) : null; } catch (err) { mat = null; }             // a broken cutMat must not take the town down with it
    if (!mat || !mat.isMaterial) mat = new THREE.MeshLambertMaterial({ color: hex });
    map.set(hex, mat);
  }
  return mat;
}

// ---------------------------------------------------------------- doors
// Every door has: top, h, z, span, solid (for the torchlight), set(f), pose(a, b, time, phase) and dispose().
// pose() gets two rattle values in -1..1 (0 when nobody is searching) and may add a slow sway of its own.
function quadGeo(tint) {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(12), 3), uv = new THREE.BufferAttribute(new Float32Array(8), 2);
  pos.setUsage(THREE.DynamicDrawUsage); uv.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos); g.setAttribute('uv', uv);
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  _c.setHex(tint);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([_c.r, _c.g, _c.b, _c.r, _c.g, _c.b, _c.r, _c.g, _c.b, _c.r, _c.g, _c.b]), 3));
  return g;
}

// a door mesh plus its depth mask, which rides along as a child so it follows every move and rattle
function doorMesh(geo, mat) {
  const mesh = new THREE.Mesh(geo, mat), mask = MASKS.get(mat);
  if (mask) mesh.add(new THREE.Mesh(geo, mask));
  return mesh;
}

// a panel that comes down from a fixed top edge while its texture unrolls with it (shutter, tarpaulin, net, branches)
function dropDoor(parent, mat, wid, hgt, top, z, uRep, tint, cloth) {
  const geo = quadGeo(tint), pos = geo.attributes.position, uv = geo.attributes.uv;
  pos.setXYZ(0, -wid / 2, 0, 0); pos.setXYZ(1, wid / 2, 0, 0); pos.setXYZ(2, -wid / 2, 0, 0); pos.setXYZ(3, wid / 2, 0, 0);
  geo.setIndex([0, 2, 1, 2, 3, 1]);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -hgt / 2, 0), Math.hypot(wid, hgt) / 2 + 0.06);
  const mesh = doorMesh(geo, mat); mesh.position.set(0, top, z); mesh.visible = false; parent.add(mesh);
  let e = 0;
  return {
    top, h: hgt, z, span: wid / 2 - 0.16, live: !!cloth, solid: 1,
    set(f) {
      e = cloth ? f * (0.35 + 0.65 * f) : f;                      // cloth falls, a shutter rolls
      const y = -e * hgt;
      pos.setY(2, y); pos.setY(3, y); pos.needsUpdate = true;
      uv.setXY(0, 0, e); uv.setXY(1, uRep, e); uv.setXY(2, 0, 0); uv.setXY(3, uRep, 0); uv.needsUpdate = true;
      mesh.visible = e > 0.004;
    },
    pose(a, b, time, ph) { // rattle is exaggerated so it still reads from the chase camera
      const sway = cloth ? Math.sin(time * 1.3 + ph) * 0.03 + Math.sin(time * 2.9 + ph * 2) * 0.012 : 0;
      mesh.position.x = a * 0.018; mesh.position.z = z + b * 0.008;
      mesh.position.y = top + (cloth ? 0 : Math.abs(a) * 0.022);               // a shutter jumps as someone tries to lift it
      mesh.rotation.z = b * 0.022; mesh.rotation.x = cloth ? sway + a * 0.1 : a * 0.014;
    },
    dispose() { geo.dispose(); },
  };
}

// leaves that slide out of the jambs while their texture travels with the leading edge (godown doors, tin sheet)
function slideDoor(parent, mat, leaves, hgt, y0, z, uRep, tint) {
  const parts = leaves.map(lf => {
    const geo = quadGeo(tint), pos = geo.attributes.position;
    pos.setXYZ(0, 0, 0, 0); pos.setXYZ(1, 0, 0, 0); pos.setXYZ(2, 0, hgt, 0); pos.setXYZ(3, 0, hgt, 0);
    geo.setIndex(lf.dir > 0 ? [0, 1, 2, 2, 1, 3] : [1, 0, 3, 3, 0, 2]);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(lf.dir * lf.len / 2, hgt / 2, 0), Math.hypot(lf.len, hgt) / 2 + 0.06);
    const mesh = doorMesh(geo, mat); mesh.position.set(lf.x0, y0, z); mesh.visible = false; parent.add(mesh);
    return { geo, mesh, lf };
  });
  let span = 0; for (const lf of leaves) span += lf.len;
  return {
    top: y0 + hgt, h: hgt, z, span: span / 2 - 0.16, live: false, solid: 1,
    set(f) {
      const e = f * f * (3 - 2 * f);
      for (const p of parts) {
        const pos = p.geo.attributes.position, uv = p.geo.attributes.uv, x = p.lf.dir * e * p.lf.len;
        pos.setX(1, x); pos.setX(3, x); pos.needsUpdate = true;
        uv.setXY(0, uRep * (1 - e), 0); uv.setXY(1, uRep, 0); uv.setXY(2, uRep * (1 - e), 1); uv.setXY(3, uRep, 1); uv.needsUpdate = true;
        p.mesh.visible = e > 0.004;
      }
    },
    pose(a, b) {
      for (let i = 0; i < parts.length; i++) {
        const m = parts[i].mesh, lf = parts[i].lf, s = i ? b : a;                // tugged leaves part a little and bang about
        m.position.z = z + s * 0.012; m.rotation.y = s * 0.02 * lf.dir; m.position.y = y0 + Math.abs(s) * 0.006; m.position.x = lf.x0 - lf.dir * Math.abs(s) * 0.022;
      }
    },
    dispose() { for (const p of parts) p.geo.dispose(); },
  };
}

// two barred leaves on side hinges that swing shut from against the side walls (bungalow gate)
function gateDoor(parent, S, leafW, hgt, y0, z, hingeX) {
  const L = doorMesh(S.leafGeo, S.door.gate), R = doorMesh(S.leafGeo, S.door.gate);
  L.scale.set(leafW, hgt, 1); L.position.set(-hingeX, y0, z);
  R.scale.set(leafW, hgt, 1); R.position.set(hingeX, y0, z);
  parent.add(L, R);
  let ang = 1.5, shut = 0;
  return {
    top: y0 + hgt, h: hgt, z, span: leafW - 0.16, live: false, solid: 0.5,
    set(f) { shut = f * f * (3 - 2 * f); ang = (1 - shut) * 1.5; L.rotation.y = ang; R.rotation.y = PI - ang; },
    pose(a, b) { L.rotation.y = ang + Math.abs(a) * 0.09 * shut; R.rotation.y = PI - ang - Math.abs(b) * 0.09 * shut; },   // rattled leaves can only give inwards
    dispose() { },
  };
}

// an iron grille that drops straight down in its guide channels, like a sluice gate (culvert).
// Raised, it stands above the lid; it never swings through the space where the car is parked.
function hangDoor(parent, S, wid, hgt, top, z) {
  const mesh = doorMesh(S.hangGeo, S.door.grille);
  mesh.scale.set(wid, hgt, 1); mesh.position.set(0, top + hgt, z); parent.add(mesh);
  let y = top + hgt, shut = 0;
  return {
    top, h: hgt, z, span: wid / 2 - 0.16, live: false, solid: 0.45,
    set(f) { shut = f; y = top + (1 - f * f) * hgt; mesh.position.y = y; },   // falls faster and faster, like a dropped grate
    pose(a, b) { // someone outside heaves at it: it jumps in its channels and clatters back
      mesh.position.y = y + Math.abs(a) * 0.03 * shut; mesh.position.x = b * 0.012 * shut;
      mesh.rotation.z = b * 0.012 * shut; mesh.rotation.x = a * 0.02 * shut;
    },
    dispose() { },
  };
}

// ---------------------------------------------------------------- shared building blocks
const reps = (width, tile) => Math.max(1, Math.round(width / tile));          // whole texture repeats across a door
function floorSlab(B, w, d, hex) { B.box(w, 0.012, d, 0, 0.006, 0, hex); }
function linerWalls(B, hw, hd, h, upper, lower, dado, sides) { // thin inner walls so the roof never floats over a low neighbour
  const t = 0.04;
  B.box(hw * 2, h, t, 0, h / 2, -hd + t / 2, upper);
  if (dado) B.box(hw * 2 - t * 2, dado, 0.01, 0, dado / 2 + 0.012, -hd + t + 0.005, lower);
  if (!sides) return;
  for (const s of [-1, 1]) { // the side walls stop just short of the mouth, so they share no face with door posts and pillars there
    B.box(t, h, hd * 2 - 0.006, s * (hw - t / 2), h / 2, -0.003, upper);
    if (dado) B.box(0.01, dado, hd * 2 - t - 0.006, s * (hw - t - 0.005), dado / 2 + 0.012, t / 2 - 0.003, lower);
  }
}
function tyre(B, x, y, z, rx = 0, rz = 0, r = 0.11) {
  B.cyl(r, r, r * 0.62, x, y, z, 0x1d1d20, 10, rx, rz);
  B.cyl(r * 0.5, r * 0.5, r * 0.66, x, y, z, 0x55595f, 8, rx, rz);
}
function lampBracket(B, x, y, z, r) { // a little tin shade over the bulb
  B.cyl(r * 0.45, r * 1.4, r * 0.8, x, y + r * 1.15, z, 0x2a2c30, 7);
  B.box(0.012, 0.012, 0.07, x, y + r * 1.6, z - 0.03, 0x2a2c30);
}
function signBoard(o, x, y, z, w, h, hex, rz = 0) { // backing board in the baked mesh, painted face added later
  o.B.box(w + 0.05, h + 0.05, 0.03, x, y, z - 0.02, hex, 0, 0, rz);
  o.sign = { x, y, z, w, h, rz };
}

// ---------------------------------------------------------------- the nine kinds
// Each builder fills o.B (baked props), o.R(hex) (overhead surfaces), o.door, o.lamp and optionally o.sign.
const BUILD = {
  // mechanic's garage with a roller shutter
  garage(o) {
    const { B, r, w, d, hw, hd } = o, back = -hd;
    const wall = pick(r, [0x8f8b78, 0x7f8a94, 0x94846e]), dado = pick(r, [0x70392e, 0x355a70, 0x4a5e40]);
    floorSlab(B, w, d, 0x4a4c50);
    B.box(0.36, 0.003, 0.28, -0.05, 0.0135, 0.16, 0x2a2b2e, 0.3); B.box(0.2, 0.003, 0.16, 0.1, 0.0135, -0.32, 0x303134, -0.5);
    linerWalls(B, hw, hd, 0.6, wall, dado, 0.21, true);
    const slab = o.R(0x666a72), trim = o.R(0x4e525a);
    slab.box(w, 0.07, d - 0.012, 0, 0.635, -0.006);                            // stops just behind the face of the shutter housing
    trim.box(w, 0.05, 0.06, 0, 0.695, back + 0.03); trim.box(0.06, 0.05, d, -hw + 0.03, 0.695, 0); trim.box(0.06, 0.05, d, hw - 0.03, 0.695, 0);
    const tk = r() < 0.5 ? -1 : 1;                                             // water tank on the roof
    trim.cyl(0.15, 0.16, 0.2, tk * 0.42, 0.77, -0.55, 10); trim.cyl(0.07, 0.09, 0.04, tk * 0.42, 0.89, -0.55, 8);
    B.box(w, 0.1, 0.1, 0, 0.615, hd - 0.05, 0x4c5158);                          // shutter drum housing
    for (const s of [-1, 1]) B.box(0.055, 0.57, 0.07, s * (hw - 0.0275), 0.285, hd - 0.05, 0x3c4046);   // shutter channels, proud of the walls
    const bx = -0.2;                                                           // workbench, vice, tool board
    B.box(0.74, 0.03, 0.2, bx, 0.2, back + 0.15, 0x73593c);
    B.box(0.03, 0.19, 0.16, bx - 0.33, 0.105, back + 0.15, 0x4e3d2a); B.box(0.03, 0.19, 0.16, bx + 0.33, 0.105, back + 0.15, 0x4e3d2a);
    B.box(0.07, 0.05, 0.06, bx + 0.22, 0.24, back + 0.17, 0x687078);
    B.box(0.12, 0.06, 0.09, bx - 0.2, 0.245, back + 0.14, pick(r, [0x8a3328, 0x2f5a8a]));
    B.box(0.64, 0.2, 0.014, bx, 0.43, back + 0.048, 0x5a4630);
    for (let i = 0; i < 5; i++) B.box(0.026, 0.1 + r() * 0.06, 0.008, bx - 0.24 + i * 0.12, 0.43, back + 0.058, pick(r, [0xb4bac0, 0x9a3a2e, 0xb4bac0, 0xa8963a]), 0, 0, (r() - 0.5) * 0.6);
    const tx = hw - 0.19, tz = back + 0.2;                                     // tyres
    for (let i = 0; i < 3; i++) tyre(B, tx + (r() - 0.5) * 0.03, 0.047 + i * 0.07, tz + (r() - 0.5) * 0.03);
    tyre(B, hw - 0.085, 0.122, -0.36, 0, PI / 2 - 0.18);
    const drum = pick(r, [0x2f5682, 0x8a3a2c, 0x2f6a4c]);                      // oil drum
    B.cyl(0.1, 0.1, 0.28, -hw + 0.15, 0.152, -0.5, drum, 10); B.cyl(0.104, 0.104, 0.02, -hw + 0.15, 0.1, -0.5, 0x9a9684, 10);
    B.cyl(0.104, 0.104, 0.02, -hw + 0.15, 0.21, -0.5, 0x9a9684, 10); B.cyl(0.03, 0.03, 0.02, -hw + 0.18, 0.3, -0.48, 0x24262a, 6);
    B.cyl(0.06, 0.06, 0.24, -hw + 0.11, 0.09, 0.3, 0x9a5226, 8, PI / 2); B.box(0.08, 0.06, 0.1, -hw + 0.11, 0.18, 0.3, 0x3a3e44); // air compressor
    B.box(0.16, 0.09, 0.1, hw - 0.14, 0.057, 0.3, 0x8a3028, 0.2); B.box(0.1, 0.012, 0.012, hw - 0.14, 0.115, 0.3, 0x2a2c30, 0.2); // toolbox
    signBoard(o, 0, 0.9, hd + 0.03, 1.3, 0.26, 0x2a2622);
    for (const s of [-1, 1]) B.box(0.03, 0.12, 0.03, s * 0.5, 0.72, hd - 0.01, 0x2a2622);
    o.lamp = { x: 0, y: 0.705, z: hd + 0.048, r: 0.032, hex: 0xffe6a8 };
    lampBracket(B, 0, 0.705, hd + 0.048, 0.032);
    o.door = dropDoor(o.g, o.S.door.shutter, w - 0.08, 0.575, 0.575, hd - 0.05, reps(w - 0.08, 0.71), pick(r, [0x9aa6b0, 0x86a08a, 0xb09078, 0xa0a0a0]), false);
  },

  // grain warehouse with two sliding plank doors
  godown(o) {
    const { B, r, w, d, hw, hd } = o, back = -hd;
    const wall = pick(r, [0x8c8470, 0x857a6a, 0x7c8478]), jute = [0x9c875c, 0x8f7b52, 0xa8925f];
    floorSlab(B, w, d, 0x443e36);
    B.box(0.3, 0.003, 0.2, -0.3, 0.0135, -0.5, 0x8a7a50, 0.4);
    linerWalls(B, hw, hd, 0.6, wall, 0x5c5244, 0.16, true);
    const tin = o.R(pick(r, [0x66584a, 0x5a6066])), ridge = o.R(0x3e3a36), tilt = Math.atan2(0.18, hw), run = Math.hypot(hw, 0.18) + 0.01;
    tin.box(run, 0.03, d - 0.08, -hw / 2, 0.715, 0, 0, 0, tilt); tin.box(run, 0.03, d - 0.08, hw / 2, 0.715, 0, 0, 0, -tilt);
    ridge.box(0.1, 0.03, d - 0.08, 0, 0.815, 0);
    for (const z of [-0.5, 0, 0.5]) { ridge.box(run, 0.012, 0.03, -hw / 2, 0.735, z, 0, 0, tilt); ridge.box(run, 0.012, 0.03, hw / 2, 0.735, z, 0, 0, -tilt); }
    for (const z of [hd - 0.03, back + 0.03]) {                                // stepped false-front gables, front and back
      B.box(w, 0.08, 0.06, 0, 0.6, z, wall); B.box(w * 0.82, 0.21, 0.06, 0, 0.745, z, wall); B.box(w * 0.36, 0.07, 0.06, 0, 0.885, z, wall);
    }
    for (let i = -1; i <= 1; i++) B.box(0.16, 0.035, 0.012, i * 0.36, 0.5, back + 0.046, 0x23201c);    // ventilator slits
    B.box(w, 0.03, 0.035, 0, 0.553, hd - 0.085, 0x34363b);                      // door rail
    const sack = (x, y, z, ry) => B.ball(0.15, 0.062, 0.1, x, y, z, pick(r, jute), ry + (r() - 0.5) * 0.25);
    B.box(0.66, 0.03, 0.28, -0.4, 0.027, back + 0.2, 0x57452f); B.box(0.5, 0.03, 0.28, 0.46, 0.027, back + 0.2, 0x57452f); // pallets
    sack(-0.56, 0.1, back + 0.2, 0); sack(-0.26, 0.1, back + 0.2, 0); sack(-0.41, 0.215, back + 0.2, 0); sack(-0.5, 0.33, back + 0.2, 0);
    sack(-0.2, 0.215, back + 0.19, 0.2); sack(0.38, 0.1, back + 0.2, 0); sack(0.6, 0.1, back + 0.2, PI / 2); sack(0.48, 0.215, back + 0.2, 0);
    B.ball(0.085, 0.14, 0.085, -hw + 0.13, 0.15, -0.3, pick(r, jute)); B.ball(0.085, 0.13, 0.085, -hw + 0.13, 0.14, -0.1, pick(r, jute)); // standing sacks
    B.ball(0.14, 0.06, 0.1, hw - 0.17, 0.07, -0.42, pick(r, jute), 1.2);
    const sx = hw - 0.14;                                                       // platform weighing scale
    B.box(0.18, 0.03, 0.22, sx, 0.027, 0.12, 0x4a4e54); B.box(0.025, 0.3, 0.025, sx + 0.06, 0.16, 0.03, 0x3a3e44); B.cyl(0.05, 0.05, 0.02, sx + 0.06, 0.33, 0.045, 0xb0aa94, 10, PI / 2);
    B.box(0.02, 0.5, 0.02, -hw + 0.07, 0.26, 0.42, 0x6a5236, 0, -0.12); B.box(0.02, 0.5, 0.02, -hw + 0.07, 0.26, 0.6, 0x6a5236, 0, -0.12); // ladder
    for (let i = 0; i < 4; i++) B.box(0.016, 0.016, 0.18, -hw + 0.07, 0.1 + i * 0.11, 0.523 - i * 0.013, 0x6a5236);
    signBoard(o, 0, 0.745, hd + 0.022, 1.12, 0.16, wall);
    o.lamp = { x: 0, y: 0.605, z: hd + 0.05, r: 0.03, hex: 0xffd98a };
    lampBracket(B, 0, 0.605, hd + 0.05, 0.03);
    o.door = slideDoor(o.g, o.S.door.planks, [{ x0: -hw + 0.04, dir: 1, len: hw - 0.04 }, { x0: hw - 0.04, dir: -1, len: hw - 0.04 }], 0.53, 0.012, hd - 0.085, 1, pick(r, [0xa89880, 0x8fa0a8, 0xa08a70]));
  },

  // market shed: tin roof on four posts, a tarpaulin curtain
  shed(o) {
    const { B, r, w, d, hw, hd } = o, back = -hd, wood = 0x57432e;
    floorSlab(B, w, d, 0x463b30);
    B.box(0.5, 0.003, 0.3, 0.3, 0.0135, -0.45, 0x7a6a42, 0.3); B.box(0.3, 0.003, 0.22, -0.4, 0.0135, 0.5, 0x33291f, -0.4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(0.026, 0.032, sz > 0 ? 0.68 : 0.6, sx * (hw - 0.06), sz > 0 ? 0.34 : 0.3, sz * (hd - 0.06), wood, 6);
    B.box(w - 0.06, 0.035, 0.035, 0, 0.615, hd - 0.06, wood); B.box(w - 0.06, 0.035, 0.035, 0, 0.565, back + 0.06, wood);
    for (const s of [-1, 1]) B.box(0.03, 0.03, d - 0.1, s * (hw - 0.06), 0.6, 0, wood, 0, -0.035);
    const a = o.R(0x626a70), b = o.R(pick(r, [0x70543f, 0x5a5448, 0x6a5a3a]));     // patchwork of tin sheets
    for (let i = 0; i < 3; i++) (i % 2 ? b : a).box(w / 3 + 0.06, 0.02, d + 0.02, (i - 1) * w / 3, 0.655 + i * 0.008, 0.02, 0, -0.055 - i * 0.006, (i - 1) * 0.02);
    b.box(0.2, 0.05, 0.12, -0.3, 0.7, -0.4, 0.4); a.cyl(0.1, 0.1, 0.05, 0.36, 0.7, 0.25, 10);      // brick and tyre hold the sheets down
    B.box(1.12, 0.06, 0.3, 0, 0.11, back + 0.2, 0x6a5234);                       // takht with baskets of vegetables
    for (const s of [-1, 1]) B.box(0.05, 0.08, 0.26, s * 0.5, 0.04, back + 0.2, 0x4a3824);
    const veg = [0x9a3e2c, 0x4a7a3a, 0xa08a34, 0x7a4a6a, 0xa86a2c];
    for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.36 + (r() - 0.5) * 0.04; B.cyl(0.105, 0.075, 0.09, x, 0.185, back + 0.2, 0x8f7040, 9); B.ball(0.095, 0.045, 0.095, x, 0.235, back + 0.2, pick(r, veg)); }
    B.box(0.2, 0.13, 0.26, -hw + 0.15, 0.077, -0.3, 0x6a5236, 0.1); B.box(0.2, 0.13, 0.26, -hw + 0.15, 0.21, -0.32, 0x7a6040, -0.15); // crates
    B.box(0.21, 0.012, 0.27, -hw + 0.15, 0.143, -0.3, 0x3a2c1c, 0.1);
    B.ball(0.1, 0.13, 0.1, hw - 0.15, 0.14, -0.2, 0x9a865a); B.cyl(0.1, 0.075, 0.09, hw - 0.16, 0.057, 0.12, 0x8f7040, 9); B.ball(0.09, 0.04, 0.09, hw - 0.16, 0.105, 0.12, pick(r, veg));
    B.cyl(0.14, 0.14, 0.02, -hw + 0.07, 0.15, 0.3, 0x4f3c28, 12, 0, PI / 2 - 0.2); B.cyl(0.03, 0.03, 0.03, -hw + 0.075, 0.15, 0.3, 0x2a2622, 6, 0, PI / 2 - 0.2); // cart wheel
    B.cyl(0.036, 0.036, w - 0.2, 0, 0.6, hd - 0.02, 0x3a4a5a, 6, 0, PI / 2);      // rolled-up tarpaulin
    signBoard(o, 0, 0.85, hd + 0.03, 0.92, 0.17, 0x2a2622);
    for (const s of [-1, 1]) B.box(0.02, 0.16, 0.02, s * 0.36, 0.72, hd + 0.0, 0x4a3824);
    o.lamp = { x: 0, y: 0.665, z: hd + 0.048, r: 0.03, hex: 0xffe2a0 };
    lampBracket(B, 0, 0.665, hd + 0.048, 0.03);
    o.door = dropDoor(o.g, o.S.door.tarp, w - 0.16, 0.585, 0.595, hd - 0.045, reps(w - 0.16, 0.67), pick(r, [0x5d7798, 0x628a74, 0x9a7c50, 0x7c809a]), true);
  },

  // concrete drain tunnel with a rusty grille
  culvert(o) {
    const { B, r, w, d, hw, hd } = o, back = -hd, conc = 0x5c6062;
    floorSlab(B, w, d, 0x2a2e31);
    B.box(0.36, 0.003, d - 0.06, 0, 0.0135, 0, 0x191d20); B.box(0.1, 0.003, 0.5, 0.07, 0.015, 0.3, 0x3a4648, 0.1);   // wet channel
    for (const s of [-1, 1]) B.box(0.17, 0.09, d - 0.04, s * (hw - 0.125), 0.057, 0, 0x54585a);
    linerWalls(B, hw, hd, 0.56, 0x505456, 0x3a4a40, 0.15, true);
    const la = o.R(0x5e6264), lb = o.R(0x515557);                              // thick precast lid in four planks
    for (let i = 0; i < 4; i++) (i % 2 ? lb : la).box(w, 0.16, d / 4 - 0.012, 0, 0.64, back + d / 8 + i * d / 4);
    lb.box(w, 0.045, 0.06, 0, 0.742, hd - 0.03); lb.cyl(0.11, 0.11, 0.02, -0.3, 0.73, -0.2, 10);
    for (const s of [-1, 1]) B.box(0.13, 0.56, 0.1, s * (hw - 0.065), 0.28, hd - 0.05, conc);
    B.put(units().ring, 0x666a6c, 0, 0.31, back + 0.06, 0.25, 0.25, 0.3);       // pipe mouth in the back wall
    B.put(units().disc, 0x050607, 0, 0.31, back + 0.047, 0.25, 0.25, 1);
    B.box(0.13, 0.2, 0.006, 0.02, 0.1, back + 0.046, 0x1c2a24); B.box(0.3, 0.07, 0.006, -0.3, 0.42, back + 0.046, 0x34443a); B.box(0.2, 0.1, 0.006, 0.42, 0.2, back + 0.046, 0x34443a);
    for (let i = 0; i < 3; i++) B.box(0.035, 0.014, 0.13, -hw + 0.058, 0.17 + i * 0.13, -0.3, 0x4a3024);   // iron rungs
    tyre(B, -hw + 0.3, 0.05, back + 0.2, 0.25, 0.1);
    B.blob(0.11, hw - 0.3, 0.05, back + 0.18, 0x34302a, 0.5, 1.1);
    for (let i = 0; i < 4; i++) B.box(0.08, 0.035, 0.045, hw - 0.14 + (r() - 0.5) * 0.06, 0.12 + (i > 2 ? 0.036 : 0), -0.1 + (i % 3) * 0.1, 0x7a4030, r() * 0.6);
    B.box(0.015, 0.015, 0.4, hw - 0.055, 0.44, 0.2, 0x3a2a22); B.box(0.015, 0.3, 0.015, hw - 0.055, 0.3, 0.39, 0x3a2a22);    // old pipe
    o.sign = { x: 0, y: 0.64, z: hd + 0.005, w: 0.78, h: 0.1, rz: 0 };
    const gw = w - 0.26, gz = hd - 0.012, rust = 0x5a3a2a;                      // sluice frame: the raised grille stands in it, above the lid
    for (const s of [-1, 1]) B.box(0.035, 0.59, 0.045, s * (gw / 2 + 0.01), 0.87, gz, rust);
    B.box(gw + 0.09, 0.04, 0.05, 0, 1.17, gz, rust);
    B.box(0.016, 0.09, 0.016, 0, 1.225, gz, 0x3a3e44); B.cyl(0.055, 0.055, 0.014, 0, 1.25, gz + 0.02, 0x6a4030, 8, PI / 2);   // spindle and hand wheel
    o.lamp = { x: 0, y: 0.8, z: hd + 0.04, r: 0.028, hex: 0xc9ffb0, dim: 0.55 };   // bulkhead lamp, just in front of the raised grille
    B.box(0.08, 0.025, 0.06, 0, 0.775, hd + 0.022, 0x2a2c30);
    o.door = hangDoor(o.g, o.S, gw, 0.545, 0.56, gz);
  },

  // bungalow car porch with an iron gate
  porch(o) {
    const { B, r, w, d, hw, hd } = o, back = -hd;
    const cream = pick(r, [0x98907c, 0x8f968c, 0x9a8a7a]), oxide = pick(r, [0x6a3b32, 0x3f5a50, 0x4a4a6a]), g1 = 0x2a5434, g2 = 0x224428;
    floorSlab(B, w, d, 0x5a3832);
    for (const s of [-1, 1]) B.box(0.15, 0.003, d - 0.1, s * 0.2, 0.0135, 0, 0x7e786a);        // two paved wheel strips
    B.box(w - 0.02, 0.003, 0.04, 0, 0.0135, hd - 0.02, 0x8a8474);
    linerWalls(B, hw, hd, 0.62, cream, oxide, 0.12, false);
    o.R(0x74706a).box(w - 0.02, 0.06, d - 0.02, 0, 0.65, -0.01);                 // the slab sits inside its fascia
    const fascia = o.R(oxide); fascia.box(w, 0.12, 0.05, 0, 0.64, hd - 0.025); fascia.box(0.05, 0.1, d - 0.05, -hw + 0.025, 0.64, -0.025); fascia.box(0.05, 0.1, d - 0.05, hw - 0.025, 0.64, -0.025);
    // Each gate leaf swings in an arc about its post. The leaf is no wider than lets that arc pass 0.03 clear of the
    // front corner of the biggest car (0.42 x 0.86, parked in the middle); a wider bay gets a stub of wall beside each post.
    const gz = hd - 0.03, reach = gz - 0.43, leaf = Math.max(0.3, Math.min(hw - 0.1, (0.0441 + reach * reach - 0.0009) / 0.48));
    for (const s of [-1, 1]) {
      for (const z of [hd - 0.3, -0.25]) { B.box(0.075, 0.6, 0.075, s * (hw - 0.045), 0.31, z, cream); B.box(0.1, 0.03, 0.1, s * (hw - 0.045), 0.585, z, cream); }
      B.box(0.11, 0.5, 0.11, s * (leaf + 0.045), 0.25, hd - 0.06, cream); B.box(0.14, 0.03, 0.14, s * (leaf + 0.045), 0.515, hd - 0.06, oxide);   // gate posts
      if (hw - leaf > 0.14) { B.box(hw - leaf - 0.1, 0.4, 0.07, s * (hw + leaf + 0.1) / 2, 0.2, hd - 0.06, cream); B.box(hw - leaf - 0.1, 0.03, 0.09, s * (hw + leaf + 0.1) / 2, 0.415, hd - 0.06, oxide); }
      const h0 = back + 0.06, h1 = Math.max(h0 + 0.4, hd - 0.2 - leaf), hn = Math.max(3, Math.round((h1 - h0) / 0.22));   // hedge, clear of the open gate leaf
      B.box(0.13, 0.3, h1 - h0, s * (hw - 0.085), 0.162, (h0 + h1) / 2, g2);
      for (let i = 0; i < hn; i++) B.blob(0.085 + r() * 0.03, s * (hw - 0.085 + (r() - 0.5) * 0.03), 0.31 + r() * 0.04, h0 + 0.06 + i * (h1 - h0 - 0.12) / (hn - 1), i % 2 ? g1 : g2, 0.75, r() * 3);
      B.blob(0.065, s * (hw - 0.04), 0.545, hd - 0.31, g1, 0.8, r() * 3); B.blob(0.05, s * (hw - 0.035), 0.42, hd - 0.38, g2, 1, r() * 3);   // creeper on the pillar
    }
    const dx = 0.32;                                                           // house door, window, step, pots
    B.box(0.3, 0.46, 0.016, dx, 0.242, back + 0.048, 0x3a2a1e); B.box(0.25, 0.42, 0.012, dx, 0.23, back + 0.056, 0x5a4230); B.box(0.02, 0.02, 0.02, dx + 0.09, 0.22, back + 0.066, 0xb09a50);
    B.box(0.42, 0.04, 0.12, dx, 0.032, back + 0.1, 0x7a7870);
    B.box(0.34, 0.22, 0.014, -0.3, 0.37, back + 0.047, 0x3a2a1e); B.box(0.29, 0.17, 0.012, -0.3, 0.37, back + 0.053, 0x1c2632);
    for (let i = -1; i <= 1; i++) B.box(0.012, 0.17, 0.012, -0.3 + i * 0.075, 0.37, back + 0.062, 0x8a8e94);
    for (const px of [dx - 0.24, dx + 0.24]) { B.cyl(0.05, 0.035, 0.07, px, 0.047, back + 0.12, 0x8a4c34, 7); B.blob(0.075, px, 0.14, back + 0.12, g1, 1.1, r() * 3); }
    for (let i = 0; i < 6; i++) B.box(0.03, 0.03, 0.02, -0.62 + r() * 0.5, 0.2 + r() * 0.3, back + 0.05, pick(r, [0x9a3a6a, 0xa8507a, 0x2a5434]));  // bougainvillea on the wall
    o.sign = { x: 0, y: 0.645, z: hd + 0.006, w: 0.72, h: 0.085, rz: 0 };
    o.lamp = { x: 0, y: 0.54, z: hd - 0.025, r: 0.032, hex: 0xfff1d6 };
    B.box(0.012, 0.03, 0.012, 0, 0.585, hd - 0.025, 0x2a2c30);
    o.door = gateDoor(o.g, o.S, leaf, 0.46, 0.014, gz, leaf);
  },

  // a clump of trees in the open park: no walls, no roof, the branches come down
  grove(o) {
    const { B, r, hw, hd } = o, back = -hd;
    const bark = 0x4a382a, greens = [0x245a34, 0x2c6436, 0x1f4f30], bush = [0x2a5c36, 0x234c2e, 0x33683a];
    const spots = [[-hw - 0.24, -0.55], [hw + 0.26, -0.3], [-hw - 0.2, 0.6], [hw + 0.22, 0.72], [-0.48, back - 0.26], [0.5, back - 0.3]];
    if (r() < 0.6) spots.push([0.02, back - 0.32]);                              // trunks stay within 0.5 of the rectangle
    const crowns = [o.R(greens[0], true), o.R(greens[1], true)];
    spots.forEach(([x, z], i) => {                                             // 6 or 7 trees round the three closed sides
      x += (r() - 0.5) * 0.12; z += (r() - 0.5) * 0.12;
      const h = 0.78 + r() * 0.3, lean = (r() - 0.5) * 0.12;
      B.cyl(0.04, 0.07, h, x, h / 2, z, bark, 6, lean, lean * 0.7);
      B.cyl(0.02, 0.03, 0.4, x * 0.82, h * 0.82, z * 0.82, bark, 5, z > 0 ? -0.6 : 0.6, x > 0 ? 0.9 : -0.9);
      const cr = 0.36 + r() * 0.12;                                             // crowns lean in over the bay, never out over the lane
      const keep = (v, rad, lo, hi) => Math.max(lo + rad, Math.min(hi - rad, v));
      crowns[i % 2].blob(cr, keep(x * 0.8, cr, -hw - 0.5, hw + 0.5), h + cr * 0.34, keep(z * 0.86, cr, back - 0.5, hd + 0.08), 0.72, r() * 6);
      crowns[(i + 1) % 2].blob(cr * 0.62, x * 0.66 + (r() - 0.5) * 0.3, h + cr * 0.1, keep(z * 0.72 + (r() - 0.5) * 0.3, cr * 0.62, back - 0.5, hd + 0.08), 0.7, r() * 6);
    });
    for (const [x, z, s] of [[-hw - 0.06, 0.02, 0.27], [hw + 0.08, 0.2, 0.25], [-hw - 0.04, -0.9, 0.24], [hw + 0.06, -0.82, 0.26], [-0.12, back - 0.1, 0.29], [0.3, back - 0.14, 0.25], [-hw - 0.02, 0.86, 0.16], [hw + 0.04, 0.3, 0.2]]) {
      B.blob(s, x + (r() - 0.5) * 0.06, s * 0.52, z + (r() - 0.5) * 0.06, pick(r, bush), 0.74, r() * 6);                 // bushes close the gaps
    }
    B.cyl(0.05, 0.06, 0.5, -hw + 0.12, 0.06, 0.5, 0x4f3c2c, 6, PI / 2, 0.1);       // fallen log, stones
    B.blob(0.08, hw - 0.06, 0.04, 0.95, 0x6a6c6e, 0.7, 1); B.blob(0.06, hw - 0.2, 0.03, -0.75, 0x5c5e60, 0.7, 2); B.blob(0.07, -hw + 0.1, 0.035, -0.5, 0x646668, 0.7, 3);
    B.cyl(0.018, 0.024, 0.66, hw - 0.02, 0.33, hd - 0.05, bark, 5, 0, 0.05);      // stick that carries the lantern
    B.box(0.34, 0.016, 0.016, hw - 0.19, 0.64, hd - 0.05, bark);
    const lx = hw - 0.33;                                                       // the lantern hangs from the end of that stick, whatever the width
    B.box(0.006, 0.07, 0.006, lx, 0.6, hd - 0.05, 0x1c1c1e); B.cyl(0.02, 0.03, 0.02, lx, 0.575, hd - 0.05, 0x2a2c30, 6); B.cyl(0.028, 0.028, 0.014, lx, 0.508, hd - 0.05, 0x2a2c30, 6);
    o.lamp = { x: lx, y: 0.54, z: hd - 0.05, r: 0.026, hex: 0xffc070 };
    // the moving part: a leafy canopy over the middle plus hanging branches at the mouth
    const canopy = new THREE.Group(); o.g.add(canopy);
    const cb = new RoofBake(true), hex = greens[2];
    // Its underside stays above y = 0.7 even when lowered, so the camera that sits inside (the game puts it at y = 0.62
    // in a grove) looks out under the leaves instead of into them.
    cb.blob(0.66, 0, 1.06, -0.32, 0.32, 0.4); cb.blob(0.58, -0.2, 1.04, 0.4, 0.32, 1.7); cb.blob(0.56, 0.28, 1.07, 0.36, 0.3, 2.9); cb.blob(0.4, 0.3, 1.12, -0.5, 0.34, 4.1);
    for (let i = -1; i <= 1; i++) cb.lump(units().ico, 0, i * hw * 0.72, 0.94 + (i ? 0 : 0.03), hd - 0.17, hw * 0.5 + 0.08, 0.13, 0.2, 2.2 + i * 1.3);   // leafy lintel hides the straight top edge of the hanging branches
    const cgeo = cb.build(); o.own.push(cgeo);
    canopy.add(new THREE.Mesh(cgeo, cutMaterial(o.ctx, hex)));
    const fringe = dropDoor(canopy, o.S.door.vines, o.w + 0.1, 0.75, 0.9, hd - 0.04, reps(o.w + 0.1, 0.8), 0xc4ccc4, true);
    let low = 0;
    o.door = {
      top: 0.77, h: 0.75, z: hd - 0.04, span: hw - 0.14, live: true, solid: 0.5,
      set(f) { low = f * f * (3 - 2 * f); canopy.position.y = -0.13 * low; fringe.set(f); },
      pose(a, b, time, ph) {
        canopy.rotation.z = Math.sin(time * 0.7 + ph) * 0.014 + a * 0.03; canopy.rotation.x = Math.sin(time * 0.93 + ph * 1.7) * 0.011 + b * 0.014;
        canopy.position.y = -0.13 * low + Math.abs(a) * 0.014;
        fringe.pose(a, b, time, ph);
      },
      dispose() { fringe.dispose(); },
    };
  },

  // bus-stand shelter with a parked bus down one side and a hanging tarpaulin
  depot(o) {
    const { B, r, w, d, hw, hd } = o, back = -hd, steel = 0x55626c;
    const body = pick(r, [0x8a3830, 0x356a50, 0x35528a]), cream = 0xa39a80;
    floorSlab(B, w, d, 0x383a3f);
    B.box(0.025, 0.003, d - 0.2, -0.26, 0.0135, 0, 0x9a8a30); B.box(0.025, 0.003, d - 0.2, hw - 0.22, 0.0135, 0, 0x9a8a30);
    linerWalls(B, hw, hd, 0.6, 0x7c7e78, 0x4c5a66, 0.18, false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.box(0.05, 0.66, 0.05, sx * (hw - 0.035), 0.33, sz * (hd - 0.045), steel); B.box(0.056, 0.12, 0.056, sx * (hw - 0.035), 0.075, sz * (hd - 0.045), 0x9a8428); }
    const tin = o.R(0x5a6870), rib = o.R(0x46525a);
    tin.box(w, 0.022, d + 0.04, 0, 0.695, 0.02, 0, -0.04);
    for (let i = -2; i <= 2; i++) rib.box(0.03, 0.02, d + 0.04, i * (hw - 0.07) / 2, 0.712, 0.02, 0, -0.04);
    B.box(w, 0.07, 0.03, 0, 0.665, hd - 0.02, 0x8a7a2c);                         // painted fascia
    const cx = -hw + 0.23, cz = -0.12, len = 1.62;                              // the bus
    B.box(0.42, 0.26, len, cx, 0.2, cz, body); B.box(0.42, 0.15, len, cx, 0.405, cz, cream); B.box(0.4, 0.035, len - 0.04, cx, 0.497, cz, 0xb0a890);
    B.box(0.008, 0.095, len - 0.3, cx + 0.211, 0.41, cz - 0.02, 0x18202a);
    for (let i = 0; i < 5; i++) B.box(0.01, 0.095, 0.025, cx + 0.213, 0.41, cz - 0.64 + i * 0.31, cream);
    B.box(0.01, 0.03, len, cx + 0.211, 0.3, cz, 0xa8963a); B.box(0.01, 0.2, 0.16, cx + 0.212, 0.22, cz + 0.6, 0x241c18);
    B.box(0.36, 0.11, 0.008, cx, 0.41, cz + len / 2 + 0.002, 0x18202a); B.box(0.3, 0.04, 0.01, cx, 0.5, cz + len / 2 + 0.003, 0xa8963a);
    B.box(0.44, 0.045, 0.03, cx, 0.1, cz + len / 2 + 0.006, 0x5a5e64);
    for (const s of [-1, 1]) B.cyl(0.03, 0.03, 0.012, cx + s * 0.14, 0.2, cz + len / 2 + 0.004, 0xa6a290, 8, PI / 2);
    for (const z of [cz + 0.52, cz - 0.5]) { B.cyl(0.075, 0.075, 0.06, cx + 0.172, 0.087, z, 0x161618, 10, 0, PI / 2); B.cyl(0.035, 0.035, 0.066, cx + 0.172, 0.087, z, 0x6a6e74, 8, 0, PI / 2); }
    B.box(0.3, 0.012, 0.9, cx, 0.52, cz - 0.2, 0x3a3e44); B.box(0.24, 0.05, 0.3, cx, 0.55, cz - 0.4, 0x6a5238, 0.1); B.ball(0.1, 0.035, 0.12, cx, 0.55, cz + 0.0, 0x7a7052);   // luggage on the roof rack
    const bz = -0.35;                                                          // bench, water pot, timetable
    B.box(0.13, 0.02, 0.62, hw - 0.12, 0.14, bz, 0x6e5638); B.box(0.02, 0.16, 0.62, hw - 0.055, 0.26, bz, 0x6e5638);
    for (const z of [bz - 0.26, bz + 0.26]) B.box(0.1, 0.13, 0.03, hw - 0.12, 0.077, z, 0x3a3e44);
    B.box(0.14, 0.12, 0.14, hw - 0.14, 0.072, back + 0.14, 0x4a4e54); B.ball(0.075, 0.075, 0.075, hw - 0.14, 0.2, back + 0.14, 0x8a5238); B.cyl(0.04, 0.04, 0.015, hw - 0.14, 0.275, back + 0.14, 0x6a3e2a, 8);
    B.box(0.42, 0.26, 0.012, 0.22, 0.38, back + 0.047, 0x26323c); B.box(0.34, 0.18, 0.006, 0.22, 0.38, back + 0.055, 0xa8a48e);
    for (let i = 0; i < 4; i++) B.box(0.3, 0.008, 0.004, 0.22, 0.44 - i * 0.04, back + 0.06, 0x3a3a3a);
    B.cyl(0.036, 0.036, w - 0.16, 0, 0.625, hd - 0.05, 0x4a4e3a, 6, 0, PI / 2);    // rolled-up tarpaulin
    signBoard(o, 0, 0.87, hd + 0.03, 1.06, 0.19, 0x26282c);
    for (const s of [-1, 1]) B.box(0.025, 0.14, 0.025, s * 0.4, 0.75, hd - 0.0, 0x3a3e44);
    o.lamp = { x: 0, y: 0.672, z: hd + 0.045, r: 0.03, hex: 0xe2ebff };
    lampBracket(B, 0, 0.672, hd + 0.045, 0.026);
    o.door = dropDoor(o.g, o.S.door.tarp, w - 0.12, 0.6, 0.615, hd - 0.05, reps(w - 0.12, 0.69), pick(r, [0x8a8a5c, 0x6a8068, 0x9a7a52]), true);
  },

  // river boat shed: sloping thatch, a hull on the back wall, a net across the mouth
  boatshed(o) {
    const { B, r, w, d, hw, hd } = o, back = -hd, bamboo = 0x8a7840, plank = 0x5a4632;
    floorSlab(B, w, d, 0x46372a);
    for (let z = back + 0.25; z < hd - 0.1; z += 0.25) B.box(w - 0.1, 0.003, 0.014, 0, 0.0135, z, 0x241a12);
    linerWalls(B, hw, hd, 0.6, plank, 0x3a4e54, 0.14, true);
    B.box(w, 0.3, 0.04, 0, 0.75, back + 0.02, plank);
    const tilt = Math.atan2(0.28, d), thatch = o.R(pick(r, [0x77673c, 0x6c6240, 0x7a6a48])), pole = o.R(0x4a3c24);
    thatch.box(w, 0.06, d + 0.07, 0, 0.765, 0.025, 0, tilt);
    for (const z of [-0.7, -0.1, 0.5]) pole.box(w + 0.0, 0.02, 0.035, 0, 0.805 - z * 0.14, z, 0, tilt);
    pole.box(w, 0.05, 0.05, 0, 0.635, hd + 0.03, 0, tilt);
    for (const s of [-1, 1]) {
      B.cyl(0.026, 0.03, 0.92, s * (hw - 0.05), 0.46, hd - 0.05, bamboo, 6);       // tall front poles carry the name board
      B.cyl(0.026, 0.03, 0.9, s * (hw - 0.05), 0.45, back + 0.07, bamboo, 6);
    }
    const hull = pick(r, [0x3c4a54, 0x54402c, 0x2f4a44]);                       // upturned hull hung on the back wall
    B.put(units().dome, hull, 0, 0.37, back + 0.04, 0.5, 0.1, 0.115, PI / 2);
    B.box(0.94, 0.014, 0.02, 0, 0.37, back + 0.142, 0x1e1a16); B.box(1.0, 0.03, 0.012, 0, 0.482, back + 0.048, 0xa8a48e);
    for (const s of [-1, 1]) B.box(0.012, 0.14, 0.012, s * 0.32, 0.54, back + 0.06, 0x9a865a);
    B.box(0.02, 0.02, 0.86, -hw + 0.06, 0.42, -0.2, 0x8a7448); B.box(0.014, 0.07, 0.2, -hw + 0.055, 0.42, 0.3, 0x8a7448);       // oar on the wall
    B.box(0.02, 0.6, 0.02, hw - 0.1, 0.3, back + 0.1, 0x8a7448, 0, 0.1, 0.1); B.box(0.07, 0.17, 0.012, hw - 0.13, 0.55, back + 0.13, 0x8a7448, 0, 0.1, 0.1);  // oar in the corner
    B.blob(0.17, -hw + 0.24, 0.05, back + 0.42, 0x3f5e58, 0.45, 2.2); B.blob(0.11, -hw + 0.14, 0.05, back + 0.62, 0x38544e, 0.5, 0.6);   // heaped net and floats
    for (let i = 0; i < 4; i++) B.ball(0.03, 0.03, 0.03, -hw + 0.16 + r() * 0.2, 0.1 + r() * 0.02, back + 0.36 + r() * 0.22, i % 2 ? 0xb06a2c : 0xb4ae98);
    B.cyl(0.085, 0.06, 0.12, hw - 0.14, 0.072, 0.05, 0x8a7240, 9); B.cyl(0.07, 0.05, 0.1, hw - 0.13, 0.062, 0.3, 0x7c6638, 9); B.ball(0.06, 0.02, 0.06, hw - 0.14, 0.13, 0.05, 0x8a9498);   // fish baskets
    B.put(units().ring, 0x9a8658, -hw + 0.15, 0.03, 0.3, 0.085, 0.085, 0.11, PI / 2);     // coiled rope
    B.put(units().ring, 0x9a8658, -hw + 0.15, 0.055, 0.3, 0.07, 0.07, 0.1, PI / 2);
    B.cyl(0.03, 0.03, w - 0.2, 0, 0.6, hd - 0.05, 0x4a6a62, 6, 0, PI / 2);        // net bundled on its pole
    signBoard(o, 0, 0.83, hd - 0.03, 1.02, 0.16, 0x3a2e22);
    o.lamp = { x: 0.34, y: 0.535, z: hd + 0.01, r: 0.027, hex: 0xffb860 };
    B.box(0.006, 0.07, 0.006, 0.34, 0.595, hd + 0.01, 0x1c1c1e); B.cyl(0.02, 0.03, 0.02, 0.34, 0.57, hd + 0.01, 0x2a2c30, 6); B.cyl(0.028, 0.028, 0.012, 0.34, 0.503, hd + 0.01, 0x2a2c30, 6);
    o.door = dropDoor(o.g, o.S.door.net, w - 0.14, 0.58, 0.59, hd - 0.05, (w - 0.14) / 0.544, 0xffffff, true);
    o.door.solid = 0.35;                                                      // a net catches little of a torch beam
  },

  // a nook in a scrap yard walled with crushed cars, closed by a sliding tin sheet
  scrapyard(o) {
    const { B, r, w, d, hw, hd } = o, back = -hd;
    const paint = [0x7a4228, 0x66513c, 0x3d5c5c, 0x86722e, 0x5c6266, 0x7c342a, 0x48567a, 0x6a6a5a];
    floorSlab(B, w, d, 0x38322c);
    B.box(0.3, 0.003, 0.24, 0.05, 0.0135, 0.3, 0x211d1a, 0.5); B.box(0.22, 0.003, 0.16, -0.1, 0.0135, -0.25, 0x262220, -0.3);
    const wreck = (x, y, z, len, ry) => {                                     // one flattened car body
      const c = pick(r, paint);
      B.box(0.26, 0.15, len, x, y + 0.075, z, c, ry); B.box(0.21, 0.035, len * 0.5, x, y + 0.16, z - len * 0.05, 0x1e2226, ry);
      B.box(0.27, 0.03, len * 0.2, x, y + 0.03, z + len * 0.34, 0x26262a, ry);
    };
    for (const s of [-1, 1]) {
      const x = s * (hw - 0.14);
      for (let col = 0; col < 3; col++) {
        const len = 0.55 + r() * 0.05, layers = col === 2 ? 2 : 3 - (r() < 0.35 ? 1 : 0), z = back + 0.33 + col * 0.62;
        for (let i = 0; i < layers; i++) wreck(x + (r() - 0.5) * 0.03, 0.012 + i * 0.165, z + (r() - 0.5) * 0.03, len - i * 0.03, (r() - 0.5) * 0.12);
      }
      B.cyl(0.024, 0.03, 0.68, s * (hw - 0.04), 0.34, hd - 0.05, 0x4f443a, 6, 0, s * 0.03);     // crooked poles hold the awning
    }
    for (let i = 0; i < 3; i++) tyre(B, -0.3 + (r() - 0.5) * 0.03, 0.047 + i * 0.07, back + 0.16);   // heap at the back
    tyre(B, -0.07, 0.047, back + 0.14); tyre(B, -0.06, 0.117, back + 0.15); tyre(B, -0.43, 0.122, back + 0.3, 0, PI / 2 - 0.15);
    B.cyl(0.095, 0.1, 0.27, 0.15, 0.147, back + 0.15, 0x6a4028, 10); B.box(0.17, 0.14, 0.16, 0.36, 0.082, back + 0.14, 0x505458, 0.2);
    B.box(0.3, 0.26, 0.015, 0.2, 0.15, back + 0.32, pick(r, paint), 0.15, -0.4); B.cyl(0.018, 0.018, 0.44, 0.33, 0.2, back + 0.25, 0x4a4038, 6, 0.2, 1.1);
    const sa = o.R(0x72503a), sb = o.R(0x5c646a), blk = o.R(0x1c1c1f);          // patchwork awning
    sa.box(w * 0.54, 0.02, d + 0.02, -hw * 0.48, 0.662, 0.02, 0, -0.03, 0.03); sb.box(w * 0.54, 0.02, d + 0.02, hw * 0.48, 0.676, 0.02, 0, -0.05, -0.02);
    sb.box(w * 0.4, 0.016, 0.5, -0.1, 0.69, -0.5, 0.2, -0.04); blk.cyl(0.11, 0.11, 0.06, 0.32, 0.725, -0.2, 10); blk.cyl(0.11, 0.11, 0.06, -0.36, 0.71, 0.4, 10);
    sa.box(0.16, 0.05, 0.08, 0.1, 0.72, 0.62, 0.5);
    B.box(w, 0.025, 0.035, 0, 0.59, hd - 0.085, 0x3e322a);                       // angle-iron rail for the sliding sheet
    signBoard(o, -0.08, 0.87, hd + 0.03, 1.0, 0.2, 0x3a2c22, 0.035);
    for (const s of [-1, 1]) B.box(0.02, 0.16, 0.02, -0.08 + s * 0.4, 0.74, hd + 0.0, 0x3a2c22);
    o.lamp = { x: 0.5, y: 0.655, z: hd + 0.05, r: 0.03, hex: 0xffa860 };
    B.box(0.006, 0.08, 0.006, 0.5, 0.72, hd + 0.05, 0x1c1c1e); B.box(0.012, 0.012, 0.1, 0.5, 0.76, hd + 0.0, 0x2a2622);
    o.door = slideDoor(o.g, o.S.door.tin, [{ x0: -hw + 0.03, dir: 1, len: w - 0.06 }], 0.565, 0.012, hd - 0.085, reps(w - 0.06, 0.72), pick(r, [0xb09078, 0xa8a8a0, 0x9aa6a0]));
  },
};

// Short fictional names, Hinglish. Each kind has a list of first parts and a list of second parts; the seed walks
// through every pairing before any repeats, so hideouts of one kind only share a name if their seeds differ by a
// multiple of the number of pairings (30 or more, and never a multiple of 7, the step between the game's seeds).
const UPTO = n => Array.from({ length: n }, (_, i) => i + 1);
const NAMES = {
  garage: [['Guddu', 'Pappu', 'Bablu', 'Chhotu', 'Munna', 'Raju', 'Bunty', 'Lallan', 'Tinku', 'Sonu'], ['Motor Garage', 'Auto Works', 'Gaadi Repair', 'Motor Works'], (a, b) => `${a} ${b}`],
  godown: [['Anaj', 'Gehun', 'Chawal', 'Shakkar', 'Daal', 'Bori'], UPTO(17), (a, b) => `${a} Godown No. ${b}`],
  shed: [['Sabzi', 'Phal', 'Pyaaz', 'Aloo', 'Tokri'], UPTO(9), (a, b) => `${a} Mandi Shed ${b}`],
  culvert: [['Nala Puliya', 'Ganda Nala Surang', 'Purani Puliya', 'Nala Dhakkan'], UPTO(17), (a, b) => `${a} No. ${b}`],
  porch: [['Sharma', 'Verma', 'Mishra', 'Tiwari', 'Saxena', 'Chaubey', 'Pandey', 'Mathur'], ['Niwas', 'Sadan', 'Kunj', 'Kothi', 'Bhavan'], (a, b) => `${a} ${b}`],
  grove: [['Imli', 'Aam', 'Neem', 'Peepal', 'Jamun', 'Bargad', 'Amrood', 'Sheesham'], ['ka Jhurmut', 'ki Chhaon', 'ka Jhund', 'ki Bagiya'], (a, b) => `${a} ${b}`],
  depot: [['Bus Adda', 'Roadways', 'Sawari Gaadi', 'Khatara Bus'], UPTO(9), (a, b) => `${a} Shed ${b}`],
  boatshed: [['Naavik', 'Machhua', 'Majhi', 'Nadiya', 'Kinara', 'Patwar'], ['Naav Ghar', 'Naav Shed', 'Ghat Shed', 'Jaal Ghar', 'Naav Adda'], (a, b) => `${a} ${b}`],
  scrapyard: [['Pappu', 'Kallu', 'Jumman', 'Bhola', 'Chhedi', 'Nanhe'], ['Kabaad Adda', 'Kabadi Kona', 'Loha Bhangar', 'Kabaad Ghar', 'Purza Bazaar'], (a, b) => `${a} ${b}`],
};
function nameFor(kind, seed) {
  const [first, second, join] = NAMES[kind], n = first.length * second.length, i = (((seed * 11 + 5) % n) + n) % n;
  return join(first[i % first.length], second[Math.floor(i / first.length)]);
}

// ---------------------------------------------------------------- public builder
// Builds one hideout. spec: { kind, w, d, seed }. ctx: { cutMat(hex), makeLabel(text, opts) }.
// w and d default to 1.5 and 2.0, the size everything was laid out for; other sizes work (the game's park groves are
// 2 x 2) and are held to 1.2 .. 4 wide and 1.6 .. 4 deep.
// spec.kind may be one of HIDEOUT_KINDS or an old kind from the map (it goes through kindFor). The name is painted
// on the hideout's signboard; a floating name tag is only made when spec.label === true (the game draws its own).
// Returns { g, kind, name, label, setClosed, setSearch, update, dispose }.
//   g                THREE.Group in the local space described at the top of this file.
//   label            null, or with spec.label === true the sprite from ctx.makeLabel, already added to g.
//   setClosed(f)     f = 0 open .. 1 shut: moves the door across the mouth and puts the bulb out as f nears 1.
//   setSearch(level) 0..1: how hard police outside are searching. The door rattles and torchlight sweeps its gaps
//                    (only shown once the door is more than half shut). It eases in and out by itself.
//   update(dt, time) call once a frame, both in seconds: rattle, torch sweep, bulb flicker, swaying cloth and leaves.
//   dispose()        removes the group from its parent and frees everything this hideout owns (not the shared parts).
export function buildHideout(spec, ctx) {
  spec = spec || {}; ctx = ctx || {};
  const S = shared();
  const kind = HIDEOUT_KINDS.indexOf(spec.kind) >= 0 ? spec.kind : kindFor(spec.kind);
  const size = (v, def, lo, hi) => { v = +v; return v > 0 ? Math.max(lo, Math.min(hi, v)) : def; };   // NaN, 0 and negatives give the default
  const w = size(spec.w, 1.5, 1.2, 4), d = size(spec.d, 2.0, 1.6, 4), seed = Math.floor(+spec.seed || 0) | 0;
  const kindNo = HIDEOUT_KINDS.indexOf(kind), hw = w / 2, hd = d / 2;
  const name = (typeof spec.name === 'string' && spec.name.trim()) ? spec.name.trim().slice(0, 28) : nameFor(kind, seed);
  const g = new THREE.Group(); g.name = 'hideout:' + kind;
  const roofs = new Map(), own = [];
  const o = {
    S, ctx, g, w, d, hw, hd, seed, own, r: rng(seed * 7919 + kindNo * 104729 + 17), B: new Bake(true),
    R(hex, leafy) { let b = roofs.get(hex); if (!b) roofs.set(hex, b = new RoofBake(leafy)); return b; },   // overhead surfaces of one colour
    door: null, lamp: null, sign: null,
  };
  BUILD[kind](o);

  // baked props, then one mesh per roof colour
  const solidGeo = o.B.build(o.lamp); own.push(solidGeo);
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, lightMap: lampTexture(o.lamp.hex), lightMapIntensity: 0 }); own.push(solidMat);
  g.add(new THREE.Mesh(solidGeo, solidMat));
  roofs.forEach((bake, hex) => { const geo = bake.build(); own.push(geo); g.add(new THREE.Mesh(geo, cutMaterial(ctx, hex))); });

  // bulb, its halo and the pool of light it throws on the threshold
  const L = o.lamp, lampOn = new THREE.Color(L.hex), lampHot = new THREE.Color(L.hex).multiplyScalar(LAMP_BOOST), lampOff = new THREE.Color(0x14120f), dimK = L.dim || 1;
  const bulbMat = new THREE.MeshBasicMaterial({ color: L.hex });
  const bulb = new THREE.Mesh(S.bulbGeo, bulbMat); bulb.position.set(L.x, L.y, L.z); bulb.scale.setScalar(L.r); g.add(bulb);
  const glowGeo = new THREE.BufferGeometry(), px = Math.max(-0.2, Math.min(0.2, L.x)), hs = 0.2;
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    px - hw + 0.03, 0.024, hd - 0.85, px + hw - 0.03, 0.024, hd - 0.85, px - hw + 0.03, 0.024, hd + 0.32, px + hw - 0.03, 0.024, hd + 0.32,
    L.x - hs, L.y - hs, L.z - 0.012, L.x + hs, L.y - hs, L.z - 0.012, L.x - hs, L.y + hs, L.z - 0.012, L.x + hs, L.y + hs, L.z - 0.012], 3));
  glowGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1], 2));
  glowGeo.setIndex([0, 2, 1, 2, 3, 1, 4, 5, 6, 6, 5, 7]);
  glowGeo.computeBoundingSphere(); own.push(glowGeo);
  const glowMat = new THREE.MeshBasicMaterial({ map: S.tex.glow, color: L.hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true });
  const glow = new THREE.Mesh(glowGeo, glowMat); g.add(glow);
  own.push(bulbMat, glowMat);

  // painted signboard
  let signMat = null;
  if (o.sign) {
    const sg = o.sign, tex = paintSign(kind, name, seed, sg.w / sg.h);
    signMat = new THREE.MeshBasicMaterial({ map: tex });
    const sm = new THREE.Mesh(S.signGeo, signMat); sm.position.set(sg.x, sg.y, sg.z); sm.scale.set(sg.w, sg.h, 1); sm.rotation.z = sg.rz || 0; g.add(sm);
    own.push(signMat); if (tex) own.push(tex);
  }

  // torchlight of a searching officer (drawn only while searched)
  const door = o.door;
  const torchMat = new THREE.MeshBasicMaterial({ map: S.tex.torch, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  torchMat.color.setRGB(1.7, 1.5, 1.1);                                       // hotter than white at its core, so the beam blooms
  const spotMat = torchMat.clone();                                           // the spot on the outside of the door, weaker on doors that are mostly holes
  const torch = new THREE.Group(), tOver = new THREE.Mesh(S.torchOver, spotMat), tUnder = new THREE.Mesh(S.torchUnder, torchMat);
  tUnder.renderOrder = -1; tOver.renderOrder = 1;                              // under the door's blend, then over it
  torch.add(tUnder, tOver); torch.position.set(0, Math.max(0, door.top - door.h), door.z); torch.scale.y = door.h; torch.visible = false; g.add(torch);
  own.push(torchMat, spotMat);

  // floating name tag, only on request
  let label = null;
  if (typeof ctx.makeLabel === 'function' && spec.label === true) {
    try { label = ctx.makeLabel(name, { color: '#cdbcff', h: 0.3 }); } catch (err) { label = null; }
    if (label && label.isObject3D) { label.position.set(0, 1.32, hd * 0.35); g.add(label); } else label = null;
  }

  const ph = (seed * 2.399 + kindNo * 1.3) % TAU;
  const st = { f: -1, lamp: 1, search: 0, sv: 0, posed: false };
  function lampTo(k) {
    bulbMat.color.copy(lampOff).lerp(lampHot, k * dimK);
    glowMat.color.copy(lampOn).multiplyScalar(POOL * k * dimK);
    glow.visible = k > 0.012;
    solidMat.lightMapIntensity = LAMP_REACH * k * dimK;
    if (signMat) signMat.color.setScalar(0.2 + 0.5 * k);                       // a painted board in lamplight, never bright enough to bloom like neon
  }
  function setClosed(f) {
    f = clamp01(+f || 0);
    if (f === st.f) return;
    st.f = f; door.set(f);
    st.lamp = 1 - smooth(0.45, 0.92, f);
    lampTo(st.lamp);
  }
  function setSearch(level) { st.search = clamp01(+level || 0); }
  function update(dt, time) {
    dt = dt > 0 ? Math.min(dt, 0.1) : 0.016; time = +time; if (!(time > -1e9 && time < 1e9)) time = 0;
    if (st.lamp > 0.012) {                                                    // bulb flicker with the odd brown-out
      const dip = Math.sin(time * 1.3 + ph * 5) * Math.sin(time * 0.37 + ph * 3) > 0.9 ? 0.45 + 0.45 * Math.sin(time * 43) : 0;
      lampTo(st.lamp * (1 - 0.05 * (1 + Math.sin(time * 19 + ph) * Math.sin(time * 7.3 + ph * 2)) - dip * 0.5));
    }
    st.sv += (st.search - st.sv) * Math.min(1, dt * 9);
    if (st.search === 0 && st.sv < 0.01) st.sv = 0;
    const shut = smooth(0.5, 0.95, st.f), sv = st.sv * shut;
    if (sv > 0.004) {
      const burst = sv * (0.3 + 0.7 * Math.pow(Math.max(0, Math.sin(time * 3.3 + ph)), 2));
      door.pose(burst * Math.sin(time * 57 + ph), burst * Math.sin(time * 41.3 + ph * 2), time, ph);
      torch.visible = true;
      torch.position.x = Math.sin(time * 2.2 + ph) * door.span + Math.sin(time * 5.7 + ph * 3) * 0.06;
      torchMat.opacity = sv * (0.8 + 0.2 * Math.sin(time * 31 + ph)); spotMat.opacity = torchMat.opacity * door.solid;
      st.posed = true;
    } else {
      if (torch.visible) torch.visible = false;
      if (door.live || st.posed) { door.pose(0, 0, time, ph); st.posed = false; }   // cloth and leaves keep swaying; a rattled door settles
    }
  }
  function dispose() {
    if (g.parent) g.parent.remove(g);
    door.dispose();
    for (const x of own) x.dispose();
    if (label) { const m = label.material; if (m) { if (m.map) m.map.dispose(); m.dispose(); } }
    g.clear();
  }
  setClosed(0);
  return { g, kind, name, label, setClosed, setSearch, update, dispose };
}
