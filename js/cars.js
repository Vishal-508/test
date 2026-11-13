// The vehicles everyone drives: the chors' getaway car and the police jeep.
// Everything is generated in code (merged low-poly geometry with vertex colours, CanvasTextures for
// the light pools, shadow, livery and reflections). Geometry and textures are built once and shared
// by every car of a kind; each car owns only its materials and its four wheel instances.
//
//   import { PAINTS, makeCar } from './cars.js?v=8';
//   const car = makeCar('chor', { paint: PAINTS[0].hex });      // or makeCar('police')
//   scene.add(car.g); car.g.position.set(x, 0, z); car.g.rotation.y = heading;
//   car.update(state, dt, time);                                 // every frame, seconds
//   car.dispose();                                               // when the car leaves
//
// Conventions: X = east, Z = south, Y = up, 1 unit = 5 m. Models face +Z and stand on y = 0.
// In this right-handed frame the car's LEFT flank is +X and its RIGHT flank is -X.
// Footprints (collision uses them): getaway car 0.84 long x 0.38 wide x 0.27 tall, jeep 0.86 x 0.42 x 0.36
// (0.40 with the light bar).
// Lamp lenses are MeshBasicMaterial with colours above 1 where they should bloom. The paint is a MeshStandardMaterial
// with a small night-sky reflection map and one shader patch (see "Night sheen") that keeps dark paints readable.
import * as THREE from '../vendor/three.module.min.js';

// Getaway-car paints: moody ones first, then the loud ones.
export const PAINTS = [
  { id: 'kaala',  name: 'Kaala',        hex: 0x1c1e26 },   // black
  { id: 'kattha', name: 'Kattha Laal',  hex: 0x4d1521 },   // deep maroon
  { id: 'botal',  name: 'Botal Hara',   hex: 0x153b2b },   // bottle green
  { id: 'raat',   name: 'Raat Neela',   hex: 0x15244f },   // midnight blue
  { id: 'loha',   name: 'Loha',         hex: 0x4a4f58 },   // gunmetal
  { id: 'sarson', name: 'Sarson',       hex: 0xb88c1e },   // mustard
  { id: 'malai',  name: 'Malai',        hex: 0xcbbf9e },   // cream
  { id: 'jung',   name: 'Jung Narangi', hex: 0xa9521f },   // rust orange
];

const HAS_DOM = typeof document !== 'undefined';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// scratch objects for the geometry builders
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();

