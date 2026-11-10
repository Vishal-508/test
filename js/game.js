// Chor Police: Jugnupur ki Raat. Game rules, police AI, multiplayer sync, input, HUD and the main loop.
import * as THREE from '../vendor/three.module.min.js';
import { CFG, matchSetup, rankFor } from './config.js';
import { buildWorld } from './world.js';
import { buildScene, paintMini, setSiteVisual, COLORS, LABELS } from './scene.js';
import { makeChar, animateChar, setCharAlpha, setCarry, makeCone } from './entities.js';
import { initAudio, sfx, setSiren, setMuted, isMuted } from './audio.js';
import { HostNet, ClientNet, cleanCode } from './net.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r2 = v => Math.round(v * 100) / 100;
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const TAU = Math.PI * 2;
const lerpAngle = (a, b, t) => a + ((((b - a + Math.PI) % TAU) + TAU) % TAU - Math.PI) * t;
const mmss = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ------------------------------------------------------------------ saved progress
const SAVE_KEY = 'jugnupur.save.v1';
const save = (() => { const d = { name: '', night: 1, total: 0, wins: 0, muted: false }; try { return Object.assign(d, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { return d; } })();
const storeSave = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode: play without saving */ } };

// ------------------------------------------------------------------ renderer and scene
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
const canvas = $('c');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' }); }
catch (e) { $('loading').textContent = 'This browser cannot show 3D graphics (WebGL is off or not supported). Try Chrome, Safari or Firefox on a newer device.'; throw e; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.fog);
scene.fog = new THREE.Fog(COLORS.fog, 14, 46);
const camera = new THREE.PerspectiveCamera(50, 1, 2.2, 170); // near plane also clips anything tall that drifts right in front of the lens
scene.add(new THREE.HemisphereLight(0x7d8cc0, 0x2a2e40, 1.0));
const moon = new THREE.DirectionalLight(0xb4c2ff, 0.75); moon.position.set(-30, 40, 45); scene.add(moon);
const torch = new THREE.PointLight(0xffdfb0, 14, 10, 1.4); torch.position.set(50, 1.6, 50); scene.add(torch);
const U = { uCut: { value: new THREE.Vector3(0.5, 0.5, -1) }, uRes: { value: new THREE.Vector2(1, 1) } };
const dyn = new THREE.Group(); scene.add(dyn);

function radialTexture(inner, outer) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, inner); g.addColorStop(0.45, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,236,200,0.55)', 'rgba(255,220,170,0.16)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
pool.rotation.x = -Math.PI / 2; pool.position.y = 0.022; pool.visible = false; scene.add(pool);
const arrowShape = new THREE.Shape(); arrowShape.moveTo(0, 0.42); arrowShape.lineTo(0.24, -0.1); arrowShape.lineTo(0, 0.02); arrowShape.lineTo(-0.24, -0.1); arrowShape.closePath();
const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: COLORS.loot, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
arrow.rotation.order = 'YXZ'; arrow.rotation.x = Math.PI / 2; arrow.position.y = 0.06; arrow.renderOrder = 15; arrow.visible = false; scene.add(arrow);

let W = null, H = null, miniBase = null;

// ------------------------------------------------------------------ state
const S = {
  screen: 'loading', net: null, isHost: true, solo: true, myId: 'h', paused: false,
  lobby: { code: '', players: [] }, night: 1,
  players: new Map(), cops: [], sites: [], me: null,
  t: 0, banked: 0, target: 700, over: null, leverLock: 0, cfg: null, flags: {}, evOut: [], pings: [],
  cam: { yaw: 0, dist: 8.8, pitch: 1.02, orbit: 0 },
  hold: { key: '', t: 0 }, latch: false, robSent: -1, unhideSent: false, ctx: null, danger: 0, lastSnap: 0, lastSend: 0, tickSfx: 0,
};
const In = { keys: new Set(), mx: 0, my: 0, actTouch: false, runTouch: false, stick: null, look: null };

// ------------------------------------------------------------------ small UI helpers
function show(id, on) { $(id).hidden = !on; }
function setScreen(name) {
  S.screen = name;
  show('menu', name === 'menu'); show('lobby', name === 'lobby'); show('end', name === 'over'); show('hud', name === 'play' || name === 'over'); show('pause', false);
  if (name !== 'play') { setSiren(0); $('vignette').style.opacity = 0; }
}
let toastTimer = 0;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200); }
function feed(text, kind) {
  const f = $('feed'), d = document.createElement('div'); d.textContent = text; if (kind) d.className = kind; f.appendChild(d);
  while (f.children.length > 4) f.removeChild(f.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 5200);
}
let bannerTimer = 0;
function banner(text, kind) { const b = $('banner'); b.textContent = text; b.className = 'on ' + (kind || ''); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { b.className = ''; }, 2200); }
function ping(x, y, dur, col) { S.pings.push({ x, y, t0: performance.now(), dur: dur * 1000, col }); }
const myName = () => (($('name').value || '').trim().slice(0, 14)) || 'Chhotu';

// ------------------------------------------------------------------ match setup
function clearDyn() { while (dyn.children.length) dyn.remove(dyn.children[0]); }
function newPlayer(p, k) {
  const isMe = p.id === S.myId;
  const P = {
    id: p.id, name: p.name, role: p.role, x: p.x, y: p.y, a: 0, rx: p.x, ry: p.y, ra: 0, spd: 0,
    hidden: -1, jailed: false, jailLeft: 0, immune: 0, carry: [], arrests: 0, own: 0, inPipe: false, pipeT: 0, pipeTo: null,
    robbing: -1, sprint: false, tpSeq: 0, stam: CFG.STAMINA_MAX, stamWait: 0, exhausted: false, isMe,
    char: makeChar(p.role, k, isMe ? '' : p.name),
  };
  P.char.ring.visible = isMe; dyn.add(P.char.g);
  return P;
}
function newCop(k, x, y) {
  const c = { id: k, x, y, a: Math.PI, rx: x, ry: y, ra: Math.PI, st: 'count', path: null, pi: 0, goal: null, target: null, lastSeen: null, sawT: -9, sweep: [], pre: null, wait: 0, repath: 0, searchT: 0, spd: 0, char: makeChar('police', k + 1, '') };
  c.cone = makeCone(CFG.VISION * ((S.cfg && S.cfg.visionMul) || 1), CFG.FOV); c.char.g.add(c.cone); dyn.add(c.char.g);
  return c;
}
function beginMatch(m) {
  clearDyn();
  S.cfg = m.cfg; S.target = m.cfg.target; S.t = 0; S.banked = 0; S.over = null; S.leverLock = 0; S.pings = []; S.evOut = []; S.flags = {};
  S.players = new Map();
  m.players.forEach((p, k) => S.players.set(p.id, newPlayer(p, k)));
  S.me = S.players.get(S.myId);
  S.sites = W.sites.map(s => ({ robbed: false, lockUntil: s.tier === 3 ? CFG.JACKPOT_AT : 0, prog: 0, alarmAt: -99, st: (s.tier === 3 || s.coach) ? 1 : 0, pct: 0 }));
  S.cops = [];
  if (S.isHost) for (let k = 0; k < m.cfg.cops; k++) { const sp = W.policeSpawns[(k + (m.cfg.copStart || 0)) % W.policeSpawns.length]; S.cops.push(newCop(k, sp.x, sp.y)); }
  const me = S.me;
  S.cam.yaw = Math.atan2(50 - me.x, me.y - 50);
  S.hold = { key: '', t: 0 }; S.latch = true; S.robSent = -1; S.unhideSent = false; S.paused = false; S.danger = 0;
  $('feed').innerHTML = '';
  $('role').textContent = me.role === 'chor' ? 'CHOR' : 'POLICE'; $('role').className = 'pill ' + me.role;
  $('btnAct').textContent = me.role === 'chor' ? 'ACT' : 'SEARCH';
  pool.visible = true; pool.scale.setScalar(me.role === 'police' ? 11 : 8);
  setScreen('play');
  lastHost = performance.now();
  if (me.role === 'chor') { feed('Rob the gold boxes. Carry the loot to a green beam.', 'gold'); feed('Hide in the violet circles. Running is noisy.'); }
  else { feed('Count to ' + CFG.COUNT + ', then catch the chors by touching them.'); feed('Watch your map for alarms. Search the violet circles.'); }
  canvas.focus();
}

function siteState(i) {
  const s = S.sites[i], d = W.sites[i];
  if (s.robbed) return 2;
  if (d.coach && (S.t < CFG.COACH_OPEN || S.t >= CFG.COACH_CLOSE)) return 1;
  return S.t < s.lockUntil ? 1 : 0;
}
const isJackpot = i => W.sites[i].tier === 3;
function canCarry(P, i) { return isJackpot(i) ? P.carry.length === 0 : (P.carry.length < 2 && !P.carry.some(isJackpot)); }
const carryValue = P => P.carry.reduce((s, i) => s + W.sites[i].value, 0);
const chors = () => [...S.players.values()].filter(p => p.role === 'chor');
const soloChor = () => chors().length <= 1;

