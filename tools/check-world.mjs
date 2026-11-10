// Sanity check for the map: run `node tools/check-world.mjs` after editing data/map.json.
// Confirms every walkable cell, place to rob, hiding spot, way out and lever can actually be reached.
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
const human = flood(at(s0.x, s0.y), k => W.type[k] === T.WALK), police = flood(at(p0.x, p0.y), k => W.ai[k] === 1);
let problems = 0, walk = 0, reach = 0;
for (let k = 0; k < N * N; k++) if (W.type[k] === T.WALK) { walk++; if (human[k]) reach++; }
if (walk !== reach) { problems++; console.log(`${walk - reach} walkable cells cannot be reached on foot`); }
const check = (label, list, name, needPolice) => {
  for (const p of list) {
    if (!human[at(p.x, p.y)]) { problems++; console.log(`${label} "${name(p)}" cannot be reached by players`); }
    const q = W.nearestWalk(p.x, p.y, true);
    if (needPolice && (Math.hypot(q.x - p.x, q.y - p.y) > 1.5 || !police[at(q.x, q.y)])) { problems++; console.log(`${label} "${name(p)}" cannot be reached by computer police`); }
  }
};
check('place to rob', W.sites, p => p.full, true);
check('way out', W.escapes, p => p.name, true);
check('lever', W.levers, p => p.name, true);
check('hiding spot', W.hides, p => `${p.kind} at ${p.x},${p.y}`, false);
check('chor start', W.spawns, p => p.label, false);
for (const p of W.pipes) for (const e of [p.a, p.b]) if (!human[at(e.x, e.y)]) { problems++; console.log(`pipe mouth of ${p.name} at ${e.x},${e.y} cannot be reached`); }
console.log(`${W.boxes.length} buildings, ${walk} walkable cells, ${W.sites.length} places to rob, ${W.hides.length} hiding spots.`);
console.log(problems ? `${problems} problem(s) found.` : 'Map is fully connected.');
process.exit(problems ? 1 : 0);
