// Turns the hand-drawn map (data/map.json) into a drivable grid: which cells a car can use,
// where the buildings stand, where police jeeps may go, hideout bays, plus sight lines and pathfinding.
// No rendering code here, so it can also be run from Node for checks.

export const N = 200;     // cells per side
export const CS = 0.5;    // cell size in map units (2.5 m)
export const T = { WALK: 0, BLDG: 1, WATER: 2, RAIL: 3, CAGE: 4, MARK: 6, PROP: 7 };
export const LANE = { NONE: 0, OPEN: 1, ALLEY: 2, STREET: 3, MAIN: 4, DRAIN: 5, GALI: 6, BAY: 7 };

const HW = { main: 1.5, street: 1.0, alley: 0.8, plank: 0.8, bridge: 1.5, drain: 1.2 };
const LANE_OF = { main: LANE.MAIN, bridge: LANE.MAIN, street: LANE.STREET, alley: LANE.ALLEY, plank: LANE.ALLEY, drain: LANE.DRAIN };
const GALI_HW = 0.75;
const OPEN_ROUTES = new Set(['Ganda Nala Bed', 'Tirpal Surang']);   // every other shortcut is a tang gali: too narrow for a police jeep
const BAY_W = 1.5, BAY_D = 2.0;

export function hash2(i, j) {
  let n = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  const qx = ax + t * dx, qy = ay + t * dy;
  return { d: Math.hypot(px - qx, py - qy), qx, qy, t };
}

const STYLE = {
  kotwali: { h0: 0.8, h1: 1.0, win: 1, max: 8, pal: [0x6a7088, 0x7a7f96, 0x5f667f, 0x857f8c] },
  sarafa: { h0: 0.7, h1: 0.6, win: 1, max: 7, pal: [0x8a6a55, 0x97785a, 0x7a5d4e, 0x9c6f5c] },
  patri: { h0: 0.55, h1: 0.6, win: 1, max: 9, pal: [0x86785a, 0x766b52, 0x91825e, 0x6c6454] },
  afsar: { h0: 0.5, h1: 0.4, win: 1, max: 8, pal: [0x66788f, 0x5c6d86, 0x728399, 0x7a828c] },
  mill: { h0: 0.9, h1: 0.8, win: 1, max: 10, pal: [0x7c5f52, 0x8a6652, 0x70584c] },
  huts: { h0: 0.34, h1: 0.2, win: 0, max: 4, pal: [0x717d8c, 0x8a7560, 0x66717e, 0x92735e, 0x7b8792] },
  ghat: { h0: 0.16, h1: 0.3, win: 0, max: 9, pal: [0x637777, 0x6f8383, 0x5a6d6d] },
  bagh: { h0: 0.38, h1: 0, win: 0, max: 14, pal: [0x2c5c3c, 0x275233, 0x326644] },
};
export const LAMP = { patri: 0xffe2a0, afsar: 0xdce6ff, ghat: 0x9dffb4, basti: 0xffa860, sarafa: 0xffd29a, kotwali: 0xeef2ff, bagh: 0xffd9a0 };

