// Things that move and glow to make a town feel alive: a passing train, video screens, vertical neon signs,
// utility poles and wires, vending machines, traffic lights, falling blossom, steam, boats on the water.
// Everything is decoration: nothing here is solid and nothing changes the rules.
//
//   const ambient = buildAmbient(scene, W, map, { hash2 });   // once, after buildWorld() and buildScene()
//   ambient.update(dt, time, focus, fx);                      // every frame; focus = { x, z } the camera looks at
//
// A map switches this on with layout.ambient (see data/map-hotaru.json). Maps without it get an empty object.
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;
const NONE = { update() {}, dispose() {} };

// True when this device can draw Japanese lettering (otherwise the signs use Latin letters).
function canDrawKana() {
  try {
    const cv = document.createElement('canvas'); cv.width = 48; cv.height = 32;
    const c = cv.getContext('2d', { willReadFrequently: true });
    const shot = ch => { c.fillStyle = '#000'; c.fillRect(0, 0, 48, 32); c.fillStyle = '#fff'; c.font = '700 22px "Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif'; c.textBaseline = 'middle'; c.fillText(ch, 6, 16); return c.getImageData(0, 0, 48, 32).data; };
    const a = shot('あ'), b = shot('の'), none = shot('￿');
    let ink = 0, differ = 0, notBox = 0;
    for (let i = 0; i < a.length; i += 4) { if (a[i] > 60) ink++; if (Math.abs(a[i] - b[i]) > 40) differ++; if (Math.abs(a[i] - none[i]) > 40) notBox++; }
    return ink > 12 && differ > 6 && notBox > 6;
  } catch (e) { return false; }
}

