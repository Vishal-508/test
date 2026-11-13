// Arcade car handling shared by players and computer police: throttle, steering, handbrake drift, nitro,
// collisions against the town grid and other cars, and a path-following driver for the computer.
// Headings: angle a means the car points along (sin a, cos a) on the map (x east, y south).
import { CS } from './world.js?v=9';

// vmax top speed, acc engine pull, tA/tB steering curve: turn rate = steer x min(v / tA, tB / v) rad/s
export const CAR = {
  chor:   { len: 0.84, wid: 0.38, r: 0.19, off: 0.25, vmax: 3.4, maxRev: 1.2, acc: 4.2, brake: 6.0, drag: 0.5, tA: 0.55, tB: 5.0, grip: 10, gripHb: 3.0 },
  police: { len: 0.86, wid: 0.42, r: 0.21, off: 0.25, vmax: 3.5, maxRev: 1.2, acc: 3.6, brake: 5.5, drag: 0.5, tA: 0.6, tB: 4.6, grip: 10, gripHb: 3.2 },
};
export const NITRO = { TOP: 1.35, ACC: 1.8 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => (Number.isFinite(a) ? a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)) : 0);

export function makeVehicle(kind, x, y, a) {
  return { kind, P: CAR[kind], x, y, a: a || 0, vx: 0, vy: 0, vf: 0, steer: 0, slip: 0, hit: 0, crash: false, stall: 0, gr: 1, charge: 0, boost: 0, bump: null, touch: false };
}

// Push the car out of walls (grid cells) and other cars; returns the hardest hit this step (units/s into the obstacle).
function collide(v, solid, others) {
  const P = v.P, r = P.r;
  let hard = 0; v.touch = false;
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 0; c < 3; c++) {
      const o = c === 0 ? P.off : c === 1 ? 0 : -P.off;
      const fx = Math.sin(v.a), fy = Math.cos(v.a);
      let cx = v.x + fx * o, cy = v.y + fy * o;
      const push = (nx, ny, pen) => {
        v.x += nx * pen; v.y += ny * pen; cx += nx * pen; cy += ny * pen; v.touch = true;
        v.a = wrap(v.a - (fx * o * ny - fy * o * nx) * pen * 2.6);          // swing the body as if shoved at this end
        const vn = v.vx * nx + v.vy * ny;
        if (vn < 0) {
          // a glancing touch turns the nose along the wall so the car slides instead of grinding
          v.a = wrap(v.a - clamp((fx * o * ny - fy * o * nx) * -vn * 1.7, -0.1, 0.1));
          v.vx -= 1.12 * vn * nx; v.vy -= 1.12 * vn * ny; if (-vn > hard) hard = -vn;
        }
      };
      const i0 = Math.floor((cx - r) / CS), i1 = Math.floor((cx + r) / CS), j0 = Math.floor((cy - r) / CS), j1 = Math.floor((cy + r) / CS);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!solid(i, j)) continue;
        const px = clamp(cx, i * CS, (i + 1) * CS), py = clamp(cy, j * CS, (j + 1) * CS);
        const dx = cx - px, dy = cy - py, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); push(dx / d, dy / d, r - d); }
        else { // centre is inside the cell: leave by the nearest open side
          const l = cx - i * CS, rt = (i + 1) * CS - cx, t = cy - j * CS, b = (j + 1) * CS - cy;
          const opts = [[l, -1, 0, i - 1, j], [rt, 1, 0, i + 1, j], [t, 0, -1, i, j - 1], [b, 0, 1, i, j + 1]].filter(q => !solid(q[3], q[4])).sort((a, b2) => a[0] - b2[0]);
          const q = opts[0] || [Math.min(l, rt, t, b), l <= rt && l <= t && l <= b ? -1 : rt <= t && rt <= b ? 1 : 0, 0];
          if (!opts[0] && q[1] === 0) q[2] = t <= b ? -1 : 1;
          push(q[1], q[2], q[0] + r);
        }
      }
      if (others) for (const ot of others) {
        if (ot === v) continue;
        const R = r + ot.P.r, ofx = Math.sin(ot.a), ofy = Math.cos(ot.a);
        for (let k = -1; k <= 1; k++) {
          const ox = ot.x + ofx * ot.P.off * k, oy = ot.y + ofy * ot.P.off * k, dx = cx - ox, dy = cy - oy, d2 = dx * dx + dy * dy;
          if (d2 >= R * R || d2 < 1e-10) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          // judge the bump by closing speed, then separate (each car moves itself half way)
          const rvx = v.vx - (ot.vx || 0), rvy = v.vy - (ot.vy || 0), vn = rvx * nx + rvy * ny;
          v.x += nx * (R - d) * 0.5; v.y += ny * (R - d) * 0.5; cx += nx * (R - d) * 0.5; cy += ny * (R - d) * 0.5;
          if (vn < 0) { v.vx -= 0.75 * vn * nx; v.vy -= 0.75 * vn * ny; if (-vn > hard) hard = -vn; v.bump = ot; }
        }
      }
    }
  }
  return hard;
}

