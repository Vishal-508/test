// Builds the town you drive through: wet painted ground that reacts to headlights, instanced buildings
// with lit windows, landmarks, street lamps with light cones, loot markers, hideouts and labels.
import * as THREE from '../vendor/three.module.min.js';
import { N, CS, T, LANE, hash2 } from './world.js?v=7';
import { buildHideout, kindFor } from './hideouts.js?v=7';
import { CFG } from './config.js?v=7';
import { canDrawKana, mergeBoxes } from './ambient.js?v=7';

const FONT = '"Baloo 2","Trebuchet MS","Segoe UI",sans-serif';

export const COLORS = {
  fog: 0x0a0f1c, loot: 0xf3b43f, locked: 0xb04a4a, escape: 0x3bc98b, hide: 0xad90ff,
  police: 0x6a98ff, route: 0xff6f9f, alarm: 0xff4040,
};

// ---------------------------------------------------------------- ground painting (three maps)
function drawLanes(l, S, map, W, clipMask) {
  l.lineCap = 'round'; l.lineJoin = 'round';
  const path = pts => { l.beginPath(); pts.forEach((p, k) => k ? l.lineTo(p.x * S, p.y * S) : l.moveTo(p.x * S, p.y * S)); };
  const stroke = (pts, w, col, dash) => { path(pts); l.lineWidth = w * S; l.strokeStyle = col; l.setLineDash(dash ? dash.map(d => d * S) : []); l.stroke(); l.setLineDash([]); };
  const LY = W.layout, pk = W.park;
  // park grass with darker and lighter patches
  if (pk) {
    const pw = pk.x1 - pk.x0, ph = pk.y1 - pk.y0;
    l.fillStyle = '#132a1c'; l.fillRect((pk.x0 - 0.5) * S, (pk.y0 - 0.5) * S, (pw + 1) * S, (ph + 1) * S);
    for (let k = 0; k < Math.round(pw * ph * 0.53); k++) {
      const x = pk.x0 + hash2(k, 3) * pw, y = pk.y0 + hash2(k, 9) * ph, r = 0.4 + hash2(k, 17) * 1.3;
      l.fillStyle = hash2(k, 23) > 0.5 ? 'rgba(34,78,46,0.35)' : 'rgba(6,18,10,0.4)'; l.beginPath(); l.arc(x * S, y * S, r * S, 0, 7); l.fill();
    }
  }
  // police yard paving and parking-lot bays
  for (const o of (LY.open || [])) {
    const x0 = o.x0 - 0.5, y0 = o.y0 - 0.5, x1 = o.x1 + 0.5, y1 = o.y1 + 0.5;
    if (o.paint === 'yard') {
      l.fillStyle = '#30364a'; l.fillRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
      l.strokeStyle = 'rgba(255,255,255,0.05)'; l.lineWidth = 1;
      for (let v = x0 + 0.5; v < x1; v += 1) { l.beginPath(); l.moveTo(v * S, y0 * S); l.lineTo(v * S, y1 * S); l.stroke(); }
      for (let v = y0 + 0.5; v < y1; v += 1) { l.beginPath(); l.moveTo(x0 * S, v * S); l.lineTo(x1 * S, v * S); l.stroke(); }
    } else if (o.paint === 'lot') {
      l.fillStyle = '#272a33'; l.fillRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
      l.strokeStyle = 'rgba(240,220,140,0.2)'; l.lineWidth = 0.08 * S;
      for (let v = y0 + 1.5; v < y1; v += 1.6) { l.beginPath(); l.moveTo((x0 + 0.6) * S, v * S); l.lineTo((x0 + 2.2) * S, v * S); l.stroke(); l.beginPath(); l.moveTo((x1 - 2.2) * S, v * S); l.lineTo((x1 - 0.6) * S, v * S); l.stroke(); }
    } else if (o.paint === 'plaza') {
      l.fillStyle = o.color || '#2b2f3d'; l.fillRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
    }
  }
  const alleyCol = Object.assign({ kotwali: '#282f42', sarafa: '#2f2b2b', patri: '#2c2a24', afsar: '#252d40', basti: '#322922', ghat: '#263333', bagh: '#2e312c' }, LY.alley || {});
  const kinds = k => map.roads.filter(r => r.kind === k);
  for (const r of kinds('drain')) { const p = r.points.map(q => ({ x: q.x, y: Math.min(q.y, 93.2) })); stroke(p, 2.5, '#454e64'); stroke(p, 2.1, '#0b0e17'); stroke(p, 0.3, 'rgba(70,110,150,0.3)', [0.9, 1.7]); }
  for (const r of kinds('alley')) stroke(r.points, 1.64, alleyCol[W.districtAt(r.points[0].x, r.points[0].y)] || '#282f42');
  for (const r of map.special_routes) if (r.name === 'Tirpal Surang') stroke(r.points, 1.64, '#2a2626');
  for (const g of W.galis) { stroke(g.points, 1.54, '#2a2228'); }
  for (const r of kinds('street')) stroke(r.points, 2.04, r.name === 'Bagh ki Pagdandi' ? '#3d3c35' : '#2e3447');
  for (const r of kinds('plank')) { stroke(r.points, 1.6, '#5e4a34'); stroke(r.points, 1.6, 'rgba(0,0,0,0.25)', [0.12, 0.3]); }
  if (LY.roadStyle === 'jp') {
    // narrow streets: asphalt wall to wall, a white line down each side marking the strip people walk in
    for (const r of kinds('street')) { stroke(r.points, 2.04, '#2a2e39'); stroke(r.points, 1.66, 'rgba(226,229,236,0.6)'); stroke(r.points, 1.54, '#2a2e39'); }
    // big roads: paved pavement with a yellow guide strip, kerb, white edge lines, orange centre line
    for (const r of kinds('main')) stroke(r.points, 3.06, '#484c58');
    for (const r of kinds('main')) { stroke(r.points, 2.74, 'rgba(214,170,40,0.5)'); stroke(r.points, 2.62, '#484c58'); stroke(r.points, 2.38, '#8a8e9a'); stroke(r.points, 2.3, '#292d38'); stroke(r.points, 2.04, 'rgba(230,232,238,0.6)'); stroke(r.points, 1.94, '#292d38'); }
    // stop lines and the word painted on the road where a side street meets a bigger road
    const kana = canDrawKana(), word = kana ? ['止', 'ま', 'れ'] : ['S', 'T', 'O', 'P'];
    const HWQ = { main: 1.5, street: 1.0 }, HWR = { street: 1.0, alley: 0.8 };
    const near = (p, q) => { for (let k = 1; k < q.points.length; k++) { const a = q.points[k - 1], b = q.points[k], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)); if (Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < 0.15) return true; } return false; };
    for (const r of map.roads) {
      if (!HWR[r.kind] || r.points.length < 2) continue;
      for (const end of [0, 1]) {
        const p = end ? r.points[r.points.length - 1] : r.points[0], o = end ? r.points[r.points.length - 2] : r.points[1];
        const Ln = Math.hypot(p.x - o.x, p.y - o.y); if (Ln < 5) continue;
        const dx = (p.x - o.x) / Ln, dy = (p.y - o.y) / Ln;
        const q = map.roads.find(c => c !== r && HWQ[c.kind] && (c.kind === 'main' || r.kind === 'alley') && near(p, c)); if (!q) continue;
        const back = HWQ[q.kind] + 0.2, hw = HWR[r.kind];
        l.save(); l.translate((p.x - dx * back) * S, (p.y - dy * back) * S); l.rotate(Math.atan2(dx, -dy));
        l.fillStyle = 'rgba(232,234,240,0.78)'; l.fillRect(-(hw - 0.2) * S, 0, (hw * 2 - 0.4) * S, 0.11 * S);
        if (r.kind === 'street') {
          const ch = 0.62 * S; l.font = `700 ${ch.toFixed(1)}px "Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif`; l.textAlign = 'center'; l.textBaseline = 'middle'; l.fillStyle = 'rgba(232,234,240,0.72)';
          word.forEach((c, i) => { l.save(); l.translate(0, (0.62 + i * (kana ? 0.7 : 0.5)) * S); l.scale(kana ? 1 : 0.8, kana ? 1.25 : 1); l.fillText(c, 0, 0); l.restore(); });
        }
        l.restore();
      }
    }
    for (const r of kinds('main')) stroke(r.points, 0.08, '#d9902a');
    // manhole covers
    for (let k = 0; k < 160; k++) { const x = hash2(k, 131) * 100, y = hash2(k, 137) * 100; if (!W.walkable(x, y) || W.laneAt(x, y) < LANE.ALLEY) continue; l.fillStyle = 'rgba(12,13,17,0.8)'; l.beginPath(); l.arc(x * S, y * S, 0.16 * S, 0, 7); l.fill(); l.strokeStyle = 'rgba(120,124,136,0.5)'; l.lineWidth = 0.03 * S; l.stroke(); }
  } else {
    for (const r of kinds('main')) stroke(r.points, 3.06, '#3a4259');
    for (const r of kinds('main')) { stroke(r.points, 2.76, '#30374b'); stroke(r.points, 0.1, '#9aa1b8', [1.0, 1.4]); }
  }
  for (const r of kinds('bridge')) stroke(r.points, 3.06, '#40485f');
  // zebra crossings
  l.fillStyle = 'rgba(214,220,235,0.5)';
  for (const z of (LY.crossings || [])) {
    if (z.len) { // a crossing at an angle: { cx, cy, len, w, ang }
      l.save(); l.translate(z.cx * S, z.cy * S); l.rotate(z.ang);
      for (let x = -z.len / 2; x < z.len / 2 - 0.2; x += 0.55) l.fillRect(x * S, -z.w / 2 * S, 0.28 * S, z.w * S);
      l.restore(); continue;
    }
    const w = z.x1 - z.x0, h = z.y1 - z.y0;
    if (w >= h) for (let x = z.x0 + 0.15; x < z.x1 - 0.2; x += 0.55) l.fillRect(x * S, z.y0 * S, 0.28 * S, h * S);
    else for (let y = z.y0 + 0.15; y < z.y1 - 0.2; y += 0.55) l.fillRect(z.x0 * S, y * S, w * S, 0.28 * S);
  }
  if (clipMask) { l.globalCompositeOperation = 'destination-in'; l.drawImage(clipMask, 0, 0); l.globalCompositeOperation = 'source-over'; }
}