export function buildAmbient(scene, W, map, ctx) {
  const L = W && W.layout;
  if (!L || !L.ambient || typeof document === 'undefined') return NONE;
  const A = L.ambient, hash = (ctx && ctx.hash2) || ((i, j) => Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1);
  const group = new THREE.Group(); group.name = 'ambient'; scene.add(group);
  const own = [], ticks = [];
  const keep = o => { own.push(o); return o; };
  const bas = (color, extra) => keep(new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {})));
  const lam = color => keep(new THREE.MeshLambertMaterial({ color }));
  const dummy = new THREE.Object3D(), col = new THREE.Color();
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
      if (!wgt || f.h < 1.25 || f.len < 1.6 || hash(i * 7 + 1, 91) > wgt) return;
      const side = hash(i, 5) > 0.5 ? 1 : -1, along = side * (f.len / 2 - 0.35 - hash(i, 9) * 0.5);
      const hgt = Math.min(f.h - 0.75, 0.9 + hash(i, 13) * 0.9);
      const out = hgt * 0.125 + 0.05;   // half the blade's width, so its inner edge sits just off the wall
      picks.push({ x: f.x - f.ny * along + f.nx * out, z: f.y + f.nx * along + f.ny * out, ry: Math.atan2(-f.ny, f.nx), h: hgt, y: 0.62 + hgt / 2 + hash(i, 17) * Math.max(0, f.h - 0.75 - hgt) * 0.6, col: Math.floor(hash(i, 21) * COLS), tint: Math.floor(hash(i, 25) * tints.length) });
    });
    for (let k = 0; k < COLS; k++) {
      const list = picks.filter(p => p.col === k); if (!list.length) continue;
      const geo = keep(new THREE.PlaneGeometry(1, 1)); const uv = geo.attributes.uv;
      for (let q = 0; q < uv.count; q++) uv.setX(q, (k + uv.getX(q)) / COLS);
      const mat = bas(0xffffff, { map: tex, toneMapped: false });
      const im = new THREE.InstancedMesh(geo, mat, list.length * 2);   // two faces back to back, so the lettering reads from both ways along the street
      list.forEach((p, i) => { for (const face of [0, 1]) {
        dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(0, p.ry + face * Math.PI, 0); dummy.scale.set(p.h * 0.25, p.h, 1); dummy.updateMatrix();
        im.setMatrixAt(i * 2 + face, dummy.matrix); im.setColorAt(i * 2 + face, col.copy(tints[p.tint]).multiplyScalar(1.5));
      } });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; group.add(im);
      if (k % 3 === 1) ticks.push((dt, t) => { const on = Math.sin(t * 3.1 + k) > -0.55 && Math.sin(t * 23 + k * 2) > -0.9; mat.color.setScalar(on ? 1 : 0.12); });   // a failing tube
    }
  }

  // ---------------------------------------------------------------- video screens with moving pictures
  const screenTime = { value: 0 };
  for (const q of (A.screens || [])) {
    const mat = keep(new THREE.ShaderMaterial({
      uniforms: { uTime: screenTime, uA: { value: new THREE.Color(q.color) }, uB: { value: new THREE.Color(q.color2 != null ? q.color2 : 0xffffff) }, uSeed: { value: (q.x * 3.1 + q.y) % 7 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uSeed;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          float t = uTime + uSeed * 3.0, scene = floor(t / 4.0);
          vec2 uv = vUv; vec3 c;
          float kind = mod(scene + floor(uSeed), 3.0);
          if (kind < 0.5) { float bars = step(0.5, fract(uv.x * 5.0 - t * 0.35)); c = mix(uA, uB, bars) * (0.75 + 0.25 * sin(uv.y * 40.0)); }
          else if (kind < 1.5) { vec2 g = floor(uv * vec2(10.0, 5.0)); float b = h(g + floor(t * 3.0)); c = mix(uA * 0.35, uB, step(0.62, b)); }
          else { float d = length((uv - 0.5) * vec2(1.9, 1.0)); float ring = 0.5 + 0.5 * sin(d * 26.0 - t * 5.0); c = mix(uA, uB, ring * smoothstep(0.75, 0.1, d)); }
          float ticker = step(uv.y, 0.16) * step(0.5, fract(uv.x * 14.0 + t * 1.2));
          c = mix(c, vec3(1.0), ticker * 0.8);
          c *= 0.82 + 0.18 * sin(uv.y * 220.0);
          gl_FragColor = vec4(c * 1.25, 1.0);
        }`,
      side: THREE.DoubleSide,
    }));
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(q.w, q.h)), mat); m.position.set(q.x, q.y0 + q.h / 2, q.y); m.rotation.y = q.ry || 0; group.add(m);
    const fr = new THREE.Mesh(keep(new THREE.BoxGeometry(q.w + 0.18, q.h + 0.18, 0.1)), lam(0x15171d));
    fr.position.set(q.x - Math.sin(q.ry || 0) * 0.07, q.y0 + q.h / 2, q.y - Math.cos(q.ry || 0) * 0.07); fr.rotation.y = q.ry || 0; group.add(fr);
  }
  if ((A.screens || []).length) ticks.push((dt, t) => { screenTime.value = t; });

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
      const poles = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.035, 0.045, 2.1, 6)), wood, pts.length);
      const bars = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.5, 0.04, 0.04)), wood, pts.length);
      const cans = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 8)), lam(0x8a8f96), pts.length);
      pts.forEach((p, i) => {
        dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.position.set(p.x, 1.05, p.y); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(p.x, 1.95, p.y); dummy.rotation.set(0, Math.atan2(-p.ux, p.uy) + Math.PI / 2, 0); dummy.updateMatrix(); bars.setMatrixAt(i, dummy.matrix);
        dummy.rotation.set(0, 0, 0); dummy.position.set(p.x + p.ux * 0.09, 1.7, p.y + p.uy * 0.09); dummy.updateMatrix(); cans.setMatrixAt(i, dummy.matrix);
      });
      for (const im of [poles, bars, cans]) { im.frustumCulled = false; group.add(im); }
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
      const bodies = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.2, 0.38, 0.12)), lam(0xffffff), list.length);
      const fronts = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(0.16, 0.2)), bas(0xffffff, { toneMapped: false }), list.length);
      const bodyCol = [0xc8322e, 0x2c5fc0, 0xe8e8ea], glowCol = [0xfff0e0, 0xdcefff, 0xfff6c8];
      list.forEach((p, i) => {
        dummy.scale.set(1, 1, 1); dummy.rotation.set(0, p.ry, 0);
        dummy.position.set(p.x, 0.19, p.z); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix); bodies.setColorAt(i, col.setHex(bodyCol[p.k]));
        dummy.position.set(p.x + Math.sin(p.ry) * 0.063, 0.24, p.z + Math.cos(p.ry) * 0.063); dummy.updateMatrix(); fronts.setMatrixAt(i, dummy.matrix); fronts.setColorAt(i, col.setHex(glowCol[p.k]).multiplyScalar(0.8));
      });
      for (const im of [bodies, fronts]) { if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; group.add(im); }
    }
  }

  // ---------------------------------------------------------------- traffic lights that change
  if (A.signals && A.signals.length) {
    const post = lam(0x2e323c), dim = { r: 0x3a1512, a: 0x3a2c10, g: 0x0f3320 }, lit = { r: 0xff4136, a: 0xffb400, g: 0x34ff8a };
    const heads = [];
    A.signals.forEach((s, i) => {
      const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.035, 0.045, 1.7, 6)), post); pole.position.set(s.x, 0.85, s.y); group.add(pole);
      const box = new THREE.Mesh(keep(new THREE.BoxGeometry(0.16, 0.46, 0.16)), post); box.position.set(s.x, 1.78, s.y); group.add(box);
      const lamps = {};
      [['r', 0.14], ['a', 0], ['g', -0.14]].forEach(([k, dy]) => { const m = new THREE.Mesh(keep(new THREE.SphereGeometry(0.075, 8, 6)), bas(dim[k], { toneMapped: false })); m.position.set(s.x, 1.78 + dy, s.y); m.scale.set(1.25, 1, 1.25); group.add(m); lamps[k] = m.material; });
      heads.push({ lamps, grp: s.g != null ? s.g : i % 2 });
    });
    ticks.push((dt, t) => {
      const ph = t % 16;   // 0-7 group 0 goes, 7-8 amber, 8-15 group 1 goes, 15-16 amber
      for (const h of heads) {
        const mine = h.grp === 0 ? ph : (ph + 8) % 16, state = mine < 7 ? 'g' : mine < 8 ? 'a' : 'r';
        for (const k of ['r', 'a', 'g']) h.lamps[k].color.setHex(k === state ? lit[k] : dim[k]);
      }
    });
  }

  // ---------------------------------------------------------------- a train passing along the line
  if (A.train) {
    const T = A.train, cars = T.cars || 6, len = 2.7, tg = new THREE.Group(); group.add(tg);
    const body = lam(T.color || 0xc9ced6), stripe = bas(T.stripe || 0x4dff7a), win = bas(0xfff0c0, { toneMapped: false }), dark = lam(0x23262e);
    for (let k = 0; k < cars; k++) {
      const x = (k - (cars - 1) / 2) * (len + 0.14);
      const b = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 0.56, 0.6)), body); b.position.set(x, 0.5, 0); tg.add(b);
      const s = new THREE.Mesh(keep(new THREE.BoxGeometry(len + 0.01, 0.07, 0.62)), stripe); s.position.set(x, 0.33, 0); tg.add(s);
      const w = new THREE.Mesh(keep(new THREE.BoxGeometry(len * 0.86, 0.16, 0.63)), win); w.position.set(x, 0.58, 0); tg.add(w);
      const u = new THREE.Mesh(keep(new THREE.BoxGeometry(len * 0.8, 0.14, 0.4)), dark); u.position.set(x, 0.15, 0); tg.add(u);
    }
    const head = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.12, 0.4)), bas(0xffffff, { toneMapped: false })); tg.add(head);
    const span = cars * (len + 0.14) / 2 + 6, period = T.every || 26, speed = T.speed || 9;
    ticks.push((dt, t) => {
      const n = Math.floor(t / period), f = t - n * period, dir = n % 2 ? -1 : 1, run = (100 + span * 2) / speed;
      if (f > run) { tg.visible = false; return; }
      tg.visible = true;
      const x = dir > 0 ? -span + f * speed : 100 + span - f * speed;
      tg.position.set(x, 0, T.y); head.position.set(dir * (cars * (len + 0.14) / 2 - 0.05), 0.42, 0);
    });
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
    const mats = A.blink.map(b => { const m = new THREE.Mesh(keep(new THREE.SphereGeometry(b.r || 0.09, 8, 6)), bas(b.color || 0xff4136, { toneMapped: false })); m.position.set(b.x, b.h, b.y); group.add(m); return { mat: m.material, base: new THREE.Color(b.color || 0xff4136), ph: b.ph || 0, rate: b.rate || 1 }; });
    ticks.push((dt, t) => { for (const m of mats) { const on = ((t * m.rate + m.ph) % 1.6) < 0.8; m.mat.color.copy(m.base).multiplyScalar(on ? 1.4 : 0.12); } });
  }

  // ---------------------------------------------------------------- spotlights sweeping the sky over the club district
  if (A.beams && A.beams.length) {
    const geo = keep(new THREE.CylinderGeometry(0.9, 0.05, 9, 12, 1, true)); geo.translate(0, 4.5, 0);
    const beams = A.beams.map((b, i) => {
      const mat = keep(new THREE.MeshBasicMaterial({ color: b.color || 0xbfd8ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      const m = new THREE.Mesh(geo, mat); m.position.set(b.x, b.h || 2.6, b.y); m.renderOrder = 4; group.add(m); return { m, ph: i * 2.1 };
    });
    ticks.push((dt, t) => { for (const b of beams) { b.m.rotation.z = Math.sin(t * 0.5 + b.ph) * 0.55; b.m.rotation.x = Math.cos(t * 0.37 + b.ph * 1.3) * 0.45; } });
  }

  // ---------------------------------------------------------------- fishing boats riding the swell
  if (A.boats && A.boats.length) {
    const hull = lam(0x5a4636), cabin = lam(0xd8d2c4);
    const boats = A.boats.map((b, i) => {
      const g = new THREE.Group(); g.position.set(b.x, 0.02, b.y); g.rotation.y = b.ry || 0; group.add(g);
      const h = new THREE.Mesh(keep(new THREE.BoxGeometry(1.7, 0.24, 0.6)), hull); h.position.y = 0.1; g.add(h);
      const cb = new THREE.Mesh(keep(new THREE.BoxGeometry(0.5, 0.34, 0.42)), cabin); cb.position.set(-0.35, 0.38, 0); g.add(cb);
      const lampM = new THREE.Mesh(keep(new THREE.SphereGeometry(0.07, 8, 6)), bas(i % 2 ? 0xffe9a8 : 0x9dffd4, { toneMapped: false })); lampM.position.set(0.5, 0.62, 0); g.add(lampM);
      const mast = new THREE.Mesh(keep(new THREE.BoxGeometry(0.04, 0.6, 0.04)), hull); mast.position.set(0.5, 0.42, 0); g.add(mast);
      return { g, ph: i * 1.7 };
    });
    ticks.push((dt, t) => { for (const b of boats) { b.g.position.y = 0.02 + Math.sin(t * 1.1 + b.ph) * 0.035; b.g.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.05; b.g.rotation.x = Math.cos(t * 0.7 + b.ph) * 0.03; } });
  }

  return {
    update(dt, time, focus, fx) { for (const f of ticks) f(dt, time, focus, fx); },
    dispose() { scene.remove(group); for (const o of own) if (o && o.dispose) o.dispose(); },
  };
}