// One physics step. inp: { throttle -1..1, steer -1..1 (right positive), handbrake, nitro }.
// env: { solid(i, j), others: [vehicles], speedMul }.
// Afterwards: v.hit = hardest contact this step, v.crash = true on a head-on smash, v.boost = nitro earned by a drift (0..0.2).
export function stepVehicle(v, inp, dt, env) {
  const P = v.P, mul = env.speedMul || 1;
  v.steer += clamp(clamp(inp.steer || 0, -1, 1) - v.steer, -6 * dt, 6 * dt);
  let fx = Math.sin(v.a), fy = Math.cos(v.a);
  let vf = v.vx * fx + v.vy * fy, vr = v.vx * fy - v.vy * fx;
  const hb = !!inp.handbrake, top = P.vmax * mul * (inp.nitro ? NITRO.TOP : 1);
  let th = clamp(inp.throttle || 0, -1, 1);
  if (v.stall > 0) { v.stall -= dt; if (th > 0) th = 0; }                 // engine coughs after a smash
  if (th > 0) {
    if (vf < 0) vf += P.brake * th * dt;
    else if (vf < top) vf += P.acc * mul * (inp.nitro ? NITRO.ACC : 1) * (hb ? 0.7 : 1) * th * (1 - vf / top) * dt;
  } else if (th < 0) {
    if (vf > 0.06) vf += P.brake * th * dt;
    else if (vf > -P.maxRev) vf += P.acc * 0.7 * th * dt;
  } else { vf -= vf * P.drag * dt; if (Math.abs(vf) < 0.03) vf = 0; }
  if (vf > top) vf -= (vf - top) * Math.min(1, 2.5 * dt);
  const sp = Math.abs(vf);
  if (hb && sp > 0.05) vf -= Math.sign(vf) * Math.min(sp, 1.0 * dt);
  v.vx = fx * vf + fy * vr; v.vy = fy * vf - fx * vr;
  // steering: tight at low speed, wide at top speed; the handbrake swings the tail, or spins the car on the spot when slow
  let rate;
  if (hb) rate = sp >= 1.2 ? 3.2 : 3.5;
  else rate = sp < 0.02 ? 0 : Math.min(sp / P.tA, P.tB / sp);
  v.a = wrap(v.a - v.steer * rate * (vf >= -0.05 ? 1 : -1) * dt);
  // tyres: sideways speed is scrubbed off quickly; the handbrake lets go of the road for a drift
  fx = Math.sin(v.a); fy = Math.cos(v.a);
  vf = v.vx * fx + v.vy * fy; vr = v.vx * fy - v.vy * fx;
  v.gr += clamp((hb && sp >= 1.2 ? 0 : 1) - v.gr, -dt / 0.08, dt / 0.25);
  const slip = Math.abs(vr);
  vr *= Math.exp(-(P.gripHb + (P.grip - P.gripHb) * v.gr) * (env.gripMul || 1) * dt);   // gripMul below 1: a wet road
  // drift charge: hold a real slide and it pays out speed and nitro when you straighten up
  v.boost = 0;
  if (slip > 0.36 * Math.max(0.5, Math.abs(vf)) && Math.hypot(vf, vr) > 1.6) v.charge += dt;
  else if (v.charge > 0) {
    if (v.charge >= 0.25 && !inp.nitro) { const big = v.charge >= 0.7; vf += big ? 0.7 : 0.4; v.boost = big ? 0.2 : 0.08; }
    v.charge = 0;
  }
  v.vx = fx * vf + fy * vr; v.vy = fy * vf - fx * vr;
  const before = Math.hypot(v.vx, v.vy);
  v.x += v.vx * dt; v.y += v.vy * dt;
  v.bump = null;
  v.hit = collide(v, env.solid, env.others);
  // scrape or crash: brushing a wall costs a little, a head-on hit costs a lot and stalls the engine for a moment
  v.crash = false;
  if (v.hit >= 1.4 && v.hit / Math.max(before, 0.01) >= 0.57 && !v.bump) { v.crash = true; v.vx *= 0.5; v.vy *= 0.5; v.stall = 0.35; }
  else if (v.touch) { const k = Math.exp(-0.9 * dt); v.vx *= k; v.vy *= k; }
  fx = Math.sin(v.a); fy = Math.cos(v.a);
  v.vf = v.vx * fx + v.vy * fy;
  v.slip = slip;
  return v;
}