// ------------------------------------------------------------------ host: rules
function ev(e) { S.evOut.push(e); handleEvent(e); }
function teleport(P, x, y) {
  P.x = x; P.y = y; P.tpSeq++;
  if (P.isMe) { P.rx = x; P.ry = y; } else if (S.net && !S.solo) S.net.send(P.id, { k: 'tp', x, y, q: P.tpSeq });
}
function alarm(i, loud) {
  const d = W.sites[i]; S.sites[i].alarmAt = S.t;
  const idle = S.cops.filter(c => c.st !== 'chase' && c.st !== 'count').sort((a, b) => dist(a, d) - dist(b, d));
  let go = [];
  if (d.tier === 3) go = idle; else if (d.tier === 2) go = idle.filter((c, k) => k === 0 || dist(c, d) < 20); else go = idle.filter((c, k) => k === 0 && dist(c, d) < 30);
  for (const c of go) { c.st = 'respond'; c.goal = { x: d.x, y: d.y }; c.hint = { x: d.x, y: d.y }; c.path = null; }
  ev({ t: loud ? 'alarm' : 'ping', m: loud ? 'ALARM at ' + d.full + '!' : 'Alarm bell at ' + d.full, x: d.x, y: d.y });
}
function arrest(ch, by) {
  if (ch.jailed || ch.immune > 0) return;
  for (const i of ch.carry) { S.sites[i].robbed = false; S.sites[i].lockUntil = S.t + CFG.RELOCK; S.sites[i].prog = 0; }
  const lost = carryValue(ch);
  ch.carry = []; ch.hidden = -1; ch.robbing = -1; ch.inPipe = false; ch.jailed = true; ch.arrests++;
  ch.jailLeft = soloChor() ? CFG.JAIL_SOLO : CFG.JAIL_MULTI;
  const jailed = chors().filter(p => p.jailed).length, slot = W.cageSlots[(jailed - 1) % W.cageSlots.length];
  teleport(ch, slot.x, slot.y);
  S.leverLock = S.t + CFG.LEVER_LOCK;
  for (const c of S.cops) if (c.target === ch.id) { c.st = 'patrol'; c.target = null; c.path = null; c.wait = 1.2; }
  if (by && by.role === 'police') by.arrests++;
  ev({ t: 'arrest', m: ch.name + ' was caught by ' + (by ? by.name : 'a constable') + (lost ? '. ' + money(lost) + ' goes back.' : '.'), who: ch.id });
  const all = chors();
  if (soloChor()) { if (ch.arrests >= CFG.MAX_ARRESTS_SOLO) endRound('police', 'Caught ' + CFG.MAX_ARRESTS_SOLO + ' times.'); }
  else if (all.every(p => p.jailed)) endRound('police', 'Every chor is in the lock-up.');
}
function release(P, how) {
  if (!P.jailed) return;
  P.jailed = false; P.jailLeft = 0; P.immune = CFG.IMMUNE;
  const rp = W.releasePoints[(S.flags.rel = (S.flags.rel || 0) + 1) % W.releasePoints.length];
  teleport(P, rp.x + (Math.random() - 0.5) * 0.6, rp.y + (Math.random() - 0.5) * 0.6);
  if (how === 'bail') ev({ t: 'free', m: P.name + ' is out on bail.', who: [P.id] });
}
function endRound(w, why) {
  if (S.over) return;
  S.over = { w, why, t: Math.round(S.t), b: S.banked, tg: S.target, pl: [...S.players.values()].map(p => ({ id: p.id, n: p.name, r: p.role, own: p.own, ar: p.arrests })) };
  if (S.net && !S.solo) S.net.broadcast(snapshot());
  finishMatch(S.over);
}
function doAction(P, type, i) {
  if (!P || S.over || S.screen !== 'play') return;
  i = i | 0;
  const slack = P.isMe ? 0.3 : 1.2; // remote players are judged on slightly older positions
  if (type === 'rob') { P.robbing = (P.role === 'chor' && !P.jailed && i >= 0 && i < W.sites.length) ? i : -1; return; }
  if (P.jailed) return;
  if (P.role === 'chor') {
    if (type === 'bank') {
      const e = W.escapes[i]; if (!e || !P.carry.length || dist(P, e) > CFG.BANK_RANGE + slack) return;
      const v = carryValue(P), jack = P.carry.some(isJackpot);
      P.carry = []; P.own += v; S.banked += v;
      ev({ t: 'bank', m: P.name + ' banked ' + money(v) + ' at ' + e.name + '.', j: jack ? 1 : 0, x: e.x, y: e.y, who: P.id });
      if (S.banked >= S.target) endRound('chor', 'Target banked with ' + mmss(CFG.ROUND - S.t) + ' to spare.');
    } else if (type === 'hide') {
      const h = W.hides[i]; if (!h || P.hidden >= 0 || dist(P, h) > CFG.HIDE_RANGE + slack || P.carry.some(isJackpot)) return;
      if ([...S.players.values()].some(o => o !== P && o.hidden === i)) return;
      for (const c of S.cops) if (c.st === 'chase' && c.target === P.id && S.t - c.sawT < 0.5 && dist(c, P) < 9) { c.st = 'search'; c.sweep = [i]; c.pre = null; c.path = null; c.searchT = 0; }
      P.hidden = i; P.robbing = -1;
    } else if (type === 'unhide') { P.hidden = -1; }
    else if (type === 'lever') {
      const l = W.levers[i]; if (!l || dist(P, l) > CFG.LEVER_RANGE + slack || S.t < S.leverLock) return;
      const inside = chors().filter(p => p.jailed); if (!inside.length) return;
      inside.forEach(p => release(p, 'lever'));
      ev({ t: 'free', m: P.name + ' pulled the lever. ' + inside.map(p => p.name).join(', ') + ' ' + (inside.length > 1 ? 'are' : 'is') + ' free!', who: inside.map(p => p.id), x: l.x, y: l.y });
    }
  } else if (type === 'search') {
    const h = W.hides[i]; if (!h || dist(P, h) > CFG.SEARCH_RANGE + slack) return;
    const found = chors().find(p => p.hidden === i && !p.jailed);
    if (found) { found.immune = 0; arrest(found, P); }
    else if (P.isMe) feed('Nothing here.'); else if (S.net) S.net.send(P.id, { k: 'note', m: 'Nothing here.' });
  }
}
function removePlayer(id) {
  const P = S.players.get(id); if (!P) return;
  for (const i of P.carry) { S.sites[i].robbed = false; S.sites[i].prog = 0; }
  dyn.remove(P.char.g); S.players.delete(id);
  ev({ t: 'left', m: P.name + ' left the game.', who: id });
  if (S.isHost && !S.over && S.screen === 'play') {
    const all = chors();
    if (!all.length) endRound('police', 'No chors left in town.');
    else if (all.length > 1 && all.every(p => p.jailed)) endRound('police', 'Every chor is in the lock-up.');
    else if (P.role === 'police') { // a police player left: computer constables take over so the chors still have someone to dodge
      const humans = [...S.players.values()].filter(p => p.role === 'police').length, want = matchSetup(all.length, humans, 1).cops;
      while (S.cops.length < want) { const sp = W.policeSpawns[S.cops.length % W.policeSpawns.length]; const c = newCop(S.cops.length, sp.x, sp.y); c.st = 'patrol'; S.cops.push(c); }
    }
  }
}