// ---------------------------------------------------------------- tiny geometry builder
// Triangles are collected flat with one colour per vertex; finish() welds the normals of faces that
// meet at a shallow angle, so cylinders and gentle panel curves shade smoothly while edges stay crisp.
const lin = hex => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };   // sRGB hex -> linear rgb for vertex colours
const newB = () => ({ p: [], c: [] });
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function tri(b, A, B, C, col) {
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * nx + ny * ny + nz * nz < 1e-18) return;                     // no area: skip
  b.p.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
  for (let k = 0; k < 3; k++) b.c.push(col[0], col[1], col[2]);
}
// Flat quad A-B-C-D, wound to face away from `ref` (a point inside the shape).
function quad(b, A, B, C, D, col, ref) {
  const ax = C[0] - A[0], ay = C[1] - A[1], az = C[2] - A[2], bx = D[0] - B[0], by = D[1] - B[1], bz = D[2] - B[2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  if (ref) {
    const cx = (A[0] + B[0] + C[0] + D[0]) / 4 - ref[0], cy = (A[1] + B[1] + C[1] + D[1]) / 4 - ref[1], cz = (A[2] + B[2] + C[2] + D[2]) / 4 - ref[2];
    if (nx * cx + ny * cy + nz * cz < 0) { const t = B; B = D; D = t; }
  }
  tri(b, A, B, C, col); tri(b, A, C, D, col);
}
// Skin between consecutive closed rings of points (all rings have the same number of points).
function loft(b, rings, colOf, yRef) {
  const m = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < m; j++) {
    const A = rings[i][j], B = rings[i][(j + 1) % m], C = rings[i + 1][(j + 1) % m], D = rings[i + 1][j];
    quad(b, A, B, C, D, typeof colOf === 'function' ? colOf(i, j) : colOf, [0, yRef, (A[2] + B[2] + C[2] + D[2]) / 4]);
  }
}
// Flat cap over one ring, facing +Z (dir = 1) or -Z (dir = -1).
function cap(b, ring, col, dir) {
  const c = [0, 0, 0];
  for (const p of ring) { c[0] += p[0] / ring.length; c[1] += p[1] / ring.length; c[2] += p[2] / ring.length; }
  for (let j = 0; j < ring.length; j++) {
    const A = ring[j], B = ring[(j + 1) % ring.length];
    const nz = (A[0] - c[0]) * (B[1] - c[1]) - (A[1] - c[1]) * (B[0] - c[0]);
    if (nz * dir >= 0) tri(b, c, A, B, col); else tri(b, c, B, A, col);
  }
}
// Append any three.js geometry (transformed by matrix m), painted one colour. The geometry is disposed.
function addGeom(b, geom, col, m) {
  const g = geom.index ? geom.toNonIndexed() : geom, a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    _v.fromBufferAttribute(a, i); if (m) _v.applyMatrix4(m);
    b.p.push(_v.x, _v.y, _v.z); b.c.push(col[0], col[1], col[2]);
  }
  if (g !== geom) g.dispose();
  geom.dispose();
}
function box(b, w, h, d, x, y, z, col, rx = 0, ry = 0, rz = 0) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'XYZ')), _s.set(w, h, d));
  addGeom(b, new THREE.BoxGeometry(1, 1, 1), col, _m);
}
// Cylinder with its axis along 'x', 'y' or 'z'; r1 is the radius at the positive end.
function cyl(b, r1, r0, len, seg, x, y, z, col, axis) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  addGeom(b, g, col, null);
}
// Dark half-disc on a body side, above a wheel (the wheel arch).
function arch(b, r, x, y, z, col) {
  const g = new THREE.CircleGeometry(r, 12, 0, Math.PI);
  g.rotateY(x > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(x, y, z);
  addGeom(b, g, col, null);
}
// Turn the collected triangles into a BufferGeometry. opt: { crease (radians), colors (bool), ao: [y0, y1, min] }.
function finish(b, opt) {
  const o = opt || {}, n = b.p.length / 3, pos = new Float32Array(b.p), nor = new Float32Array(n * 3), fn = new Float32Array(n);
  const P = b.p, faces = n / 3, cosT = Math.cos(o.crease == null ? 0.6 : o.crease), where = new Map(), keys = new Array(n);
  for (let f = 0; f < faces; f++) {
    const i = f * 9;
    const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
    fn[f * 3] = uy * vz - uz * vy; fn[f * 3 + 1] = uz * vx - ux * vz; fn[f * 3 + 2] = ux * vy - uy * vx;   // length = 2 x area
    for (let k = 0; k < 3; k++) {
      const v = f * 3 + k, key = Math.round(P[v * 3] * 2e4) + ',' + Math.round(P[v * 3 + 1] * 2e4) + ',' + Math.round(P[v * 3 + 2] * 2e4);
      keys[v] = key;
      const list = where.get(key); if (list) list.push(f); else where.set(key, [f]);
    }
  }
  for (let v = 0; v < n; v++) {
    const f = (v / 3) | 0, ax = fn[f * 3], ay = fn[f * 3 + 1], az = fn[f * 3 + 2], al = Math.hypot(ax, ay, az) || 1;
    let sx = 0, sy = 0, sz = 0;
    for (const g of where.get(keys[v])) {
      const bx = fn[g * 3], by = fn[g * 3 + 1], bz = fn[g * 3 + 2], bl = Math.hypot(bx, by, bz) || 1;
      if ((ax * bx + ay * by + az * bz) / (al * bl) >= cosT) { sx += bx; sy += by; sz += bz; }   // area-weighted
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    nor[v * 3] = sx / l; nor[v * 3 + 1] = sy / l; nor[v * 3 + 2] = sz / l;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (o.colors !== false) {
    const col = new Float32Array(b.c);
    if (o.ao) for (let v = 0; v < n; v++) {                         // darker towards the ground: cheap contact shading
      const k = o.ao[2] + (1 - o.ao[2]) * smooth(o.ao[0], o.ao[1], P[v * 3 + 1]);
      col[v * 3] *= k; col[v * 3 + 1] *= k; col[v * 3 + 2] *= k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  geo.computeBoundingSphere();
  return geo;
}

// One body cross-section at z: a closed ring running sill -> side -> shoulder -> top -> other side -> underside.
// hw half width, yb/yt bottom/top, cb/ct bottom/top chamfers, crown = extra height on the centre line,
// bulge = how far the waist stands proud of the sill and shoulder.
function section(z, hw, yb, yt, cb, ct, crown, bulge) {
  const half = [[hw - cb - bulge, yb], [hw - bulge, yb + cb], [hw, yb + (yt - yb) * 0.55], [hw - bulge, yt - ct], [hw - ct, yt]];
  const ring = half.map(q => [q[0], q[1], z]);
  ring.push([0, yt + crown, z]);
  for (let k = half.length - 1; k >= 0; k--) ring.push([-half[k][0], half[k][1], z]);
  return ring;
}
// A flat panel bl-br-tr-tl drawn as a painted frame (pillars) around a glass pane.
// Margins are fractions of the panel: ml/mr along the bottom edge, mb/mt up the sides.
function pane(bp, bg, bl, br, tr, tl, ml, mr, mb, mt, col, ref) {
  const at = (u, v) => lerp3(lerp3(bl, br, u), lerp3(tl, tr, u), v);
  const a = at(ml, mb), b = at(1 - mr, mb), c = at(1 - mr, 1 - mt), d = at(ml, 1 - mt);
  if (mb > 0) quad(bp, bl, br, b, a, col, ref);
  if (mr > 0) quad(bp, br, tr, c, b, col, ref);
  if (mt > 0) quad(bp, tr, tl, d, c, col, ref);
  if (ml > 0) quad(bp, tl, bl, a, d, col, ref);
  quad(bg, a, b, c, d, col, ref);
}
// The cabin: a tapered box of framed windows over a dark interior block, plus a roof slab.
// G: { yB, yT, zF, zR, hwB, zFt, zRt, hwT } (base and top rectangles), side: [[u0, u1, ml, mr], ...] from the rear forwards.
function greenhouse(paint, trim, glass, G, front, rear, side, sideMb, sideMt, roof, col, dark, roofCol) {
  const ref = [0, (G.yB + G.yT) / 2, (G.zF + G.zR) / 2];
  const fbl = [G.hwB, G.yB, G.zF], fbr = [-G.hwB, G.yB, G.zF], ftr = [-G.hwT, G.yT, G.zFt], ftl = [G.hwT, G.yT, G.zFt];
  const rbl = [-G.hwB, G.yB, G.zR], rbr = [G.hwB, G.yB, G.zR], rtr = [G.hwT, G.yT, G.zRt], rtl = [-G.hwT, G.yT, G.zRt];
  pane(paint, glass, fbl, fbr, ftr, ftl, front[0], front[0], front[1], front[2], col, ref);
  pane(paint, glass, rbl, rbr, rtr, rtl, rear[0], rear[0], rear[1], rear[2], col, ref);
  for (const sx of [1, -1]) {
    const bl = [sx * G.hwB, G.yB, G.zR], br = [sx * G.hwB, G.yB, G.zF], tr = [sx * G.hwT, G.yT, G.zFt], tl = [sx * G.hwT, G.yT, G.zRt];
    const at = (u, v) => lerp3(lerp3(bl, br, u), lerp3(tl, tr, u), v);
    for (const w of side) pane(paint, glass, at(w[0], 0), at(w[1], 0), at(w[1], 1), at(w[0], 1), w[2], w[3], sideMb, sideMt, col, ref);
  }
  // what you see through the glass: a dark block just inside it
  const i = 0.005, base = [[G.hwB - i, G.yB, G.zF - i], [-G.hwB + i, G.yB, G.zF - i], [-G.hwB + i, G.yB, G.zR + i], [G.hwB - i, G.yB, G.zR + i]];
  const top = [[G.hwT - i, G.yT - i, G.zFt - i], [-G.hwT + i, G.yT - i, G.zFt - i], [-G.hwT + i, G.yT - i, G.zRt + i], [G.hwT - i, G.yT - i, G.zRt + i]];
  for (let j = 0; j < 4; j++) quad(trim, base[j], base[(j + 1) % 4], top[(j + 1) % 4], top[j], dark, ref);
  // roof slab with a small overhang and a little crown
  const R = roof, rings = [
    section(G.zFt + R.over, R.hw - 0.006, R.yb, R.yt - 0.004, 0.003, 0.004, R.crown * 0.5, 0),
    section(G.zFt + R.over - 0.014, R.hw, R.yb, R.yt, 0.004, 0.006, R.crown, 0),
    section(G.zRt - R.over + 0.014, R.hw, R.yb, R.yt, 0.004, 0.006, R.crown, 0),
    section(G.zRt - R.over, R.hw - 0.006, R.yb, R.yt - 0.004, 0.003, 0.004, R.crown * 0.5, 0)];
  const rc = roofCol || col;
  loft(paint, rings, rc, (R.yb + R.yt) / 2); cap(paint, rings[0], rc, 1); cap(paint, rings[3], rc, -1);
}
// A wheel with its axle along X: tyre, steel rim, hub cap and four dark slots so the spin can be seen.
function buildWheel(r, w, rimHex, capHex) {
  const b = newB(), rubber = lin(0x0b0b0d), rim = lin(rimHex), hub = lin(capHex), slot = lin(0x050506);
  cyl(b, r, r, w, 16, 0, 0, 0, rubber, 'x');
  cyl(b, r * 0.64, r * 0.64, w + 0.004, 12, 0, 0, 0, rim, 'x');
  cyl(b, r * 0.26, r * 0.26, w + 0.005, 8, 0, 0, 0, hub, 'x');
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    box(b, w + 0.0046, r * 0.15, r * 0.2, 0, Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, slot, a, 0, 0);
  }
  return finish(b, { crease: 0.5 });
}

// ---------------------------------------------------------------- flat effect quads (light pools, glows, shadow, flame)
// Rectangle lying on the ground at height y, facing up: starts centred on (x, z), runs `len` along heading `ang`.
function groundQuad(o, x, y, z, wid, len, ang, u0, v0, u1, v1) {
  const fx = Math.sin(ang), fz = Math.cos(ang), rx = fz * wid / 2, rz = -fx * wid / 2, i = o.p.length / 3;
  o.p.push(x - rx, y, z - rz, x + rx, y, z + rz, x + rx + fx * len, y, z + rz + fz * len, x - rx + fx * len, y, z - rz + fz * len);
  o.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
  o.i.push(i, i + 2, i + 1, i, i + 3, i + 2);
}
// Indexed geometry with uvs from the collected quads.
function fxGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.p), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(o.uv), 2));
  g.setIndex(o.i);
  g.computeBoundingSphere();
  return g;
}
// Where things sit in the 256 x 256 effect atlas (uv rectangles, inset a little against bleeding).
const UV_BEAM = [0.004, 0.004, 0.496, 0.996], UV_BLOB = [0.504, 0.504, 0.996, 0.996], UV_FLAME = [0.504, 0.004, 0.746, 0.496];

