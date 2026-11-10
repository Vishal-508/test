// Sanity check for the map: run `node tools/check-world.mjs` after editing data/map.json.
// Confirms every road cell, place to rob, hideout door, hand-off point and lever can actually be driven to.
import fs from 'fs';
import { buildWorld, N, CS, T } from '../js/world.js';

const map = JSON.parse(fs.readFileSync(new URL('../data/map.json', import.meta.url), 'utf8'));
const W = buildWorld(map);
const flood = (start, ok) => {
  const seen = new Uint8Array(N * N), q = [start]; seen[start] = 1;
  while (q.length) { const c = q.pop(), i = c % N, j = (c - i) / N; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const k = nj * N + ni; if (!seen[k] && ok(k)) { seen[k] = 1; q.push(k); } } }
  return seen;
};
const at = (x, y) => Math.floor(y / CS) * N + Math.floor(x / CS);
const s0 = W.nearestWalk(W.spawns[0].x, W.spawns[0].y), p0 = W.nearestWalk(W.policeSpawns[0].x, W.policeSpawns[0].y, true);
const chor = flood(at(s0.x, s0.y), k => W.type[k] === T.WALK), police = flood(at(p0.x, p0.y), k => W.ai[k] === 1);
let problems = 0, road = 0, reach = 0;
const bad = text => { problems++; console.log(text); };
for (let k = 0; k < N * N; k++) if (W.type[k] === T.WALK) { road++; if (chor[k]) reach++; }
if (road !== reach) bad(`${road - reach} road cells cannot be reached by a getaway car`);
const check = (label, list, name, at2) => {
  for (const p of list) {
    const q = at2 ? at2(p) : p;
    if (!chor[at(q.x, q.y)]) bad(`${label} "${name(p)}" cannot be reached by getaway cars`);
    const n = W.nearestWalk(q.x, q.y, true);
    if (Math.hypot(n.x - q.x, n.y - q.y) > 1.5 || !police[at(n.x, n.y)]) bad(`${label} "${name(p)}" cannot be reached by police jeeps`);
  }
};
check('place to rob', W.sites, p => p.full);
check('hand-off point', W.escapes, p => p.name);
check('lever', W.levers, p => p.name);
check('hideout door', W.hides, p => `${p.kind} at ${p.x},${p.y}`, p => p.front);
check('hideout search point', W.hides, p => `${p.kind} at ${p.x},${p.y}`, p => p.search);
for (const s of W.spawns) if (!chor[at(s.x, s.y)]) bad(`chor start "${s.label}" is not on a road`);
for (const s of [...W.policeSpawns, ...W.releasePoints]) if (W.type[at(s.x, s.y)] !== T.WALK) bad(`start point at ${s.x},${s.y} is not on a road`);
if (W.hides.length !== map.hiding_spots.length) bad(`${map.hiding_spots.length - W.hides.length} hiding spots had no room for a hideout and were left out`);
// a jeep must be able to drive from the thana to every place it can be sent
for (const p of [...W.sites, ...W.escapes, ...W.hides.map(h => h.search)]) if (!W.findPath(p0.x, p0.y, p.x, p.y)) bad(`no police route from the thana to ${p.x},${p.y}`);
console.log(`${W.boxes.length} buildings, ${road} road cells, ${W.sites.length} places to rob, ${W.hides.length} hideouts, ${W.galis.length} tang galis.`);
console.log(problems ? `${problems} problem(s) found.` : 'Map is fully connected.');
process.exit(problems ? 1 : 0);