// ------------------------------------------------------------------ host: police AI
function copGo(c, x, y) { c.path = W.findPath(c.x, c.y, x, y) || []; c.pi = c.path.length > 1 ? 1 : 0; }
function copMove(c, speed, dt) {
  if (!c.path || c.pi >= c.path.length) { c.spd = 0; return true; }
  let rem = speed * dt; c.spd = speed;
  while (rem > 0 && c.pi < c.path.length) {
    const n = c.path[c.pi], dx = n.x - c.x, dy = n.y - c.y, d = Math.hypot(dx, dy);
    if (d <= rem) { c.x = n.x; c.y = n.y; rem -= d; c.pi++; if (d > 0.001) c.a = Math.atan2(dx, dy); }
    else { c.x += dx / d * rem; c.y += dy / d * rem; c.a = Math.atan2(dx, dy); rem = 0; }
  }
  return c.pi >= c.path.length;
}
function copSees(c, ch) {
  if (ch.hidden >= 0 || ch.inPipe || ch.jailed) return false;
  const d = dist(c, ch), chasing = c.st === 'chase' && c.target === ch.id;
  const range = (W.inPark(ch.x, ch.y) ? CFG.VISION_PARK : CFG.VISION) * S.cfg.visionMul + (chasing ? 3 : 0);
  if (d > range) return false;
  if (d > 1.6 && !chasing) {
    const dot = (Math.sin(c.a) * (ch.x - c.x) + Math.cos(c.a) * (ch.y - c.y)) / d;
    if (dot < Math.cos(CFG.FOV)) return false;
  }
  return W.los(c.x, c.y, ch.x, ch.y);
}
function nearHides(p, n, maxD) {
  return W.hides.map(h => ({ i: h.i, d: dist(h, p) })).filter(o => o.d < maxD).sort((a, b) => a.d - b.d).slice(0, n).map(o => o.i);
}
function pickPatrol(c) {
  if (c.hint) { // after an alarm: go and look at the way out a chor would most likely run for
    const h = c.hint; c.hint = null;
    if (Math.random() < 0.7) return W.escapes.reduce((b, e) => (!b || dist(e, h) < dist(b, h)) ? e : b, null);
  }
  const cand = [];
  W.sites.forEach((s, i) => { if (!S.sites[i].robbed) cand.push({ x: s.x, y: s.y, w: [0, 1, 2, 4][s.tier] }); });
  W.escapes.forEach(e => cand.push({ x: e.x, y: e.y, w: 2 }));
  W.posts.forEach(p => cand.push({ x: p.x, y: p.y, w: 1 }));
  let total = 0;
  for (const k of cand) {
    if (dist(k, c) < 9) k.w *= 0.15;
    for (const o of S.cops) if (o !== c && o.goal && dist(o.goal, k) < 14) k.w *= 0.3;
    total += k.w;
  }
  let r = Math.random() * total;
  for (const k of cand) { r -= k.w; if (r <= 0) return k; }
  return cand[0];
}
function copTick(c, dt) {
  if (S.t < CFG.COUNT) { c.st = 'count'; c.spd = 0; c.a += dt * 0.6; return; }
  if (c.st === 'count') { c.st = 'patrol'; c.wait = 0.25 * c.id; }
  const sp = S.cfg.speedMul;
  let seen = null, sd = 1e9;
  for (const ch of chors()) { if (copSees(c, ch)) { const d = dist(c, ch); if (d < sd) { sd = d; seen = ch; } } }
  if (seen) {
    if (c.st !== 'chase' || c.target !== seen.id) { ev({ t: 'spot', to: seen.id }); c.repath = 0; }
    c.st = 'chase'; c.target = seen.id; c.lastSeen = { x: seen.x, y: seen.y, t: S.t }; c.sawT = S.t;
  } else if (c.st === 'patrol' || c.st === 'search') {
    for (const ch of chors()) if (ch.sprint && ch.spd > 0.5 && ch.hidden < 0 && !ch.inPipe && !ch.jailed && dist(c, ch) < CFG.NOISE_RANGE) { c.st = 'respond'; c.goal = { x: ch.x, y: ch.y }; c.path = null; break; }
  }
  if (c.st === 'chase') {
    const tg = S.players.get(c.target);
    if (!tg || tg.jailed) { c.st = 'patrol'; c.target = null; c.path = null; c.wait = 0.8; return; }
    if (tg.hidden >= 0 || tg.inPipe) { c.st = 'search'; c.sweep = nearHides(c.lastSeen, 2, 7); c.pre = { x: c.lastSeen.x, y: c.lastSeen.y }; c.path = null; c.searchT = 0; c.target = null; return; }
    if (!seen && S.t - c.lastSeen.t > 2.4) { c.st = 'search'; c.sweep = nearHides(c.lastSeen, 2, 7); c.pre = { x: c.lastSeen.x, y: c.lastSeen.y }; c.path = null; c.searchT = 0; c.target = null; return; }
    c.repath -= dt;
    if (c.repath <= 0) { c.repath = 0.3; const fresh = seen || S.t - c.lastSeen.t < 0.7; copGo(c, fresh ? tg.x : c.lastSeen.x, fresh ? tg.y : c.lastSeen.y); }
    copMove(c, CFG.COP_CHASE * sp, dt);
  } else if (c.st === 'respond') {
    if (!c.path) copGo(c, c.goal.x, c.goal.y);
    if (copMove(c, CFG.COP_RUN * sp, dt)) { c.st = 'search'; c.sweep = nearHides(c.goal, 2, 7); c.pre = null; c.path = null; c.searchT = 0; }
  } else if (c.st === 'search') {
    if (c.pre) { if (!c.path) copGo(c, c.pre.x, c.pre.y); if (copMove(c, CFG.COP_RUN * sp, dt)) { c.pre = null; c.path = null; } return; }
    if (!c.sweep.length) { c.st = 'patrol'; c.path = null; c.wait = 0.6; return; }
    const h = W.hides[c.sweep[0]];
    if (!c.path) copGo(c, h.x, h.y);
    if (copMove(c, CFG.COP_RUN * 0.9 * sp, dt) || dist(c, h) < 0.8) {
      c.spd = 0; c.a = lerpAngle(c.a, Math.atan2(h.x - c.x, h.y - c.y), Math.min(1, dt * 8)); c.searchT += dt;
      if (c.searchT >= 0.8) {
        c.searchT = 0;
        if (dist(c, h) < 1.7) { const f = chors().find(p => p.hidden === h.i && !p.jailed); if (f) { f.immune = 0; arrest(f, null); } }
        c.sweep.shift(); c.path = null;
      }
    }
  } else { // patrol
    if (c.wait > 0) { c.wait -= dt; c.a += dt * 0.9; c.spd = 0; return; }
    if (!c.path || c.pi >= c.path.length) { const g = pickPatrol(c); c.goal = { x: g.x, y: g.y }; copGo(c, g.x, g.y); if (!c.path.length) { c.wait = 1; return; } }
    if (copMove(c, CFG.COP_PATROL * sp, dt)) { c.wait = 0.6 + Math.random() * 1.2; c.path = null; }
  }
}

function hostTick(dt) {
  if (S.over) return;
  S.t += dt;
  const F = S.flags;
  if (!F.go && S.t >= CFG.COUNT) { F.go = 1; ev({ t: 'info', m: 'The police have finished counting. Run!' }); }
  if (!F.jack && S.t >= CFG.JACKPOT_AT) { F.jack = 1; ev({ t: 'chime', m: 'The clock tower chimes. The three tijoris are open!' }); }
  if (!F.co && S.t >= CFG.COACH_OPEN) { F.co = 1; ev({ t: 'chime', m: 'The mail coach strongbox is open for one minute!' }); }
  if (!F.cc && S.t >= CFG.COACH_CLOSE) { F.cc = 1; if (!S.sites[W.sites.findIndex(s => s.coach)].robbed) ev({ t: 'info', m: 'The mail coach has shut its strongbox.' }); }
  if (!F.min && S.t >= CFG.ROUND - 60) { F.min = 1; ev({ t: 'info', m: 'One minute left!' }); }
  const all = [...S.players.values()];
  for (const P of all) {
    if (P.immune > 0) P.immune -= dt;
    if (P.jailed) { P.jailLeft -= dt; if (P.jailLeft <= 0) release(P, 'bail'); }
  }
  // robbing: progress lives on the host so two chors on one box really are faster
  for (let i = 0; i < W.sites.length; i++) {
    const s = S.sites[i], d = W.sites[i]; s.st = siteState(i);
    if (s.st !== 0) { s.prog = 0; continue; }
    const hs = all.filter(P => P.role === 'chor' && P.robbing === i && !P.jailed && P.hidden < 0 && !P.inPipe && dist(P, d) < CFG.ROB_RANGE + 1 && canCarry(P, i));
    if (hs.length) {
      if (d.tier === 3 && S.t - s.alarmAt > 6) alarm(i, true);
      if (d.tier === 2 && s.prog === 0 && S.t - s.alarmAt > 5) alarm(i, false);
      s.prog += dt * Math.pow(hs.length, 0.9);
      if (s.prog >= CFG.HOLD[d.tier]) {
        s.robbed = true; s.prog = 0; s.st = 2; hs[0].carry.push(i); hs.forEach(P => { P.robbing = -1; });
        ev({ t: 'grab', m: hs[0].name + ' robbed ' + d.full + ' (' + money(d.value) + ').', who: hs[0].id });
        if (d.tier !== 3) alarm(i, false);
      }
    } else if (s.prog > 0) s.prog = Math.max(0, s.prog - dt * 2.5);
  }
  // witnesses: a chor carrying loot through lit streets gets reported now and then (never in the dark park, a hiding spot or a pipe)
  for (const ch of all) {
    if (ch.role !== 'chor' || !ch.carry.length) { ch.tipAt = S.t; continue; }
    if (ch.jailed || ch.hidden >= 0 || ch.inPipe || W.inPark(ch.x, ch.y) || S.cops.some(c => c.st === 'chase' && c.target === ch.id)) continue;
    if (S.t - (ch.tipAt || 0) < (ch.carry.some(isJackpot) ? CFG.TIP_EVERY_JACKPOT : CFG.TIP_EVERY)) continue;
    ch.tipAt = S.t;
    const near = W.sites.reduce((b, s) => (!b || dist(s, ch) < dist(b, ch)) ? s : b, null);
    const idle = S.cops.filter(c => c.st !== 'chase' && c.st !== 'count').sort((a, b) => dist(a, ch) - dist(b, ch)).slice(0, ch.carry.some(isJackpot) ? 2 : 1);
    for (const c of idle) { c.st = 'respond'; c.goal = { x: ch.x, y: ch.y }; c.hint = { x: ch.x, y: ch.y }; c.path = null; }
    ev({ t: 'tip', m: 'Tip-off: a chor with a bag was seen near ' + near.full + '.', x: ch.x, y: ch.y, who: ch.id });
  }
  for (const c of S.cops) copTick(c, dt);
  // arrests: a constable or a police player touching a chor
  const pol = all.filter(P => P.role === 'police');
  for (const ch of all) {
    if (ch.role !== 'chor' || ch.jailed || ch.hidden >= 0 || ch.inPipe || ch.immune > 0) continue;
    let by = null, got = false;
    for (const c of S.cops) if (c.st !== 'count' && dist(c, ch) < CFG.ARREST_DIST) { got = true; break; }
    if (!got) for (const p of pol) if (S.t >= CFG.COUNT && dist(p, ch) < CFG.ARREST_DIST + 0.1) { got = true; by = p; break; }
    if (got) arrest(ch, by);
    if (S.over) return;
  }
  if (S.t >= CFG.ROUND) endRound('police', 'Time ran out with ' + money(S.banked) + ' of ' + money(S.target) + ' banked.');
}

