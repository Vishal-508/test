// Arcade car handling shared by players and computer police: throttle, steering, drift, nitro,
// collisions against the town grid and other cars, and a path-following driver for the computer.
// Headings: angle a means the car points along (sin a, cos a) on the map (x east, y south).
import { CS } from './world.js';

export const CAR = {
  chor:   { len: 0.84, wid: 0.38, r: 0.19, off: 0.25, maxSpeed: 3.4, maxRev: 1.3, accel: 3.0, brake: 6.5, drag: 0.6, turn: 3.2, turnHi: 0.48, grip: 9.0, gripHb: 1.7, nitroSpeed: 4.5, nitroAccel: 5.4 },
  police: { len: 0.86, wid: 0.42, r: 0.21, off: 0.25, maxSpeed: 3.5, maxRev: 1.2, accel: 2.6, brake: 6.0, drag: 0.6, turn: 2.9, turnHi: 0.5, grip: 9.5, gripHb: 2.0, nitroSpeed: 4.3, nitroAccel: 4.6 },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function makeVehicle(kind, x, y, a) {
  return { kind, P: CAR[kind], x, y, a: a || 0, vx: 0, vy: 0, vf: 0, steer: 0, slip: 0, hit: 0 };
}
export function circlesOf(v) {
  const fx = Math.sin(v.a), fy = Math.cos(v.a), o = v.P.off;
  return [[v.x + fx * o, v.y + fy * o], [v.x, v.y], [v.x - fx * o, v.y - fy * o]];
}

// Push the car out of walls (grid cells) and other cars; returns the hardest hit this step (units/s into the obstacle).
function collide(v, solid, others) {
  const P = v.P, r = P.r;
  let hard = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 0; c < 3; c++) {
      const o = c === 0 ? P.off : c === 1 ? 0 : -P.off;
      let fx = Math.sin(v.a), fy = Math.cos(v.a);
      let cx = v.x + fx * o, cy = v.y + fy * o;
      const push = (nx, ny, pen, soft) => {
        v.x += nx * pen; v.y += ny * pen; cx += nx * pen; cy += ny * pen;
        v.a = wrap(v.a - (fx * o * ny - fy * o * nx) * pen * 2.6);         // swing the body as if shoved at this end
        const vn = v.vx * nx + v.vy * ny;
        if (vn < 0) {
          // a glancing touch turns the nose along the wall so the car slides instead of grinding
          v.a = wrap(v.a - clamp((fx * o * ny - fy * o * nx) * -vn * 1.7, -0.1, 0.1));
          const e = soft ? 0.35 : 0.12; v.vx -= (1 + e) * vn * nx; v.vy -= (1 + e) * vn * ny; v.vx *= 0.985; v.vy *= 0.985; if (-vn > hard) hard = -vn;
        }
      };
      const i0 = Math.floor((cx - r) / CS), i1 = Math.floor((cx + r) / CS), j0 = Math.floor((cy - r) / CS), j1 = Math.floor((cy + r) / CS);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!solid(i, j)) continue;
        const px = clamp(cx, i * CS, (i + 1) * CS), py = clamp(cy, j * CS, (j + 1) * CS);
        const dx = cx - px, dy = cy - py, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); push(dx / d, dy / d, r - d, false); }
        else { // centre is inside the cell: leave by the nearest open side
          const l = cx - i * CS, rt = (i + 1) * CS - cx, t = cy - j * CS, b = (j + 1) * CS - cy;
          const opts = [[l, -1, 0, i - 1, j], [rt, 1, 0, i + 1, j], [t, 0, -1, i, j - 1], [b, 0, 1, i, j + 1]].filter(q => !solid(q[3], q[4])).sort((a, b2) => a[0] - b2[0]);
          const q = opts[0] || [Math.min(l, rt, t, b), l <= rt && l <= t && l <= b ? -1 : rt <= t && rt <= b ? 1 : 0, 0, 0, 0];
          if (!opts[0] && q[1] === 0) q[2] = t <= b ? -1 : 1;
          push(q[1], q[2], q[0] + r, false);
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
export function stepVehicle(v, inp, dt, env) {
  const P = v.P, mul = env.speedMul || 1;
  v.steer += (clamp(inp.steer || 0, -1, 1) - v.steer) * Math.min(1, dt * 10);
  let fx = Math.sin(v.a), fy = Math.cos(v.a);
  let vf = v.vx * fx + v.vy * fy, vr = v.vx * fy - v.vy * fx;
  const top = (inp.nitro ? P.nitroSpeed : P.maxSpeed) * mul, th = clamp(inp.throttle || 0, -1, 1);
  if (th > 0) {
    if (vf < 0) vf += P.brake * th * dt;
    else if (vf < top) vf += (inp.nitro ? P.nitroAccel : P.accel) * mul * th * dt * (1 - 0.5 * vf / top);
  } else if (th < 0) {
    if (vf > 0.06) vf += P.brake * th * dt;
    else if (vf > -P.maxRev) vf += P.accel * 0.8 * th * dt;
  } else { vf -= vf * P.drag * dt; if (Math.abs(vf) < 0.03) vf = 0; }
  if (vf > top) vf -= (vf - top) * Math.min(1, 2.5 * dt);
  if (inp.handbrake) vf -= vf * 1.3 * dt;
  v.vx = fx * vf + fy * vr; v.vy = fy * vf - fx * vr;
  // steer: needs some speed to bite, bites less at top speed, flips in reverse
  const sp = Math.abs(vf), turn = P.turn * (1 - P.turnHi * Math.min(1, sp / P.maxSpeed)) * Math.min(1, sp / 0.9);
  v.a = wrap(v.a - v.steer * turn * (vf >= 0 ? 1 : -1) * (inp.handbrake ? 1.4 : 1) * dt);   // positive steer = right
  // tyres: sideways speed is scrubbed off quickly, slowly with the handbrake (that is the drift)
  fx = Math.sin(v.a); fy = Math.cos(v.a);
  vf = v.vx * fx + v.vy * fy; vr = v.vx * fy - v.vy * fx;
  const grip = inp.handbrake ? P.gripHb : (Math.abs(v.steer) > 0.75 && sp > 2.5 ? P.grip * 0.5 : P.grip);
  const slip = Math.abs(vr);
  vr *= Math.exp(-grip * dt);
  v.vx = fx * vf + fy * vr; v.vy = fy * vf - fx * vr;
  v.x += v.vx * dt; v.y += v.vy * dt;
  v.bump = null;
  v.hit = collide(v, env.solid, env.others);
  fx = Math.sin(v.a); fy = Math.cos(v.a);
  v.vf = v.vx * fx + v.vy * fy;
  v.slip = slip;
  return v;
}

// ---------------------------------------------------------------- computer driver
// Follows a list of points like a driver would: looks ahead, slows for corners, backs out when stuck.
// d: driver memory { seg, stuck, rev, revSteer }. Returns the inputs for stepVehicle plus { arrived, wedged }.
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
  if (!best) return { x: path[path.length - 1].x, y: path[path.length - 1].y, seg, left: Math.hypot(path[path.length - 1].x - x, path[path.length - 1].y - y) };
  let k = best.k, t = best.t, rem = ahead, px = 0, py = 0, left = 0;
  for (let q = best.k; q < path.length - 1; q++) { const a = path[q], b = path[q + 1], L = Math.hypot(b.x - a.x, b.y - a.y); left += q === best.k ? L * (1 - best.t) : L; }
  for (;;) {
    const a = path[k], b = path[k + 1], L = Math.hypot(b.x - a.x, b.y - a.y), room = L * (1 - t);
    if (rem <= room || k >= path.length - 2) { const tt = L ? Math.min(1, t + rem / L) : 1; px = a.x + (b.x - a.x) * tt; py = a.y + (b.y - a.y) * tt; break; }
    rem -= room; k++; t = 0;
  }
  return { x: px, y: py, seg: best.k, t: best.t, left };
}