// The flat effect meshes of one kind of car: shadow, headlight pools, tail glow, siren glow and exhaust flames.
function buildFx(K) {
  K.headCol = new THREE.Color(K.headOn).multiplyScalar(HEAD_BOOST);
  let o = { p: [], uv: [], i: [] };
  groundQuad(o, 0, 0.011, -K.shadow[1] / 2, K.shadow[0], K.shadow[1], 0, 0, 0, 1, 1);
  K.shadowGeo = fxGeometry(o);
  // two headlight pools, toed out a touch so they overlap into a brighter middle
  o = { p: [], uv: [], i: [] };
  for (const sx of [1, -1]) groundQuad(o, sx * K.lampX, 0.02, K.front - 0.05, 2.3, 3.45, sx * 0.04, UV_BEAM[0], UV_BEAM[1], UV_BEAM[2], UV_BEAM[3]);
  K.poolGeo = fxGeometry(o);
  o = { p: [], uv: [], i: [] };
  groundQuad(o, 0, 0.021, -K.front - 0.64, 1.1, 1.0, 0, UV_BLOB[0], UV_BLOB[1], UV_BLOB[2], UV_BLOB[3]);   // behind the tail: brake, reverse and nitro glow
  K.tailGlowGeo = fxGeometry(o);
  o = { p: [], uv: [], i: [] };
  groundQuad(o, 0, 0.022, -1.6, 3.2, 3.2, 0, UV_BLOB[0], UV_BLOB[1], UV_BLOB[2], UV_BLOB[3]);
  K.sirenGeo = fxGeometry(o);
  // exhaust flames: the mesh sits at the tail pipes and is stretched along -Z by update()
  o = { p: [], uv: [], i: [] };
  const L = 0.34, y = K.pipeY, f = UV_FLAME;
  for (const x of K.pipes) {
    let i = o.p.length / 3;
    o.p.push(x - 0.045, y, 0, x + 0.045, y, 0, x + 0.045, y, -L, x - 0.045, y, -L);
    o.uv.push(f[0], f[1], f[2], f[1], f[2], f[3], f[0], f[3]); o.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
    i = o.p.length / 3;
    o.p.push(x, y - 0.04, 0, x, y + 0.04, 0, x, y + 0.04, -L, x, y - 0.04, -L);
    o.uv.push(f[0], f[1], f[2], f[1], f[2], f[3], f[0], f[3]); o.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  K.flameGeo = fxGeometry(o);
}

// ---------------------------------------------------------------- the getaway car
// A small three-box saloon of no particular make: round lamps, chrome bumpers, upright rear window.
function buildChor() {
  const paint = newB(), trim = newB(), glass = newB(), head = newB(), tail = newB(), rev = newB();
  const W = [1, 1, 1], SHUT = [0.3, 0.3, 0.3], HW = 0.186, WX = 0.1655, WZ = 0.255, WR = 0.058;   // hub caps end at x = 0.19
  const chrome = lin(0x9da3ad), black = lin(0x0b0c0f), dark = lin(0x16181c), cabin = lin(0x050608), amber = lin(0x8f4a0c), plate = lin(0xc9c7ba), steel = lin(0x4d5158);

  const rings = [
    section(0.405, 0.163, 0.078, 0.139, 0.008, 0.010, 0.002, 0),
    section(0.388, 0.182, 0.056, 0.150, 0.010, 0.014, 0.004, 0.002),
    section(0.330, HW, 0.048, 0.156, 0.012, 0.016, 0.006, 0.003),
    section(0.150, HW, 0.048, 0.164, 0.012, 0.016, 0.006, 0.003),
    section(-0.250, HW, 0.048, 0.164, 0.012, 0.016, 0.005, 0.003),
    section(-0.385, 0.183, 0.054, 0.158, 0.010, 0.014, 0.003, 0.002),
    section(-0.405, 0.166, 0.078, 0.148, 0.008, 0.010, 0.002, 0)];
  loft(paint, rings, W, 0.105); cap(paint, rings[0], W, 1); cap(paint, rings[6], W, -1);

  greenhouse(paint, trim, glass,
    { yB: 0.160, yT: 0.257, zF: 0.150, zR: -0.255, hwB: 0.177, zFt: 0.052, zRt: -0.190, hwT: 0.150 },
    [0.07, 0.07, 0.10], [0.09, 0.10, 0.13],
    [[0, 0.5, 0.22, 0.05], [0.5, 1, 0.05, 0.17]], 0.08, 0.12,
    { hw: 0.154, yb: 0.2545, yt: 0.266, crown: 0.004, over: 0.008 }, W, cabin);
  for (const sx of [1, -1]) box(paint, 0.012, 0.014, 0.02, sx * 0.184, 0.173, 0.132, W);          // wing mirrors

  // bumpers, grille, lamps' surrounds
  for (const sz of [1, -1]) {
    box(trim, 0.352, 0.022, 0.02, 0, 0.069, sz * 0.409, chrome);
    for (const sx of [1, -1]) {
      box(trim, 0.014, 0.022, 0.036, sx * 0.175, 0.069, sz * 0.396, chrome, 0, sx * sz * 0.5, 0);
      box(trim, 0.012, 0.034, 0.008, sx * 0.075, 0.073, sz * 0.416, dark);                              // overriders: the car ends at z = +-0.42
    }
  }
  box(trim, 0.176, 0.038, 0.004, 0, 0.112, 0.406, black);
  for (const y of [0.101, 0.112, 0.123]) box(trim, 0.168, 0.0035, 0.003, 0, y, 0.4085, chrome);
  for (const sx of [1, -1]) {
    cyl(trim, 0.0265, 0.0265, 0.007, 12, sx * 0.125, 0.112, 0.4055, chrome, 'z');
    cyl(head, 0.0215, 0.0215, 0.006, 12, sx * 0.125, 0.112, 0.4105, W, 'z');
    box(trim, 0.024, 0.009, 0.005, sx * 0.125, 0.0865, 0.4065, amber);
    // rear lamp clusters: red outboard, white reverse lamp inboard
    box(tail, 0.05, 0.027, 0.007, sx * 0.13, 0.127, -0.4065, W);
    box(rev, 0.02, 0.019, 0.007, sx * 0.09, 0.127, -0.4065, W);
    box(trim, 0.076, 0.033, 0.004, sx * 0.118, 0.127, -0.4045, black);
    // side furniture: rub strip, door shuts, handles, wheel arches
    box(trim, 0.003, 0.006, 0.31, sx * 0.1865, 0.106, 0, dark);
    box(trim, 0.004, 0.007, 0.4, sx * 0.1775, 0.166, -0.052, chrome);
    for (const z of [0.136, -0.046, -0.218]) box(paint, 0.002, 0.082, 0.005, sx * 0.1855, 0.116, z, SHUT);
    for (const z of [0.02, -0.16]) box(trim, 0.003, 0.005, 0.022, sx * 0.1855, 0.143, z, chrome);
    for (const z of [WZ, -WZ]) arch(trim, 0.073, sx * (HW + 0.0009), WR, z, black);
    cyl(trim, 0.0075, 0.0075, 0.03, 8, sx * 0.08, 0.052, -0.404, steel, 'z');
  }
  box(trim, 0.33, 0.004, 0.014, 0, 0.1705, 0.157, black);                                           // scuttle under the windscreen
  box(trim, 0.07, 0.019, 0.003, 0, 0.069, 0.4185, plate);
  box(trim, 0.07, 0.021, 0.003, 0, 0.108, -0.4065, plate);
  box(trim, 0.1, 0.004, 0.003, 0, 0.1335, -0.4065, chrome);

  const K = {
    paint: finish(paint, { ao: [0.045, 0.13, 0.5] }), trim: finish(trim, { ao: [0.04, 0.1, 0.7] }), glass: finish(glass, { colors: false }),
    head: finish(head, { colors: false }), tail: finish(tail, { colors: false }), rev: finish(rev, { colors: false }),
    wheel: buildWheel(WR, 0.044, 0x565a62, 0xa6abb4), wheelR: WR, wheels: [[WX, WZ], [-WX, WZ], [WX, -WZ], [-WX, -WZ]],
    front: 0.42, lampX: 0.125, shadow: [0.58, 1.06], pipes: [0.08, -0.08], pipeY: 0.052,
    headOn: 0xffefc2, poolTint: 0xffe2a8, poolGain: 0.45, roll: 0.085, pitch: 0.0085,
  };
  buildFx(K);
  return K;
}

// ---------------------------------------------------------------- the police jeep
// A tall, square 4x4: white flanks, blue bonnet, roof and door bands, a roof light bar, bull bar and a spare wheel
// on the tailgate. The upward-facing panels are the dark colour on purpose: a siren light hung just above the roof
// would burn a white roof out to a blank glare.
const POLICE_WHITE = 0xb9c0cb, POLICE_BLUE = 0x17357f;
function buildPolice() {
  const paint = newB(), trim = newB(), glass = newB(), head = newB(), tail = newB(), rev = newB(), barR = newB(), barB = newB();
  const W = lin(POLICE_WHITE), BL = lin(POLICE_BLUE), SHUT = W.map(v => v * 0.35), HW = 0.198, WX = 0.1775, WZ = 0.262, WR = 0.075;   // hub caps end at x = 0.21
  const black = lin(0x0b0c0f), dark = lin(0x1b1d22), cabin = lin(0x050608), amber = lin(0x8f4a0c), plate = lin(0xc9c7ba), grey = lin(0x7b808a), steel = lin(0x3c4046);

  const rings = [
    section(0.410, 0.184, 0.108, 0.208, 0.008, 0.008, 0, 0),
    section(0.396, 0.196, 0.092, 0.216, 0.010, 0.010, 0, 0.001),
    section(0.140, HW, 0.086, 0.216, 0.012, 0.012, 0, 0.0015),
    section(-0.390, HW, 0.086, 0.216, 0.012, 0.012, 0, 0.0015),
    section(-0.405, 0.190, 0.100, 0.212, 0.008, 0.010, 0, 0)];
  loft(paint, rings, (i, j) => (i < 2 && (j === 4 || j === 5) ? BL : W), 0.15);            // blue bonnet
  cap(paint, rings[0], W, 1); cap(paint, rings[4], W, -1);

  greenhouse(paint, trim, glass,
    { yB: 0.212, yT: 0.345, zF: 0.136, zR: -0.398, hwB: 0.192, zFt: 0.088, zRt: -0.386, hwT: 0.178 },
    [0.07, 0.08, 0.10], [0.13, 0.40, 0.12],
    [[0, 0.3, 0.2, 0.09], [0.3, 0.66, 0.06, 0.06], [0.66, 1, 0.06, 0.15]], 0.10, 0.12,
    { hw: 0.182, yb: 0.342, yt: 0.356, crown: 0.003, over: 0.010 }, W, cabin, BL);

  // front: bumper, bull bar, grille, lamp surrounds
  box(trim, 0.40, 0.034, 0.03, 0, 0.106, 0.413, dark);
  for (const sx of [1, -1]) box(trim, 0.014, 0.1, 0.012, sx * 0.07, 0.152, 0.424, black);
  box(trim, 0.2, 0.014, 0.012, 0, 0.204, 0.424, black);
  box(trim, 0.154, 0.014, 0.012, 0, 0.152, 0.424, black);
  box(trim, 0.2, 0.064, 0.004, 0, 0.166, 0.4105, black);
  for (const y of [0.146, 0.166, 0.186]) box(trim, 0.19, 0.006, 0.003, 0, y, 0.4125, grey);
  box(trim, 0.078, 0.02, 0.003, 0, 0.106, 0.4285, plate);
  // back: bumper, spare wheel, plate
  box(trim, 0.40, 0.03, 0.026, 0, 0.1, -0.414, dark);
  cyl(trim, 0.066, 0.066, 0.028, 14, 0, 0.194, -0.414, black, 'z');
  cyl(trim, 0.034, 0.034, 0.032, 10, 0, 0.194, -0.414, grey, 'z');                                  // the jeep ends at z = +-0.43
  box(trim, 0.078, 0.02, 0.003, 0, 0.1, -0.4285, plate);
  for (const sx of [1, -1]) {
    cyl(trim, 0.03, 0.03, 0.007, 12, sx * 0.138, 0.168, 0.4105, black, 'z');
    cyl(head, 0.024, 0.024, 0.006, 12, sx * 0.138, 0.168, 0.4155, [1, 1, 1], 'z');
    box(trim, 0.026, 0.011, 0.005, sx * 0.138, 0.131, 0.4115, amber);
    box(tail, 0.03, 0.05, 0.008, sx * 0.168, 0.172, -0.407, [1, 1, 1]);
    box(rev, 0.03, 0.02, 0.008, sx * 0.168, 0.134, -0.407, [1, 1, 1]);
    // flanks: flares over the wheels, running board, mirror, door shuts and handles
    for (const z of [WZ, -WZ]) { arch(trim, 0.093, sx * (HW + 0.0009), WR, z, black); box(trim, 0.016, 0.012, 0.2, sx * 0.202, 0.171, z, black); }
    box(trim, 0.022, 0.012, 0.3, sx * 0.199, 0.09, 0, black);
    box(trim, 0.014, 0.03, 0.022, sx * 0.203, 0.236, 0.118, black);
    for (const z of [0.132, -0.06, -0.25]) box(paint, 0.002, 0.11, 0.005, sx * 0.1975, 0.158, z, SHUT);
    for (const z of [0.0, -0.19]) box(trim, 0.003, 0.006, 0.024, sx * 0.1985, 0.197, z, black);
    box(trim, 0.01, 0.008, 0.4, sx * 0.164, 0.3615, -0.15, black);                                   // roof rails
  }
  box(trim, 0.36, 0.004, 0.014, 0, 0.2195, 0.142, black);
  cyl(trim, 0.009, 0.009, 0.03, 8, -0.12, 0.092, -0.405, steel, 'z');
  // roof light bar: red lens on the left, blue on the right
  box(trim, 0.3, 0.012, 0.062, 0, 0.3645, 0.03, black);
  box(trim, 0.034, 0.026, 0.056, 0, 0.3825, 0.03, dark);
  box(barR, 0.126, 0.026, 0.052, 0.08, 0.3825, 0.03, [1, 1, 1]);
  box(barB, 0.126, 0.026, 0.052, -0.08, 0.3825, 0.03, [1, 1, 1]);

  // POLICE lettering: both doors (reading left to right from outside) and the bonnet (reading from the front)
  const o = { p: [], uv: [], i: [] }, x = HW + 0.0016, y0 = 0.114, y1 = 0.194, z0 = 0.16;
  o.p.push(x, y0, z0, x, y0, -z0, x, y1, -z0, x, y1, z0, -x, y0, -z0, -x, y0, z0, -x, y1, z0, -x, y1, -z0,
    -0.17, 0.2172, 0.3125, 0.17, 0.2172, 0.3125, 0.17, 0.2172, 0.2275, -0.17, 0.2172, 0.2275);
  for (let k = 0; k < 3; k++) { o.uv.push(0, 0, 1, 0, 1, 1, 0, 1); o.i.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3); }
  const decal = fxGeometry(o); decal.computeVertexNormals();

  const K = {
    paint: finish(paint, { ao: [0.085, 0.17, 0.55] }), trim: finish(trim, { ao: [0.07, 0.14, 0.7] }), glass: finish(glass, { colors: false }),
    head: finish(head, { colors: false }), tail: finish(tail, { colors: false }), rev: finish(rev, { colors: false }),
    barR: finish(barR, { colors: false }), barB: finish(barB, { colors: false }), decal,
    wheel: buildWheel(WR, 0.06, 0x34373c, 0x8a8f98), wheelR: WR, wheels: [[WX, WZ], [-WX, WZ], [WX, -WZ], [-WX, -WZ]],
    front: 0.43, lampX: 0.138, shadow: [0.64, 1.1], pipes: [-0.12], pipeY: 0.092,
    headOn: 0xf4f6ff, poolTint: 0xe6ecff, poolGain: 0.45, roll: 0.1, pitch: 0.0095,
  };
  buildFx(K);
  return K;
}