// ------------------------------------------------------------------ network: snapshots
const ST_CODE = { patrol: 0, respond: 1, chase: 2, search: 3, count: 4 };
function snapshot() {
  const m = {
    k: 's', t: r2(S.t), b: S.banked, ll: r2(Math.max(0, S.leverLock - S.t)),
    s: S.sites.map((s, i) => [s.st, Math.round(100 * s.prog / CFG.HOLD[W.sites[i].tier])]),
    p: [...S.players.values()].map(P => [P.id, r2(P.x), r2(P.y), r2(P.a), (P.jailed ? 1 : 0) | (P.immune > 0 ? 2 : 0) | (P.inPipe ? 4 : 0) | (P.sprint ? 8 : 0), P.hidden, P.carry, Math.ceil(P.jailLeft), P.arrests, P.own, r2(P.spd)]),
    c: S.cops.map(c => [r2(c.x), r2(c.y), r2(c.a), ST_CODE[c.st], c.target || '', r2(c.spd)]),
    e: S.evOut,
  };
  if (S.over) m.o = S.over;
  return m;
}
function applySnapshot(m) {
  if (S.screen !== 'play') return;
  S.t = m.t; S.banked = m.b; S.leverLock = m.t + m.ll;
  m.s.forEach((v, i) => { if (S.sites[i]) { S.sites[i].st = v[0]; S.sites[i].pct = v[1]; S.sites[i].robbed = v[0] === 2; } });
  const seen = new Set();
  for (const v of m.p) {
    const P = S.players.get(v[0]); if (!P) continue; seen.add(v[0]);
    if (!P.isMe) { P.x = v[1]; P.y = v[2]; P.a = v[3]; P.inPipe = !!(v[4] & 4); P.sprint = !!(v[4] & 8); P.spd = v[10]; }
    P.jailed = !!(v[4] & 1); P.immune = (v[4] & 2) ? 1 : 0; P.hidden = v[5]; P.carry = v[6]; P.jailLeft = v[7]; P.arrests = v[8]; P.own = v[9];
  }
  while (S.cops.length < m.c.length) S.cops.push(newCop(S.cops.length, m.c[S.cops.length][0], m.c[S.cops.length][1]));
  m.c.forEach((v, k) => { const c = S.cops[k]; c.x = v[0]; c.y = v[1]; c.a = v[2]; c.st = ['patrol', 'respond', 'chase', 'search', 'count'][v[3]]; c.target = v[4] || null; c.spd = v[5]; });
  for (const e of m.e) handleEvent(e);
  if (m.o && !S.over) { S.over = m.o; finishMatch(m.o); }
}
function handleEvent(e) {
  const me = S.me; if (!me) return;
  if (e.to && e.to !== me.id) return;
  const mine = e.who === me.id || (Array.isArray(e.who) && e.who.includes(me.id));
  switch (e.t) {
    case 'alarm': ping(e.x, e.y, 9, '#ff4a4a'); feed(e.m, 'alarm'); sfx.alarm(); S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; break;
    case 'ping': ping(e.x, e.y, 5, '#ff8a4a'); if (me.role === 'police') { feed(e.m, 'alarm'); S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; } sfx.bell(); break;
    case 'grab': feed(e.m, 'gold'); if (mine) sfx.grab(); break;
    case 'tip': if (me.role === 'police') { ping(e.x, e.y, 6, '#ff8a4a'); feed(e.m, 'alarm'); S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; sfx.bell(); } else if (mine) { feed('Someone saw your bag. The police have been tipped off!', 'alarm'); sfx.bell(); } break;
    case 'bank': feed(e.m, 'good'); if (e.j) { sfx.jackpot(); if (me.role === 'police') { ping(e.x, e.y, 10, '#ff4a4a'); S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; } } else sfx.coin(); break;
    case 'arrest': feed(e.m, 'alarm'); sfx.caught(); if (mine) banner('PAKDE GAYE!', 'red'); break;
    case 'free': feed(e.m, 'good'); sfx.free(); if (mine) banner('AZAAD!', 'green'); break;
    case 'chime': banner(e.m, 'gold'); feed(e.m, 'gold'); sfx.chime(); break;
    case 'spot': banner('DEKH LIYA! RUN!', 'red'); sfx.spotted(); break;
    case 'left': { feed(e.m); const P = S.players.get(e.who); if (P && !S.isHost) { dyn.remove(P.char.g); S.players.delete(e.who); } break; }
    default: if (e.m) feed(e.m);
  }
}

// ------------------------------------------------------------------ local player
function request(type, i) { if (S.isHost) doAction(S.me, type, i); else if (S.net) S.net.send({ k: 'a', t: type, i }); }
function findContext(me) {
  if (me.jailed) return { type: 'none', label: 'In the lock-up. ' + (soloChor() ? 'Bail in ' : 'A friend can pull a lever. Bail in ') + Math.max(0, Math.ceil(me.jailLeft)) + 's' };
  if (me.inPipe) return { type: 'none', label: 'Crawling through the pipe…' };
  const out = [];
  if (me.role === 'chor') {
    if (me.hidden >= 0) return { type: 'unhide', key: 'unhide', hold: 0.12, act: true, label: 'Hidden. Move to come out.' };
    if (me.carry.length) for (const e of W.escapes) { const d = dist(me, e); if (d < CFG.BANK_RANGE) out.push({ s: d / CFG.BANK_RANGE - 0.5, type: 'bank', i: e.i, key: 'bank' + e.i, hold: CFG.BANK_HOLD, act: true, label: 'Hold to bank ' + money(carryValue(me)) }); }
    W.sites.forEach((s, i) => {
      const d = dist(me, s); if (d > CFG.ROB_RANGE) return;
      const st = S.sites[i].st;
      if (st === 2) return;
      if (st === 1) out.push({ s: d / CFG.ROB_RANGE + 0.2, type: 'none', label: s.coach ? (S.t < CFG.COACH_OPEN ? 'Strongbox opens at 3:00' : 'Strongbox is shut') : (S.t < CFG.JACKPOT_AT ? 'Locked until the clock chimes at 1:00' : 'Locked again for a moment') });
      else if (!canCarry(me, i)) out.push({ s: d / CFG.ROB_RANGE + 0.2, type: 'none', label: 'Bag is full. Bank it first.' });
      else out.push({ s: d / CFG.ROB_RANGE, type: 'rob', i, key: 'rob' + i, act: true, label: 'Hold to rob ' + s.full + '  ' + money(s.value) });
    });
    if (chors().some(p => p.jailed && p !== me)) for (const l of W.levers) {
      const d = dist(me, l); if (d > CFG.LEVER_RANGE) continue;
      if (S.t < S.leverLock) out.push({ s: d / CFG.LEVER_RANGE, type: 'none', label: 'Lever locked for ' + Math.ceil(S.leverLock - S.t) + 's' });
      else out.push({ s: d / CFG.LEVER_RANGE - 0.3, type: 'lever', i: l.i, key: 'lever' + l.i, hold: CFG.LEVER_HOLD, act: true, label: 'Hold to open the lock-up' });
    }
    W.pipes.forEach((p, k) => [p.a, p.b].forEach((e, n) => { const d = dist(me, e); if (d < CFG.PIPE_RANGE) out.push({ s: d / CFG.PIPE_RANGE + 0.1, type: 'pipe', i: k * 2 + n, key: 'pipe' + k + n, hold: CFG.PIPE_HOLD, act: true, label: 'Hold to crawl through the pipe' }); }));
    for (const h of W.hides) {
      const d = dist(me, h); if (d > CFG.HIDE_RANGE) continue;
      if (me.carry.some(isJackpot)) out.push({ s: d / CFG.HIDE_RANGE + 0.3, type: 'none', label: 'Jackpot bag is too big to hide with' });
      else if ([...S.players.values()].some(o => o !== me && o.hidden === h.i)) out.push({ s: d / CFG.HIDE_RANGE + 0.3, type: 'none', label: 'Someone is already hiding here' });
      else out.push({ s: d / CFG.HIDE_RANGE + 0.05, type: 'hide', i: h.i, key: 'hide' + h.i, hold: CFG.HIDE_HOLD, act: true, label: 'Hide here (' + h.kind + ')' });
    }
  } else {
    if (S.t < CFG.COUNT) return { type: 'none', label: 'Counting… ' + Math.ceil(CFG.COUNT - S.t) };
    for (const h of W.hides) { const d = dist(me, h); if (d < CFG.SEARCH_RANGE) out.push({ s: d, type: 'search', i: h.i, key: 'search' + h.i, hold: CFG.SEARCH_HOLD, act: true, label: 'Hold to search the ' + h.kind }); }
  }
  out.sort((a, b) => a.s - b.s);
  return out[0] || null;
}
function startPipe(code) {
  const me = S.me, p = W.pipes[code >> 1], to = (code & 1) ? p.a : p.b;
  me.inPipe = true; me.pipeT = CFG.PIPE_TRAVEL; me.pipeTo = { x: to.x, y: to.y }; me.spd = 0; sfx.pipe();
}
function perform(ctx) {
  switch (ctx.type) {
    case 'bank': request('bank', ctx.i); break;
    case 'hide': request('hide', ctx.i); sfx.hide(); break;
    case 'unhide': request('unhide', 0); break;
    case 'lever': request('lever', ctx.i); break;
    case 'search': request('search', ctx.i); sfx.click(); break;
    case 'pipe': startPipe(ctx.i); break;
  }
}
function moveInput() {
  let ix = In.mx, iy = In.my; const k = In.keys;
  if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1; if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
  if (k.has('KeyW') || k.has('ArrowUp')) iy += 1; if (k.has('KeyS') || k.has('ArrowDown')) iy -= 1;
  const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
  const yaw = S.cam.yaw, fx = Math.sin(yaw), fy = -Math.cos(yaw), rx = Math.cos(yaw), ry = Math.sin(yaw);
  return { x: fx * iy + rx * ix, y: fy * iy + ry * ix, len: Math.min(1, l) };
}
function localUpdate(dt) {
  const me = S.me; if (!me) return;
  const k = In.keys;
  if (k.has('KeyQ')) S.cam.yaw -= 1.9 * dt; if (k.has('KeyE')) S.cam.yaw += 1.9 * dt;
  const actHeld = k.has('Space') || k.has('KeyF') || k.has('Enter') || In.actTouch;
  const runHeld = k.has('ShiftLeft') || k.has('ShiftRight') || In.runTouch;
  if (!actHeld) S.latch = false;
  const mv = moveInput();
  if (me.jailed) { me.spd = 0; me.sprint = false; }
  else if (me.inPipe) {
    me.pipeT -= dt;
    if (me.pipeT <= 0) { me.x = me.pipeTo.x; me.y = me.pipeTo.y; me.inPipe = false; sfx.hide(); }
  } else if (me.hidden >= 0) {
    me.spd = 0; me.sprint = false;
    if (mv.len > 0.3 && !S.unhideSent) { request('unhide', 0); S.unhideSent = true; }
  } else if (S.screen === 'play' && !(me.role === 'police' && S.t < CFG.COUNT)) {
    S.unhideSent = false;
    if (!W.walkable(me.x, me.y)) { const q = W.nearestWalk(me.x, me.y); me.x = q.x; me.y = q.y; }
    const moving = mv.len > 0.08;
    const sprint = runHeld && moving && !me.exhausted && me.stam > 0;
    if (sprint) { me.stam -= dt; me.stamWait = CFG.STAMINA_DELAY; if (me.stam <= 0) { me.stam = 0; me.exhausted = true; } }
    else { me.stamWait -= dt; if (me.stamWait <= 0) me.stam = Math.min(CFG.STAMINA_MAX, me.stam + CFG.STAMINA_REGEN * dt); if (me.stam > 1.2) me.exhausted = false; }
    let speed = me.role === 'chor' ? (sprint ? CFG.CHOR_SPRINT : CFG.CHOR_WALK) : (sprint ? CFG.POLICE_SPRINT : CFG.POLICE_WALK);
    for (const i of me.carry) speed *= 1 - (isJackpot(i) ? CFG.CARRY_SLOW_JACKPOT : CFG.CARRY_SLOW);
    if (moving) {
      const dx = mv.x * speed * dt, dy = mv.y * speed * dt, r = 0.2;
      if (W.free(me.x + dx, me.y, r)) me.x += dx;
      if (W.free(me.x, me.y + dy, r)) me.y += dy;
      me.a = lerpAngle(me.a, Math.atan2(mv.x, mv.y), Math.min(1, dt * 14));
    }
    me.spd = moving ? speed * mv.len : 0; me.sprint = sprint;
  } else { me.spd = 0; }

  // what can I do right here?
  const ctx = S.over ? null : findContext(me); S.ctx = ctx;
  const can = actHeld && !S.latch && ctx && ctx.act;
  if (ctx && ctx.type === 'rob') {
    if (can) { if (S.robSent !== ctx.i) { request('rob', ctx.i); S.robSent = ctx.i; } S.tickSfx -= dt; if (S.tickSfx <= 0) { sfx.tick(); S.tickSfx = 0.33; } }
    else if (S.robSent !== -1) { request('rob', -1); S.robSent = -1; }
    S.hold.t = 0;
  } else {
    if (S.robSent !== -1) { request('rob', -1); S.robSent = -1; }
    if (can) {
      if (S.hold.key !== ctx.key) S.hold = { key: ctx.key, t: 0 };
      S.hold.t += dt;
      if (S.hold.t >= ctx.hold) { perform(ctx); S.hold = { key: '', t: 0 }; S.latch = true; }
    } else S.hold.t = 0;
  }
  // clients tell the host where they are
  if (!S.isHost && S.net) {
    const now = performance.now();
    if (now - S.lastSend > 66) { S.lastSend = now; S.net.send({ k: 'p', x: r2(me.x), y: r2(me.y), a: r2(me.a), f: (me.sprint ? 1 : 0) | (me.inPipe ? 2 : 0), v: r2(me.spd), q: me.tpSeq }); }
  }
}