// ---------------------------------------------------------------- computer driver
// Follows a list of points like a driver would: looks ahead, brakes for corners, backs out when stuck.
// d: driver memory. Returns the inputs for stepVehicle plus { arrived, wedged }.
export function makeDriver() { return { seg: 0, stuck: 0, rev: 0, revSteer: 1, wedged: 0 }; }

function alongPath(path, seg, x, y, ahead) {
  // nearest point on the path at or after segment `seg`, then walk `ahead` further along it
  let best = null;
  for (let k = Math.max(0, seg - 1); k < Math.min(path.length - 1, seg + 4); k++) {
    const a = path[k], b = path[k + 1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L === 0 ? 0 : clamp(((x - a.x) * dx + (y - a.y) * dy) / L, 0, 1);
    const qx = a.x + dx * t, qy = a.y + dy * t, d = Math.hypot(x - qx, y - qy);
    if (!best || d < best.d - 0.01) best = { d, k, t };
  }
  if (!best) return { x: path[path.length - 1].x, y: path[path.length - 1].y, seg, t: 0, left: Math.hypot(path[path.length - 1].x - x, path[path.length - 1].y - y) };
  let k = best.k, t = best.t, rem = ahead, px = 0, py = 0, left = 0;
  for (let q = best.k; q < path.length - 1; q++) { const a = path[q], b = path[q + 1], L = Math.hypot(b.x - a.x, b.y - a.y); left += q === best.k ? L * (1 - best.t) : L; }
  for (;;) {
    const a = path[k], b = path[k + 1], L = Math.hypot(b.x - a.x, b.y - a.y), room = L * (1 - t);
    if (rem <= room || k >= path.length - 2) { const tt = L ? Math.min(1, t + rem / L) : 1; px = a.x + (b.x - a.x) * tt; py = a.y + (b.y - a.y) * tt; break; }
    rem -= room; k++; t = 0;
  }
  return { x: px, y: py, seg: best.k, t: best.t, left };
}

const OUT = { throttle: 0, steer: 0, handbrake: false, nitro: false, arrived: false, wedged: false };
export function drive(v, path, d, want, dt) {
  const out = OUT; out.throttle = 0; out.steer = 0; out.handbrake = false; out.nitro = false; out.arrived = false; out.wedged = false;
  if (!path || path.length < 2) { out.arrived = true; out.throttle = v.vf > 0.2 ? -1 : 0; return out; }
  if (d.rev > 0) { // backing out of a jam
    d.rev -= dt; out.throttle = -1; out.steer = d.revSteer;
    if (d.rev <= 0) { d.stuck = 0; d.wedged++; out.wedged = true; }
    return out;
  }
  const sp = Math.abs(v.vf);
  const near = alongPath(path, d.seg, v.x, v.y, 0.75 + sp * 0.3);
  d.seg = near.seg;
  if (near.left < 0.55) { out.arrived = true; out.throttle = v.vf > 0.3 ? -1 : 0; return out; }
  const ang = wrap(Math.atan2(near.x - v.x, near.y - v.y) - v.a);
  out.steer = clamp(-ang * 2.6, -1, 1);
  // corner speed: brake in time for each bend ahead, harder for sharper bends
  let target = want * clamp(1.15 - Math.abs(ang) * 0.6, 0.35, 1), run = 0;
  for (let k = near.seg; k < path.length - 2 && run < 8; k++) {
    const p0 = path[k], p1 = path[k + 1], p2 = path[k + 2], L = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    run += k === near.seg ? L * (1 - near.t) : L;
    const bend = Math.abs(wrap(Math.atan2(p2.x - p1.x, p2.y - p1.y) - Math.atan2(p1.x - p0.x, p1.y - p0.y)));
    if (bend < 0.2) continue;
    const vc = clamp(3.3 - bend * 1.35, 1.15, 3.6);                         // a right angle is taken at a little over 1 unit/s
    target = Math.min(target, Math.sqrt(vc * vc + 2 * 3.6 * Math.max(0, run - 0.5)));
  }
  if (near.left < 2.2) target = Math.min(target, 0.6 + near.left * 0.9);
  if (Math.abs(ang) > 1.9) target = Math.min(target, 0.8);                  // facing the wrong way: swing round slowly
  out.throttle = clamp((target - v.vf) * 2.2, -1, 1);
  if (v.vf > target + 0.9) out.throttle = -1;
  // stuck against something, or sliding along a wall while facing the wrong way: reverse with opposite lock for a moment
  if (want > 0.4 && (sp < 0.22 || (Math.abs(ang) > 1.9 && v.touch))) { d.stuck += dt; if (d.stuck > 0.8) { d.rev = 0.75; d.revSteer = ang >= 0 ? 1 : -1; } } else d.stuck = Math.max(0, d.stuck - dt * 2);
  return out;
}