// ---------------------------------------------------------------- shared textures
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// One 256 px atlas for everything additive: the headlight beam (left half), a soft round glow (top right)
// and the exhaust flame (bottom right). Black means "adds nothing", so no alpha channel is needed.
function paintAtlas() {
  const S = 256, cv = canvas(S, S), ctx = cv.getContext('2d'), im = ctx.createImageData(S, S), d = im.data;
  const put = (x, y, r, g, b) => { const k = (y * S + x) * 4; d[k] = r * 255; d[k + 1] = g * 255; d[k + 2] = b * 255; };
  for (let k = 3; k < d.length; k += 4) d[k] = 255;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) {         // beam: a fan of light, brightest a little ahead of the car
    const u = Math.abs((x + 0.5) / 64 - 1), v = 1 - (y + 0.5) / 256, hw = 0.12 + 0.82 * Math.pow(v, 0.9);
    const across = Math.exp(-Math.pow(u / hw, 2.4) * 1.5) * smooth(1, 0.82, u);
    const along = smooth(0, 0.08, v) * Math.pow(1 - v, 1.2) * (0.42 + 0.58 * 0.3 / (0.3 + v));
    const a = Math.min(1, across * along * 1.3);
    put(x, y, a, a, a);
  }
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {         // round glow
    const r = Math.hypot((x + 0.5) / 64 - 1, (y + 0.5) / 64 - 1), a = Math.pow(Math.max(0, 1 - r), 2);
    put(128 + x, y, a, a, a);
  }
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {          // flame: blue-white core, orange skirt, tapering to the tip
    const u = Math.abs((x + 0.5) / 32 - 1), v = 1 - (y + 0.5) / 128, w = 0.1 + 0.6 * Math.pow(1 - v, 0.7) * smooth(0, 0.12, v + 0.04);
    const fade = smooth(0, 0.04, v) * Math.pow(1 - v, 1.1) * smooth(1, 0.8, u);
    const skirt = Math.exp(-(u * u) / (w * w) * 1.6) * fade, core = Math.exp(-(u * u) / (w * w) * 9) * fade * smooth(0.75, 0.05, v);
    put(128 + x, 128 + y, Math.min(1, skirt * 1.0 + core * 0.7), Math.min(1, skirt * 0.42 + core * 0.9), Math.min(1, skirt * 0.07 + core * 1.3));
  }
  ctx.putImageData(im, 0, 0);
  return cv;
}
// Soft shadow in the shape of the car's footprint (black, alpha only).
function paintShadow() {
  const w = 64, h = 128, cv = canvas(w, h), ctx = cv.getContext('2d'), im = ctx.createImageData(w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = Math.abs((x + 0.5) / w * 2 - 1), py = Math.abs((y + 0.5) / h * 2 - 1);
    const qx = Math.max(0, px - 0.42), qy = Math.max(0, py - 0.62), dist = Math.hypot(qx, qy) - 0.14;   // rounded rectangle
    const a = clamp(1 - dist / 0.24, 0, 1);
    d[(y * w + x) * 4 + 3] = a * a * (3 - 2 * a) * 255;
  }
  ctx.putImageData(im, 0, 0);
  return cv;
}
// Blue band with white POLICE lettering (4 : 1).
function paintPolice() {
  const cv = canvas(512, 128), c = cv.getContext('2d');
  c.fillStyle = '#' + POLICE_BLUE.toString(16).padStart(6, '0'); c.fillRect(0, 0, 512, 128);
  c.fillStyle = '#dfe5ee'; c.fillRect(0, 7, 512, 7); c.fillRect(0, 114, 512, 7);
  c.font = 'italic 900 84px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  c.textBaseline = 'middle'; c.textAlign = 'left';
  const word = 'POLICE', gap = 12;
  let total = -gap; for (const ch of word) total += c.measureText(ch).width + gap;
  const sc = Math.min(1, 440 / total);
  c.save(); c.translate(256, 66); c.scale(sc, 1);
  let x = -total / 2; for (const ch of word) { c.fillText(ch, x, 0); x += c.measureText(ch).width + gap; }
  c.restore();
  return cv;
}
// A little night sky for the paint and glass to reflect: dark dome, hazy horizon, moon, a few street lamps and neon signs.
function paintEnv() {
  const w = 256, h = 128, cv = canvas(w, h), c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#080b14'); g.addColorStop(0.34, '#121a2e'); g.addColorStop(0.49, '#3a4868'); g.addColorStop(0.51, '#2a2420');
  g.addColorStop(0.62, '#100f0f'); g.addColorStop(1, '#060607');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'lighter';
  const glow = (x, y, r, col) => {
    const q = c.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, col); q.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = q; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  glow(178, 26, 22, 'rgba(110,130,200,0.4)'); glow(178, 26, 6, 'rgba(240,244,255,1)');        // moon
  const lamps = [[14, 57, '255,190,110'], [47, 54, '255,176,96'], [83, 58, '255,150,170'], [112, 55, '255,200,130'],
    [139, 58, '170,220,255'], [203, 56, '255,184,104'], [229, 53, '255,205,140'], [246, 58, '255,196,120']];
  for (const [x, y, rgb] of lamps) { glow(x, y, 9, `rgba(${rgb},0.45)`); glow(x, y, 3, `rgba(${rgb},1)`); }
  return cv;
}