export function paintGround(size, map, W) {
  const S = size / 100, px = CS * S;
  const mk = (w = size) => { const c = document.createElement('canvas'); c.width = c.height = w; return c; };
  // ---- colour
  const alb = mk(), c = alb.getContext('2d');
  c.fillStyle = '#070a12'; c.fillRect(0, 0, size, size);
  const base = Object.assign({ kotwali: '#262d3f', sarafa: '#2c292a', patri: '#2a2822', afsar: '#232b3d', basti: '#2d251f', ghat: '#222e2e', bagh: '#152a1c' }, W.layout.ground || {});
  const mask = mk(), m = mask.getContext('2d'); m.fillStyle = '#fff';
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const t = W.type[j * N + i], x = (i + 0.5) * CS, y = (j + 0.5) * CS;
    if (t === T.WALK || t === T.CAGE || t === T.BAY || (t === T.PROP && W.inPark(x, y))) { c.fillStyle = base[W.districtAt(x, y)] || '#262d3f'; c.fillRect(i * px, j * px, px + 0.6, px + 0.6); m.fillRect(i * px, j * px, px + 0.6, px + 0.6); }
    else if (t === T.WATER) { c.fillStyle = '#0b2644'; c.fillRect(i * px, j * px, px + 0.6, px + 0.6); }
    else if (t === T.RAIL) { c.fillStyle = '#17181d'; c.fillRect(i * px, j * px, px + 0.6, px + 0.6); }
  }
  const lay = mk(); drawLanes(lay.getContext('2d'), S, map, W, mask); c.drawImage(lay, 0, 0);
  // hideout bay floors: oil-stained concrete
  for (const h of W.hides) if (h.bay && !h.grove) { c.fillStyle = '#1d2029'; c.fillRect(h.bay.x0 * S, h.bay.y0 * S, (h.bay.x1 - h.bay.x0) * S, (h.bay.y1 - h.bay.y0) * S); c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(h.x * S, h.y * S, 0.35 * S, 0.5 * S, 0, 0, 7); c.fill(); }
  // rails and river detail
  const railY = W.layout.railY, waterY = W.layout.waterY;
  if (railY != null) {
    c.strokeStyle = '#2a2420'; c.lineWidth = 0.12 * S;
    for (let x = 0; x < 100; x += 0.55) { c.beginPath(); c.moveTo(x * S, (railY - 1.1) * S); c.lineTo(x * S, (railY - 0.3) * S); c.stroke(); }
    c.strokeStyle = '#7b8196'; c.lineWidth = 0.06 * S;
    for (const y of [railY - 0.88, railY - 0.52]) { c.beginPath(); c.moveTo(0, y * S); c.lineTo(100 * S, y * S); c.stroke(); }
  }
  if (waterY != null) {
    c.strokeStyle = 'rgba(120,170,220,0.16)'; c.lineWidth = 0.06 * S;
    for (let k = 0; k < 150; k++) { const x = hash2(k, 51) * 100, y = waterY + 0.3 + hash2(k, 57) * (99.8 - waterY - 0.3), w = 0.6 + hash2(k, 61) * 1.8; c.beginPath(); c.moveTo(x * S, y * S); c.lineTo((x + w) * S, y * S); c.stroke(); }
  }
  c.fillStyle = '#1b2134'; c.fillRect(W.cage.x0 * S, W.cage.y0 * S, (W.cage.x1 - W.cage.x0) * S, (W.cage.y1 - W.cage.y0) * S);
  // soft dark edges where the road meets a wall (cheap ambient occlusion); skipped where canvas blur is missing
  if ('filter' in c) {
    const ao = mk(400), a = ao.getContext('2d'); a.fillStyle = '#000';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const t = W.type[j * N + i]; if (t === T.BLDG || t === T.MARK) a.fillRect(i * 2, j * 2, 2, 2); }
    c.save(); c.filter = `blur(${(0.5 * S).toFixed(1)}px)`; c.globalAlpha = 0.6; c.drawImage(ao, 0, 0, size, size); c.restore();
  }
  // ---- light (emissive): lamp pools, markers, shortcut trails
  const emi = mk(), e = emi.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
  e.lineCap = 'round';
  for (const g of W.galis) { e.beginPath(); g.points.forEach((p, k) => k ? e.lineTo(p.x * S, p.y * S) : e.moveTo(p.x * S, p.y * S)); e.lineWidth = 0.13 * S; e.strokeStyle = 'rgba(255,111,159,0.55)'; e.setLineDash([0.45 * S, 0.45 * S]); e.stroke(); e.setLineDash([]); }
  const ring = (x, y, r, col, w, dash) => { e.beginPath(); e.arc(x * S, y * S, r * S, 0, Math.PI * 2); e.lineWidth = w * S; e.strokeStyle = col; e.setLineDash(dash ? dash.map(d => d * S) : []); e.stroke(); e.setLineDash([]); };
  for (const s of W.sites) { ring(s.x, s.y, 1.1, 'rgba(243,180,63,0.8)', 0.08); ring(s.x, s.y, 0.85, 'rgba(243,180,63,0.3)', 0.05, [0.3, 0.2]); }
  for (const x of W.escapes) { ring(x.x, x.y, 1.35, 'rgba(59,201,139,0.9)', 0.1); ring(x.x, x.y, 1.0, 'rgba(59,201,139,0.35)', 0.06, [0.35, 0.25]); }
  for (const v of W.levers) ring(v.x, v.y, 0.6, 'rgba(106,152,255,0.9)', 0.07);
  for (const h of W.hides) { // violet chevrons on the lane, pointing at each hideout door
    const nx = h.bay.nx, ny = h.bay.ny, tx = -ny, ty = nx;
    e.strokeStyle = 'rgba(173,144,255,0.9)'; e.lineWidth = 0.08 * S; e.lineJoin = 'round';
    for (const off of [-0.75, -0.4]) { const cx = h.mouth.x + nx * off, cy = h.mouth.y + ny * off; e.beginPath(); e.moveTo((cx + tx * 0.4 - nx * 0.2) * S, (cy + ty * 0.4 - ny * 0.2) * S); e.lineTo((cx + nx * 0.12) * S, (cy + ny * 0.12) * S); e.lineTo((cx - tx * 0.4 - nx * 0.2) * S, (cy - ty * 0.4 - ny * 0.2) * S); e.stroke(); }
  }
  e.globalCompositeOperation = 'lighter';
  const glow = (x, y, r, col, a) => {
    const g = e.createRadialGradient(x * S, y * S, 0, x * S, y * S, r * S);
    const rr = (col >> 16) & 255, gg = (col >> 8) & 255, bb = col & 255;
    g.addColorStop(0, `rgba(${rr},${gg},${bb},${a})`); g.addColorStop(0.45, `rgba(${rr},${gg},${bb},${a * 0.38})`); g.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    e.fillStyle = g; e.fillRect((x - r) * S, (y - r) * S, 2 * r * S, 2 * r * S);
  };
  for (const p of W.lamps) glow(p.x + p.dx * 0.5, p.y + p.dy * 0.5, p.r, p.c, p.post ? 0.3 : 0.17);
  for (const f of W.facades) { // light spilling out of shopfronts onto the pavement
    if (f.fs !== 3 && f.fs !== 5) continue;
    const tx = -f.ny, ty = f.nx, hl = f.len / 2, reach = f.fs === 5 ? 1.3 : 1.0;
    const g = e.createLinearGradient(f.x * S, f.y * S, (f.x + f.nx * reach) * S, (f.y + f.ny * reach) * S);
    const cool = hash2(Math.round(f.x * 4), Math.round(f.y * 4)) > 0.7 || f.fs === 5;
    g.addColorStop(0, cool ? 'rgba(200,225,255,0.34)' : 'rgba(255,214,150,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    e.fillStyle = g; e.beginPath();
    e.moveTo((f.x - tx * hl) * S, (f.y - ty * hl) * S); e.lineTo((f.x + tx * hl) * S, (f.y + ty * hl) * S);
    e.lineTo((f.x + tx * hl + f.nx * reach) * S, (f.y + ty * hl + f.ny * reach) * S); e.lineTo((f.x - tx * hl + f.nx * reach) * S, (f.y - ty * hl + f.ny * reach) * S); e.closePath(); e.fill();
  }
  for (const s of W.sites) glow(s.x, s.y, 2.0, 0xf3b43f, 0.16);
  for (const x of W.escapes) glow(x.x, x.y, 2.6, 0x3bc98b, 0.16);
  for (const p of W.posts) glow(p.x, p.y, 2.6, 0x6a98ff, 0.22);
  for (const q of (W.layout.glows || [])) glow(q[0], q[1], q[2], q[3], q[4]);
  e.globalCompositeOperation = 'destination-in'; e.drawImage(mask, 0, 0); e.globalCompositeOperation = 'source-over';   // light only falls on open ground
  // ---- wetness (roughness): mostly damp, with puddles on the roads
  const rsz = Math.min(1024, size), rs = rsz / 100, rgh = mk(rsz), r = rgh.getContext('2d');
  r.fillStyle = '#9c9c9c'; r.fillRect(0, 0, rsz, rsz);
  for (let k = 0; k < 900; k++) {
    const x = hash2(k, 71) * 100, y = hash2(k, 73) * 100; if (!W.walkable(x, y)) continue;
    const lk = W.laneAt(x, y), big = lk === LANE.MAIN || lk === LANE.STREET, rad = (big ? 0.5 : 0.28) + hash2(k, 79) * (big ? 1.1 : 0.4);
    const g = r.createRadialGradient(x * rs, y * rs, 0, x * rs, y * rs, rad * rs); g.addColorStop(0, 'rgba(38,38,38,0.95)'); g.addColorStop(0.7, 'rgba(60,60,60,0.5)'); g.addColorStop(1, 'rgba(120,120,120,0)');
    r.fillStyle = g; r.beginPath(); r.ellipse(x * rs, y * rs, rad * rs, rad * rs * (0.5 + hash2(k, 83) * 0.5), hash2(k, 89) * 3, 0, 7); r.fill();
  }
  return { alb, emi, rgh };
}