// ------------------------------------------------------------------ drawing: entities, camera, HUD
const v3 = new THREE.Vector3();
function syncEntities(dt, time) {
  const me = S.me;
  for (const P of S.players.values()) {
    const k = Math.min(1, dt * 11);
    if (P.isMe || Math.hypot(P.x - P.rx, P.y - P.ry) > 6) { P.rx = P.x; P.ry = P.y; P.ra = P.isMe ? P.a : lerpAngle(P.ra, P.a, k); }
    else { P.rx += (P.x - P.rx) * k; P.ry += (P.y - P.ry) * k; P.ra = lerpAngle(P.ra, P.a, k); }
    let vis = true, alpha = 1;
    if (P.inPipe) vis = false;
    else if (P.hidden >= 0) { if (P.isMe || (me && me.role === 'chor' && P.role === 'chor')) alpha = 0.35; else vis = false; }
    else if (!P.isMe && P.role === 'chor' && me && me.role === 'police' && !P.jailed) vis = dist(me, P) < 13 && W.los(me.x, me.y, P.rx, P.ry);
    if (vis && P.immune > 0 && Math.sin(time * 22) > 0) alpha = Math.min(alpha, 0.45);
    P.seen = vis; P.char.g.visible = vis;
    P.char.g.position.set(P.rx, 0, P.ry); P.char.g.rotation.y = P.ra;
    setCharAlpha(P.char, alpha); setCarry(P.char, P.carry.length, P.carry.some(isJackpot));
    P.char.body.scale.y = (P.hidden >= 0 ? 0.62 : 1) * 1.18;
    animateChar(P.char, (P.jailed || P.hidden >= 0) ? 0 : P.spd, dt, time);
  }
  for (const c of S.cops) {
    const k = Math.min(1, dt * 11);
    c.rx += (c.x - c.rx) * k; c.ry += (c.y - c.ry) * k; c.ra = lerpAngle(c.ra, c.a, Math.min(1, dt * 9));
    c.char.g.position.set(c.rx, 0, c.ry); c.char.g.rotation.y = c.ra;
    c.char.chase = c.st === 'chase';
    c.cone.visible = c.st !== 'count';
    c.cone.material.color.setHex(c.st === 'chase' ? 0xff5050 : c.st === 'patrol' ? 0xfff2b0 : 0xffb060);
    c.cone.material.opacity = c.st === 'chase' ? 0.2 : 0.11;
    animateChar(c.char, c.spd, dt, time);
  }
}
function updateCamera(dt, time) {
  const cam = S.cam;
  if (S.screen === 'play' || S.screen === 'over') {
    const me = S.me; if (!me) return;
    let tx = me.rx, tz = me.ry;
    if (me.inPipe && me.pipeTo) { const f = 1 - clamp(me.pipeT / CFG.PIPE_TRAVEL, 0, 1), e = f * f * (3 - 2 * f); tx = me.x + (me.pipeTo.x - me.x) * e; tz = me.y + (me.pipeTo.y - me.y) * e; }
    const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), D = cam.dist, cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camera.position.set(tx - fx * D * cp, D * sp, tz - fz * D * cp);
    camera.lookAt(tx, 0.45, tz);
    camera.updateMatrixWorld();
    v3.set(tx, 0.45, tz).project(camera); U.uCut.value.x = v3.x * 0.5 + 0.5; U.uCut.value.y = v3.y * 0.5 + 0.5;
    v3.set(tx, 0.45, tz).applyMatrix4(camera.matrixWorldInverse); U.uCut.value.z = -v3.z;
    torch.position.set(tx, 1.5, tz); pool.position.x = tx; pool.position.z = tz;
  } else {
    cam.orbit += dt * 0.05;
    camera.position.set(50 + Math.sin(cam.orbit) * 30, 19, 50 + Math.cos(cam.orbit) * 30);
    camera.lookAt(50, 0, 50); U.uCut.value.z = -1; torch.position.set(50, 3, 50);
  }
}
function updateLabels() {
  // keep name tags a steady size on screen and fade the ones right beside the camera
  for (const sp of LABELS) {
    if (!sp.visible) continue;
    sp.getWorldPosition(v3); const d = v3.distanceTo(camera.position), s = sp.userData.base * clamp(d / 9.5, 0.55, 2.2);
    sp.scale.set(s * sp.userData.ratio, s, 1); sp.material.opacity = clamp((d - 3.2) / 2.5, 0, 1);
  }
}
function updateWorldVisuals(time) {
  for (let i = 0; i < S.sites.length; i++) {
    const v = H.siteVis[i]; setSiteVisual(v, S.sites[i].st);
    if (S.sites[i].st === 0) v.beam.material.opacity = 0.17 + 0.07 * Math.sin(time * 3 + i);
  }
  const locked = S.t < S.leverLock;
  for (const l of H.leverVis) l.bulb.material.color.setHex(locked ? 0xff4a4a : COLORS.police);
  H.thanaLamp.material.color.setHex(Math.floor(time * 2) % 2 ? 0x8fb4ff : 0xff6a6a);
  // arrow at your feet pointing to the next useful place
  const me = S.me; let tgt = null, col = COLORS.loot;
  if (me && S.screen === 'play' && !me.jailed && me.hidden < 0 && !me.inPipe) {
    if (me.role === 'chor') {
      if (me.carry.length) { col = COLORS.escape; tgt = W.escapes.reduce((b, e) => (!b || dist(me, e) < dist(me, b)) ? e : b, null); }
      else { let bd = 1e9; W.sites.forEach((s, i) => { if (S.sites[i].st === 0) { const d = dist(me, s); if (d < bd) { bd = d; tgt = s; } } }); }
    } else if (S.lastAlarm && performance.now() - S.lastAlarm.t < 14000) { tgt = S.lastAlarm; col = COLORS.alarm; }
  }
  if (tgt && dist(me, tgt) > 2.6) {
    const a = Math.atan2(tgt.x - me.x, tgt.y - me.y);
    arrow.visible = true; arrow.material.color.setHex(col);
    arrow.position.set(me.rx + Math.sin(a) * 0.85, 0.06, me.ry + Math.cos(a) * 0.85); arrow.rotation.y = a;
  } else arrow.visible = false;
}
let hudCache = {};
function setText(id, text) { if (hudCache[id] !== text) { hudCache[id] = text; $(id).textContent = text; } }
function updateHud(time) {
  const me = S.me; if (!me) return;
  const left = CFG.ROUND - S.t;
  setText('timer', mmss(left)); $('timer').classList.toggle('low', left <= 30);
  let phase = '';
  if (S.t < CFG.COUNT) phase = 'Police are counting… ' + Math.ceil(CFG.COUNT - S.t);
  else if (S.t < CFG.JACKPOT_AT) phase = 'Tijoris open in ' + Math.ceil(CFG.JACKPOT_AT - S.t) + 's';
  else if (S.t >= CFG.COACH_OPEN && S.t < CFG.COACH_CLOSE) phase = 'Mail coach open ' + Math.ceil(CFG.COACH_CLOSE - S.t) + 's';
  setText('phase', phase);
  setText('lootText', money(S.banked) + ' / ' + money(S.target));
  $('lootBar').style.width = clamp(100 * S.banked / S.target, 0, 100) + '%';
  if (me.role === 'chor') setText('bag', me.carry.length ? 'Bag: ' + me.carry.map(i => W.sites[i].name).join(' + ') + '  ' + money(carryValue(me)) : 'Bag: empty' + (me.arrests && soloChor() ? ' · caught ' + me.arrests + '/' + CFG.MAX_ARRESTS_SOLO : ''));
  else setText('bag', 'Arrests: ' + me.arrests);
  $('stam').firstElementChild.style.width = (100 * me.stam / CFG.STAMINA_MAX) + '%';
  $('stam').firstElementChild.style.background = me.exhausted ? '#ff6a6a' : '#7de0ff';
  const ctx = S.ctx, pr = $('prompt');
  if (ctx && S.screen === 'play') {
    pr.hidden = false; setText('promptText', ctx.label);
    let frac = 0;
    if (ctx.type === 'rob') frac = S.isHost ? S.sites[ctx.i].prog / CFG.HOLD[W.sites[ctx.i].tier] : S.sites[ctx.i].pct / 100;
    else if (ctx.act && S.hold.key === ctx.key) frac = S.hold.t / ctx.hold;
    $('promptBarWrap').style.display = ctx.act && ctx.type !== 'unhide' ? '' : 'none';
    $('promptBar').style.width = clamp(frac * 100, 0, 100) + '%';
  } else pr.hidden = true;
  // being chased: red edges and a siren that grows as they close in
  let danger = 0, chaser = null;
  if (me.role === 'chor' && !me.jailed && S.screen === 'play') {
    for (const c of S.cops) if (c.st === 'chase' && c.target === me.id) { const v = clamp(1 - dist(c, me) / 16, 0.3, 1); if (v > danger) { danger = v; chaser = { x: c.rx, y: c.ry }; } }
    if (me.hidden < 0) for (const P of S.players.values()) if (P.role === 'police' && dist(P, me) < 9 && W.los(P.x, P.y, me.x, me.y)) { const v = clamp(1 - dist(P, me) / 11, 0.3, 1); if (v > danger) { danger = v; chaser = { x: P.rx, y: P.ry }; } }
  }
  // if the one chasing you is outside the picture, a red arrow on the edge of the screen shows where from
  const th = $('threat');
  if (chaser) {
    v3.set(chaser.x, 0.5, chaser.y).project(camera);
    if (v3.z < 1 && Math.abs(v3.x) < 0.93 && Math.abs(v3.y) < 0.88) th.style.display = 'none';
    else {
      const dx = chaser.x - me.x, dy = chaser.y - me.y, cy = Math.cos(S.cam.yaw), sy = Math.sin(S.cam.yaw);
      const ang = Math.atan2(dx * sy - dy * cy, dx * cy + dy * sy);
      th.style.display = 'block';
      th.style.left = (50 + Math.cos(ang) * 43) + '%'; th.style.top = (50 - Math.sin(ang) * 39) + '%';
      th.style.transform = 'translate(-50%,-50%) rotate(' + (90 - ang * 180 / Math.PI).toFixed(0) + 'deg)';
    }
  } else th.style.display = 'none';
  S.danger += (danger - S.danger) * 0.15;
  $('vignette').style.opacity = S.danger > 0.02 ? (S.danger * (0.72 + 0.28 * Math.sin(time * 9))).toFixed(2) : 0;
  setSiren(S.danger);
}
function drawMini() {
  const cv = $('mini'), c = cv.getContext('2d'), Z = cv.width / 100, me = S.me, now = performance.now();
  c.drawImage(miniBase, 0, 0, cv.width, cv.height);
  const dot = (x, y, r, col) => { c.beginPath(); c.arc(x * Z, y * Z, r, 0, TAU); c.fillStyle = col; c.fill(); };
  for (const h of W.hides) dot(h.x, h.y, 1.6, 'rgba(173,144,255,0.8)');
  W.sites.forEach((s, i) => { const st = S.sites[i] ? S.sites[i].st : 0; if (st === 2) return; dot(s.x, s.y, 2.2 + s.tier * 1.1, st === 1 ? '#8a6a4a' : '#f3b43f'); if (s.tier === 3) { c.beginPath(); c.arc(s.x * Z, s.y * Z, 7.5, 0, TAU); c.strokeStyle = st === 1 ? '#8a6a4a' : '#f3b43f'; c.lineWidth = 1.4; c.stroke(); } });
  for (const e of W.escapes) { c.beginPath(); c.moveTo(e.x * Z, e.y * Z - 7); c.lineTo(e.x * Z + 6.5, e.y * Z + 5); c.lineTo(e.x * Z - 6.5, e.y * Z + 5); c.closePath(); c.fillStyle = '#3bc98b'; c.fill(); }
  const anyJailed = chors().some(p => p.jailed);
  for (const l of W.levers) { c.beginPath(); c.arc(l.x * Z, l.y * Z, anyJailed ? 4 + 2 * Math.sin(now / 150) : 2.5, 0, TAU); c.strokeStyle = '#6a98ff'; c.lineWidth = 2; c.stroke(); }
  S.pings = S.pings.filter(p => now - p.t0 < p.dur);
  for (const p of S.pings) { const f = ((now - p.t0) % 1100) / 1100; c.beginPath(); c.arc(p.x * Z, p.y * Z, 3 + f * 16, 0, TAU); c.strokeStyle = p.col; c.globalAlpha = 1 - f; c.lineWidth = 2.5; c.stroke(); c.globalAlpha = 1; dot(p.x, p.y, 3, p.col); }
  if (!me) return;
  for (const k of S.cops) { if (me.role === 'police' || k.st === 'chase' || dist(k, me) < 15) dot(k.rx, k.ry, 3.4, k.st === 'chase' ? '#ff5050' : '#6a98ff'); }
  for (const P of S.players.values()) {
    if (P.isMe) continue;
    if (P.role === 'police') { if (me.role === 'police' || dist(P, me) < 15) dot(P.rx, P.ry, 3.6, '#8fb4ff'); }
    else if (me.role === 'chor' || P.seen || P.jailed) dot(P.rx, P.ry, 3.4, P.jailed ? '#8a8f9c' : '#ffd98a');
  }
  c.save(); c.translate(me.rx * Z, me.ry * Z); c.rotate(-me.ra + Math.PI);
  c.beginPath(); c.moveTo(0, -7.5); c.lineTo(5.5, 5.5); c.lineTo(0, 2.5); c.lineTo(-5.5, 5.5); c.closePath(); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = '#0a0f1c'; c.stroke(); c.restore();
}