export function buildWorld(map) {
  const type = new Uint8Array(N * N).fill(T.BLDG);
  const ai = new Uint8Array(N * N);      // 1 where a police jeep may drive
  const lane = new Uint8Array(N * N);    // what kind of ground a drivable cell is
  const lines = [];
  const idx = (i, j) => j * N + i;
  const cellOf = v => Math.max(0, Math.min(N - 1, Math.floor(v / CS)));

  const carve = (ax, ay, bx, by, hw, aiOk, kind) => {
    const i0 = cellOf(Math.min(ax, bx) - hw), i1 = cellOf(Math.max(ax, bx) + hw);
    const j0 = cellOf(Math.min(ay, by) - hw), j1 = cellOf(Math.max(ay, by) + hw);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (distSeg((i + 0.5) * CS, (j + 0.5) * CS, ax, ay, bx, by).d <= hw) {
        const k = idx(i, j); type[k] = T.WALK; if (aiOk) ai[k] = 1;
        if (kind === LANE.GALI) { if (!lane[k]) lane[k] = kind; } else if (kind > lane[k] || lane[k] === LANE.GALI) lane[k] = kind;
      }
    }
  };
  const poly = (pts, hw, aiOk, kind, name) => {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      carve(a.x, a.y, b.x, b.y, hw, aiOk, kind);
      lines.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, hw, ai: aiOk ? 1 : 0, kind, name });
    }
  };
  const rect = (x0, y0, x1, y1, fn) => {
    for (let j = cellOf(y0); j <= cellOf(y1); j++) for (let i = cellOf(x0); i <= cellOf(x1); i++) {
      const cx = (i + 0.5) * CS, cy = (j + 0.5) * CS;
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) fn(idx(i, j), cx, cy);
    }
  };
  const carveRect = (x0, y0, x1, y1, kind) => rect(x0, y0, x1, y1, k => { type[k] = T.WALK; ai[k] = 1; if (kind > lane[k]) lane[k] = kind; });
  const stamp = (x0, y0, x1, y1, val, onlyIf) => rect(x0, y0, x1, y1, k => { if (onlyIf == null || type[k] === onlyIf) { type[k] = val; ai[k] = 0; lane[k] = 0; } });

  const districts = map.districts;
  const districtAt = (x, y) => { for (const d of districts) if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d.id; return 'patri'; };
  const park = districts.find(d => d.id === 'bagh');
  const inPark = (x, y) => x > park.x + 2 && x < park.x + park.w - 2 && y > park.y + 2 && y < park.y + park.h - 2;

  // --- open areas: the park, the thana yard, the bus stand
  carveRect(24.5, 52.5, 47.5, 75.5, LANE.OPEN);
  const trees = [];
  for (let gx = 27; gx <= 45.5; gx += 3.6) for (let gy = 55; gy <= 73.5; gy += 3.6) {
    const r = hash2(gx * 10, gy * 10);
    if (r > 0.74) continue;
    const tx = gx + (hash2(gx * 7, gy * 3) - 0.5) * 2.2, ty = gy + (hash2(gx * 3, gy * 11) - 0.5) * 2.2;
    trees.push({ x: tx, y: ty, s: 0.8 + r * 0.6 });
    stamp(tx - 0.5, ty - 0.5, tx + 0.5, ty + 0.5, T.PROP);
  }
  carveRect(53.5, 37.5, 62.5, 46.5, LANE.OPEN);
  carveRect(88.5, 44.5, 97.5, 61.5, LANE.OPEN);

  // --- tang galis (chor only), then every road, street and alley
  const galis = [];
  for (const r of map.special_routes) {
    let pts = r.points.map(p => ({ x: p.x, y: p.y }));
    if (r.name === 'Baad Surang') pts = [{ x: 76, y: 27 }, { x: 84, y: 27 }, { x: 84, y: 16 }, { x: 88, y: 16 }];   // squared off so it can be driven
    const open = OPEN_ROUTES.has(r.name);
    poly(pts, open ? HW.alley : GALI_HW, open, open ? LANE.ALLEY : LANE.GALI, r.name);
    if (!open) galis.push({ name: r.name, points: pts });
  }
  for (const r of map.roads) {
    const hw = HW[r.kind];
    if (!hw) continue;
    const pts = r.kind === 'drain' ? r.points.map(p => ({ x: p.x, y: Math.min(p.y, 93.2) })) : r.points;
    poly(pts, hw, true, LANE_OF[r.kind], r.name);
  }
  // doorways the drawing implies: thana gate, the gali behind the bank, the jeweller's back lane, the haveli's broken wall
  carve(58, 46.5, 58, 50, 1.0, true, LANE.STREET);
  carve(76, 27, 76, 30, 0.75, true, LANE.ALLEY);
  carve(84, 27, 84, 30, 0.75, true, LANE.ALLEY);
  carve(28, 26, 30, 26, 0.75, false, LANE.GALI);
  carve(28, 26, 28, 28, 0.75, false, LANE.GALI);
  carve(88, 16, 88, 12.5, 0.75, false, LANE.GALI);

  // --- places of interest get an apron and a link to the nearest lane a jeep can use
  const nearestLine = (x, y, needAi) => {
    let best = null;
    for (const l of lines) {
      if (needAi && !l.ai) continue;
      const q = distSeg(x, y, l.ax, l.ay, l.bx, l.by);
      if (!best || q.d < best.d) best = { d: q.d, qx: q.qx, qy: q.qy, t: q.t, l };
    }
    return best;
  };
  const poi = (x, y, r) => {
    const best = nearestLine(x, y, true);
    if (best && best.d > best.l.hw * 0.8) carve(x, y, best.qx, best.qy, 0.75, true, LANE.ALLEY);
    carve(x, y, x, y, r, true, LANE.OPEN);
    return best ? Math.atan2(best.qx - x, best.qy - y) : 0;   // heading that points at the lane
  };
  const sites = map.rob_locations.map((s, i) => ({
    i, id: s.id, name: s.short || s.name, full: s.name, gloss: s.gloss, tier: s.loot_tier, value: s.value, x: s.x, y: s.y, coach: s.id === 'r7',
  }));
  const escapes = map.escape_points.map((e, i) => ({ i, name: e.name, x: e.x, y: e.y }));
  const levers = (map.levers || []).map((l, i) => ({ i, name: l.name, x: l.x, y: l.y }));
  const posts = map.police_sites.filter(p => p.kind !== 'station').map(p => ({ name: p.name, x: p.x, y: p.y }));
  const spawns = map.spawns.chor.map(s => ({ x: s.x, y: s.y, label: s.label, a: 0 }));
  sites.forEach(s => poi(s.x, s.y, 1.25));
  escapes.forEach(e => poi(e.x, e.y, 1.5));
  levers.forEach(l => poi(l.x, l.y, 1.0));
  posts.forEach(p => poi(p.x, p.y, 1.0));
  spawns.forEach(s => { s.a = poi(s.x, s.y, 1.2); });

  // --- solid props and landmark footprints
  const cage = { x0: 53.5, y0: 37.5, x1: 57, y1: 39.5 };
  stamp(cage.x0, cage.y0, cage.x1, cage.y1, T.CAGE);
  const marks = {
    thana: { x0: 59.5, y0: 38, x1: 62.5, y1: 43.5 },
    clock: { x0: 49.5, y0: 49.5, x1: 50.5, y1: 50.5 },
    station: { x0: 43.6, y0: 4.8, x1: 48.4, y1: 7.6 },
    tank: { x0: 9.5, y0: 5.5, x1: 10.5, y1: 6.5 },
    chimney: { x0: 4.4, y0: 45.4, x1: 5.6, y1: 46.6 },
    mandir: { x0: 53.2, y0: 92.2, x1: 54.8, y1: 93.8 },
    talkies: { x0: 38.5, y0: 51.5, x1: 45.5, y1: 52.5 },
    ruin: { x0: 85.5, y0: 9.5, x1: 90.5, y1: 15 },
    scrap: { x0: 9.5, y0: 85.5, x1: 14.8, y1: 90.8 },
  };
  stamp(marks.thana.x0, marks.thana.y0, marks.thana.x1, marks.thana.y1, T.MARK);
  stamp(marks.clock.x0, marks.clock.y0, marks.clock.x1, marks.clock.y1, T.MARK);
  for (const k of ['station', 'tank', 'chimney', 'mandir', 'talkies', 'ruin', 'scrap']) { const m = marks[k]; stamp(m.x0, m.y0, m.x1, m.y1, T.MARK, T.BLDG); }
  const solidProps = [
    { kind: 'bus', x0: 89.5, y0: 46, x1: 92.5, y1: 47.2, c: 0xb8442e }, { kind: 'bus', x0: 93.5, y0: 46, x1: 96.5, y1: 47.2, c: 0x2e6fb8 },
    { kind: 'bus', x0: 89.5, y0: 58.6, x1: 92.5, y1: 59.8, c: 0x2e6fb8 }, { kind: 'bus', x0: 93.5, y0: 58.6, x1: 96.5, y1: 59.8, c: 0xb8442e },
    { kind: 'bus', x0: 93.9, y0: 53.4, x1: 96.9, y1: 54.6, c: 0xc79a2a },
    { kind: 'wagon', x0: 14, y0: 7.5, x1: 18, y1: 8.4, c: 0x6a3c2a },
    { kind: 'coach', x0: 53, y0: 5.9, x1: 59, y1: 6.8, c: 0x7a2330 },
  ];
  for (const p of solidProps) stamp(p.x0, p.y0, p.x1, p.y1, T.PROP);
  for (const s of [...sites, ...escapes]) rect(s.x - 0.9, s.y - 0.9, s.x + 0.9, s.y + 0.9, k => { if (type[k] === T.PROP) { type[k] = T.WALK; ai[k] = 1; lane[k] = LANE.OPEN; } });

  // --- hideouts: a bay a car can drive into, cut into the buildings beside the nearest lane
  const hides = [];
  const bayFree = (x0, y0, x1, y1) => {
    if (x0 < 1.5 || y0 < 5.5 || x1 > 98.5 || y1 > 93.8) return false;
    let ok = true;
    rect(x0, y0, x1, y1, k => { if (type[k] !== T.BLDG) ok = false; });
    return ok;
  };
  map.hiding_spots.forEach((h, i) => {
    const rec = { i, kind: h.kind, x: h.x, y: h.y, a: 0, bay: null, mouth: null, r: 1.0 };
    if (inPark(h.x, h.y)) { // in the open park: a grove of trees, no walls
      const best = nearestLine(h.x, h.y, true);
      carve(h.x, h.y, h.x, h.y, 1.2, true, LANE.OPEN);
      rec.a = best ? Math.atan2(best.qx - h.x, best.qy - h.y) : 0; rec.grove = true;
      hides.push(rec); return;
    }
    // try the lanes nearest to the spot, either side, sliding along the lane until a bay fits inside solid building
    const near = lines.filter(l => l.ai && l.kind !== LANE.GALI).map(l => ({ l, q: distSeg(h.x, h.y, l.ax, l.ay, l.bx, l.by) })).sort((a, b) => (a.q.d + (a.l.kind === LANE.MAIN ? 3 : 0)) - (b.q.d + (b.l.kind === LANE.MAIN ? 3 : 0))).slice(0, 6);
    let done = false;
    for (const { l, q } of near) {
      const L = Math.hypot(l.bx - l.ax, l.by - l.ay); if (L < 0.5) continue;
      const ux = (l.bx - l.ax) / L, uy = (l.by - l.ay) / L;
      const side0 = ((h.x - q.qx) * -uy + (h.y - q.qy) * ux) >= 0 ? 1 : -1;
      for (const sh of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
        const t = Math.round((q.t * L + sh) * 2) / 2; if (t < 1.5 || t > L - 1.5) continue;
        const bx = l.ax + ux * t, by = l.ay + uy * t;
        for (const side of [side0, -side0]) {
          const nx = -uy * side, ny = ux * side;                       // points from the lane into the bay
          // the lane's real edge on the grid: step outward until the first cell that is not road
          let edge = -1;
          for (let s = 0.25; s < l.hw + 1.3; s += 0.5) { const k = idx(cellOf(bx + nx * s), cellOf(by + ny * s)); if (type[k] !== T.WALK) { edge = s - 0.25; break; } }
          if (edge < 0) continue;
          const mx = bx + nx * edge, my = by + ny * edge;               // mouth, on the lane edge
          const cx = mx + nx * BAY_D / 2, cy = my + ny * BAY_D / 2;
          const hx = Math.abs(ux) * BAY_W / 2 + Math.abs(nx) * BAY_D / 2, hy = Math.abs(uy) * BAY_W / 2 + Math.abs(ny) * BAY_D / 2;
          // the bay itself plus a one-cell wall on the three closed sides must be solid building
          const gx = Math.abs(ux) * 0.5 + Math.abs(nx) * 0.25, gy = Math.abs(uy) * 0.5 + Math.abs(ny) * 0.25;
          if (!bayFree(cx - hx - gx + nx * 0.3, cy - hy - gy + ny * 0.3, cx + hx + gx + nx * 0.3, cy + hy + gy + ny * 0.3)) continue;
          rect(cx - hx, cy - hy, cx + hx, cy + hy, k => { type[k] = T.WALK; ai[k] = 1; lane[k] = LANE.BAY; });
          carve(mx, my, bx, by, BAY_W / 2 - 0.05, true, LANE.BAY);       // join the bay to the lane
          rec.x = cx; rec.y = cy; rec.a = Math.atan2(-nx, -ny); rec.mouth = { x: mx, y: my };
          rec.bay = { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy, w: BAY_W, d: BAY_D, nx, ny };
          rec.front = { x: bx, y: by };                                  // where a jeep stops to search
          done = true; break;
        }
        if (done) break;
      }
      if (done) break;
    }
    if (!done) { rec.a = poi(h.x, h.y, 1.1); rec.front = nearestLine(h.x, h.y, true); rec.front = rec.front ? { x: rec.front.qx, y: rec.front.qy } : { x: h.x, y: h.y }; }
    hides.push(rec);
  });

  // --- river and railway are open ground nobody can cross
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = idx(i, j), cy = (j + 0.5) * CS;
    if (type[k] === T.BLDG && cy >= 94.6) type[k] = T.WATER;
    else if (type[k] === T.BLDG && cy < 4.7) type[k] = T.RAIL;
    if (type[k] !== T.WALK) { ai[k] = 0; lane[k] = 0; }
  }

  // --- merge building cells into boxes
  const used = new Uint8Array(N * N), boxes = [];
  const styleAt = (x, y) => { const d = districtAt(x, y); return d === 'basti' ? (y < 60 ? 'mill' : 'huts') : d; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (type[idx(i, j)] !== T.BLDG || used[idx(i, j)]) continue;
    const sk = styleAt((i + 0.5) * CS, (j + 0.5) * CS), st = STYLE[sk];
    const maxW = 3 + Math.floor(hash2(i, j) * st.max), maxD = 3 + Math.floor(hash2(j, i + 91) * st.max);
    let w = 0;
    while (w < maxW && i + w < N && type[idx(i + w, j)] === T.BLDG && !used[idx(i + w, j)] && styleAt((i + w + 0.5) * CS, (j + 0.5) * CS) === sk) w++;
    let d = 0;
    outer: while (d < maxD && j + d < N) {
      for (let q = 0; q < w; q++) { const k = idx(i + q, j + d); if (type[k] !== T.BLDG || used[k] || styleAt((i + q + 0.5) * CS, (j + d + 0.5) * CS) !== sk) break outer; }
      d++;
    }
    for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) used[idx(i + a, j + b)] = 1;
    boxes.push({ x: i * CS, y: j * CS, w: w * CS, d: d * CS, h: st.h0 + hash2(i + 7, j + 3) * st.h1, c: st.pal[Math.floor(hash2(i + 13, j + 29) * st.pal.length)], win: st.win, style: sk });
  }

  // --- building faces that look onto a street or main road: where shop signs and shutters can hang
  const facades = [];
  for (const b of boxes) {
    if (b.h < 0.5 || b.style === 'bagh' || b.style === 'ghat') continue;
    const i0 = Math.round(b.x / CS), j0 = Math.round(b.y / CS), w = Math.round(b.w / CS), d = Math.round(b.d / CS);
    const side = (count, cellAt, fx, fy, nx, ny) => {
      let run = -1, kind = 0;
      for (let q = 0; q <= count; q++) {
        const k = q < count ? cellAt(q) : -1, lk = k >= 0 && type[k] === T.WALK ? lane[k] : 0, on = lk === LANE.MAIN || lk === LANE.STREET;
        if (on && run < 0) { run = q; kind = lk; }
        if (!on && run >= 0) {
          const len = (q - run) * CS, mid = (run + q) / 2 * CS;
          if (len >= 1.5) facades.push({ x: fx(mid), y: fy(mid), nx, ny, len, h: b.h, kind: kind === LANE.MAIN ? 'main' : 'street', district: districtAt(fx(mid), fy(mid)) });
          run = -1;
        }
      }
    };
    if (j0 > 0) side(w, q => idx(i0 + q, j0 - 1), m => b.x + m, () => b.y, 0, -1);
    if (j0 + d < N) side(w, q => idx(i0 + q, j0 + d), m => b.x + m, () => b.y + b.d, 0, 1);
    if (i0 > 0) side(d, q => idx(i0 - 1, j0 + q), () => b.x, m => b.y + m, -1, 0);
    if (i0 + w < N) side(d, q => idx(i0 + w, j0 + q), () => b.x + b.w, m => b.y + m, 1, 0);
  }

  // --- street lamps
  const lamps = [];
  const along = (pts, step, off, post, rad) => {
    let carry = step * 0.5, n = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], L = Math.hypot(b.x - a.x, b.y - a.y); if (!L) continue;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      while (carry <= L) {
        const side = (n++ % 2) ? 1 : -1, x = a.x + ux * carry - uy * off * side, y = a.y + uy * carry + ux * off * side;
        if (x > 1 && x < 99 && y > 5 && y < 94) lamps.push({ x, y, c: LAMP[districtAt(x, y)], post, r: rad, dx: uy * side, dy: -ux * side });   // dx,dy point from the post toward the road centre
        carry += step;
      }
      carry -= L;
    }
  };
  for (const r of map.roads) {
    if (r.kind === 'main') along(r.points, 7, 1.42, true, 3.8);
    else if (r.kind === 'street') along(r.points, 8.5, 0.92, r.name !== 'Bagh ki Pagdandi', 3.0);
  }

  // --- helpers
  const inMap = (x, y) => x >= 0 && y >= 0 && x < 100 && y < 100;
  const cellAtXY = (x, y) => idx(Math.floor(x / CS), Math.floor(y / CS));
  const walkable = (x, y) => inMap(x, y) && type[cellAtXY(x, y)] === T.WALK;
  const policeOk = (x, y) => inMap(x, y) && ai[cellAtXY(x, y)] === 1;
  const solidChor = (i, j) => i < 0 || j < 0 || i >= N || j >= N || type[j * N + i] !== T.WALK;
  const solidPolice = (i, j) => i < 0 || j < 0 || i >= N || j >= N || !ai[j * N + i];
  const laneAt = (x, y) => inMap(x, y) ? lane[cellAtXY(x, y)] : 0;
  const blocksSight = t => t === T.BLDG || t === T.MARK || t === T.PROP;
  const los = (ax, ay, bx, by) => {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.2);
    for (let k = 1; k < n; k++) {
      const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
      if (!inMap(x, y)) return false;
      if (blocksSight(type[cellAtXY(x, y)])) return false;
    }
    return true;
  };
  const walkMask = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) walkMask[k] = type[k] === T.WALK ? 1 : 0;
  const nearestCell = (x, y, mask) => {
    const ci = cellOf(x), cj = cellOf(y);
    if (mask[idx(ci, cj)]) return idx(ci, cj);
    for (let r = 1; r < 30; r++) {
      let best = -1, bd = 1e9;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const k = idx(i, j);
        if (mask[k]) { const dd = (i - ci) * (i - ci) + (j - cj) * (j - cj); if (dd < bd) { bd = dd; best = k; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const nearestWalk = (x, y, policeOnly) => {
    const k = nearestCell(x, y, policeOnly ? ai : walkMask);
    return k < 0 ? { x, y } : { x: (k % N + 0.5) * CS, y: (Math.floor(k / N) + 0.5) * CS };
  };

  // --- clearance: how many cells to the nearest wall, so routes keep to the middle of the lane
  const clearance = mask => {
    const c = new Uint8Array(N * N), q = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = idx(i, j); if (!mask[k]) continue;
      let edge = i === 0 || j === 0 || i === N - 1 || j === N - 1;
      if (!edge) for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1; di++) if (!mask[idx(i + di, j + dj)]) { edge = true; break; }
      if (edge) { c[k] = 1; q.push(k); }
    }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % N, j = (k - i) / N; if (c[k] >= 4) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const nk = idx(ni, nj); if (mask[nk] && !c[nk]) { c[nk] = c[k] + 1; q.push(nk); } }
    }
    return c;
  };
  const clrPolice = clearance(ai), clrChor = clearance(walkMask);

  // --- A* over the chosen cells (police jeeps by default; pass true for the chor's fuller network)
  const gS = new Float32Array(N * N), fS = new Float32Array(N * N), came = new Int32Array(N * N), seen = new Uint32Array(N * N), closed = new Uint32Array(N * N);
  let gen = 0;
  const heap = new Int32Array(N * N * 2);
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  const OFFS = [[0, 0], [0.26, 0], [-0.26, 0], [0, 0.26], [0, -0.26]];
  const clearLine = (mask, ax, ay, bx, by) => {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.2);
    for (let k = 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
      for (const o of OFFS) {
        const i = Math.floor((x + o[0]) / CS), j = Math.floor((y + o[1]) / CS);
        if (i < 0 || j < 0 || i >= N || j >= N || !mask[idx(i, j)]) return false;
      }
    }
    return true;
  };
  const findPath = (sx, sy, tx, ty, forChor) => {
    const mask = forChor ? walkMask : ai, clr = forChor ? clrChor : clrPolice;
    const s = nearestCell(sx, sy, mask), g = nearestCell(tx, ty, mask);
    if (s < 0 || g < 0) return null;
    if (s === g) return [{ x: (g % N + 0.5) * CS, y: (Math.floor(g / N) + 0.5) * CS }];
    gen++;
    const gi = g % N, gj = Math.floor(g / N);
    let hn = 0;
    const push = k => { let c = hn++; heap[c] = k; while (c > 0) { const p = (c - 1) >> 1; if (fS[heap[p]] <= fS[heap[c]]) break; const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } };
    const pop = () => {
      const top = heap[0]; const last = heap[--hn];
      if (hn > 0) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < hn && fS[heap[l]] < fS[heap[m]]) m = l; if (r < hn && fS[heap[r]] < fS[heap[m]]) m = r; if (m === c) break; const t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } }
      return top;
    };
    const hEst = k => { const dx = Math.abs(k % N - gi), dy = Math.abs(Math.floor(k / N) - gj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    gS[s] = 0; fS[s] = hEst(s); came[s] = -1; seen[s] = gen; push(s);
    let found = false, guard = 0;
    while (hn > 0 && guard++ < 80000) {
      const c = pop();
      if (c === g) { found = true; break; }
      if (closed[c] === gen) continue;
      closed[c] = gen;
      const ci = c % N, cj = Math.floor(c / N);
      for (let q = 0; q < 8; q++) {
        const ni = ci + DI[q], nj = cj + DJ[q];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = idx(ni, nj);
        if (!mask[nk] || closed[nk] === gen) continue;
        if (q >= 4 && (!mask[idx(ci + DI[q], cj)] || !mask[idx(ci, cj + DJ[q])])) continue;
        const ng = gS[c] + (q >= 4 ? 1.414 : 1) * (clr[nk] <= 1 ? 2.4 : clr[nk] === 2 ? 1.25 : 1);
        if (seen[nk] !== gen || ng < gS[nk]) { seen[nk] = gen; gS[nk] = ng; fS[nk] = ng + hEst(nk); came[nk] = c; push(nk); }
      }
    }
    if (!found) return null;
    const raw = [];
    for (let k = g; k !== -1; k = came[k]) raw.push({ x: (k % N + 0.5) * CS, y: (Math.floor(k / N) + 0.5) * CS });
    raw.reverse();
    const out = [raw[0]];
    let a = 0;
    while (a < raw.length - 1) {
      let b = Math.min(raw.length - 1, a + 40);
      while (b > a + 1 && !clearLine(mask, raw[a].x, raw[a].y, raw[b].x, raw[b].y)) b--;
      out.push(raw[b]); a = b;
    }
    return out;
  };

  return {
    type, ai, lane, boxes, facades, lamps, trees, lines, marks, solidProps, cage, galis,
    sites, hides, escapes, levers, posts, spawns,
    policeSpawns: [{ x: 54.6, y: 41.2, a: 0 }, { x: 55.8, y: 41.2, a: 0 }, { x: 57, y: 41.2, a: 0 }, { x: 54.6, y: 43.4, a: 0 }, { x: 55.8, y: 43.4, a: 0 }, { x: 57, y: 43.4, a: 0 }, { x: 58.2, y: 44.6, a: 0 }, { x: 54.6, y: 45.4, a: 0 }],
    cageSlots: [{ x: 54.0, y: 38.05 }, { x: 54.85, y: 38.05 }, { x: 55.7, y: 38.05 }, { x: 56.55, y: 38.05 }, { x: 54.0, y: 38.95 }, { x: 54.85, y: 38.95 }, { x: 55.7, y: 38.95 }, { x: 56.55, y: 38.95 }],
    releasePoints: [{ x: 50.5, y: 38.5, a: Math.PI }, { x: 57.5, y: 36, a: -Math.PI / 2 }],
    districtAt, inPark, walkable, policeOk, solidChor, solidPolice, laneAt, los, findPath, nearestWalk,
  };
}