export function paintMini(cv, map, W) {
  const S = cv.width / 100, c = cv.getContext('2d'), px = CS * S;
  c.fillStyle = '#0a0f1c'; c.fillRect(0, 0, cv.width, cv.height);
  if (W.park) { c.fillStyle = '#13281b'; c.fillRect((W.park.x0 - 0.5) * S, (W.park.y0 - 0.5) * S, (W.park.x1 - W.park.x0 + 1) * S, (W.park.y1 - W.park.y0 + 1) * S); }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, t = W.type[k];
    if (t === T.WALK) c.fillStyle = W.inPark((i + 0.5) * CS, (j + 0.5) * CS) ? '#1f4a30' : (W.ai[k] ? '#414c6b' : '#8a4a6e');
    else if (t === T.BAY) c.fillStyle = '#7a62c9';
    else if (t === T.WATER) c.fillStyle = '#143a63';
    else if (t === T.RAIL) c.fillStyle = '#1c1e26';
    else if (t === T.CAGE) c.fillStyle = '#3a56a8';
    else continue;
    c.fillRect(i * px, j * px, px + 0.5, px + 0.5);
  }
  c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#6f7da3'; c.lineWidth = 2.6 * S;
  for (const r of map.roads) if (r.kind === 'main') { c.beginPath(); r.points.forEach((p, k) => k ? c.lineTo(p.x * S, p.y * S) : c.moveTo(p.x * S, p.y * S)); c.stroke(); }
}

// ---------------------------------------------------------------- labels
export const LABELS = [];
export function makeLabel(text, opts = {}) {
  const fs = 46, pad = 16, cv = document.createElement('canvas'), c = cv.getContext('2d');
  c.font = `700 ${fs}px ${FONT}`;
  cv.width = Math.ceil(c.measureText(text).width) + pad * 2; cv.height = Math.ceil(fs * 1.5);
  c.font = `700 ${fs}px ${FONT}`; c.textBaseline = 'middle';
  const r = 14, w = cv.width, h = cv.height;
  c.beginPath(); c.moveTo(r, 0); c.arcTo(w, 0, w, h, r); c.arcTo(w, h, 0, h, r); c.arcTo(0, h, 0, 0, r); c.arcTo(0, 0, w, 0, r); c.closePath();
  c.fillStyle = opts.bg || 'rgba(8,12,22,0.78)'; c.fill();
  if (opts.border) { c.lineWidth = 4; c.strokeStyle = opts.border; c.stroke(); }
  c.fillStyle = opts.color || '#ffffff'; c.fillText(text, pad, h / 2 + 3);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: true }));
  const hh = opts.h || 0.55; sp.scale.set(hh * w / h, hh, 1); sp.renderOrder = 20;
  sp.userData.base = hh; sp.userData.ratio = w / h; LABELS.push(sp);
  return sp;
}