// ------------------------------------------------------------------ end of round
function finishMatch(o) {
  const me = S.me, won = me && ((o.w === 'chor') === (me.role === 'chor'));
  setSiren(0); arrow.visible = false;
  if (won) sfx.win(); else sfx.lose();
  $('endTitle').textContent = o.w === 'chor' ? (won ? 'Bhaag gaye! Chors win' : 'The chors got away') : (won ? 'Pakad liya! Police win' : 'Pakde gaye! Police win');
  $('endTitle').className = 'result ' + (won ? 'win' : 'lose');
  $('endWhy').textContent = o.why;
  const mine = o.pl.find(p => p.id === S.myId) || { own: 0, ar: 0 };
  for (const p of o.pl) { p.own = +p.own || 0; p.ar = +p.ar || 0; p.n = String(p.n).slice(0, 14); p.r = p.r === 'police' ? 'police' : 'chor'; }
  const stats = [['Banked', money(o.b) + ' / ' + money(o.tg)], ['Time', mmss(o.t)], me && me.role === 'chor' ? ['Your loot', money(mine.own)] : ['Your arrests', String(mine.ar)]];
  if (S.solo) stats.push(['Night', String(S.night)]);
  const es = $('endStats'); es.innerHTML = '';
  for (const s of stats) { const d = document.createElement('div'), l = document.createElement('span'), v = document.createElement('b'); l.className = 'label'; l.textContent = s[0]; v.textContent = s[1]; d.append(l, v); es.appendChild(d); }
  const list = $('endList'); list.innerHTML = '';
  if (!S.solo) for (const p of o.pl) { const li = document.createElement('li'); const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.n + (p.id === S.myId ? ' (you)' : ''); const tg = document.createElement('span'); tg.className = 'tag ' + p.r; tg.textContent = p.r === 'chor' ? money(p.own) : p.ar + ' arrests'; li.append(nm, tg); list.appendChild(li); }
  if (me && me.role === 'chor') save.total += mine.own;
  if (won) save.wins++;
  let note = '';
  if (S.solo) {
    if (won) { save.night = Math.max(save.night, S.night + 1); $('btnAgain').textContent = 'Next night · ' + (S.night + 1); note = 'Night ' + (S.night + 1) + ' needs more loot and brings sharper police.'; }
    else $('btnAgain').textContent = 'Try night ' + S.night + ' again';
    $('btnAgain').disabled = false;
  } else if (S.isHost) { $('btnAgain').textContent = 'Back to the room'; $('btnAgain').disabled = false; }
  else { $('btnAgain').textContent = 'Waiting for the host…'; $('btnAgain').disabled = true; }
  $('endNote').textContent = note;
  storeSave(); refreshMenu();
  setTimeout(() => { if (S.over === o) setScreen('over'); }, 900);
}

