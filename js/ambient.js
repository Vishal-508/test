// Things that move and glow to make a town feel alive: a night sky with a far skyline, a railway viaduct with a
// passing train, video screens, vertical neon signs, road signs, utility poles and wires, vending machines,
// traffic lights, standing shop signs, corner mirrors, falling blossom, steam, boats on the water.
// Everything is decoration: nothing here is solid and nothing changes the rules.
//
//   const ambient = buildAmbient(scene, W, map, { hash2, camera, cutMat });   // once, after buildWorld() and buildScene()
//   ambient.update(dt, time, focus, fx);                                      // every frame; focus = { x, z } the camera looks at
//
// A map switches this on with layout.ambient (see data/map-hotaru.json). Maps without it get an empty object.
// Each kind of thing is one or two draw calls however many of them there are: boxes are merged into one mesh,
// repeated objects are instanced.
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;
const NONE = { update() {}, dispose() {}, setNight() {} };

// True when this device can draw Japanese lettering (otherwise the signs use Latin letters).
let KANA = null;
export function canDrawKana() {
  if (KANA !== null) return KANA;
  KANA = false;
  try {
    const cv = document.createElement('canvas'); cv.width = 48; cv.height = 32;
    const c = cv.getContext('2d', { willReadFrequently: true });
    const shot = ch => { c.fillStyle = '#000'; c.fillRect(0, 0, 48, 32); c.fillStyle = '#fff'; c.font = '700 22px "Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif'; c.textBaseline = 'middle'; c.fillText(ch, 6, 16); return c.getImageData(0, 0, 48, 32).data; };
    const a = shot('あ'), b = shot('の'), none = shot('￿');
    let ink = 0, differ = 0, notBox = 0;
    for (let i = 0; i < a.length; i += 4) { if (a[i] > 60) ink++; if (Math.abs(a[i] - b[i]) > 40) differ++; if (Math.abs(a[i] - none[i]) > 40) notBox++; }
    KANA = ink > 12 && differ > 6 && notBox > 6;
  } catch (e) { KANA = false; }
  return KANA;
}

// One geometry out of many boxes. Each entry is [w, h, d, x, y, z, turnY, colour]; with colours given the
// geometry carries them per vertex (use a material with vertexColors).
export function mergeBoxes(list) {
  const pos = [], nor = [], colr = [], idx = [], c = new THREE.Color();
  let base = 0, tinted = false;
  for (const b of list) {
    const g = new THREE.BoxGeometry(b[0], b[1], b[2]);
    if (b[6]) g.rotateY(b[6]);
    g.translate(b[3], b[4], b[5]);
    const p = g.attributes.position, n = g.attributes.normal;
    if (b[7] != null) tinted = true;
    c.setHex(b[7] != null ? b[7] : 0xffffff);
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); colr.push(c.r, c.g, c.b); }
    for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    base += p.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (tinted) out.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  out.setIndex(idx);
  return out;
}