// ---------------------------------------------------------------- building material: lit windows + see-through circle around the player's car
// Dark roof tiles in rows, for the pitched roofs of old houses. Has the same see-through circle round the player's car as the walls.
export function makeTileMaterial(U) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x41444f });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uCut = U.uCut; sh.uniforms.uRes = U.uRes;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vDepthC;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wpC = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          wpC = instanceMatrix * wpC;
        #endif
        vWPos = ( modelMatrix * wpC ).xyz;
        vDepthC = - mvPosition.z;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vDepthC;\nuniform vec3 uCut;\nuniform vec2 uRes;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 spC = gl_FragCoord.xy / uRes;
          float cdC = length( ( spC - uCut.xy ) * vec2( uRes.x / uRes.y, 1.0 ) );
          if ( vDepthC < uCut.z - 0.2 && cdC < 0.15 ) {
            if ( cdC < 0.105 || mod( floor( gl_FragCoord.x ) + floor( gl_FragCoord.y ), 2.0 ) < 0.5 ) discard;
          }
          float farC = clamp( ( vDepthC - 18.0 ) / 16.0, 0.0, 1.0 );
          diffuseColor.rgb *= mix( 0.72 + 0.42 * step( 0.4, fract( vWPos.y * 12.0 ) ), 0.93, farC );
        }`);
  };
  mat.customProgramCacheKey = () => 'tile1';
  return mat;
}

// What the front of a building looks like, by kind (set per building in js/world.js as `fs`):
//   1 office block with ribbons of glass   2 flats with balconies   3 narrow block of bars and shops, a lit sign on every floor
//   4 old wooden house                     5 bright single-storey shop                6 warehouse
const FRONTS = `
              float yC = vWPos.y, FLC = 0.62, dC = vDepthC, bidC = floor( vBid + 0.5 ) / 251.0;
              float flC = floor( yC / FLC ), fyC = fract( yC / FLC );
              vec3 baseC = diffuseColor.rgb;
              if ( vSty < 1.5 ) {
                float cxC = fract( uC / 0.45 ), colC = floor( uC / 0.45 );
                if ( flC < 0.5 ) {
                  float gC = step( 0.06, cxC ) * step( cxC, 0.94 ) * step( 0.06, fyC ) * step( fyC, 0.82 );
                  float lobC = step( 0.45, hsC( vec2( floor( uC / 1.8 ), sideC + bidC * 37.0 ) ) );
                  diffuseColor.rgb = mix( baseC * 0.8, vec3( 0.05, 0.07, 0.1 ), gC );
                  totalEmissiveRadiance += vec3( 1.0, 0.9, 0.72 ) * gC * lobC * ( 0.3 + 0.25 * fyC );
                } else {
                  float gC = step( 0.07, cxC ) * step( cxC, 0.93 ) * step( 0.2, fyC ) * step( fyC, 0.86 );
                  float rC = hsC( vec2( colC, flC * 13.0 + sideC + bidC * 71.0 ) );
                  float clC = hsC( vec2( floor( colC / 3.0 ), flC + sideC + bidC * 13.0 ) );
                  float litC = step( 0.64, rC * 0.45 + clC * 0.55 );
                  diffuseColor.rgb = mix( baseC, vec3( 0.06, 0.09, 0.14 ), gC );
                  float tubeC = 0.55 + 0.45 * step( 0.78, fyC ) * step( fyC, 0.84 );   // strip lights on the ceiling show through the glass
                  totalEmissiveRadiance += mix( vec3( 0.9, 0.95, 1.0 ), vec3( 1.0, 0.85, 0.6 ), step( 0.8, rC ) ) * gC * litC * 0.5 * tubeC;
                  totalEmissiveRadiance += vec3( 0.025, 0.04, 0.075 ) * gC * ( 1.0 - litC );
                }
              } else if ( vSty < 2.5 ) {
                float uxC = fract( uC / 1.0 ), unC = floor( uC / 1.0 );
                float rC = hsC( vec2( unC, flC * 17.0 + sideC + bidC * 43.0 ) );
                if ( flC < 0.5 ) {
                  float dC2 = step( 0.3, uxC ) * step( uxC, 0.7 ) * step( fyC, 0.74 ) * step( 0.75, hsC( vec2( unC, sideC + bidC * 5.0 ) ) );
                  diffuseColor.rgb = mix( baseC * 0.85, vec3( 0.08, 0.09, 0.11 ), dC2 );
                  totalEmissiveRadiance += vec3( 1.0, 0.92, 0.75 ) * dC2 * 0.5;
                } else {
                  float railC = step( fyC, 0.4 );
                  diffuseColor.rgb = mix( baseC * 0.45, baseC * 1.1, railC );
                  diffuseColor.rgb *= mix( 1.0, strC( uC, 16.0, 0.3, dC ) * 0.3 + 0.78, railC * step( 0.12, fyC ) );   // balcony railing bars
                  diffuseColor.rgb = mix( diffuseColor.rgb, baseC * 0.9, clamp( step( uxC, 0.04 ) + step( 0.96, uxC ), 0.0, 1.0 ) );
                  float wC = ( 1.0 - railC ) * step( 0.12, uxC ) * step( uxC, 0.7 ) * step( fyC, 0.92 );
                  float paneC = 1.0 - 0.75 * step( abs( uxC - 0.41 ), 0.012 );
                  float litC = step( 0.6, rC );
                  float curC = mix( 1.0, 0.45 + 0.3 * strC( uC, 22.0, 0.5, dC ), step( 0.5, fract( rC * 7.0 ) ) * step( uxC, 0.41 ) );   // a curtain half drawn
                  totalEmissiveRadiance += mix( vec3( 1.0, 0.76, 0.46 ), vec3( 0.72, 0.86, 1.0 ), step( 0.9, rC ) ) * wC * litC * 0.5 * paneC * curC;
                  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05, 0.06, 0.08 ), wC * ( 1.0 - litC ) );
                  float acC = railC * step( 0.74, uxC ) * step( uxC, 0.9 ) * step( 0.1, fyC ) * step( fyC, 0.34 ) * step( 0.3, rC );
                  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.5, 0.52, 0.55 ), acC );
                }
              } else if ( vSty < 3.5 ) {
                float bxC = fract( uC / 0.9 ), bayC = floor( uC / 0.9 );
                if ( flC < 0.5 ) {
                  float rC = hsC( vec2( bayC, sideC + bidC * 97.0 ) );
                  float gC = step( 0.07, bxC ) * step( bxC, 0.93 ) * step( 0.05, fyC ) * step( fyC, 0.74 );
                  float openC = step( 0.28, rC );
                  vec3 lightC = mix( vec3( 1.0, 0.84, 0.58 ), vec3( 0.76, 0.9, 1.0 ), step( 0.72, rC ) );
                  float frameC = 1.0 - 0.8 * clamp( step( abs( bxC - 0.5 ), 0.012 ) + step( abs( fyC - 0.56 ), 0.012 ), 0.0, 1.0 );   // door frame and a bar across
                  float goodsC = 0.55 + 0.45 * strC( yC, 9.0, 0.5, dC ) * strC( uC, 7.0, 0.45, dC );   // shelves of goods inside
                  vec3 shutC = vec3( 0.3, 0.31, 0.34 ) * ( 0.75 + 0.25 * strC( yC, 40.0, 0.5, dC ) );
                  diffuseColor.rgb = mix( baseC * 0.7, mix( shutC, vec3( 0.1, 0.09, 0.08 ), openC ), gC );
                  totalEmissiveRadiance += lightC * gC * openC * goodsC * frameC * 0.62;
                  float clothC = step( 0.74, fyC ) * step( fyC, 0.92 ) * step( 0.04, bxC ) * step( bxC, 0.96 ) * step( 0.5, rC );
                  vec3 awnC = mix( vec3( 0.55, 0.1, 0.1 ), vec3( 0.1, 0.2, 0.45 ), step( 0.75, rC ) ) * ( 0.75 + 0.45 * strC( uC, 9.0, 0.5, dC ) );
                  diffuseColor.rgb = mix( diffuseColor.rgb, awnC, clothC );
                  totalEmissiveRadiance *= 1.0 - clothC;
                } else {
                  float rC = hsC( vec2( flC * 7.0 + bayC, sideC + bidC * 31.0 ) );
                  float hueC = hsC( vec2( flC, sideC * 3.0 + bidC * 57.0 ) );
                  vec3 sgnC = hueC < 0.22 ? vec3( 1.0, 0.24, 0.6 ) : hueC < 0.44 ? vec3( 0.2, 0.88, 1.0 ) : hueC < 0.64 ? vec3( 1.0, 0.69, 0.18 ) : hueC < 0.8 ? vec3( 0.3, 1.0, 0.48 ) : vec3( 0.95, 0.96, 1.0 );
                  float hasC = step( 0.3, hsC( vec2( flC + 3.0, bidC * 91.0 + sideC ) ) );
                  float bandC = step( fyC, 0.27 ) * step( 0.03, fyC );
                  float chC = step( 0.42, hsC( vec2( floor( uC * 5.5 ), flC + sideC ) ) ) * step( 0.08, fyC ) * step( fyC, 0.22 ) * step( 0.12, fract( uC * 5.5 ) );
                  diffuseColor.rgb = mix( baseC, vec3( 0.07, 0.07, 0.09 ), bandC );
                  // most signs burn steadily; some blink, some have a gap that runs along them, a few have a failing tube
                  float blC = hsC( vec2( flC + 11.0, bidC * 53.0 + sideC ) );
                  float onC = blC < 0.1 ? step( -0.2, sin( uTime * 2.2 + blC * 90.0 ) ) : blC < 0.2 ? 0.25 + 0.75 * step( 0.22, fract( uC * 0.9 - uTime * 0.8 ) ) : blC < 0.24 ? 0.15 + 0.85 * step( 0.12, fract( sin( floor( uTime * 9.0 ) + blC * 40.0 ) * 43758.5 ) ) : 1.0;
                  totalEmissiveRadiance += sgnC * bandC * hasC * ( 0.16 + 0.8 * chC ) * onC;
                  float wC = step( 0.36, fyC ) * step( fyC, 0.9 ) * step( 0.1, bxC ) * step( bxC, 0.9 );
                  float paneC = 1.0 - 0.8 * clamp( step( abs( bxC - 0.5 ), 0.014 ) + step( abs( bxC - 0.3 ), 0.01 ) + step( abs( bxC - 0.7 ), 0.01 ), 0.0, 1.0 );
                  float litC = step( 0.45, rC );
                  float blindC = mix( 1.0, 0.5 + 0.4 * strC( yC, 30.0, 0.5, dC ), step( 0.6, fract( rC * 5.0 ) ) );
                  vec3 wcC = mix( vec3( 1.0, 0.8, 0.5 ), mix( vec3( 1.0, 0.4, 0.7 ), vec3( 0.5, 0.8, 1.0 ), step( 0.5, hsC( vec2( bayC, flC ) ) ) ), step( 0.78, rC ) );
                  totalEmissiveRadiance += wcC * wC * litC * 0.5 * paneC * blindC;
                  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05, 0.06, 0.09 ), wC * ( 1.0 - litC ) );
                }
              } else if ( vSty < 4.5 ) {
                vec3 woodC = vec3( 0.2, 0.13, 0.09 ), plasC = vec3( 0.6, 0.56, 0.48 );
                float bxC = fract( uC / 0.8 ), bayC = floor( uC / 0.8 );
                if ( yC < FLC ) {
                  float slatC = strC( uC, 14.0, 0.5, dC );
                  float rC = hsC( vec2( bayC, sideC + bidC * 29.0 ) );
                  float shC = step( 0.1, bxC ) * step( bxC, 0.9 ) * step( 0.12, fyC ) * step( fyC, 0.8 );
                  diffuseColor.rgb = woodC * ( 0.7 + 0.5 * slatC );
                  totalEmissiveRadiance += vec3( 1.0, 0.72, 0.38 ) * shC * step( 0.45, rC ) * ( 0.14 + 0.36 * slatC );
                  float norC = step( 0.6, fyC ) * step( fyC, 0.82 ) * step( 0.16, bxC ) * step( bxC, 0.84 ) * step( 0.78, rC );
                  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.1, 0.15, 0.4 ) * ( 0.8 + 0.6 * step( 0.72, fract( uC * 5.0 ) ) ), norC );
                  totalEmissiveRadiance *= 1.0 - norC;
                } else {
                  float beamC = clamp( step( bxC, 0.07 ) + step( abs( yC - FLC ), 0.035 ) + step( vBh - 0.06, yC ), 0.0, 1.0 );
                  float wC = step( 0.25, bxC ) * step( bxC, 0.75 ) * step( FLC + 0.13, yC ) * step( yC, FLC + 0.4 );
                  float litC = step( 0.55, hsC( vec2( bayC, 5.0 + sideC + bidC * 11.0 ) ) );
                  diffuseColor.rgb = mix( plasC * 0.7, woodC, beamC );
                  diffuseColor.rgb = mix( diffuseColor.rgb, woodC * 0.5, wC * ( 1.0 - litC ) );
                  totalEmissiveRadiance += vec3( 1.0, 0.75, 0.42 ) * wC * litC * ( 0.22 + 0.28 * strC( uC, 12.0, 0.5, dC ) );
                }
              } else if ( vSty < 5.5 ) {
                float mulC = step( 0.04, fract( uC / 0.6 ) );
                float gC = step( 0.05, yC ) * step( yC, 0.46 ) * mulC;
                float fasC = step( 0.5, yC ) * step( yC, 0.66 );
                diffuseColor.rgb = mix( baseC, vec3( 0.9 ), gC );
                totalEmissiveRadiance += vec3( 0.95, 0.98, 1.0 ) * gC * ( 0.45 + 0.25 * strC( yC, 9.0, 0.5, dC ) );
                vec3 stripeC = yC < 0.553 ? vec3( 0.2, 0.75, 0.35 ) : yC < 0.607 ? vec3( 0.95 ) : vec3( 0.2, 0.45, 0.95 );
                diffuseColor.rgb = mix( diffuseColor.rgb, stripeC, fasC );
                totalEmissiveRadiance += stripeC * fasC * 0.6;
              } else {
                float corC = 0.8 + 0.2 * strC( uC, 9.0, 0.5, dC );
                float dxC = fract( uC / 2.4 );
                float doorC = step( 0.2, dxC ) * step( dxC, 0.62 ) * step( yC, 0.5 );
                diffuseColor.rgb = mix( baseC * corC, baseC * 0.45 * ( 0.8 + 0.2 * strC( yC, 18.0, 0.5, dC ) ), doorC );
                float lampC = step( abs( dxC - 0.41 ), 0.035 ) * step( 0.54, yC ) * step( yC, 0.6 );
                totalEmissiveRadiance += vec3( 1.0, 0.85, 0.55 ) * lampC * 1.2;
              }
              diffuseColor.rgb *= 1.0 - 0.3 * step( vBh - 0.06, yC ) * step( vSty, 3.5 );`;

export function makeBuildingMaterial(U, windows) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uCut = U.uCut; sh.uniforms.uRes = U.uRes; sh.uniforms.uTime = U.uTime || { value: 0 }; sh.uniforms.uPower = U.uPower || { value: 1 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSty;\nvarying vec3 vWPos;\nvarying vec3 vONormal;\nvarying float vDepthC;\nvarying vec4 vRoof;\nvarying float vSty;\nvarying float vBh;\nvarying float vBid;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wpC = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          wpC = instanceMatrix * wpC;
          vec2 scC = vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
          vRoof = vec4( position.x * scC.x, position.z * scC.y, scC );
          vSty = aSty; vBh = length( instanceMatrix[ 1 ].xyz );
          vBid = floor( fract( sin( dot( instanceMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 251.0 );   // a whole number, so it survives being passed across the face
        #else
          vRoof = vec4( 0.0, 0.0, 1000.0, 1000.0 );
          vSty = 0.0; vBh = 1.0; vBid = 0.0;
        #endif
        vWPos = ( modelMatrix * wpC ).xyz;
        vONormal = normal;
        vDepthC = - mvPosition.z;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vONormal;\nvarying float vDepthC;\nvarying vec4 vRoof;\nvarying float vSty;\nvarying float vBh;\nvarying float vBid;\nuniform vec3 uCut;\nuniform vec2 uRes;\nuniform float uTime;\nuniform float uPower;\nfloat hsC( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }\nfloat lodC( float freq, float depth ) { return clamp( 2.0 - depth * freq / 70.0, 0.0, 1.0 ); }\nfloat strC( float x, float freq, float duty, float depth ) { return mix( 1.0 - duty, step( duty, fract( x * freq ) ), lodC( freq, depth ) ); }')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 spC = gl_FragCoord.xy / uRes;
          float cdC = length( ( spC - uCut.xy ) * vec2( uRes.x / uRes.y, 1.0 ) );
          if ( vDepthC < uCut.z - 0.2 && cdC < 0.15 ) {
            if ( cdC < 0.105 || mod( floor( gl_FragCoord.x ) + floor( gl_FragCoord.y ), 2.0 ) < 0.5 ) discard;
          }
          if ( vONormal.y > 0.5 ) {
            // flat roofs: patchy slabs with seams, a parapet round the edge, now and then a lit skylight
            float eC = min( vRoof.z * 0.5 - abs( vRoof.x ), vRoof.w * 0.5 - abs( vRoof.y ) );
            vec3 wallC = diffuseColor.rgb;
            vec3 roofC = wallC * 0.42 + vec3( 0.02, 0.022, 0.03 );
            vec2 rgC = vWPos.xz * 1.1; vec2 ridC = floor( rgC ); vec2 rfC = fract( rgC );
            float rhC = fract( sin( dot( ridC, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
            float farC = clamp( ( vDepthC - 14.0 ) / 14.0, 0.0, 1.0 );   // detail fades with distance so it never shimmers
            roofC *= mix( 0.8 + 0.4 * rhC, 1.0, farC );
            roofC *= 1.0 - 0.22 * ( 1.0 - farC ) * max( step( rfC.x, 0.07 ), step( rfC.y, 0.07 ) );
            float rimC = step( eC, 0.1 );
            roofC *= 1.0 - 0.45 * ( 1.0 - rimC ) * ( 1.0 - smoothstep( 0.1, 0.3, eC ) );
            roofC = mix( roofC, wallC * 0.78 + vec3( 0.03 ), rimC );
            float skyC = step( 0.955, rhC ) * step( 0.55, eC ) * step( 0.25, rfC.x ) * step( rfC.x, 0.75 ) * step( 0.3, rfC.y ) * step( rfC.y, 0.7 );
            totalEmissiveRadiance += vec3( 1.0, 0.8, 0.5 ) * skyC * 0.55 * step( vSty, 3.5 );
            diffuseColor.rgb = roofC;
            if ( vSty > 3.5 && vSty < 4.5 ) diffuseColor.rgb = vec3( 0.15, 0.16, 0.19 ) * ( 0.8 + 0.3 * step( 0.5, fract( vWPos.x * 5.0 ) ) );
          }
          else if ( abs( vONormal.y ) < 0.5 ) {
            float uC = abs( vONormal.x ) > 0.5 ? vWPos.z : vWPos.x;
            float sideC = abs( vONormal.x ) > 0.5 ? floor( vWPos.x * 2.0 + 0.5 ) : floor( vWPos.z * 2.0 + 0.5 ) + 31.0;
            if ( vSty > 0.5 ) {
${FRONTS}
            }
            ${windows ? `else {
            vec2 gC = vec2( uC * 3.1, vWPos.y * 3.4 );
            vec2 idC = floor( gC ); vec2 fC = fract( gC );
            float hC = fract( sin( dot( idC + sideC * 0.37, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
            float winC = step( 0.22, fC.x ) * step( fC.x, 0.78 ) * step( 0.3, fC.y ) * step( fC.y, 0.8 ) * step( 0.34, vWPos.y );
            float litC = step( 0.84, hC );
            vec3 wcolC = mix( vec3( 1.0, 0.74, 0.38 ), vec3( 0.7, 0.84, 1.0 ), step( 0.965, hC ) );
            totalEmissiveRadiance += wcolC * winC * litC * 0.95;
            diffuseColor.rgb *= 1.0 - 0.35 * winC * ( 1.0 - litC );
            // ground floor: a band of shop shutters, a few of them lit
            float shopC = step( vWPos.y, 0.3 ) * step( 0.04, vWPos.y );
            float sgC = fract( uC * 1.15 ); float shC = fract( sin( floor( uC * 1.15 ) * 91.7 + sideC ) * 4375.85 );
            float doorC = shopC * step( 0.1, sgC ) * step( sgC, 0.9 );
            diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 0.55 + 0.25 * step( 0.5, fract( vWPos.y * 22.0 ) ) ), doorC );
            totalEmissiveRadiance += vec3( 1.0, 0.82, 0.5 ) * doorC * step( 0.9, shC ) * 0.4;
            }` : ''}
          }
          totalEmissiveRadiance *= uPower;   // a power cut puts the windows and shop lights out
        }`);
  };
  mat.customProgramCacheKey = () => 'bldg8' + (windows ? 1 : 0);
  return mat;
}