// ------------------------------------------------------------------ menu, lobby, networking flows
function refreshMenu() {
  $('btnSolo').textContent = 'Play solo · Night ' + save.night;
  $('rankName').textContent = rankFor(save.total); $('rankLoot').textContent = money(save.total);
  $('btnMute').textContent = isMuted() ? 'Sound off' : 'Sound on';
}
function leaveNet() { if (S.net) { try { if (S.isHost) S.net.broadcast({ k: 'bye' }); else S.net.send({ k: 'bye' }); } catch (e) {} const n = S.net; S.net = null; setTimeout(() => { try { n.close(); } catch (e) {} }, 150); } }
function toMenu(msg) { leaveNet(); S.isHost = true; S.solo = true; S.myId = 'h'; S.me = null; clearDyn(); S.players = new Map(); S.cops = []; pool.visible = false; arrow.visible = false; setScreen('menu'); refreshMenu(); $('menuErr').textContent = msg || ''; }
function spawnFor(role, k) {
  if (role === 'police') { const p = W.policeSpawns[k % W.policeSpawns.length]; return { x: p.x, y: p.y }; }
  const s = W.spawns[k % W.spawns.length], q = W.nearestWalk(s.x + (k >= 4 ? 0.7 : 0), s.y);
  return { x: q.x, y: q.y };
}
function startSolo() {
  initAudio(); leaveNet(); S.isHost = true; S.solo = true; S.myId = 'h'; S.night = save.night;
  save.name = myName(); storeSave();
  const sp = spawnFor('chor', Math.floor(Math.random() * 4));
  beginMatch({ cfg: matchSetup(1, 0, S.night), players: [{ id: 'h', name: save.name, role: 'chor', x: sp.x, y: sp.y }] });
}
function renderLobby() {
  const L = S.lobby, me = L.players.find(p => p.id === S.myId);
  $('roomCode').textContent = L.code; $('pcount').textContent = L.players.length;
  const ul = $('plist'); ul.innerHTML = '';
  for (const p of L.players) { const li = document.createElement('li'); const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.id === S.myId ? ' (you)' : '') + (p.id === 'h' ? ' · host' : ''); const tg = document.createElement('span'); tg.className = 'tag ' + p.role; tg.textContent = p.role === 'chor' ? 'Chor' : 'Police'; li.append(nm, tg); ul.appendChild(li); }
  const nc = L.players.filter(p => p.role === 'chor').length, np = L.players.length - nc, setup = matchSetup(Math.max(1, nc), np, 1);
  $('btnRoleChor').disabled = !!me && me.role === 'chor'; $('btnRolePolice').disabled = !!me && me.role === 'police';
  $('lobbyInfo').textContent = nc === 0 ? 'At least one player must be a chor.' : `${nc} chor${nc > 1 ? 's' : ''} against ${np} police player${np === 1 ? '' : 's'}${setup.cops ? ' and ' + setup.cops + ' computer constable' + (setup.cops > 1 ? 's' : '') : ''}. Chors must bank ${money(setup.target)} in 6 minutes.`;
  $('btnStart').hidden = !S.isHost; $('btnStart').disabled = nc === 0;
  if (!S.isHost) $('lobbyInfo').textContent += ' Waiting for the host to start.';
}
const heard = {};
function hostDrop(pid) {
  delete heard[pid];
  const was = S.lobby.players.length;
  S.lobby.players = S.lobby.players.filter(p => p.id !== pid);
  if (S.screen === 'play' || S.screen === 'over') removePlayer(pid);
  if (S.screen === 'lobby' && S.lobby.players.length !== was) broadcastLobby();
}
// both sides say "still here" every two seconds; fifteen seconds of silence means the other side is gone
function heartbeat() {
  if (!S.net || S.solo) return;
  const now = performance.now();
  if (S.isHost) {
    if (S.screen !== 'play') S.net.broadcast({ k: 'hb' });
    for (const p of S.lobby.players.slice()) if (p.id !== 'h') { if (!heard[p.id]) heard[p.id] = now; else if (now - heard[p.id] > 15000) { S.net.kick(p.id); hostDrop(p.id); } }
  } else {
    S.net.send({ k: 'hb' });
    if (S.hostHeard && now - S.hostHeard > 15000) toMenu('Lost the connection to the host.');
  }
}
function broadcastLobby() { if (!S.net || !S.isHost) return; for (const p of S.lobby.players) if (p.id !== 'h') S.net.send(p.id, { k: 'lobby', you: p.id, code: S.lobby.code, players: S.lobby.players }); renderLobby(); }
async function createRoom() {
  initAudio(); $('menuErr').textContent = 'Creating a room…'; $('btnCreate').disabled = true;
  save.name = myName(); storeSave(); leaveNet();
  const net = new HostNet({
    onJoin() {},
    onData(pid, m) {
      if (!m || typeof m !== 'object') return;
      heard[pid] = performance.now();
      if (m.k === 'hb') return;
      if (m.k === 'bye') { net.kick(pid); hostDrop(pid); return; }
      if (m.k === 'hello') {
        if (S.screen !== 'lobby') { net.send(pid, { k: 'busy' }); setTimeout(() => net.kick(pid), 400); return; }
        if (S.lobby.players.length >= CFG.MAX_PLAYERS) { net.send(pid, { k: 'full' }); setTimeout(() => net.kick(pid), 400); return; }
        if (!S.lobby.players.some(p => p.id === pid)) S.lobby.players.push({ id: pid, name: String(m.name || 'Dost').replace(/[<>]/g, '').trim().slice(0, 14) || 'Dost', role: 'chor' });
        broadcastLobby();
      } else if (m.k === 'role') { const p = S.lobby.players.find(q => q.id === pid); if (p && S.screen === 'lobby' && (m.role === 'chor' || m.role === 'police')) { p.role = m.role; broadcastLobby(); } }
      else if (m.k === 'p') {
        const P = S.players.get(pid); if (!P || P.jailed || m.q < P.tpSeq || S.screen !== 'play') return;
        if (typeof m.x !== 'number' || typeof m.y !== 'number' || !isFinite(m.x) || !isFinite(m.y)) return;
        P.x = clamp(m.x, 0, 100); P.y = clamp(m.y, 0, 100); P.a = +m.a || 0; P.sprint = !!(m.f & 1); P.inPipe = !!(m.f & 2) && P.role === 'chor'; P.spd = clamp(+m.v || 0, 0, 3);
      } else if (m.k === 'a') doAction(S.players.get(pid), String(m.t), m.i);
    },
    onLeave(pid) { hostDrop(pid); },
  });
  try {
    const code = await net.open();
    S.net = net; S.isHost = true; S.solo = false; S.myId = 'h';
    S.lobby = { code, players: [{ id: 'h', name: save.name, role: 'chor' }] };
    $('menuErr').textContent = ''; setScreen('lobby'); renderLobby();
  } catch (e) { $('menuErr').textContent = e.message; net.close(); }
  $('btnCreate').disabled = false;
}
async function joinRoom() {
  const code = cleanCode($('code').value);
  if (code.length !== 4) { $('menuErr').textContent = 'Type the 4-letter room code.'; return; }
  initAudio(); $('menuErr').textContent = 'Joining room ' + code + '…'; $('btnJoin').disabled = true;
  save.name = myName(); storeSave(); leaveNet();
  const net = new ClientNet({
    onData(m) {
      if (!m || typeof m !== 'object') return;
      S.hostHeard = performance.now();
      if (m.k === 'hb') return;
      if (m.k === 'bye') { toMenu('The host closed the room.'); return; }
      if (m.k === 'lobby') { S.myId = m.you; S.lobby = { code: m.code, players: m.players }; if (S.screen !== 'lobby') { clearDyn(); S.players = new Map(); S.cops = []; S.me = null; pool.visible = false; setScreen('lobby'); } renderLobby(); }
      else if (m.k === 'start') beginMatch(m);
      else if (m.k === 's') applySnapshot(m);
      else if (m.k === 'tp') { const me = S.me; if (me) { me.x = m.x; me.y = m.y; me.rx = m.x; me.ry = m.y; me.tpSeq = m.q; me.inPipe = false; } }
      else if (m.k === 'note') feed(m.m);
      else if (m.k === 'busy') toMenu('That room is in the middle of a round. Try again in a few minutes.');
      else if (m.k === 'full') toMenu('That room is full (8 players).');
    },
    onClose() { if (S.net === net) toMenu('Lost the connection to the host.'); },
  });
  try {
    await net.connect(code);
    S.net = net; S.isHost = false; S.solo = false; S.hostHeard = performance.now();
    net.send({ k: 'hello', name: save.name, v: 1 });
    $('menuErr').textContent = 'Connected. Waiting for the room…';
  } catch (e) { $('menuErr').textContent = e.message; }
  $('btnJoin').disabled = false;
}
function hostStart() {
  const L = S.lobby, cs = L.players.filter(p => p.role === 'chor'), ps = L.players.filter(p => p.role === 'police');
  if (!cs.length) { $('lobbyErr').textContent = 'At least one player must be a chor.'; return; }
  $('lobbyErr').textContent = '';
  const off = Math.floor(Math.random() * 4), players = [];
  cs.forEach((p, k) => { const sp = spawnFor('chor', k + off); players.push({ id: p.id, name: p.name, role: 'chor', x: sp.x, y: sp.y }); });
  ps.forEach((p, k) => { const sp = spawnFor('police', k); players.push({ id: p.id, name: p.name, role: 'police', x: sp.x, y: sp.y }); });
  const cfg = matchSetup(cs.length, ps.length, 1);
  if (ps.length) cfg.copStart = ps.length; // constables stand clear of the police players' spots
  const msg = { k: 'start', cfg, players };
  S.net.broadcast(msg); beginMatch(msg);
}