export function buildAmbient(scene, W, map, ctx) {
  const L = W && W.layout;
  if (!L || !L.ambient || typeof document === 'undefined') return NONE;
  const A = L.ambient, hash = (ctx && ctx.hash2) || ((i, j) => Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1);
  const group = new THREE.Group(); group.name = 'ambient'; scene.add(group);
  const own = [], ticks = [];
  const keep = o => { own.push(o); return o; };
  // anything that gives off light is remembered, so a power cut can put it out
  const glows = []; let power = 1;
  const bas = (color, extra) => { const m = keep(new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {}))); if (extra && extra.toneMapped === false) glows.push({ m, base: m.color.clone() }); return m; };
  const nightHooks = [];
  const lam = (color, extra) => keep(new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {})));
  const tintLam = () => lam(0xffffff, { vertexColors: true });
  const put = (geo, mat) => { const m = new THREE.Mesh(keep(geo), mat); m.frustumCulled = false; group.add(m); return m; };
  const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(keep(geo), mat, n); m.frustumCulled = false; group.add(m); return m; };
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const setAt = (im, i, x, y, z, ry, sx, sy, sz) => { dummy.position.set(x, y, z); dummy.rotation.set(0, ry || 0, 0); dummy.scale.set(sx || 1, sy || 1, sz || 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); };
  const districtAt = W.districtAt;

  // ---------------------------------------------------------------- vertical neon blades on the walls
  if (A.blades && W.facades) {
    const kana = canDrawKana();
    const words = (kana ? A.blades.words : A.blades.alt) || ['BAR', 'HOTEL', 'RAMEN', 'SUSHI'];
    const COLS = Math.min(8, words.length), CW = 64, CH = 256;
    const cv = document.createElement('canvas'); cv.width = COLS * CW; cv.height = CH;
    const c = cv.getContext('2d');
    c.fillStyle = '#0d0e14'; c.fillRect(0, 0, cv.width, cv.height);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let k = 0; k < COLS; k++) {
      const chars = Array.from(words[k]), x = k * CW + CW / 2, step = Math.min(50, (CH - 28) / chars.length), size = Math.min(40, step * 0.86);
      c.strokeStyle = '#fff'; c.lineWidth = 3; c.shadowColor = '#fff'; c.shadowBlur = 6; c.strokeRect(k * CW + 6, 6, CW - 12, CH - 12);
      c.font = `700 ${size}px "Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo","Baloo 2",sans-serif`; c.fillStyle = '#fff';
      chars.forEach((ch, i) => { const y = CH / 2 + (i - (chars.length - 1) / 2) * step; c.fillText(ch, x, y); c.shadowBlur = 0; c.fillText(ch, x, y); c.shadowBlur = 6; });
    }
    const tex = keep(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const tints = (A.blades.colors || [0xff3d9a, 0x35e0ff, 0xffb02e, 0x4dff7a, 0xffffff]).map(h => new THREE.Color(h));
    const picks = [];
    W.facades.forEach((f, i) => {
      const wgt = (A.blades.weights || {})[f.district] || 0;
      if (!wgt || f.fs === 4 || f.h < 1.25 || f.len < 1.6 || hash(i * 7 + 1, 91) > wgt) return;
      const side = hash(i, 5) > 0.5 ? 1 : -1, along = side * (f.len / 2 - 0.35 - hash(i, 9) * 0.5);
      const hgt = Math.min(f.h - 0.75, 0.9 + hash(i, 13) * 0.9);
      const out = hgt * 0.125 + 0.05;   // half the blade's width, so its inner edge sits just off the wall
      picks.push({ x: f.x - f.ny * along + f.nx * out, z: f.y + f.nx * along + f.ny * out, ry: Math.atan2(-f.ny, f.nx), h: hgt, y: 0.62 + hgt / 2 + hash(i, 17) * Math.max(0, f.h - 0.75 - hgt) * 0.6, col: Math.floor(hash(i, 21) * COLS), tint: Math.floor(hash(i, 25) * tints.length), flick: hash(i, 29) < 0.1 });
    });
    if (picks.length) {
      // one mesh for every blade: each instance says which word it shows, and has two faces back to back
      const geo = new THREE.PlaneGeometry(1, 1), which = new Float32Array(picks.length * 2);
      const mat = bas(0xffffff, { map: tex, toneMapped: false });
      mat.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWord;')
          .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv.x = ( uv.x + aWord ) / ${COLS}.0;`);
      };
      mat.customProgramCacheKey = () => 'blade' + COLS;
      const im = inst(geo, mat, picks.length * 2), flick = [];
      picks.forEach((p, i) => { for (const face of [0, 1]) {
        const k = i * 2 + face; setAt(im, k, p.x, p.y, p.z, p.ry + face * Math.PI, p.h * 0.25, p.h, 1);
        im.setColorAt(k, col.copy(tints[p.tint]).multiplyScalar(1.5)); which[k] = p.col;
        if (p.flick) flick.push({ k, tint: p.tint, ph: hash(i, 33) * 9 });
      } });
      geo.setAttribute('aWord', new THREE.InstancedBufferAttribute(which, 1));
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      if (flick.length) ticks.push((dt, t) => { // a few have a failing tube
        for (const f of flick) { const on = Math.sin(t * 3.1 + f.ph) > -0.55 && Math.sin(t * 23 + f.ph * 2) > -0.9; im.setColorAt(f.k, col.copy(tints[f.tint]).multiplyScalar(on ? 1.5 : 0.15)); }
        im.instanceColor.needsUpdate = true;
      });
    }
  }

  // ---------------------------------------------------------------- video screens with moving pictures
  if (A.screens && A.screens.length) {
    const pos = [], uvs = [], ca = [], cb = [], seed = [], idx = [], frames = [];
    const c1 = new THREE.Color(), c2 = new THREE.Color();
    A.screens.forEach((q, i) => {
      const ry = q.ry || 0, rx = Math.cos(ry), rz = -Math.sin(ry), hw = q.w / 2, y0 = q.y0, y1 = q.y0 + q.h;
      const corners = [[-hw, y0, 0, 0], [hw, y0, 1, 0], [hw, y1, 1, 1], [-hw, y1, 0, 1]];
      c1.set(q.color); c2.set(q.color2 != null ? q.color2 : 0xffffff);
      for (const [o, y, u, v] of corners) { pos.push(q.x + rx * o, y, q.y + rz * o); uvs.push(u, v); ca.push(c1.r, c1.g, c1.b); cb.push(c2.r, c2.g, c2.b); seed.push(Math.round(((q.x * 3.1 + q.y) % 7) * 10) / 10); }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      frames.push([q.w + 0.18, q.h + 0.18, 0.1, q.x - Math.sin(ry) * 0.07, q.y0 + q.h / 2, q.y - Math.cos(ry) * 0.07, ry]);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(ca, 3)); g.setAttribute('aB', new THREE.Float32BufferAttribute(cb, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setIndex(idx);
    const mat = keep(new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPow: { value: 1 } },
      vertexShader: 'attribute vec3 aA; attribute vec3 aB; attribute float aSeed; varying vec2 vUv; varying vec3 vA; varying vec3 vB; varying float vSeed; void main(){ vUv = uv; vA = aA; vB = aB; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; varying vec3 vA; varying vec3 vB; varying float vSeed; uniform float uTime; uniform float uPow;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          float sd = floor(vSeed * 10.0 + 0.5) / 10.0, t = uTime + sd * 3.0, scene = floor(t / 4.0);
          vec2 uv = vUv; vec3 c;
          float kind = mod(scene + floor(sd), 3.0);
          if (kind < 0.5) { float bars = step(0.5, fract(uv.x * 5.0 - t * 0.35)); c = mix(vA, vB, bars) * (0.75 + 0.25 * sin(uv.y * 40.0)); }
          else if (kind < 1.5) { vec2 g = floor(uv * vec2(10.0, 5.0)); float b = h(g + floor(t * 3.0)); c = mix(vA * 0.35, vB, step(0.62, b)); }
          else { float d = length((uv - 0.5) * vec2(1.9, 1.0)); float ring = 0.5 + 0.5 * sin(d * 26.0 - t * 5.0); c = mix(vA, vB, ring * smoothstep(0.75, 0.1, d)); }
          float ticker = step(uv.y, 0.16) * step(0.5, fract(uv.x * 14.0 + t * 1.2));
          c = mix(c, vec3(1.0), ticker * 0.8);
          c *= 0.82 + 0.18 * sin(uv.y * 220.0);
          gl_FragColor = vec4(c * 1.25 * uPow, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
    }));
    put(g, mat); put(mergeBoxes(frames), lam(0x15171d));
    ticks.push((dt, t) => { mat.uniforms.uTime.value = t; });
    nightHooks.push(() => { mat.uniforms.uPow.value = power < 0.5 ? 0.02 : 1; });
  }

  // ---------------------------------------------------------------- utility poles and the wires between them
  if (A.poles && W.lines) {
    const pts = [], wires = [];
    const want = A.poles.districts || [];
    W.lines.forEach((ln, li) => {
      if (!ln.ai || ln.hw > 1.2) return;                       // streets and alleys, not the big roads
      const Ln = Math.hypot(ln.bx - ln.ax, ln.by - ln.ay); if (Ln < 6) return;
      const ux = (ln.bx - ln.ax) / Ln, uy = (ln.by - ln.ay) / Ln, side = li % 2 ? 1 : -1, off = ln.hw - 0.1;
      let prev = null;
      for (let d = 2.2; d < Ln - 1.5; d += 4.6) {
        const x = ln.ax + ux * d - uy * off * side, y = ln.ay + uy * d + ux * off * side;
        if (want.indexOf(districtAt(x, y)) < 0 || !W.walkable(x, y)) { prev = null; continue; }
        const p = { x, y, ux, uy }; pts.push(p);
        if (prev) wires.push([prev, p]);
        prev = p;
      }
    });
    if (pts.length) {
      const wood = lam(0x4a4038);
      const poles = inst(new THREE.CylinderGeometry(0.035, 0.045, 2.1, 6), wood, pts.length);
      const bars = inst(new THREE.BoxGeometry(0.5, 0.04, 0.04), wood, pts.length);
      const cans = inst(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 8), lam(0x8a8f96), pts.length);
      pts.forEach((p, i) => {
        setAt(poles, i, p.x, 1.05, p.y);
        setAt(bars, i, p.x, 1.95, p.y, Math.atan2(-p.ux, p.uy) + Math.PI / 2);
        setAt(cans, i, p.x + p.ux * 0.09, 1.7, p.y + p.uy * 0.09);
      });
      const pos = [];
      for (const [a, b] of wires) for (const s of [-0.2, 0, 0.2]) {
        const ox = -a.uy * s, oy = a.ux * s; let px = a.x + ox, py = 1.95, pz = a.y + oy;
        for (let k = 1; k <= 4; k++) { const f = k / 4, x = a.x + (b.x - a.x) * f + ox, z = a.y + (b.y - a.y) * f + oy, y = 1.95 - Math.sin(f * Math.PI) * 0.16; pos.push(px, py, pz, x, y, z); px = x; py = y; pz = z; }
      }
      const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const ls = new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color: 0x0c0d12 }))); ls.frustumCulled = false; group.add(ls);
    }
  }

  // ---------------------------------------------------------------- vending machines glowing against the walls
  if (A.vending && W.facades) {
    const list = [];
    W.facades.forEach((f, i) => {
      if (hash(i * 3 + 2, 57) > (A.vending.share || 0.3) || f.len < 1.4) return;
      const along = (hash(i, 61) - 0.5) * (f.len - 0.8);
      list.push({ x: f.x - f.ny * along + f.nx * 0.09, z: f.y + f.nx * along + f.ny * 0.09, ry: Math.atan2(f.nx, f.ny), k: Math.floor(hash(i, 67) * 3) });
    });
    if (list.length) {
      const bodies = inst(new THREE.BoxGeometry(0.2, 0.38, 0.12), lam(0xffffff), list.length);
      const fronts = inst(new THREE.PlaneGeometry(0.16, 0.2), bas(0xffffff, { toneMapped: false }), list.length);
      const bodyCol = [0xc8322e, 0x2c5fc0, 0xe8e8ea], glowCol = [0xfff0e0, 0xdcefff, 0xfff6c8];
      list.forEach((p, i) => {
        setAt(bodies, i, p.x, 0.19, p.z, p.ry); bodies.setColorAt(i, col.setHex(bodyCol[p.k]));
        setAt(fronts, i, p.x + Math.sin(p.ry) * 0.063, 0.24, p.z + Math.cos(p.ry) * 0.063, p.ry); fronts.setColorAt(i, col.setHex(glowCol[p.k]).multiplyScalar(0.8));
      });
      for (const im of [bodies, fronts]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- traffic lights that change
  // The lamps lie side by side on an arm reaching over the road (red on the right), with a small
  // walk / wait lamp for people lower down the post.
  if (A.signals && A.signals.length) {
    const POST = 0x8f949c, HOOD = 0x23262c, dim = { r: 0x3a1512, a: 0x3a2c10, g: 0x0d2f2a }, lit = { r: 0xff4136, a: 0xffb400, g: 0x2fffc0 };
    const boxes = [], lampAt = { 0: { r: [], a: [], g: [] }, 1: { r: [], a: [], g: [] } }, pedAt = { 0: { r: [], g: [] }, 1: { r: [], g: [] } };
    A.signals.forEach((s, i) => {
      const dx = s.ax || 0, dz = s.ay || 0, reach = s.reach || 1.15, grp = s.g != null ? s.g : i % 2;
      boxes.push([0.08, 2.1, 0.08, s.x, 1.05, s.y, 0, POST]);
      boxes.push([dx ? reach : 0.05, 0.05, dz ? reach : 0.05, s.x + dx * reach / 2, 2.02, s.y + dz * reach / 2, 0, POST]);
      const hx = s.x + dx * reach, hz = s.y + dz * reach;
      boxes.push([dx ? 0.14 : 0.5, 0.17, dz ? 0.14 : 0.5, hx, 1.9, hz, 0, HOOD]);
      boxes.push([0.1, 0.2, 0.1, s.x, 1.02, s.y, 0, HOOD]);
      for (const [k, off] of [['g', -0.16], ['a', 0], ['r', 0.16]]) lampAt[grp][k].push([hx + (dz ? off : 0), 1.9, hz + (dx ? off : 0), dx ? 1.5 : 1, dz ? 1.5 : 1]);
      pedAt[grp].r.push([s.x, 1.07, s.y]); pedAt[grp].g.push([s.x, 0.97, s.y]);
    });
    put(mergeBoxes(boxes), tintLam());
    const ball = new THREE.SphereGeometry(0.062, 8, 6), small = new THREE.SphereGeometry(0.045, 6, 5);
    const lamps = {}, peds = {};
    for (const grp of [0, 1]) {
      lamps[grp] = {}; peds[grp] = {};
      for (const k of ['r', 'a', 'g']) { const list = lampAt[grp][k]; if (!list.length) continue; const mat = bas(dim[k], { toneMapped: false }), im = inst(ball, mat, list.length); list.forEach((p, i) => setAt(im, i, p[0], p[1], p[2], 0, p[3], 1, p[4])); lamps[grp][k] = mat; }
      for (const k of ['r', 'g']) { const list = pedAt[grp][k]; if (!list.length) continue; const mat = bas(dim[k], { toneMapped: false }), im = inst(small, mat, list.length); list.forEach((p, i) => setAt(im, i, p[0], p[1], p[2], 0, 1.4, 1, 1.4)); peds[grp][k] = mat; }
    }
    ticks.push((dt, t) => {
      const ph = t % 18;   // 0-7 group 0 drives, 7-8 amber, 8-9 everyone waits, 9-16 group 1 drives, 16-17 amber, 17-18 wait
      for (const grp of [0, 1]) {
        const mine = grp === 0 ? ph : (ph + 9) % 18, state = mine < 7 ? 'g' : mine < 8 ? 'a' : 'r';
        for (const k of ['r', 'a', 'g']) if (lamps[grp][k]) lamps[grp][k].color.setHex(k === state && power > 0.5 ? lit[k] : dim[k]);
        const walk = state === 'r' && ((mine >= 9 && mine < 15.5) || (mine >= 15.5 && mine < 17 && Math.sin(t * 14) > 0));   // people go while the cars on this arm wait; it blinks before changing
        if (peds[grp].g) peds[grp].g.color.setHex(walk && power > 0.5 ? lit.g : dim.g);
        if (peds[grp].r) peds[grp].r.color.setHex(walk || power < 0.5 ? dim.r : lit.r);
      }
    });
  }

  // ---------------------------------------------------------------- a railway viaduct across town
  if (A.viaduct) {
    const V = A.viaduct, len = V.x1 - V.x0, cx = (V.x0 + V.x1) / 2, top = V.h + 0.22;
    const conc = [], dark = [], steel = [], glow = [];
    conc.push([len, 0.22, V.w, cx, V.h + 0.11, V.y]);
    for (const sd of [-1, 1]) conc.push([len, 0.26, 0.07, cx, top + 0.13, V.y + sd * (V.w / 2 - 0.035)]);
    dark.push([len, 0.05, 0.9, cx, top + 0.025, V.y]);                                   // ballast
    for (const sd of [-1, 1]) steel.push([len, 0.03, 0.03, cx, top + 0.07, V.y + sd * 0.2]);   // rails
    for (let x = Math.max(1, V.x0 + 2); x < Math.min(99, V.x1 - 2); x += V.every || 4.5) {
      if (W.walkable(x, V.y) || W.walkable(x - 0.5, V.y) || W.walkable(x + 0.5, V.y)) continue;   // never stand a pier in a road
      conc.push([0.34, V.h, V.w * 0.6, x, V.h / 2, V.y]);
    }
    for (let x = V.x0 + 3; x < V.x1; x += 6) { steel.push([0.05, 1.15, 0.05, x, top + 0.57, V.y - V.w / 2 + 0.1]); steel.push([0.04, 0.04, V.w * 0.8, x, top + 1.1, V.y - V.w / 2 + 0.1 + V.w * 0.4]); }
    steel.push([len, 0.012, 0.012, cx, top + 1.02, V.y]);                               // the overhead wire
    if (V.station) { // platforms and a roof where the line passes the station
      const S0 = V.station, sl = S0.x1 - S0.x0, sx = (S0.x0 + S0.x1) / 2;
      for (const sd of [-1, 1]) {
        conc.push([sl, 0.14, 0.5, sx, top + 0.07, V.y + sd * (V.w / 2 + 0.25)]);
        glow.push([sl, 0.03, 0.06, sx, top + 0.15, V.y + sd * (V.w / 2 + 0.06), 0, 0xffd84a]);   // the yellow line at the platform edge
        dark.push([sl, 0.06, 0.9, sx, top + 1.38, V.y + sd * (V.w / 2 + 0.2)]);
        glow.push([sl * 0.94, 0.03, 0.12, sx, top + 1.33, V.y + sd * (V.w / 2 + 0.2), 0, 0xfff2d0]);   // strip lights under the roof
        for (let x = S0.x0 + 0.6; x < S0.x1; x += 2.4) steel.push([0.07, 1.3, 0.07, x, top + 0.72, V.y + sd * (V.w / 2 + 0.42)]);
      }
    }
    const mk = hex => (ctx && ctx.cutMat ? keep(ctx.cutMat(hex)) : lam(hex));
    put(mergeBoxes(conc), mk(0x70747e)); put(mergeBoxes(dark), mk(0x3a3d46)); put(mergeBoxes(steel), lam(0x565a64));
    if (glow.length) put(mergeBoxes(glow), bas(0xffffff, { vertexColors: true, toneMapped: false }));
  }

  // ---------------------------------------------------------------- a train passing along the line
  if (A.train) {
    const T = A.train, cars = T.cars || 6, len = 2.7, body = [], wins = [];
    for (let k = 0; k < cars; k++) {
      const x = (k - (cars - 1) / 2) * (len + 0.14);
      body.push([len, 0.56, 0.6, x, 0.5, 0, 0, T.color || 0xc9ced6]);
      body.push([len + 0.01, 0.07, 0.62, x, 0.33, 0, 0, T.stripe || 0x3fd070]);
      body.push([len * 0.8, 0.14, 0.4, x, 0.15, 0, 0, 0x23262e]);
      wins.push([len * 0.86, 0.16, 0.63, x, 0.58, 0]);
    }
    const tg = new THREE.Group(); group.add(tg);
    const add = (geo, mat) => { const m = new THREE.Mesh(keep(geo), mat); m.frustumCulled = false; tg.add(m); return m; };
    add(mergeBoxes(body), tintLam()); add(mergeBoxes(wins), bas(0xfff0c0, { toneMapped: false }));
    const head = add(new THREE.BoxGeometry(0.06, 0.12, 0.4), bas(0xffffff, { toneMapped: false }));
    const span = cars * (len + 0.14) / 2 + 6, period = T.every || 26, speed = T.speed || 9;
    ticks.push((dt, t) => {
      const n = Math.floor(t / period), f = t - n * period, dir = n % 2 ? -1 : 1, run = (100 + span * 2) / speed;
      if (f > run || power < 0.5) { tg.visible = false; return; }   // no trains in a power cut
      tg.visible = true;
      tg.position.set(dir > 0 ? -span + f * speed : 100 + span - f * speed, T.h || 0, T.y); head.position.set(dir * (cars * (len + 0.14) / 2 - 0.05), 0.42, 0);
    });
  }

  // ---------------------------------------------------------------- blue signs over the big roads
  if (A.roadSigns && A.roadSigns.length) {
    const kana = canDrawKana(), n = A.roadSigns.length;
    const cv = document.createElement('canvas'); cv.width = 256 * n; cv.height = 128; const c = cv.getContext('2d');
    const pos = [], uvs = [], idx = [], frame = [];
    A.roadSigns.forEach((sg, i) => {
      const ox = i * 256;
      c.fillStyle = '#1b56b0'; c.fillRect(ox, 0, 256, 128); c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(ox + 6, 6, 244, 116);
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '700 40px "Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo","Baloo 2",sans-serif'; c.fillText(kana ? sg.jp : sg.en, ox + 152, kana ? 48 : 64, 180);
      if (kana) { c.font = '600 22px "Baloo 2","Hind",sans-serif'; c.fillText(sg.en, ox + 152, 92, 180); }
      c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(ox + 42, 100); c.lineTo(ox + 42, 30); c.moveTo(ox + 24, 50); c.lineTo(ox + 42, 28); c.lineTo(ox + 60, 50); c.stroke();   // straight on
      const ry = sg.face === 'n' ? Math.PI : sg.face === 's' ? 0 : sg.face === 'e' ? Math.PI / 2 : -Math.PI / 2;   // which way the lettering looks
      const along = sg.face === 'n' || sg.face === 's', rx = Math.cos(ry), rz = -Math.sin(ry), hw = 0.85, y0 = 2.125, y1 = 2.975;
      for (const [o, y, u, v] of [[-hw, y0, 0, 0], [hw, y0, 1, 0], [hw, y1, 1, 1], [-hw, y1, 0, 1]]) { pos.push(sg.x + rx * o, y, sg.y + rz * o); uvs.push((i + u) / n, v); }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      frame.push([along ? 1.74 : 0.04, 0.89, along ? 0.04 : 1.74, sg.x - Math.sin(ry) * 0.03, 2.55, sg.y - Math.cos(ry) * 0.03]);
      const px = sg.x + (along ? (sg.side || 1) * 1.42 : 0), pz = sg.y + (along ? 0 : (sg.side || 1) * 1.42);
      frame.push([0.1, 3.0, 0.1, px, 1.5, pz]); frame.push([along ? 1.5 : 0.06, 0.06, along ? 0.06 : 1.5, (px + sg.x) / 2, 2.98, (pz + sg.y) / 2]);
    });
    const tex = keep(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
    const board = bas(0xffffff, { map: tex }); board.color.setScalar(0.85);
    put(g, board); put(mergeBoxes(frame), lam(0x6f747c));
  }

  // ---------------------------------------------------------------- lit standing signs outside the bars and shops
  if (A.aframes && W.facades) {
    const list = [];
    W.facades.forEach((f, i) => {
      if (f.fs !== 3 || hash(i * 5 + 3, 73) > (A.aframes.share || 0.5)) return;
      const along = (hash(i, 77) - 0.5) * (f.len - 0.6);
      list.push({ x: f.x - f.ny * along + f.nx * 0.2, z: f.y + f.nx * along + f.ny * 0.2, ry: Math.atan2(f.nx, f.ny) + Math.PI / 2, k: Math.floor(hash(i, 79) * 5) });
    });
    if (list.length) {
      const tints = [0xff6ab0, 0x6ae4ff, 0xffc04a, 0x7dff9a, 0xffffff];
      const im = inst(new THREE.BoxGeometry(0.035, 0.3, 0.17), bas(0xffffff, { toneMapped: false }), list.length);
      list.forEach((p, i) => { setAt(im, i, p.x, 0.17, p.z, p.ry); im.setColorAt(i, col.setHex(tints[p.k]).multiplyScalar(0.95)); });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- orange corner mirrors where a lane meets a road
  if (A.mirrors && map && map.roads) {
    const list = [];
    for (const r of map.roads) {
      if (r.kind !== 'alley' || r.points.length < 2) continue;
      for (const end of [0, 1]) {
        const p = end ? r.points[r.points.length - 1] : r.points[0], o = end ? r.points[r.points.length - 2] : r.points[1];
        const Ln = Math.hypot(p.x - o.x, p.y - o.y) || 1, dx = (p.x - o.x) / Ln, dy = (p.y - o.y) / Ln;
        const x = p.x - dx * 1.25 - dy * 0.68, y = p.y - dy * 1.25 + dx * 0.68;
        if (W.walkable(x, y)) list.push({ x, y, ry: Math.atan2(-dx, -dy) });
      }
    }
    if (list.length) {
      const orange = lam(0xf07a1a);
      const posts = inst(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 6), orange, list.length);
      const rimG = new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14); rimG.rotateX(Math.PI / 2);
      const glassG = new THREE.CylinderGeometry(0.09, 0.09, 0.035, 14); glassG.rotateX(Math.PI / 2);
      const rims = inst(rimG, orange, list.length), glass = inst(glassG, lam(0x9fb4c8), list.length);
      list.forEach((p, i) => {
        setAt(posts, i, p.x, 0.5, p.y);
        setAt(rims, i, p.x, 1.06, p.y, p.ry);
        setAt(glass, i, p.x + Math.sin(p.ry) * 0.006, 1.06, p.y + Math.cos(p.ry) * 0.006, p.ry);
      });
    }
  }

  // ---------------------------------------------------------------- blossom drifting down in the park
  if (A.petals && W.park) {
    const P = W.park, n = A.petals.count || 260, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const w = P.x1 - P.x0 + 6, d = P.y1 - P.y0 + 6;
    for (let k = 0; k < n; k++) { pos[k * 3] = P.x0 - 3 + hash(k, 1) * w; pos[k * 3 + 1] = hash(k, 2) * 3.2; pos[k * 3 + 2] = P.y0 - 3 + hash(k, 3) * d; seed[k] = hash(k, 4) * TAU; }
    const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, keep(new THREE.PointsMaterial({ color: A.petals.color || 0xffc4dc, size: 0.075, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false })));
    pts.frustumCulled = false; group.add(pts);
    ticks.push((dt, t, focus) => {
      if (focus && (focus.x < P.x0 - 22 || focus.x > P.x1 + 22 || focus.z < P.y0 - 22 || focus.z > P.y1 + 22)) return;   // nobody is near enough to see them
      for (let k = 0; k < n; k++) {
        let y = pos[k * 3 + 1] - dt * (0.32 + 0.2 * Math.sin(seed[k]));
        pos[k * 3] += Math.sin(t * 0.9 + seed[k]) * dt * 0.35 + dt * 0.12; pos[k * 3 + 2] += Math.cos(t * 0.7 + seed[k] * 1.7) * dt * 0.3;
        if (y < 0.02) { y = 2.6 + hash(k, Math.floor(t)) * 0.8; pos[k * 3] = P.x0 - 3 + hash(k + 11, Math.floor(t * 3)) * w; pos[k * 3 + 2] = P.y0 - 3 + hash(k + 23, Math.floor(t * 3)) * d; }
        pos[k * 3 + 1] = y;
      }
      g.attributes.position.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- steam from the kitchens and the bathhouse
  if (A.steam && A.steam.length) {
    let acc = 0;
    ticks.push((dt, t, focus, fx) => {
      acc += dt; if (acc < 0.28 || !fx || !fx.smoke) return; acc = 0;
      for (const s of A.steam) if (!focus || Math.hypot(s.x - focus.x, s.y - focus.z) < 20) fx.smoke(s.x + (Math.random() - 0.5) * 0.2, s.h || 1.0, s.y + (Math.random() - 0.5) * 0.2, 0.3);
    });
  }

  // ---------------------------------------------------------------- lights that blink: the tower, rooftop beacons
  if (A.blink && A.blink.length) {
    const im = inst(new THREE.SphereGeometry(0.09, 8, 6), bas(0xffffff, { toneMapped: false }), A.blink.length);
    const base = A.blink.map((b, i) => { const s = (b.r || 0.09) / 0.09; setAt(im, i, b.x, b.h, b.y, 0, s, s, s); im.setColorAt(i, col.setHex(b.color || 0xff4136)); return { c: new THREE.Color(b.color || 0xff4136), ph: b.ph || 0, rate: b.rate || 1 }; });
    ticks.push((dt, t) => { base.forEach((m, i) => { const on = ((t * m.rate + m.ph) % 1.6) < 0.8; im.setColorAt(i, col.copy(m.c).multiplyScalar(on && power > 0.5 ? 1.4 : 0.12)); }); im.instanceColor.needsUpdate = true; });
  }

  // ---------------------------------------------------------------- spotlights sweeping the sky over the club district
  if (A.beams && A.beams.length) {
    const geo = keep(new THREE.CylinderGeometry(0.55, 0.04, 9, 12, 1, true)); geo.translate(0, 4.5, 0);
    const beams = A.beams.map((b, i) => {
      const mat = keep(new THREE.MeshBasicMaterial({ color: b.color || 0xbfd8ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      const m = new THREE.Mesh(geo, mat); m.position.set(b.x, b.h || 5.4, b.y); m.renderOrder = 4; group.add(m); return { m, ph: i * 2.1 };
    });
    ticks.push((dt, t) => { for (const b of beams) { b.m.rotation.z = Math.sin(t * 0.5 + b.ph) * 0.55; b.m.rotation.x = Math.cos(t * 0.37 + b.ph * 1.3) * 0.45; } });
  }

  // ---------------------------------------------------------------- fishing boats riding the swell
  if (A.boats && A.boats.length) {
    const hullG = mergeBoxes([[1.7, 0.24, 0.6, 0, 0.1, 0, 0, 0x5a4636], [0.5, 0.34, 0.42, -0.35, 0.38, 0, 0, 0xd8d2c4], [0.04, 0.6, 0.04, 0.5, 0.42, 0, 0, 0x5a4636]]);
    const hulls = inst(hullG, tintLam(), A.boats.length), lamps = inst(new THREE.SphereGeometry(0.07, 8, 6), bas(0xffffff, { toneMapped: false }), A.boats.length);
    A.boats.forEach((b, i) => { setAt(hulls, i, b.x, 0.02, b.y, b.ry || 0); setAt(lamps, i, b.x, 0.64, b.y); lamps.setColorAt(i, col.setHex(i % 2 ? 0xffe9a8 : 0x9dffd4)); });
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    ticks.push((dt, t) => {
      A.boats.forEach((b, i) => {
        const ph = i * 1.7, y = 0.02 + Math.sin(t * 1.1 + ph) * 0.035, ry = b.ry || 0;
        dummy.position.set(b.x, y, b.y); dummy.rotation.set(Math.cos(t * 0.7 + ph) * 0.03, ry, Math.sin(t * 0.9 + ph) * 0.05); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); hulls.setMatrixAt(i, dummy.matrix);
        dummy.position.set(b.x + Math.cos(ry) * 0.5, y + 0.62, b.y - Math.sin(ry) * 0.5); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix);
      });
      hulls.instanceMatrix.needsUpdate = true; lamps.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- the night sky: glow on the horizon, stars, a low moon,
  // a far ring of city blocks with lit windows, and a mountain. All painted on one dome that follows the camera.
  if (A.sky && ctx && ctx.camera) {
    const K = A.sky, moon = new THREE.Vector3(K.moon ? K.moon[0] : 0.25, K.moon ? K.moon[1] : 0.14, K.moon ? K.moon[2] : 0.95).normalize();
    const mat = keep(new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMoon: { value: moon }, uPeak: { value: K.peak != null ? K.peak : -1.5708 }, uHasPeak: { value: K.peak != null ? 1 : 0 }, uPow: { value: 1 }, uMist: { value: 0 }, uMistCol: { value: new THREE.Color(0x39414f) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `varying vec3 vDir; uniform float uTime; uniform vec3 uMoon; uniform float uPeak; uniform float uHasPeak; uniform float uPow; uniform float uMist; uniform vec3 uMistCol;
        float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
        float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vDir); float el = asin(clamp(d.y, -1.0, 1.0)), az = atan(d.x, d.z);
          vec3 zen = vec3(0.010, 0.016, 0.045), mid = vec3(0.045, 0.04, 0.11), hor = vec3(0.30, 0.12, 0.24) * mix(0.3, 1.0, uPow);   // the glow on the horizon is the city's own light
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.2, el)); c = mix(c, zen, smoothstep(0.14, 0.7, el));
          c = mix(c, vec3(0.03, 0.035, 0.07), smoothstep(0.0, -0.06, el));
          // stars
          vec3 q = floor(d * 150.0); float st = h2(q.xy + q.z * 17.0);
          c += vec3(0.85, 0.9, 1.0) * step(0.9972, st) * smoothstep(0.1, 0.35, el) * (0.5 + 0.5 * sin(uTime * 2.0 + st * 90.0));
          // moon and its halo
          float m = dot(d, uMoon);
          c += vec3(0.42, 0.46, 0.7) * pow(max(m, 0.0), 90.0) * 0.4;
          c = mix(c, vec3(1.0, 0.95, 0.82) * (0.9 + 0.1 * h2(floor(d.xy * 400.0))), smoothstep(0.99955, 0.99972, m));
          // the mountain: a broad cone with snow on top
          float da = abs(mod(az - uPeak + 3.14159, 6.28318) - 3.14159);
          float prof = min(0.125, 0.17 - da * 0.42 + 0.004 * sin(az * 90.0));
          if (uHasPeak > 0.5 && el < prof && el > -0.02) {
            float snow = smoothstep(0.088, 0.1, el + 0.012 * sin(az * 160.0));
            c = mix(vec3(0.035, 0.04, 0.085), vec3(0.42, 0.45, 0.58), snow);
            c = mix(c, hor * 0.5, smoothstep(0.03, 0.0, el));
          }
          // far city: blocks of different heights, windows, red lamps on the tall ones
          float col = floor(az * 95.0), cf = fract(az * 95.0);
          float bh = 0.012 + 0.05 * h1(col) * h1(col * 1.7 + 3.0) + 0.045 * step(0.9, h1(col * 3.1 + 7.0));
          if (el < bh && el > -0.02) {
            vec3 b = vec3(0.016, 0.02, 0.042);
            vec2 wg = vec2(floor(cf * 4.0), floor(el * 700.0));
            float wl = step(0.62, h2(wg + col * 13.0)) * step(0.2, fract(cf * 4.0)) * step(0.3, fract(el * 700.0));
            b += mix(vec3(1.0, 0.8, 0.5), vec3(0.7, 0.85, 1.0), step(0.8, h2(wg + 5.0))) * wl * 0.55 * uPow;
            float tip = step(0.07, bh) * step(bh - 0.004, el) * step(0.4, cf) * step(cf, 0.6) * step(0.0, sin(uTime * 3.0 + col));
            b += vec3(1.0, 0.15, 0.1) * tip * 1.5 * uPow;
            c = b;
          }
          c = mix(c, uMistCol, uMist * smoothstep(0.55, 0.0, el));   // fog swallows the horizon and thins overhead
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    }));
    const dome = put(new THREE.SphereGeometry(200, 48, 24), mat); dome.renderOrder = -20;
    ticks.push((dt, t) => { dome.position.copy(ctx.camera.position); mat.uniforms.uTime.value = t; });
    nightHooks.push(n => { mat.uniforms.uPow.value = power; mat.uniforms.uMist.value = n.mist || 0; if (n.mistColor != null) mat.uniforms.uMistCol.value.setHex(n.mistColor); });
  }

  return {
    update(dt, time, focus, fx) { for (const f of ticks) f(dt, time, focus, fx); },
    // How tonight differs: power 1 normally and near 0 in a power cut; mist 0 to 1 with its colour on a foggy night.
    setNight(n) {
      n = n || {}; power = n.power != null ? n.power : 1;
      for (const g of glows) g.m.color.copy(g.base).multiplyScalar(power);
      for (const f of nightHooks) f(n);
    },
    dispose() { scene.remove(group); for (const o of own) if (o && o.dispose) o.dispose(); },
  };
}