export function drive(v, path, d, want, dt) {
  const out = { throttle: 0, steer: 0, handbrake: false, nitro: false, arrived: false, wedged: false };
  if (!path || path.length < 2) { out.arrived = true; out.throttle = v.vf > 0.2 ? -1 : 0; return out; }
  if (d.rev > 0) { // backing out of a jam
    d.rev -= dt; out.throttle = -1; out.steer = d.revSteer;
    if (d.rev <= 0) { d.stuck = 0; d.wedged++; out.wedged = true; }
    return out;
  }
  const sp = Math.abs(v.vf);
  const near = alongPath(path, d.seg, v.x, v.y, 0.75 + sp * 0.28);
  d.seg = near.seg;
  if (near.left < 0.55) { out.arrived = true; out.throttle = v.vf > 0.3 ? -1 : 0; return out; }
  const ang = wrap(Math.atan2(near.x - v.x, near.y - v.y) - v.a);
  out.steer = clamp(-ang * 2.4, -1, 1);
  // corner speed: brake in time for each bend ahead, harder for sharper bends
  let target = want * clamp(1.15 - Math.abs(ang) * 0.6, 0.35, 1), run = 0;
  for (let k = near.seg; k < path.length - 2 && run < 7; k++) {
    const p0 = path[k], p1 = path[k + 1], p2 = path[k + 2], L = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    run += k === near.seg ? L * (1 - near.t) : L;
    const bend = Math.abs(wrap(Math.atan2(p2.x - p1.x, p2.y - p1.y) - Math.atan2(p1.x - p0.x, p1.y - p0.y)));
    if (bend < 0.2) continue;
    const vc = clamp(3.4 - bend * 1.55, 1.0, 3.6);                          // a right angle is taken at about 1 unit/s
    target = Math.min(target, Math.sqrt(vc * vc + 2 * 4.2 * Math.max(0, run - 0.45)));
  }
  if (near.left < 2.2) target = Math.min(target, 0.6 + near.left * 0.9);
  if (Math.abs(ang) > 1.9) target = Math.min(target, 0.8);                  // facing the wrong way: swing round slowly
  out.throttle = clamp((target - v.vf) * 2.2, -1, 1);
  if (v.vf > target + 0.9) out.throttle = -1;
  // stuck against something: reverse with opposite lock for a moment
  if (want > 0.4 && sp < 0.22) { d.stuck += dt; if (d.stuck > 0.8) { d.rev = 0.75; d.revSteer = ang >= 0 ? 1 : -1; } } else d.stuck = Math.max(0, d.stuck - dt * 2);
  return out;
}