// ------------------------------------------------------------------ input wiring
function bindUi() {
  $('name').value = save.name || '';
  const q = new URLSearchParams(location.search), room = cleanCode(q.get('room'));
  if (room.length === 4) { $('code').value = room; $('joinBox').hidden = false; }
  $('btnSolo').onclick = () => { sfx.click(); startSolo(); };
  $('btnCreate').onclick = () => createRoom();
  $('btnJoinOpen').onclick = () => { $('joinBox').hidden = !$('joinBox').hidden; if (!$('joinBox').hidden) $('code').focus(); };
  $('btnJoin').onclick = () => joinRoom();
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  $('btnRoleChor').onclick = () => setRole('chor'); $('btnRolePolice').onclick = () => setRole('police');
  $('btnStart').onclick = () => hostStart();
  $('btnLeave').onclick = () => toMenu('');
  $('btnCopy').onclick = async () => {
    const link = location.origin + location.pathname + '?room=' + S.lobby.code;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied. Send it to your friends.'); } catch (e) { toast('Tell your friends the code: ' + S.lobby.code); }
  };
  $('btnPause').onclick = () => togglePause();
  $('btnResume').onclick = () => togglePause(false);
  $('btnQuit').onclick = () => toMenu('');
  $('btnMute').onclick = () => { setMuted(!isMuted()); save.muted = isMuted(); storeSave(); refreshMenu(); };
  $('btnAgain').onclick = () => { if (S.solo) startSolo(); else if (S.isHost) { setScreen('lobby'); clearDyn(); S.players = new Map(); S.cops = []; S.me = null; pool.visible = false; broadcastLobby(); } };
  $('btnEndMenu').onclick = () => toMenu('');
  $('mini').onclick = () => $('mini').classList.toggle('big');
  const hold = (id, key) => { const b = $(id); const on = e => { e.preventDefault(); In[key] = true; b.classList.add('down'); initAudio(); }; const off = () => { In[key] = false; b.classList.remove('down'); }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off); b.addEventListener('contextmenu', e => e.preventDefault()); };
  hold('btnAct', 'actTouch'); hold('btnRun', 'runTouch');

  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape') { if (S.screen === 'play') togglePause(); return; }
    if (e.code === 'KeyM' && S.screen === 'play') { $('mini').classList.toggle('big'); return; }
    if (S.screen !== 'play') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    In.keys.add(e.code);
  });
  window.addEventListener('keyup', e => In.keys.delete(e.code));
  window.addEventListener('blur', () => { In.keys.clear(); In.actTouch = In.runTouch = false; });
  const stick = $('stick'), knob = stick.firstElementChild;
  canvas.addEventListener('pointerdown', e => {
    if (S.screen !== 'play') return;
    initAudio();
    if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.45 && !In.stick) {
      In.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      stick.style.display = 'block'; stick.style.left = (e.clientX - 60) + 'px'; stick.style.top = (e.clientY - 60) + 'px'; knob.style.transform = '';
    } else if (!In.look) In.look = { id: e.pointerId, x: e.clientX };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', e => {
    if (In.stick && e.pointerId === In.stick.id) {
      let dx = e.clientX - In.stick.ox, dy = e.clientY - In.stick.oy; const l = Math.hypot(dx, dy), m = 50;
      if (l > m) { dx *= m / l; dy *= m / l; }
      In.mx = dx / m; In.my = -dy / m; knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (In.look && e.pointerId === In.look.id) { S.cam.yaw += (e.clientX - In.look.x) * 0.0065; In.look.x = e.clientX; }
  });
  const up = e => {
    if (In.stick && e.pointerId === In.stick.id) { In.stick = null; In.mx = In.my = 0; stick.style.display = 'none'; }
    if (In.look && e.pointerId === In.look.id) In.look = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.cam.dist = clamp(S.cam.dist + e.deltaY * 0.01, 5, 14); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('resize', resize);
}
function setRole(role) {
  if (S.isHost) { const p = S.lobby.players.find(q => q.id === 'h'); if (p) p.role = role; broadcastLobby(); }
  else if (S.net) S.net.send({ k: 'role', role });
}
function togglePause(force) {
  if (S.screen !== 'play') return;
  const on = force === undefined ? $('pause').hidden : force;
  show('pause', on); S.paused = on && S.solo;
  $('pauseNote').textContent = S.solo ? 'The round is paused.' : 'The round keeps running while this menu is open.';
  In.keys.clear();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 58 : 50; camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(U.uRes.value);
}

// ------------------------------------------------------------------ loops
let lastHost = performance.now(), lastFrame = performance.now(), miniTick = 0, fpsAvg = 60;
function hostLoop() {
  const now = performance.now();
  if (S.screen !== 'play' || !S.isHost || S.paused || S.over) { lastHost = now; return; }
  let rem = Math.min((now - lastHost) / 1000, 1.2); lastHost = now;
  while (rem > 1e-4 && !S.over) { const h = Math.min(0.05, rem); hostTick(h); rem -= h; }
  if (!S.solo && S.net && now - S.lastSnap >= 95 && !S.over) { S.lastSnap = now; S.net.broadcast(snapshot()); S.evOut = []; }
  else if (S.solo) S.evOut = [];
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - lastFrame) / 1000), time = now / 1000; lastFrame = now;
  fpsAvg += ((dt > 0 ? 1 / dt : 60) - fpsAvg) * 0.05;
  // on a slow phone the picture may stutter, but you still move at full speed: several small steps per frame
  if (S.screen === 'play' && !S.paused) { const n = Math.max(1, Math.ceil(dt / 0.034)); for (let k = 0; k < n; k++) localUpdate(dt / n); }
  if (S.screen === 'play' || S.screen === 'over') {
    if (S.isHost) for (let i = 0; i < S.sites.length; i++) if (!S.over) S.sites[i].st = siteState(i);
    syncEntities(dt, time); updateWorldVisuals(time); updateHud(time);
    if (++miniTick % 3 === 0) drawMini();
  }
  updateCamera(dt, time); updateLabels();
  renderer.render(scene, camera);
}

async function boot() {
  const map = await (await fetch('data/map.json')).json();
  try { await Promise.race([Promise.all([document.fonts.load('700 46px "Baloo 2"'), document.fonts.load('600 16px "Hind"')]), new Promise(r => setTimeout(r, 1800))]); } catch (e) { /* fall back to system fonts */ }
  W = buildWorld(map);
  H = buildScene(scene, map, W, U, { ground: isTouch ? 1024 : 2048, aniso: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
  miniBase = document.createElement('canvas'); miniBase.width = miniBase.height = 400; paintMini(miniBase, map, W);
  setMuted(!!save.muted);
  bindUi(); resize(); refreshMenu();
  $('loading').hidden = true; setScreen('menu');
  setInterval(hostLoop, 50); setInterval(heartbeat, 2000);
  window.addEventListener('pagehide', () => { if (S.net && !S.solo) { try { if (S.isHost) S.net.broadcast({ k: 'bye' }); else S.net.send({ k: 'bye' }); } catch (e) {} } });
  requestAnimationFrame(frame);
  window.__cp = { S, W, CFG, In, doAction, hostTick, startSolo, save, camera, renderer, fps: () => fpsAvg }; // handy for testing in the console
}
boot().catch(err => { console.error(err); $('loading').textContent = 'Could not start the game: ' + err.message; });