// ---------------------------------------------------------------- scene
export function buildScene(scene, map, W, U, quality) {
  const H = { siteVis: [], escVis: [], leverVis: [], hideVis: [], cutMat: null };
  const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
  const bas = (color, extra) => new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {}));
  const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); (parent || scene).add(m); return m; };
  const cyl = (rt, rb, h, seg, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); (parent || scene).add(m); return m; };
  const cutMat = c => { const m = makeBuildingMaterial(U, false); m.color.setHex(c); return m; };
  H.cutMat = cutMat;
  H.cutMat = cutMat;

  // ground: wet tarmac that picks up headlights and sirens
  const maps = paintGround(quality.ground, map, W);
  const tex = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = quality.aniso; return t; };
  const gmat = quality.wet
    ? new THREE.MeshStandardMaterial({ map: tex(maps.alb, true), emissiveMap: tex(maps.emi, true), emissive: 0xffffff, emissiveIntensity: 2.1, roughnessMap: tex(maps.rgh, false), roughness: 1, metalness: 0.0 })
    : new THREE.MeshLambertMaterial({ map: tex(maps.alb, true), emissiveMap: tex(maps.emi, true), emissive: 0xffffff, emissiveIntensity: 2.1 });
  gmat.color.setRGB(1.62, 1.55, 1.48);   // the painted tarmac is dark; lift it so moonlight and headlights read on it
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), gmat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(50, 0, 50); scene.add(ground);
  H.ground = ground;
  const under = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), bas(0x04060b)); under.rotation.x = -Math.PI / 2; under.position.set(50, -0.05, 50); scene.add(under);

  // buildings
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  for (const win of [1, 0]) {
    const list = W.boxes.filter(b => !!b.win === !!win);
    const geo = unit.clone(), sty = new Float32Array(Math.max(1, list.length));
    const im = new THREE.InstancedMesh(geo, makeBuildingMaterial(U, !!win), list.length);
    list.forEach((b, k) => {
      dummy.position.set(b.x + b.w / 2, b.h / 2, b.y + b.d / 2); dummy.scale.set(b.w, b.h, b.d); dummy.updateMatrix();
      im.setMatrixAt(k, dummy.matrix); im.setColorAt(k, col.setHex(b.c)); sty[k] = b.fs || 0;
    });
    geo.setAttribute('aSty', new THREE.InstancedBufferAttribute(sty, 1));
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false; scene.add(im);
  }

  // old wooden houses get a tiled roof with a ridge along the longer side
  const gables = W.boxes.filter(b => b.gable);
  if (gables.length) {
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
      0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
      -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5], 3));
    pg.computeVertexNormals();
    const rim = new THREE.InstancedMesh(pg, makeTileMaterial(U), gables.length);
    gables.forEach((b, k) => {
      const alongX = b.w >= b.d, span = alongX ? b.d : b.w, len = alongX ? b.w : b.d, rise = Math.min(0.7, 0.42 * span);
      dummy.position.set(b.x + b.w / 2, b.h, b.y + b.d / 2); dummy.rotation.set(0, alongX ? Math.PI / 2 : 0, 0); dummy.scale.set(span + 0.26, rise, len + 0.14); dummy.updateMatrix();
      rim.setMatrixAt(k, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
    rim.instanceMatrix.needsUpdate = true; rim.frustumCulled = false; scene.add(rim);
  }

  // landmark footprints: merge marked cells into boxes
  const cellBoxes = (r, hFn, mat) => {
    const i0 = Math.floor(r.x0 / CS), i1 = Math.ceil(r.x1 / CS), j0 = Math.floor(r.y0 / CS), j1 = Math.ceil(r.y1 / CS);
    const parts = [];
    for (let j = j0; j < j1; j++) {
      let run = -1;
      for (let i = i0; i <= i1; i++) {
        const on = i < i1 && W.type[j * N + i] === T.MARK && (i + 0.5) * CS >= r.x0 && (i + 0.5) * CS <= r.x1 && (j + 0.5) * CS >= r.y0 && (j + 0.5) * CS <= r.y1;
        if (on && run < 0) run = i;
        if (!on && run >= 0) { const w = (i - run) * CS, h = hFn(run, j); parts.push([w, h, CS, run * CS + w / 2, h / 2, j * CS + CS / 2]); run = -1; }
      }
    }
    if (parts.length) scene.add(new THREE.Mesh(mergeBoxes(parts), mat));   // one mesh per footprint
  };
  const M = W.marks, LY = W.layout, th = M.thana;
  // police station and its impound yard
  cellBoxes(th, () => 1.5, cutMat(LY.thanaColor || 0x8d7d55));
  box(th.x1 - th.x0 + 0.1, 0.18, th.y1 - th.y0 + 0.1, bas(0x3d6ae0), (th.x0 + th.x1) / 2, 1.2, (th.y0 + th.y1) / 2);
  const thanaLamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), bas(0x8fb4ff)); thanaLamp.position.set(th.x0 + 0.1, 1.75, th.y1 - 0.1); scene.add(thanaLamp);
  const tl = makeLabel(LY.thanaName || 'POLICE', { color: '#9dbcff', h: 0.46 }); tl.position.set((th.x0 + th.x1) / 2 - 2.5, 2.6, (th.y0 + th.y1) / 2 + 1.25); scene.add(tl);
  const barMat = bas(0xaab4c8);
  const cg = W.cage, bars = [];
  for (let x = cg.x0; x <= cg.x1 + 0.01; x += 0.35) { bars.push([x, cg.y0]); bars.push([x, cg.y1]); }
  for (let y = cg.y0 + 0.35; y < cg.y1; y += 0.35) { bars.push([cg.x0, y]); bars.push([cg.x1, y]); }
  const barIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), barMat, bars.length);
  bars.forEach((b, k) => { dummy.position.set(b[0], 0.35, b[1]); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); barIM.setMatrixAt(k, dummy.matrix); });
  scene.add(barIM);
  box(cg.x1 - cg.x0 + 0.1, 0.06, 0.06, barMat, (cg.x0 + cg.x1) / 2, 0.7, cg.y0); box(cg.x1 - cg.x0 + 0.1, 0.06, 0.06, barMat, (cg.x0 + cg.x1) / 2, 0.7, cg.y1);
  box(0.06, 0.06, cg.y1 - cg.y0, barMat, cg.x0, 0.7, (cg.y0 + cg.y1) / 2); box(0.06, 0.06, cg.y1 - cg.y0, barMat, cg.x1, 0.7, (cg.y0 + cg.y1) / 2);
  const jl = makeLabel('IMPOUND', { color: '#c9d4ee', h: 0.4 }); jl.position.set((cg.x0 + cg.x1) / 2, 1.4, (cg.y0 + cg.y1) / 2); scene.add(jl);
  if (LY.id === 'jugnupur') {
  // clock tower
  const stone = cutMat(0x8a8272);
  box(1, 4.6, 1, stone, 50, 2.3, 50); box(1.25, 0.2, 1.25, stone, 50, 3.4, 50);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.9, 4), cutMat(0x5a4038)); roof.position.set(50, 5.05, 50); roof.rotation.y = Math.PI / 4; scene.add(roof);
  const face = bas(0xfff2b4);
  for (const [dx, dz, ry] of [[0, 0.51, 0], [0, -0.51, Math.PI], [0.51, 0, Math.PI / 2], [-0.51, 0, -Math.PI / 2]]) { const f = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), face); f.position.set(50 + dx, 4.0, 50 + dz); f.rotation.y = ry; scene.add(f); }
  const cl = makeLabel('Ghanta Ghar', { color: '#fff2b4', h: 0.42 }); cl.position.set(50, 5.9, 50); scene.add(cl);
  // station, water tower, chimney, mandir, talkies, ruin, scrap
  cellBoxes(M.station, () => 1.25, cutMat(0x93804c));
  box(4.2, 0.3, 0.1, bas(0xffe2a0), 46, 1.1, 7.66);
  const sl = makeLabel('Jugnupur Station', { color: '#ffe2a0', h: 0.5 }); sl.position.set(46, 2.2, 6.5); scene.add(sl);
  cellBoxes(M.tank, () => 0.3, cutMat(0x555a66));
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) box(0.08, 2.4, 0.08, lam(0x6c7280), 10 + dx, 1.2, 6 + dz);
  cyl(0.55, 0.55, 0.8, 12, lam(0x7a8496), 10, 2.8, 6); box(0.9, 0.12, 0.12, bas(0xffe27a), 10, 3.35, 6);
  cellBoxes(M.chimney, () => 0.5, cutMat(0x6a4a40));
  cyl(0.3, 0.48, 6, 10, cutMat(0x8a5444), 5, 3, 46); box(0.3, 0.3, 0.3, bas(0xffa860), 5, 6.2, 46);
  const ml = makeLabel('Mill', { color: '#ffb880', h: 0.45 }); ml.position.set(5, 7, 46); scene.add(ml);
  cellBoxes(M.mandir, () => 0.7, cutMat(0xd8cfc0));
  box(1.0, 0.5, 1.0, lam(0xe2d8c8), 54, 0.95, 93); const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 8), lam(0xe8a05a)); spire.position.set(54, 1.85, 93); scene.add(spire);
  for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [0, -0.95]]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), bas(0xffc860)); d.position.set(54 + dx, 0.78, 93 + dz); scene.add(d); }
  cellBoxes(M.talkies, () => 1.5, cutMat(0x7c3350));
  box(6.6, 0.42, 0.25, bas(0xff5fa0), 42, 1.75, 51.75);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 5), bas(0xfff0a0), 14);
  for (let k = 0; k < 14; k++) { dummy.position.set(38.9 + k * 0.48, 2.02, 51.6); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bulbs.setMatrixAt(k, dummy.matrix); } scene.add(bulbs);
  const tk = makeLabel('TIMTIM TALKIES', { color: '#ffb3d1', h: 0.42 }); tk.position.set(42, 2.6, 51.8); scene.add(tk);
  cellBoxes(M.ruin, (i, j) => 0.3 + hash2(i, j) * 1.3, cutMat(0x7d7466));
  box(0.9, 2.8, 0.9, cutMat(0x6f685c), 90.0, 1.4, 9.9); box(0.25, 0.25, 0.25, bas(0xf2f6ff), 90.0, 2.95, 9.9);
  cellBoxes(M.scrap, (i, j) => 0.2 + hash2(i * 3, j * 5) * 0.6, cutMat(0x6a665e));
  box(0.14, 3.2, 0.14, lam(0x8a6a2a), 14.2, 1.6, 86.2); box(2.4, 0.12, 0.12, lam(0x8a6a2a), 13.2, 3.1, 86.2); box(0.26, 0.26, 0.26, bas(0xffa860), 14.2, 3.35, 86.2);
  // Tota Darwaza: the old gate over the ring road
  const sand = cutMat(0xa5845a);
  box(0.7, 2.5, 0.7, sand, 29, 1.25, 20.0); box(0.7, 2.5, 0.7, sand, 29, 1.25, 24.0); box(0.8, 0.55, 4.7, sand, 29, 2.7, 22);
  box(0.84, 0.12, 4.74, bas(0x49c46a), 29, 2.36, 22);
  const gl = makeLabel('Tota Darwaza', { color: '#b8f2c6', h: 0.45 }); gl.position.set(29, 3.6, 22); scene.add(gl);
  } else {
    // landmarks described in the map file
    const hexCss = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
    const tag = (text, x, y, z, col, h) => { if (!text) return; const lb = makeLabel(text, { color: col || '#e8ecff', h: h || 0.44 }); lb.position.set(x, y, z); scene.add(lb); };
    for (const q of (LY.landmarks || [])) {
      if (q.type === 'block') {            // a solid building on a marked footprint, with an optional glowing band and name
        const r = M[q.mark]; if (!r) continue;
        const cx = (r.x0 + r.x1) / 2, cz = (r.y0 + r.y1) / 2, w = r.x1 - r.x0, d = r.y1 - r.y0;
        cellBoxes(r, () => q.h, cutMat(q.color));
        if (q.band != null) box(w + 0.08, q.bandH || 0.2, d + 0.08, bas(q.band), cx, q.bandY != null ? q.bandY : q.h * 0.72, cz);
        if (q.roof != null) box(w + 0.5, 0.14, d + 0.5, cutMat(q.roof), cx, q.h + 0.07, cz);
        tag(q.label, cx, q.h + 0.9, cz, q.labelColor, q.labelH);
      } else if (q.type === 'tower') {     // a tall lattice broadcasting tower with lit decks and a beacon
        const r = M[q.mark]; if (r) cellBoxes(r, () => 0.4, cutMat(0x54575f));
        const h = q.h || 9, mat = cutMat(q.color || 0xd8452e), white = cutMat(0xe8e2d6);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.95, h, 4, 6, true), mat); body.material.side = THREE.DoubleSide; body.position.set(q.x, h / 2 + 0.3, q.y); body.rotation.y = Math.PI / 4; scene.add(body);
        for (const f of [0.34, 0.62]) { const rr = 0.95 - 0.85 * f; box(rr * 1.9, 0.26, rr * 1.9, white, q.x, 0.3 + h * f, q.y); box(rr * 1.95, 0.08, rr * 1.95, bas(0xffe9b0), q.x, 0.3 + h * f - 0.16, q.y); }
        box(0.06, 1.6, 0.06, white, q.x, h + 1.1, q.y);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), bas(0xff5a4a)); beacon.position.set(q.x, h + 1.95, q.y); scene.add(beacon);
        tag(q.label, q.x, h + 2.7, q.y, q.labelColor || '#ffb0a0', 0.5);
      } else if (q.type === 'torii') {     // a shrine gate standing over a lane: nothing solid in the road
        const hw = (q.w || 2.4) / 2, mat = cutMat(q.color || 0xc8352b), alongX = q.dir === 'x';
        for (const sd of [-1, 1]) cyl(0.11, 0.13, 2.2, 8, mat, q.x + (alongX ? 0 : sd * hw), 1.1, q.y + (alongX ? sd * hw : 0));
        box(alongX ? 0.22 : hw * 2 + 0.9, 0.16, alongX ? hw * 2 + 0.9 : 0.22, mat, q.x, 2.28, q.y);
        box(alongX ? 0.26 : hw * 2 + 1.2, 0.1, alongX ? hw * 2 + 1.2 : 0.26, cutMat(0x2a2422), q.x, 2.41, q.y);
        box(alongX ? 0.14 : hw * 2 + 0.3, 0.12, alongX ? hw * 2 + 0.3 : 0.14, mat, q.x, 1.86, q.y);
        tag(q.label, q.x, 3.2, q.y, q.labelColor || '#ffc0b0', 0.42);
      } else if (q.type === 'pagoda') {    // stacked storeys, each under a wide dark roof
        const r = M[q.mark]; if (r) cellBoxes(r, () => 0.25, cutMat(0x6a665e));
        const tiers = q.tiers || 4, wall = cutMat(q.color || 0xb8442e), roofM = cutMat(0x2b2a30);
        let y = 0.25, wd = q.w || 1.7;
        for (let k = 0; k < tiers; k++) {
          box(wd, 0.62, wd, wall, q.x, y + 0.31, q.y); y += 0.62;
          const rf = new THREE.Mesh(new THREE.CylinderGeometry(wd * 0.5, wd * 0.98, 0.3, 4), roofM); rf.position.set(q.x, y + 0.15, q.y); rf.rotation.y = Math.PI / 4; scene.add(rf); y += 0.3;
          box(wd * 0.5, 0.06, 0.05, bas(0xffd9a0), q.x, y - 0.62, q.y + wd / 2 + 0.03);
          wd *= 0.8;
        }
        box(0.05, 0.9, 0.05, lam(0xc9a24a), q.x, y + 0.45, q.y);
        tag(q.label, q.x, y + 1.5, q.y, q.labelColor || '#ffd9a0', 0.44);
      } else if (q.type === 'screen') {    // a big video screen on a wall or a roof
        const m = box(q.w, q.h, 0.08, bas(q.color), q.x, q.y0 + q.h / 2, q.y); m.rotation.y = q.ry || 0;
        const fr = box(q.w + 0.16, q.h + 0.16, 0.05, lam(0x15171d), q.x - Math.sin(q.ry || 0) * 0.04, q.y0 + q.h / 2, q.y - Math.cos(q.ry || 0) * 0.04); fr.rotation.y = q.ry || 0;
        if (q.color2 != null) { const st = box(q.w * 0.86, q.h * 0.22, 0.1, bas(q.color2), q.x, q.y0 + q.h * 0.3, q.y); st.rotation.y = q.ry || 0; }
      } else if (q.type === 'lanterns') {  // a string of paper lanterns along a lane
        const n = q.n || 10, im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), bas(q.color || 0xff5a3a), n);
        for (let k = 0; k < n; k++) { const f = (k + 0.5) / n; dummy.position.set(q.x0 + (q.x1 - q.x0) * f, (q.h || 1.15) - Math.sin(f * Math.PI) * 0.12, q.y0 + (q.y1 - q.y0) * f); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1.25, 1); dummy.updateMatrix(); im.setMatrixAt(k, dummy.matrix); }
        im.frustumCulled = false; scene.add(im);
      } else if (q.type === 'label') tag(q.text, q.x, q.h || 2, q.y, q.color, q.size);
    }
  }
  // buses, wagon, mail coach
  const parked = [];
  for (const p of W.solidProps) {
    const w = p.x1 - p.x0, d = p.y1 - p.y0, cx = (p.x0 + p.x1) / 2, cz = (p.y0 + p.y1) / 2;
    if (p.kind === 'bus') { box(w, 0.62, d, cutMat(p.c), cx, 0.39, cz); box(w * 0.92, 0.18, d + 0.02, bas(0x6f8796), cx, 0.5, cz); box(w * 0.96, 0.05, d * 0.9, lam(0xdedede), cx, 0.72, cz); }
    else if (p.kind === 'wagon') { box(w, 0.42, d, cutMat(p.c), cx, 0.33, cz); box(w * 0.94, 0.06, d * 0.8, lam(0x2a1a12), cx, 0.5, cz); }
    else if (p.kind === 'van') { box(w, 0.6, d, cutMat(p.c), cx, 0.4, cz); box(w * 0.3, 0.24, d + 0.02, bas(0x9fc4d8), cx + w * 0.3, 0.52, cz); box(w * 0.5, 0.1, d + 0.03, bas(0xf3b43f), cx - w * 0.15, 0.36, cz); }
    else if (p.kind === 'car') { // a parked car, kept simple: all of them together are one mesh
      const ry = (w >= d ? Math.PI / 2 : 0) + (p.flip ? Math.PI : 0), cs = Math.cos(ry), sn = Math.sin(ry);
      const part = (bw, bh, bd, ox, y, oz, c) => parked.push([bw, bh, bd, cx + ox * cs + oz * sn, y, cz - ox * sn + oz * cs, ry, c]);
      part(0.38, 0.13, 0.84, 0, 0.13, 0, p.c); part(0.33, 0.11, 0.42, 0, 0.25, -0.04, p.c); part(0.335, 0.07, 0.43, 0, 0.255, -0.04, 0x12161c);
      for (const sx of [-0.19, 0.19]) for (const sz of [-0.26, 0.26]) part(0.06, 0.12, 0.16, sx, 0.06, sz, 0x101114);
      part(0.3, 0.03, 0.02, 0, 0.15, -0.42, 0x7a1010); part(0.3, 0.03, 0.02, 0, 0.15, 0.42, 0xd8d2b8);
    }
    else if (p.kind === 'crate') { box(w, p.h || 0.55, d, cutMat(p.c), cx, (p.h || 0.55) / 2, cz); }
    else { box(w, 0.7, d, cutMat(p.c), cx, 0.45, cz); box(w * 0.9, 0.16, d + 0.02, bas(0xffe9a8), cx, 0.55, cz); }
  }
  if (parked.length) scene.add(new THREE.Mesh(mergeBoxes(parked), lam(0xffffff, { vertexColors: true })));
  const boat = W.escapes.find(e => /Naav/.test(e.name));
  if (boat) { const b = box(1.9, 0.22, 0.7, lam(0x6a4a30), boat.x + 0.2, 0.08, boat.y + 1.75); b.rotation.y = 0.15; box(0.05, 0.9, 0.05, lam(0x554433), boat.x + 0.2, 0.5, boat.y + 1.75); box(0.14, 0.14, 0.14, bas(0x7dffa8), boat.x + 0.2, 1.0, boat.y + 1.75); }

  // park trees
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 0.6, 6), lam(0x4a3626), W.trees.length);
  const TR = W.layout.trees || {};   // a map may ask for round blossom trees instead of dark conifers
  const crowns = new THREE.InstancedMesh(TR.round ? new THREE.IcosahedronGeometry(0.78, 1) : new THREE.ConeGeometry(0.62, 1.5, 7), cutMat(TR.color != null ? TR.color : 0x1e5a32), W.trees.length);
  W.trees.forEach((t, k) => {
    dummy.position.set(t.x, 0.3, t.y); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); trunks.setMatrixAt(k, dummy.matrix);
    dummy.position.set(t.x, 0.6 + 0.75 * t.s, t.y); dummy.scale.set(t.s, t.s, t.s); dummy.updateMatrix(); crowns.setMatrixAt(k, dummy.matrix);
  });
  crowns.frustumCulled = trunks.frustumCulled = false; scene.add(trunks); scene.add(crowns);

  // street lamps: post, arm over the road, bulb, and a faint cone of light in the damp air
  const posts = W.lamps.filter(p => p.post);
  const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), lam(0x3a4050), posts.length);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), lam(0x3a4050), posts.length);
  const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), posts.length);
  const coneGeo = new THREE.CylinderGeometry(0.06, 0.85, 1.45, 12, 1, true); coneGeo.translate(0, -0.725, 0);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), posts.length);
  posts.forEach((p, k) => {
    dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
    dummy.position.set(p.x, 0.75, p.y); dummy.updateMatrix(); poles.setMatrixAt(k, dummy.matrix);
    dummy.position.set(p.x + p.dx * 0.25, 1.5, p.y + p.dy * 0.25); dummy.rotation.y = Math.atan2(p.dx, p.dy); dummy.updateMatrix(); arms.setMatrixAt(k, dummy.matrix);
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(p.x + p.dx * 0.5, 1.46, p.y + p.dy * 0.5); dummy.updateMatrix(); bulb.setMatrixAt(k, dummy.matrix); cones.setMatrixAt(k, dummy.matrix);
    bulb.setColorAt(k, col.setHex(p.c)); cones.setColorAt(k, col.setHex(p.c));
  });
  bulb.instanceColor.needsUpdate = true; cones.instanceColor.needsUpdate = true;
  poles.frustumCulled = arms.frustumCulled = bulb.frustumCulled = cones.frustumCulled = false; cones.renderOrder = 3;
  scene.add(poles); scene.add(arms); scene.add(bulb); if (quality.cones) scene.add(cones);
  H.cones = cones; H.bulbs = bulb;

  // police posts
  for (const p of W.posts) {
    box(0.6, 0.85, 0.6, lam(0x2c4a9a), p.x - 0.75, 0.42, p.y - 0.75); box(0.7, 0.1, 0.7, lam(0xe8ecf5), p.x - 0.75, 0.9, p.y - 0.75);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bas(0x7fa6ff)); b.position.set(p.x - 0.75, 1.05, p.y - 0.75); scene.add(b);
    const lb = makeLabel(p.name, { color: '#9dbcff', h: 0.4 }); lb.position.set(p.x - 0.75, 1.75, p.y - 0.75); scene.add(lb);
  }

  // places to rob: a floating gold gem in a beam, so a car can park right on the ring
  const beamGeo = new THREE.CylinderGeometry(0.55, 0.55, 3, 14, 1, true); beamGeo.translate(0, 1.5, 0);
  const beamMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const gemGeo = new THREE.OctahedronGeometry(0.22, 0);
  for (const s of W.sites) {
    const sc = s.tier === 3 ? 1.5 : s.tier === 2 ? 1.15 : 0.9;
    const g = new THREE.Group(); g.position.set(s.x, 0, s.y); scene.add(g);
    const gem = new THREE.Mesh(gemGeo, bas(COLORS.loot)); gem.position.y = 0.95; gem.scale.setScalar(sc); g.add(gem);
    const beam = new THREE.Mesh(beamGeo, beamMat(COLORS.loot)); beam.scale.set(sc, 1, sc); g.add(beam);
    const label = makeLabel(`${s.name}  ${map.currency || '₹'}${CFG.VALUE[s.tier] || s.value}`, { color: '#ffd98a', h: s.tier === 3 ? 0.5 : 0.4, border: s.tier === 3 ? 'rgba(243,180,63,0.9)' : null });
    label.position.set(0, 1.75 + sc * 0.2, 0); g.add(label);
    const lock = makeLabel('LOCKED', { color: '#ff9c9c', h: 0.3 }); lock.position.set(0, 1.35, 0); lock.visible = false; g.add(lock);
    H.siteVis.push({ g, gem, beam, label, lock, state: -1, sc, text: '' });
  }
  // Gives a place to rob a new name tag (its worth can change from round to round, and doubles while it is the hot target).
  H.relabelSite = (i, text, hot) => {
    const vz = H.siteVis[i], s = W.sites[i]; if (!vz || vz.text === text) return;
    const old = vz.label, k = LABELS.indexOf(old); if (k >= 0) LABELS.splice(k, 1);
    vz.g.remove(old); if (old.material.map) old.material.map.dispose(); old.material.dispose();
    const label = makeLabel(text, { color: hot ? '#fff3b0' : '#ffd98a', h: (s.tier === 3 ? 0.5 : 0.4) * (hot ? 1.25 : 1), border: (s.tier === 3 || hot) ? 'rgba(243,180,63,0.9)' : null });
    label.position.copy(old.position); label.visible = old.visible; label.userData.far = true; vz.g.add(label);
    vz.label = label; vz.text = text;
  };
  for (const e of W.escapes) {
    const g = new THREE.Group(); g.position.set(e.x, 0, e.y); scene.add(g);
    const beam = new THREE.Mesh(beamGeo, beamMat(COLORS.escape)); beam.scale.set(2.2, 1.25, 2.2); g.add(beam);
    const label = makeLabel(e.name, { color: '#8df0c0', h: 0.46, border: 'rgba(59,201,139,0.8)' }); label.position.set(0, 2.5, 0); g.add(label);
    H.escVis.push({ g, beam, label });
  }
  for (const v of W.levers) {
    const g = new THREE.Group(); g.position.set(v.x, 0, v.y); scene.add(g);
    box(0.16, 0.7, 0.16, lam(0x4a5266), 0, 0.35, 0, g);
    const arm = box(0.06, 0.4, 0.06, lam(0xc8ccd8), 0.12, 0.72, 0, g); arm.rotation.z = -0.7;
    const bulbM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), bas(COLORS.police)); bulbM.position.set(0, 0.86, 0); g.add(bulbM);
    const label = makeLabel('Impound lever', { color: '#9dbcff', h: 0.38 }); label.position.set(0, 1.45, 0); g.add(label);
    H.leverVis.push({ g, bulb: bulbM, arm, label });
  }
  // bollards at the mouths of the tang galis: a small car squeezes through, a jeep does not
  const bolls = [];
  for (const g of W.galis) for (const end of [g.points[0], g.points[g.points.length - 1]]) bolls.push(end);
  const bollIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 8), lam(0xd8c040), bolls.length * 2);
  bolls.forEach((p, k) => { for (const s of [-1, 1]) { const horiz = W.walkable(p.x + 1, p.y) || W.walkable(p.x - 1, p.y); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.position.set(p.x + (horiz ? 0 : s * 0.62), 0.16, p.y + (horiz ? s * 0.62 : 0)); dummy.updateMatrix(); bollIM.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), dummy.matrix); } });
  scene.add(bollIM);

  // hideouts: real places to drive into
  const hctx = { cutMat, makeLabel };
  for (const h of W.hides) {
    const kind = h.grove ? 'grove' : kindFor(h.kind);
    const ho = buildHideout({ kind, w: h.bay.w, d: h.bay.d, seed: h.i * 7 + 3, name: h.given || '' }, hctx);
    ho.setClosed(1);   // every door is shut unless someone is going in or out, so a shut door tells the police nothing
    ho.g.position.set(h.x, 0, h.y); ho.g.rotation.y = h.a; scene.add(ho.g);
    const label = makeLabel(ho.name || kind, { color: '#d9ccff', h: 0.34 }); label.position.set(h.x, 1.35, h.y); scene.add(label);
    h.hkind = kind; h.name = ho.name || kind;
    H.hideVis.push({ ho, label, closed: 1, search: 0 });
  }

  H.thanaLamp = thanaLamp;
  return H;
}

export function setSiteVisual(v, state) { // 0 available, 1 locked, 2 robbed
  if (v.state === state) return;
  v.state = state;
  v.beam.visible = state !== 2; v.label.visible = state !== 2; v.lock.visible = state === 1; v.gem.visible = state !== 2;
  v.beam.material.color.setHex(state === 1 ? COLORS.locked : COLORS.loot);
  v.gem.material.color.setHex(state === 0 ? COLORS.loot : 0x7a5a3a);
}
