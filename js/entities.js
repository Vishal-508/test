// Low-poly chor and police figures, built from boxes, with a simple walk cycle.
import * as THREE from '../vendor/three.module.min.js';
import { makeLabel, COLORS } from './scene.js';

let stripeTex = null;
function stripes() {
  if (stripeTex) return stripeTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32; const c = cv.getContext('2d');
  for (let y = 0; y < 32; y += 8) { c.fillStyle = '#f1f1f1'; c.fillRect(0, y, 32, 4); c.fillStyle = '#16181d'; c.fillRect(0, y + 4, 32, 4); }
  stripeTex = new THREE.CanvasTexture(cv); stripeTex.colorSpace = THREE.SRGBColorSpace; stripeTex.magFilter = THREE.NearestFilter;
  return stripeTex;
}
const SKIN = [0xc68a5c, 0xa8703f, 0xd9a273, 0x8f5a34];
const CHOR_TINT = [0xffffff, 0xffd0d0, 0xd0e4ff, 0xd8ffd0, 0xfff0c0];

export function makeChar(role, variant = 0, name = '') {
  const g = new THREE.Group();
  const L = c => new THREE.MeshLambertMaterial({ color: c, transparent: true });
  const add = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); (parent || body).add(m); return m; };
  const body = new THREE.Group(); g.add(body);
  const isChor = role === 'chor';
  const shirt = isChor ? new THREE.MeshLambertMaterial({ map: stripes(), color: CHOR_TINT[variant % CHOR_TINT.length], transparent: true }) : L(0xb59a5e);
  const pants = L(isChor ? 0x22252e : 0x8a7646), skin = L(SKIN[variant % SKIN.length]);
  const parts = { mats: [shirt, pants, skin] };
  // legs pivot at the hip so they can swing
  const hip = y => { const p = new THREE.Group(); p.position.y = y; body.add(p); return p; };
  parts.legL = hip(0.24); parts.legR = hip(0.24);
  add(0.1, 0.24, 0.11, pants, -0.07, -0.12, 0, parts.legL); add(0.1, 0.24, 0.11, pants, 0.07, -0.12, 0, parts.legR);
  parts.torso = add(0.28, 0.26, 0.16, shirt, 0, 0.37, 0);
  parts.armL = hip(0.48); parts.armR = hip(0.48);
  add(0.08, 0.24, 0.09, shirt, -0.19, -0.12, 0, parts.armL); add(0.08, 0.24, 0.09, shirt, 0.19, -0.12, 0, parts.armR);
  parts.head = add(0.18, 0.18, 0.18, skin, 0, 0.6, 0);
  if (isChor) {
    const mask = L(0x111318); parts.mats.push(mask);
    add(0.19, 0.06, 0.19, mask, 0, 0.62, 0); add(0.2, 0.05, 0.2, mask, 0, 0.7, 0);
    const sackMat = L(0xcaa55a); parts.mats.push(sackMat);
    parts.sack = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), sackMat); parts.sack.position.set(0, 0.42, -0.17); parts.sack.visible = false; body.add(parts.sack);
  } else {
    const cap = L(0x23408a); parts.mats.push(cap);
    add(0.2, 0.07, 0.2, cap, 0, 0.72, 0); add(0.2, 0.025, 0.1, cap, 0, 0.69, 0.14);
    const belt = L(0x3a2a1a); parts.mats.push(belt); add(0.29, 0.04, 0.17, belt, 0, 0.27, 0);
    parts.siren = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ color: 0x6a98ff })); parts.siren.position.set(0, 0.79, 0); body.add(parts.siren);
  }
  // blob shadow and team ring
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.22, 14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.012; g.add(sh);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.33, 24), new THREE.MeshBasicMaterial({ color: isChor ? COLORS.loot : COLORS.police, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.016; ring.visible = false; g.add(ring);
  let label = null;
  if (name) { label = makeLabel(name, { color: isChor ? '#ffd98a' : '#9dbcff', h: 0.34 }); label.position.y = 1.15; g.add(label); }
  body.scale.setScalar(1.18);
  return { g, body, parts, ring, label, role, phase: Math.random() * 6, alpha: 1 };
}

export function animateChar(c, speed, dt, t) {
  c.phase += dt * (4 + speed * 7);
  const sw = Math.min(1, speed / 1.2) * 0.75, s = Math.sin(c.phase) * sw;
  c.parts.legL.rotation.x = s; c.parts.legR.rotation.x = -s;
  c.parts.armL.rotation.x = -s * 0.9; c.parts.armR.rotation.x = s * 0.9;
  c.body.position.y = Math.abs(Math.sin(c.phase)) * 0.025 * sw;
  if (c.parts.siren) { const on = c.chase ? (Math.floor(t * 6) % 2) : 0; c.parts.siren.material.color.setHex(c.chase ? (on ? 0xff3030 : 0x4a7dff) : 0x6a98ff); c.parts.siren.scale.setScalar(c.chase ? 1.6 : 1); }
}

export function setCharAlpha(c, a) {
  if (c.alpha === a) return;
  c.alpha = a;
  for (const m of c.parts.mats) { m.opacity = a; m.depthWrite = a > 0.9; }
}

export function setCarry(c, n, jackpot) {
  if (!c.parts.sack) return;
  c.parts.sack.visible = n > 0;
  c.parts.sack.scale.setScalar(jackpot ? 1.5 : 0.85 + 0.3 * n);
  c.parts.sack.material.color.setHex(jackpot ? 0xf3b43f : 0xcaa55a);
}

// The patch of ground a police officer can see, drawn as a flat fan.
export function makeCone(range, halfAngle) {
  const seg = 18, pos = [0, 0, 0];
  for (let k = 0; k <= seg; k++) { const a = -halfAngle + (2 * halfAngle) * k / seg; pos.push(Math.sin(a) * range, 0, Math.cos(a) * range); }
  const idx = []; for (let k = 1; k <= seg; k++) idx.push(0, k, k + 1);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  m.position.y = 0.03; m.renderOrder = 2;
  return m;
}