let TEX = null;
// The shared textures, made the first time a car is built. Every entry is null where there is no DOM.
function textures() {
  if (TEX) return TEX;
  TEX = { atlas: null, shadow: null, police: null, env: null };
  if (!HAS_DOM) return TEX;
  try {
    TEX.atlas = new THREE.CanvasTexture(paintAtlas()); TEX.atlas.colorSpace = THREE.SRGBColorSpace;
    TEX.shadow = new THREE.CanvasTexture(paintShadow()); TEX.shadow.colorSpace = THREE.SRGBColorSpace;
    TEX.police = new THREE.CanvasTexture(paintPolice()); TEX.police.colorSpace = THREE.SRGBColorSpace; TEX.police.anisotropy = 4;
    TEX.env = new THREE.CanvasTexture(paintEnv()); TEX.env.colorSpace = THREE.SRGBColorSpace; TEX.env.mapping = THREE.EquirectangularReflectionMapping;
  } catch (err) { /* no 2D canvas: cars still draw, without pools, shadow, lettering and reflections */ }
  return TEX;
}

const KITS = { chor: null, police: null };
const kitFor = kind => KITS[kind] || (KITS[kind] = kind === 'police' ? buildPolice() : buildChor());

// Lamp colours, shared and read-only. The game tone-maps the frame (ACES) and blooms only what is brighter than
// white, so lamps that should glow are given linear values above 1. The brake red stays near 1: pushed harder,
// ACES turns red to orange.
const col = hex => new THREE.Color(hex), rgb = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const C_HEAD_OFF = col(0x15171b), C_TAIL_OFF = col(0x1c0608), C_TAIL_DIM = rgb(0.2, 0.0, 0.004), C_TAIL_ON = rgb(1.0, 0.0, 0.03);
const C_REV_OFF = col(0x17181a), C_REV_ON = rgb(1.7, 1.7, 1.6), C_BAR_OFF = col(0x1e2533);
const C_RED_ON = rgb(4.6, 0.02, 0.25), C_RED_DIM = col(0x4a0a10), C_BLUE_ON = rgb(0.25, 0.9, 6.0), C_BLUE_DIM = col(0x0c163f);
const C_GLOW_RED = rgb(0.6, 0.04, 0.05), C_GLOW_BLUE = rgb(0.05, 0.14, 0.62);
const HEAD_BOOST = 2.0;
const NO_STATE = {};

// Night sheen. Under the game's dim sky a dark car is a black hole in the road: black paint has next to nothing to
// scatter and too little to mirror. So the paint carries a little cool light of its own in its emissive colour (the
// darker the paint the more of its own hue is in it), and this patch to the standard fragment shader lets that light
// show on the panels that face the sky, fades it down the flanks and makes it follow the vertex colours, so the door
// shuts and the sills stay dark. All paint materials share the one patched program.
const SHEEN_SKY = rgb(0.009, 0.012, 0.022), SHEEN_HUE = 0.045;
function sheenShader(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= ( 0.14 + 0.86 * smoothstep( -0.2, 0.9, dot( normal, ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) ) * vColor.g;');
}
// Work out a paint material's sheen from its colour.
function setSheen(mat) {
  const c = mat.color, m = Math.max(c.r, c.g, c.b), k = SHEEN_HUE * (1 - smooth(0.03, 0.2, m)) / (m + 0.03);
  mat.emissive.setRGB(SHEEN_SKY.r + c.r * k, SHEEN_SKY.g + c.g * k, SHEEN_SKY.b + c.b * k);
}

// ---------------------------------------------------------------- public: build a car
// makeCar('chor' | 'police', { paint: 0xRRGGBB }) -> { g, kind, update(state, dt, time), dispose(), setPaint(hex) }.
// g is a THREE.Group facing +Z, centred on the origin, wheels on y = 0. Call update() every frame.
// opts.paint colours the getaway car (the jeep keeps its livery). opts.reflect === false leaves out the
// night-sky reflection map (three.js blurs it once into a half-float texture the first time a car is drawn).
export function makeCar(kind, opts) {
  kind = kind === 'police' ? 'police' : 'chor';
  const K = kitFor(kind), T = textures(), police = kind === 'police';
  const paintHex = police ? 0xffffff : (opts && typeof opts.paint === 'number' ? opts.paint : PAINTS[0].hex);

  const g = new THREE.Group(); g.name = 'car-' + kind;
  const root = new THREE.Group(), body = new THREE.Group();          // root: hidden when fully ghosted; body: leans and pitches
  g.add(root); root.add(body);

  // materials (all owned by this car: they carry its paint, its lamp state and its ghost alpha)
  const std = p => new THREE.MeshStandardMaterial(Object.assign({ envMap: opts && opts.reflect === false ? null : T.env }, p));
  const lamp = c => new THREE.MeshBasicMaterial({ color: c });
  const glow = (c, side) => new THREE.MeshBasicMaterial({ color: c, map: T.atlas, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: side || THREE.FrontSide });
  const M = {
    paint: std({ color: paintHex, metalness: 0.5, roughness: 0.38, vertexColors: true, envMapIntensity: 2.0 }),
    trim: std({ color: 0xffffff, metalness: 0.35, roughness: 0.55, vertexColors: true, envMapIntensity: 1.0 }),
    glass: std({ color: 0x0a1018, metalness: 0.7, roughness: 0.22, transparent: true, opacity: 0.86, depthWrite: false, envMapIntensity: 1.5 }),
    head: lamp(C_HEAD_OFF), tail: lamp(C_TAIL_OFF), rev: lamp(C_REV_OFF),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, map: T.shadow, transparent: true, opacity: 0.62, depthWrite: false }),
    pools: glow(K.poolTint), tailGlow: glow(0x000000), flame: glow(0xffffff, THREE.DoubleSide),
  };
  M.paint.onBeforeCompile = sheenShader; setSheen(M.paint);
  if (police) {
    M.barR = lamp(C_BAR_OFF); M.barB = lamp(C_BAR_OFF);
    M.decal = std({ color: 0xffffff, map: T.police, metalness: 0.5, roughness: 0.38, envMapIntensity: 2.0 });
    M.siren = glow(0x000000);
  }
  // the solid parts, with what to restore when the car stops being a ghost
  const solid = ['paint', 'trim', 'glass', 'head', 'tail', 'rev', 'barR', 'barB', 'decal'].filter(k => M[k])
    .map(k => ({ m: M[k], opacity: M[k].opacity, transparent: M[k].transparent, depthWrite: M[k].depthWrite }));

  const mesh = (geo, mat, parent, order) => { const o = new THREE.Mesh(geo, mat); if (order) o.renderOrder = order; parent.add(o); return o; };
  mesh(K.paint, M.paint, body); mesh(K.trim, M.trim, body); mesh(K.glass, M.glass, body);
  mesh(K.head, M.head, body); mesh(K.tail, M.tail, body); mesh(K.rev, M.rev, body);
  if (police) { mesh(K.barR, M.barR, body); mesh(K.barB, M.barB, body); mesh(K.decal, M.decal, body); }
  const wheels = new THREE.InstancedMesh(K.wheel, M.trim, 4); root.add(wheels);
  // ground effects draw before other see-through things (negative renderOrder), shadow first
  const shadow = mesh(K.shadowGeo, M.shadow, root, -3), pools = mesh(K.poolGeo, M.pools, root, -2), tailGlow = mesh(K.tailGlowGeo, M.tailGlow, root, -2);
  const siren = police ? mesh(K.sirenGeo, M.siren, root, -2) : null;
  const flame = mesh(K.flameGeo, M.flame, root); flame.position.z = -K.front + 0.02;
  pools.visible = tailGlow.visible = flame.visible = false; if (siren) siren.visible = false;
  if (!T.shadow) shadow.visible = false;
  const fx = !!T.atlas;

  const st = { spin: 0, yaw: 0, roll: 0, pitch: 0, acc: 0, prev: 0, first: true, head: 0, tail: 0, brake: 0, rev: 0, nitro: 0, alpha: 1, wSpin: 0, wYaw: 0, phase: Math.random() * 10 };

  // The body and the wheels are posed by writing their matrices directly, and update() does its own arithmetic
  // instead of calling maths helpers: nothing is allocated per frame, whatever the JavaScript engine decides to inline.
  body.matrixAutoUpdate = false;
  const bm = body.matrix.elements, wm = wheels.instanceMatrix.array;

  // Wheel k sits at its hub, turned by Ry(steering yaw) * Rx(spin); only the front pair (0 and 1) steers.
  function placeWheels() {
    const cs = Math.cos(st.spin), sn = Math.sin(st.spin), cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    for (let k = 0, o = 0; k < 4; k++, o += 16) {
      const c = k < 2 ? cy : 1, s = k < 2 ? sy : 0;
      wm[o] = c; wm[o + 1] = 0; wm[o + 2] = -s; wm[o + 3] = 0;
      wm[o + 4] = s * sn; wm[o + 5] = cs; wm[o + 6] = c * sn; wm[o + 7] = 0;
      wm[o + 8] = s * cs; wm[o + 9] = -sn; wm[o + 10] = c * cs; wm[o + 11] = 0;
      wm[o + 12] = K.wheels[k][0]; wm[o + 13] = K.wheelR; wm[o + 14] = K.wheels[k][1]; wm[o + 15] = 1;
    }
    wheels.instanceMatrix.needsUpdate = true; st.wSpin = st.spin; st.wYaw = st.yaw;
  }
  placeWheels();

  function setAlpha(a) {
    st.alpha = a;
    const ghost = a < 0.999;
    for (const s of solid) {
      const want = ghost ? true : s.transparent;
      if (s.m.transparent !== want) { s.m.transparent = want; s.m.needsUpdate = true; }
      s.m.depthWrite = ghost ? false : s.depthWrite;
      s.m.opacity = ghost ? s.opacity * a : s.opacity;
    }
    M.shadow.opacity = 0.62 * a;
    root.visible = a > 0.01;
  }

  // Per-frame animation. state = { speed, steer, brake, lights, siren, nitro, hidden, alpha }; dt and time in seconds.
  // steer is positive for a right turn, as in js/vehicle.js (heading angle falling): the front wheels then point towards -X.
  // Missing fields are treated as 0 / false / alpha 1, but pass one complete state object, reused from frame to
  // frame: then nothing here allocates.
  function update(state, dt, time) {
    const s = state || NO_STATE, live = !s.hidden;
    let t = +time, speed = +s.speed, steer = +s.steer, alpha = s.alpha == null ? 1 : +s.alpha;
    if (!(t > -1e9 && t < 1e9)) t = 0;                                   // a missing or wild number counts as zero
    if (!(speed > -20)) speed = speed < 0 ? -20 : 0; else if (speed > 20) speed = 20;
    if (steer !== steer) steer = 0; else if (steer > 1) steer = 1; else if (steer < -1) steer = -1;
    alpha = alpha < 1 ? (alpha > 0 ? alpha : 0) : 1;
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    if (alpha !== st.alpha) setAlpha(alpha);
    const kBody = 1 - Math.exp(-dt * 7), kLamp = 1 - Math.exp(-dt * 18), kBrake = 1 - Math.exp(-dt * 26);   // easing per frame

    // wheels: roll with the road, front pair turns with the steering (right is -X, so a right turn is a negative yaw)
    st.spin = (st.spin + speed / K.wheelR * dt) % TAU;
    st.yaw += (-steer * 0.5 - st.yaw) * kLamp;
    if (Math.abs(st.spin - st.wSpin) > 1e-4 || Math.abs(st.yaw - st.wYaw) > 1e-4) placeWheels();

    // body: leans out of a bend (right turn: the left, +X, side dips), squats under power, dives under braking,
    // trembles a little while the engine runs
    if (st.first) { st.prev = speed; st.first = false; }
    if (dt > 0) { let a = (speed - st.prev) / dt; a = a > 9 ? 9 : a < -9 ? -9 : a; st.acc += (a - st.acc) * kBody; }
    st.prev = speed;
    let grip = Math.abs(speed) / 2.6; if (grip > 1) grip = 1;
    st.roll += (-steer * grip * K.roll - st.roll) * kBody;
    let pitch = -st.acc * K.pitch; pitch = pitch > 0.06 ? 0.06 : pitch < -0.045 ? -0.045 : pitch;
    if (live && s.nitro) pitch -= 0.012;
    st.pitch += (pitch - st.pitch) * kBody;
    const cr = Math.cos(st.roll), sr = Math.sin(st.roll), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
    bm[0] = cr; bm[1] = cp * sr; bm[2] = sp * sr; bm[4] = -sr; bm[5] = cp * cr; bm[6] = sp * cr; bm[9] = -sp; bm[10] = cp;   // Rx(pitch) * Rz(roll)
    bm[13] = live ? Math.sin(t * 71 + st.phase) * 0.0011 * (1 - 0.6 * grip) + Math.sin(t * 23 + st.phase) * 0.0012 * grip : 0;
    body.matrixWorldNeedsUpdate = true;

    // lamps: each level eases towards its target, then the lens colours are mixed from them
    st.head += ((live && s.lights ? 1 : 0) - st.head) * kLamp;
    st.tail += ((live ? (s.lights ? 1 : 0.45) : 0) - st.tail) * kLamp;
    st.brake += ((live && s.brake ? 1 : 0) - st.brake) * kBrake;
    st.rev += ((live && speed < -0.1 ? 1 : 0) - st.rev) * kLamp;
    st.nitro += ((live && s.nitro ? 1 : 0) - st.nitro) * kLamp;
    const hd = st.head, tl = st.tail, bk = st.brake, rv = st.rev, HN = K.headCol;
    let c = M.head.color;
    c.r = C_HEAD_OFF.r + (HN.r - C_HEAD_OFF.r) * hd; c.g = C_HEAD_OFF.g + (HN.g - C_HEAD_OFF.g) * hd; c.b = C_HEAD_OFF.b + (HN.b - C_HEAD_OFF.b) * hd;
    c = M.tail.color;                                                   // off -> dim red with the lights, -> bright with the brake
    const tr = C_TAIL_OFF.r + (C_TAIL_DIM.r - C_TAIL_OFF.r) * tl, tg = C_TAIL_OFF.g + (C_TAIL_DIM.g - C_TAIL_OFF.g) * tl, tb = C_TAIL_OFF.b + (C_TAIL_DIM.b - C_TAIL_OFF.b) * tl;
    c.r = tr + (C_TAIL_ON.r - tr) * bk; c.g = tg + (C_TAIL_ON.g - tg) * bk; c.b = tb + (C_TAIL_ON.b - tb) * bk;
    c = M.rev.color;
    c.r = C_REV_OFF.r + (C_REV_ON.r - C_REV_OFF.r) * rv; c.g = C_REV_OFF.g + (C_REV_ON.g - C_REV_OFF.g) * rv; c.b = C_REV_OFF.b + (C_REV_ON.b - C_REV_OFF.b) * rv;
    pools.visible = fx && hd * alpha > 0.01;
    M.pools.opacity = hd * alpha * K.poolGain;

    // nitro flame: length and brightness flicker
    const fl = st.nitro * (0.75 + 0.25 * Math.sin(t * 131 + st.phase * 2));
    flame.visible = fx && st.nitro * alpha > 0.02;
    if (flame.visible) {
      flame.scale.z = st.nitro * (0.92 + 0.4 * Math.sin(t * 83 + st.phase) * Math.sin(t * 47.3 + 1.7));
      M.flame.opacity = alpha * fl;
    }
    // what the tail throws on the road: red under braking, white in reverse, orange under nitro
    tailGlow.visible = fx && (bk > 0.02 || rv > 0.02 || st.nitro > 0.02) && alpha > 0.02;
    if (tailGlow.visible) {
      c = M.tailGlow.color;
      c.r = bk * 0.4 + rv * 0.09 + fl * 0.42; c.g = bk * 0.02 + rv * 0.09 + fl * 0.14; c.b = bk * 0.02 + rv * 0.08 + fl * 0.03;
      M.tailGlow.opacity = alpha;
    }

    // siren: red and blue swap six times a second (red on odd sixths, like the game's siren point lights),
    // with a glow on the road that flares at each swap
    if (police) {
      if (live && s.siren) {
        const beat = t * 6, whole = Math.floor(beat), red = (whole & 1) === 1, f = beat - whole;
        M.barR.color.copy(red ? C_RED_ON : C_RED_DIM); M.barB.color.copy(red ? C_BLUE_DIM : C_BLUE_ON);
        siren.visible = fx && alpha > 0.01;
        M.siren.color.copy(red ? C_GLOW_RED : C_GLOW_BLUE);
        M.siren.opacity = alpha * (0.5 + 0.5 * (1 - f) * (1 - f)) * 0.45;
      } else {
        M.barR.color.copy(C_BAR_OFF); M.barB.color.copy(C_BAR_OFF); siren.visible = false;
      }
    }
  }

  // Repaint a getaway car (police jeeps keep their livery).
  function setPaint(hex) { if (!police && typeof hex === 'number') { M.paint.color.setHex(hex); setSheen(M.paint); } }

  // Free what this car owns (its materials and wheel instances) and take it out of the scene.
  // Shared geometry and textures stay, for the other cars.
  function dispose() {
    if (g.parent) g.parent.remove(g);
    for (const k in M) M[k].dispose();
    wheels.dispose();
  }

  return { g, kind, update, dispose, setPaint };
}
