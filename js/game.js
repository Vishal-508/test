// Chor Police: Jugnupur ki Raat. A night car chase: game rules, police AI, multiplayer sync, input, camera, HUD and the main loop.
import * as THREE from '../vendor/three.module.min.js';
import { CFG, matchSetup, rankFor, paintsUnlocked } from './config.js';
import { buildWorld, hash2 } from './world.js';
import { buildScene, paintMini, setSiteVisual, COLORS, LABELS, makeLabel } from './scene.js';
import { makeVehicle, stepVehicle, makeDriver, drive, CAR } from './vehicle.js';
import { makeCar, PAINTS } from './cars.js';
import { Fx } from './fx.js';
import { buildDressing } from './dressing.js';
import { makePost } from './postfx.js';
import { initAudio, setMuted, isMuted, setMusicOn, isMusicOn, engine, skid, siren, heartbeat, rain, music, sfx } from './audio.js';
import { HostNet, ClientNet, cleanCode } from './net.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r2 = v => Math.round(v * 100) / 100;
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const TAU = Math.PI * 2;
const wrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
const mmss = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ------------------------------------------------------------------ saved progress
const SAVE_KEY = 'jugnupur.save.v2';
const save = (() => {
  const d = { name: '', night: 1, total: 0, wins: 0, muted: false, music: true, paint: 'kaala', quality: 'auto', seenHelp: 0 };
  try { const old = JSON.parse(localStorage.getItem('jugnupur.save.v1') || '{}'); if (old.name) d.name = old.name; if (old.total) d.total = old.total; } catch (e) { /* no older save */ }
  try { return Object.assign(d, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { return d; }
})();
const storeSave = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode: play without saving */ } };

// ------------------------------------------------------------------ renderer, lights, effects
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
const canvas = $('c');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' }); }
catch (e) { $('loading').textContent = 'This browser cannot show 3D graphics (WebGL is off or not supported). Try Chrome, Safari or Firefox on a newer device.'; throw e; }
const highQ = () => save.quality === 'high' || (save.quality === 'auto' && !isTouch);
let pixelCap = isTouch ? 1.5 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.fog);
scene.fog = new THREE.Fog(COLORS.fog, 16, 52);
const camera = new THREE.PerspectiveCamera(52, 1, 1.6, 180);
const HEMI = 1.55, MOON = 1.05;
const hemi = new THREE.HemisphereLight(0x8d93ab, 0x4c4850, HEMI); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xc6ceff, MOON); moon.position.set(-30, 40, 45); scene.add(moon);
const headlamp = new THREE.SpotLight(0xfff1d0, 0, 13, 0.56, 0.85, 1.0); scene.add(headlamp); scene.add(headlamp.target);
const sirenRed = new THREE.PointLight(0xff2a2a, 0, 9, 1.4), sirenBlue = new THREE.PointLight(0x2a5cff, 0, 9, 1.4); scene.add(sirenRed); scene.add(sirenBlue);
const U = { uCut: { value: new THREE.Vector3(0.5, 0.5, -1) }, uRes: { value: new THREE.Vector2(1, 1) } };
const dyn = new THREE.Group(); scene.add(dyn);
const post = makePost(renderer, scene, camera);

const arrowShape = new THREE.Shape(); arrowShape.moveTo(0, 0.5); arrowShape.lineTo(0.28, -0.12); arrowShape.lineTo(0, 0.02); arrowShape.lineTo(-0.28, -0.12); arrowShape.closePath();
const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: COLORS.loot, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
arrow.rotation.order = 'YXZ'; arrow.rotation.x = Math.PI / 2; arrow.position.y = 0.07; arrow.renderOrder = 15; arrow.visible = false; scene.add(arrow);

let W = null, H = null, miniBase = null, fx = null, dressing = null;

// ------------------------------------------------------------------ state
const S = {
  screen: 'loading', net: null, isHost: true, solo: true, myId: 'h', paused: false,
  lobby: { code: '', players: [] }, night: 1,
  players: new Map(), cops: [], sites: [], me: null, others: [],
  t: 0, banked: 0, target: 700, over: null, leverLock: 0, cfg: null, flags: {}, evOut: [], pings: [], searchLv: {},
  cam: { yaw: 0, dist: 8.6, pitch: 0.84, orbit: 0, look: 0, lookT: 0, fov: 52, hide: 0, shake: 0, pos: new THREE.Vector3(50, 19, 80), tgt: new THREE.Vector3(50, 0, 50) },
  hold: { key: '', t: 0 }, latch: false, robSent: -1, unhideSent: false, ctx: null, danger: 0, lastSnap: 0, lastSend: 0, tickSfx: 0, lightningAt: 0, lowFps: 0,
};
const In = { keys: new Set(), mx: 0, my: 0, actTouch: false, nitroTouch: false, brakeTouch: false, stick: null, look: null };

// ------------------------------------------------------------------ small UI helpers
function show(id, on) { $(id).hidden = !on; }
function setScreen(name) {
  S.screen = name;
  show('menu', name === 'menu'); show('lobby', name === 'lobby'); show('end', name === 'over'); show('hud', name === 'play' || name === 'over'); show('pause', false);
  if (name !== 'play') { siren(0); skid(0); heartbeat(0); engine(0, 0, false); $('vignette').style.opacity = 0; $('hideui').classList.remove('on'); }
}
let toastTimer = 0;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3400); }
function feed(text, kind) {
  const f = $('feed'), d = document.createElement('div'); d.textContent = text; if (kind) d.className = kind; f.appendChild(d);
  while (f.children.length > 4) f.removeChild(f.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 5200);
}
let bannerTimer = 0;
function banner(text, kind) { const b = $('banner'); b.textContent = text; b.className = 'on ' + (kind || ''); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { b.className = ''; }, 2200); }
function ping(x, y, dur, col) { S.pings.push({ x, y, t0: performance.now(), dur: dur * 1000, col }); }
const myName = () => (($('name').value || '').trim().slice(0, 14)) || 'Chhotu';
const paintHex = id => (PAINTS.find(p => p.id === id) || PAINTS[0]).hex;

// ------------------------------------------------------------------ match setup
// take a car (and everything attached to it) out of the scene and free its GPU memory
function dropObject(obj) {
  obj.traverse(o => { const k = LABELS.indexOf(o); if (k >= 0) { LABELS.splice(k, 1); if (o.material && o.material.map) o.material.map.dispose(); if (o.material) o.material.dispose(); } });
  if (obj.parent) obj.parent.remove(obj);
}
function dropEntity(e) { if (!e) return; dropObject(e.car.g); try { e.car.dispose(); } catch (err) { /* already gone */ } }
function clearDyn() { for (const P of S.players.values()) dropEntity(P); for (const c of S.cops) dropEntity(c); while (dyn.children.length) dyn.remove(dyn.children[0]); S.players = new Map(); S.cops = []; S.me = null; }
function newPlayer(p) {
  const isMe = p.id === S.myId, kind = p.role === 'chor' ? 'chor' : 'police';
  const P = {
    id: p.id, name: p.name, role: p.role, v: makeVehicle(kind, p.x, p.y, p.a || 0), net: { x: p.x, y: p.y, a: p.a || 0, vf: 0, steer: 0 },
    hidden: -1, jailed: false, jailLeft: 0, immune: 0, carry: [], arrests: 0, own: 0, robbing: -1, bust: 0, heat: 0,
    lights: true, nitroOn: false, brake: false, drift: false, nitro: CFG.NITRO_MAX, nitroWait: 0, nitroEmpty: false,
    tpSeq: 0, isMe, tipAt: 0, spotAt: -9, wheel: null,
    car: makeCar(kind, { paint: p.paint || PAINTS[0].hex }),
  };
  dyn.add(P.car.g);
  if (!isMe) { P.tag = makeLabel(p.name, { color: kind === 'chor' ? '#ffd98a' : '#9dbcff', h: 0.3 }); P.tag.position.y = 0.95; P.car.g.add(P.tag); }
  return P;
}
function newCop(k, x, y, a) {
  const c = { id: k, v: makeVehicle('police', x, y, a || 0), drv: makeDriver(), rx: x, ry: y, ra: a || 0, st: 'count', path: null, goal: null, target: null, lastSeen: null, sawT: -9, sweep: [], pre: null, wait: 0, repath: 0, searchT: 0, hint: null, sirenOn: false, car: makeCar('police', {}) };
  c.proxy = { x, y, a: a || 0, vx: 0, vy: 0, P: CAR.police };
  dyn.add(c.car.g);
  return c;
}
function beginMatch(m) {
  clearDyn();
  S.cfg = m.cfg; S.target = m.cfg.target; S.t = 0; S.banked = 0; S.over = null; S.leverLock = 0; S.pings = []; S.evOut = []; S.flags = {}; S.searchLv = {};
  m.players.forEach(p => S.players.set(p.id, newPlayer(p)));
  S.me = S.players.get(S.myId);
  S.sites = W.sites.map(s => ({ robbed: false, lockUntil: s.tier === 3 ? CFG.JACKPOT_AT : 0, prog: 0, alarmAt: -99, st: (s.tier === 3 || s.coach) ? 1 : 0, pct: 0 }));
  if (S.isHost) for (let k = 0; k < m.cfg.cops; k++) { const sp = W.policeSpawns[(k + (m.cfg.copStart || 0)) % W.policeSpawns.length]; S.cops.push(newCop(k, sp.x, sp.y, sp.a)); }
  const me = S.me;
  S.cam.yaw = Math.PI - me.v.a; S.cam.look = 0; S.cam.hide = 0; S.cam.shake = 0;
  S.cam.pos.set(me.v.x, 14, me.v.y + 10); S.cam.tgt.set(me.v.x, 0, me.v.y);
  S.hold = { key: '', t: 0 }; S.latch = true; S.robSent = -1; S.unhideSent = false; S.paused = false; S.danger = 0; S.lastAlarm = null; S.lightningAt = 8 + Math.random() * 10;
  $('feed').innerHTML = '';
  $('role').textContent = me.role === 'chor' ? 'CHOR' : 'POLICE'; $('role').className = 'pill ' + me.role;
  $('btnAct').textContent = me.role === 'chor' ? 'ACT' : 'SEARCH';
  $('btnLights').textContent = me.role === 'chor' ? 'Lights' : 'Siren';
  $('wanted').style.display = me.role === 'chor' ? '' : 'none';
  fx.setRain(m.cfg.rain || 0);
  setScreen('play');
  lastHost = performance.now();
  if (m.cfg.name) banner(m.cfg.name, 'gold');
  if (me.role === 'chor') { feed('Stop on a gold ring and hold the action button to rob it.', 'gold'); feed('Carry loot to a green beam. Hide in garages (violet arrows).'); }
  else { feed('Wait for the count, then box the chors in to bust them.'); feed('Follow alarms on your map. Stop in front of hideouts to search.'); }
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
const loose = P => !P.jailed && P.hidden < 0;
function inHide(h, x, y, slack) { slack = slack || 0; return h.bay ? (x > h.bay.x0 - slack && x < h.bay.x1 + slack && y > h.bay.y0 - slack && y < h.bay.y1 + slack) : Math.hypot(x - h.x, y - h.y) < 1.15 + slack; }

// ------------------------------------------------------------------ host: rules
function ev(e) { S.evOut.push(e); handleEvent(e); }
function teleport(P, x, y, a) {
  const v = P.v; v.x = x; v.y = y; v.a = a; v.vx = v.vy = v.vf = 0; P.net.x = x; P.net.y = y; P.net.a = a; P.net.vf = 0; P.tpSeq++;
  if (!P.isMe && S.net && !S.solo) S.net.send(P.id, { k: 'tp', x, y, a, q: P.tpSeq });
}
function addHeat(P, n) { P.heat = clamp(P.heat + n, 0, CFG.HEAT_MAX); }
function alarm(i, loud) {
  const d = W.sites[i]; S.sites[i].alarmAt = S.t;
  const idle = S.cops.filter(c => c.st !== 'chase' && c.st !== 'count').sort((a, b) => dist(a.v, d) - dist(b.v, d));
  let go = [];
  if (d.tier === 3) go = idle; else if (d.tier === 2) go = idle.filter((c, k) => k === 0 || dist(c.v, d) < 25); else go = idle.filter((c, k) => k === 0 && dist(c.v, d) < 40);
  for (const c of go) { c.st = 'respond'; c.goal = { x: d.x, y: d.y }; c.hint = { x: d.x, y: d.y }; c.path = null; }
  ev({ t: loud ? 'alarm' : 'ping', m: loud ? 'ALARM at ' + d.full + '!' : 'Alarm bell at ' + d.full, x: d.x, y: d.y });
}
function arrest(ch, by) {
  if (ch.jailed || ch.immune > 0) return;
  for (const i of ch.carry) { S.sites[i].robbed = false; S.sites[i].lockUntil = S.t + CFG.RELOCK; S.sites[i].prog = 0; }
  const lost = carryValue(ch);
  ch.carry = []; ch.hidden = -1; ch.robbing = -1; ch.bust = 0; ch.heat *= 0.4; ch.jailed = true; ch.arrests++;
  ch.jailLeft = soloChor() ? CFG.JAIL_SOLO : CFG.JAIL_MULTI;
  const jailed = chors().filter(p => p.jailed).length, slot = W.cageSlots[(jailed - 1) % W.cageSlots.length];
  teleport(ch, slot.x, slot.y, 0);
  S.leverLock = S.t + CFG.LEVER_LOCK;
  for (const c of S.cops) if (c.target === ch.id) { c.st = 'patrol'; c.target = null; c.path = null; c.wait = 1.5; }
  if (by && by.role === 'police') by.arrests++;
  ev({ t: 'arrest', m: ch.name + ' was busted by ' + (by ? by.name : 'a police jeep') + (lost ? '. ' + money(lost) + ' goes back.' : '.'), who: ch.id });
  if (soloChor()) { if (ch.arrests >= CFG.MAX_ARRESTS_SOLO) endRound('police', 'Busted ' + CFG.MAX_ARRESTS_SOLO + ' times.'); }
  else if (chors().every(p => p.jailed)) endRound('police', 'Every getaway car is in the impound.');
}
function release(P, how) {
  if (!P.jailed) return;
  P.jailed = false; P.jailLeft = 0; P.immune = CFG.IMMUNE; P.bust = 0;
  const rp = W.releasePoints[(S.flags.rel = (S.flags.rel || 0) + 1) % W.releasePoints.length];
  teleport(P, rp.x, rp.y, rp.a);
  if (how === 'bail') ev({ t: 'free', m: P.name + ' is back on the road.', who: [P.id] });
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
  const slack = P.isMe ? 0.3 : 1.3, v = P.v, sp = Math.abs(v.vf); // remote players are judged on slightly older positions
  if (type === 'rob') { P.robbing = (P.role === 'chor' && !P.jailed && i >= 0 && i < W.sites.length) ? i : -1; return; }
  if (P.jailed) return;
  if (P.role === 'chor') {
    if (type === 'bank') {
      const e = W.escapes[i]; if (!e || !P.carry.length || dist(v, e) > CFG.BANK_RANGE + slack) return;
      const val = carryValue(P), jack = P.carry.some(isJackpot);
      P.carry = []; P.own += val; S.banked += val; addHeat(P, -1);
      ev({ t: 'bank', m: P.name + ' handed over ' + money(val) + ' at ' + e.name + '.', j: jack ? 1 : 0, x: e.x, y: e.y, who: P.id });
      if (S.banked >= S.target) endRound('chor', 'Target banked with ' + mmss(CFG.ROUND - S.t) + ' to spare.');
    } else if (type === 'hide') {
      const h = W.hides[i]; if (!h || P.hidden >= 0 || !inHide(h, v.x, v.y, slack) || sp > CFG.HIDE_SPEED + 0.6 || P.carry.some(isJackpot)) return;
      if ([...S.players.values()].some(o => o !== P && o.hidden === i)) return;
      // a jeep that watched you drive in knows exactly where to look
      for (const c of S.cops) if (c.st === 'chase' && c.target === P.id && S.t - c.sawT < 0.6 && dist(c.v, v) < 12) { c.st = 'search'; c.sweep = [i]; c.pre = null; c.path = null; c.searchT = 0; c.target = null; }
      P.hidden = i; P.robbing = -1; P.bust = 0;
    } else if (type === 'unhide') { P.hidden = -1; }
    else if (type === 'lever') {
      const l = W.levers[i]; if (!l || dist(v, l) > CFG.LEVER_RANGE + slack || S.t < S.leverLock) return;
      const inside = chors().filter(p => p.jailed); if (!inside.length) return;
      inside.forEach(p => release(p, 'lever'));
      ev({ t: 'free', m: P.name + ' pulled the lever. ' + inside.map(p => p.name).join(', ') + ' ' + (inside.length > 1 ? 'are' : 'is') + ' out!', who: inside.map(p => p.id), x: l.x, y: l.y });
    }
  } else if (type === 'searching') { P.searching = i; P.searchT0 = S.t; }   // a police player has started (or with -1, stopped) searching a hideout
  else if (type === 'search') {
    const h = W.hides[i]; P.searching = -1; if (!h || dist(v, h.search) > CFG.SEARCH_RANGE + slack) return;
    const found = chors().find(p => p.hidden === i && !p.jailed);
    if (found) { found.immune = 0; arrest(found, P); }
    else if (P.isMe) feed('Nobody in there.'); else if (S.net) S.net.send(P.id, { k: 'note', m: 'Nobody in there.' });
  }
}
function removePlayer(id) {
  const P = S.players.get(id); if (!P) return;
  for (const i of P.carry) { S.sites[i].robbed = false; S.sites[i].prog = 0; }
  dropEntity(P); S.players.delete(id);
  ev({ t: 'left', m: P.name + ' left the game.', who: id });
  if (S.isHost && !S.over && S.screen === 'play') {
    const all = chors();
    if (!all.length) endRound('police', 'No getaway cars left in town.');
    else if (all.length > 1 && all.every(p => p.jailed)) endRound('police', 'Every getaway car is in the impound.');
    else if (P.role === 'police') { // a police player left: computer jeeps take over so the chors still have someone to dodge
      const humans = [...S.players.values()].filter(p => p.role === 'police').length, want = matchSetup(all.length, humans, 1).cops;
      while (S.cops.length < want) { const sp = W.policeSpawns[S.cops.length % W.policeSpawns.length]; const c = newCop(S.cops.length, sp.x, sp.y, sp.a); c.st = 'patrol'; S.cops.push(c); }
    }
  }
}

// ------------------------------------------------------------------ host: police jeeps driven by the computer
function copGo(c, x, y) { c.path = W.findPath(c.v.x, c.v.y, x, y) || null; c.drv.seg = 0; c.goalPt = { x, y }; }
let hostOthers = [];
function copDrive(c, want, dt) { // returns true on arrival
  if (!c.path || c.path.length < 2) { copStop(c, dt); return true; }
  const inp = drive(c.v, c.path, c.drv, want, dt);
  if (inp.wedged && c.goalPt) { const g = c.goalPt; copGo(c, g.x, g.y); }
  stepVehicle(c.v, inp, dt, { solid: W.solidPolice, others: hostOthers });
  return inp.arrived;
}
const STOP = { throttle: -1, steer: 0 }, COAST = { throttle: 0, steer: 0 };
function copStop(c, dt) { stepVehicle(c.v, c.v.vf > 0.15 ? STOP : COAST, dt, { solid: W.solidPolice, others: hostOthers }); if (Math.abs(c.v.vf) < 0.15) { c.v.vx *= 0.5; c.v.vy *= 0.5; } }
function copSees(c, ch) {
  if (ch.hidden >= 0 || ch.jailed) return false;
  const d = dist(c.v, ch.v), chasing = c.st === 'chase' && c.target === ch.id;
  let range = (ch.lights ? CFG.VISION : CFG.VISION_DARK) * S.cfg.visionMul * (W.inPark(ch.v.x, ch.v.y) ? CFG.VISION_PARK : 1) + (chasing ? 4 : 0);
  if (d > range) return false;
  if (d > CFG.NEAR && !chasing) {
    const dot = (Math.sin(c.v.a) * (ch.v.x - c.v.x) + Math.cos(c.v.a) * (ch.v.y - c.v.y)) / d;
    if (dot < Math.cos(CFG.FOV)) return false;
  }
  return W.los(c.v.x, c.v.y, ch.v.x, ch.v.y);
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
  W.posts.forEach(p => cand.push({ x: p.x, y: p.y, w: 1.5 }));
  let total = 0;
  for (const k of cand) {
    if (dist(k, c.v) < 12) k.w *= 0.15;
    for (const o of S.cops) if (o !== c && o.goal && dist(o.goal, k) < 16) k.w *= 0.3;
    total += k.w;
  }
  let r = Math.random() * total;
  for (const k of cand) { r -= k.w; if (r <= 0) return k; }
  return cand[0];
}
function startSweep(c, around, first) {
  c.st = 'search'; c.sweep = nearHides(around, 2, 9); c.pre = first ? { x: around.x, y: around.y } : null; c.path = null; c.searchT = 0; c.target = null;
}
function copTick(c, dt) {
  const v = c.v;
  if (S.t < CFG.COUNT) { c.st = 'count'; c.sirenOn = false; return; }
  if (c.st === 'count') { c.st = 'patrol'; c.wait = 0.5 * c.id; }
  const sp = S.cfg.speedMul;
  let seen = null, sd = 1e9;
  for (const ch of chors()) { if (copSees(c, ch)) { const d = dist(v, ch.v); if (d < sd) { sd = d; seen = ch; } } }
  if (seen) {
    if (c.st !== 'chase' || c.target !== seen.id) { ev({ t: 'spot', to: seen.id }); c.repath = 0; if (S.t - seen.spotAt > 6) { addHeat(seen, 0.6); seen.spotAt = S.t; } }
    c.st = 'chase'; c.target = seen.id; c.lastSeen = { x: seen.v.x, y: seen.v.y, t: S.t }; c.sawT = S.t;
  } else if (c.st === 'patrol' || c.st === 'search') { // a screaming engine nearby gives you away
    for (const ch of chors()) if (ch.nitroOn && loose(ch) && dist(v, ch.v) < CFG.NOISE_RANGE) { c.st = 'respond'; c.goal = { x: ch.v.x, y: ch.v.y }; c.path = null; break; }
  }
  c.sirenOn = c.st === 'chase' || c.st === 'respond';
  if (c.st === 'chase') {
    const tg = S.players.get(c.target);
    if (!tg || tg.jailed) { c.st = 'patrol'; c.target = null; c.path = null; c.wait = 1; copStop(c, dt); return; }
    if (tg.hidden >= 0 || (!seen && S.t - c.lastSeen.t > 2.6)) { startSweep(c, c.lastSeen, true); copStop(c, dt); return; }
    const d = dist(v, tg.v), fresh = seen || S.t - c.lastSeen.t < 0.8;
    c.repath -= dt;
    if (fresh && d < 4.5 && W.los(v.x, v.y, tg.v.x, tg.v.y)) { // close and in view: go straight for where they will be
      const lead = clamp(d / 3.5, 0, 0.6);
      c.path = [{ x: v.x, y: v.y }, { x: tg.v.x + tg.v.vx * lead, y: tg.v.y + tg.v.vy * lead }]; c.drv.seg = 0; c.goalPt = null; c.repath = 0;
    } else if (c.repath <= 0) { c.repath = 0.4; copGo(c, fresh ? tg.v.x : c.lastSeen.x, fresh ? tg.v.y : c.lastSeen.y); }
    copDrive(c, CFG.COP_CHASE * sp * (1 + 0.012 * tg.heat), dt);
  } else if (c.st === 'respond') {
    if (!c.path) copGo(c, c.goal.x, c.goal.y);
    if (copDrive(c, CFG.COP_RESPOND * sp, dt)) startSweep(c, c.goal, false);
  } else if (c.st === 'search') {
    if (c.pre) { if (!c.path) copGo(c, c.pre.x, c.pre.y); if (copDrive(c, CFG.COP_RESPOND * sp, dt)) { c.pre = null; c.path = null; } return; }
    if (!c.sweep.length) { c.st = 'patrol'; c.path = null; c.wait = 0.5; copStop(c, dt); return; }
    const h = W.hides[c.sweep[0]];
    if (!c.path) copGo(c, h.search.x, h.search.y);
    const there = copDrive(c, CFG.COP_RESPOND * 0.8 * sp, dt) || dist(v, h.search) < 1.0;
    if (there && Math.abs(v.vf) < 0.6) { // parked outside: the officer shines a torch through the gaps
      c.searchT += dt; S.searchLv[h.i] = clamp(c.searchT / CFG.AI_SEARCH, 0.05, 1);
      if (c.searchT >= CFG.AI_SEARCH) {
        const f = chors().find(p => p.hidden === h.i && !p.jailed);
        if (f) { f.immune = 0; arrest(f, null); }
        c.searchT = 0; c.sweep.shift(); c.path = null; delete S.searchLv[h.i];
      }
    } else if (c.searchT > 0) { c.searchT = 0; delete S.searchLv[h.i]; }
  } else { // patrol
    if (c.wait > 0) { c.wait -= dt; copStop(c, dt); return; }
    if (!c.path) { const g = pickPatrol(c); c.goal = { x: g.x, y: g.y }; copGo(c, g.x, g.y); if (!c.path) { c.wait = 1; return; } }
    if (copDrive(c, CFG.COP_CRUISE * sp, dt)) { c.wait = 0.8 + Math.random() * 1.6; c.path = null; }
  }
}

function hostTick(dt) {
  if (S.over) return;
  S.t += dt;
  const F = S.flags;
  if (!F.go && S.t >= CFG.COUNT) { F.go = 1; ev({ t: 'go', m: 'The police are rolling. Drive!' }); }
  if (!F.jack && S.t >= CFG.JACKPOT_AT) { F.jack = 1; ev({ t: 'chime', m: 'The clock tower chimes. The three tijoris are open!' }); }
  if (!F.co && S.t >= CFG.COACH_OPEN) { F.co = 1; ev({ t: 'chime', m: 'The mail coach strongbox is open for one minute!' }); }
  if (!F.cc && S.t >= CFG.COACH_CLOSE) { F.cc = 1; if (!S.sites[W.sites.findIndex(s => s.coach)].robbed) ev({ t: 'info', m: 'The mail coach has shut its strongbox.' }); }
  if (!F.min && S.t >= CFG.ROUND - 60) { F.min = 1; ev({ t: 'info', m: 'One minute left!' }); }
  const all = [...S.players.values()];
  hostOthers = [];
  for (const P of all) {
    if (P.immune > 0) P.immune -= dt;
    if (P.jailed) { P.jailLeft -= dt; if (P.jailLeft <= 0) release(P, 'bail'); }
    if (loose(P)) hostOthers.push(P.v);
  }
  for (const c of S.cops) hostOthers.push(c.v);
  // robbing: progress lives on the host so two cars on one job really are faster
  for (let i = 0; i < W.sites.length; i++) {
    const s = S.sites[i], d = W.sites[i]; s.st = siteState(i);
    if (s.st !== 0) { s.prog = 0; continue; }
    const hs = all.filter(P => P.role === 'chor' && P.robbing === i && loose(P) && dist(P.v, d) < CFG.ROB_RANGE + 1 && Math.abs(P.v.vf) < CFG.ROB_SPEED + 0.7 && canCarry(P, i));
    if (hs.length) {
      if (d.tier === 3 && S.t - s.alarmAt > 6) alarm(i, true);
      if (d.tier === 2 && s.prog === 0 && S.t - s.alarmAt > 5) alarm(i, false);
      s.prog += dt * Math.pow(hs.length, 0.9);
      if (s.prog >= CFG.HOLD[d.tier]) {
        s.robbed = true; s.prog = 0; s.st = 2; hs[0].carry.push(i); hs.forEach(P => { P.robbing = -1; addHeat(P, [0, 0.7, 1.3, 2.4][d.tier]); });
        ev({ t: 'grab', m: hs[0].name + ' robbed ' + d.full + ' (' + money(d.value) + ').', who: hs[0].id });
        if (d.tier !== 3) alarm(i, false);
      }
    } else if (s.prog > 0) s.prog = Math.max(0, s.prog - dt * 2.5);
  }
  // heat cools when nobody has eyes on you, faster while hidden; witnesses report a loaded car in lit streets
  for (const ch of all) {
    if (ch.role !== 'chor') continue;
    const chased = S.cops.some(c => c.st === 'chase' && c.target === ch.id);
    if (!chased) ch.heat = Math.max(0, ch.heat - dt * (ch.hidden >= 0 ? 0.22 : 0.04));
    if (!ch.carry.length) { ch.tipAt = S.t; continue; }
    if (!loose(ch) || W.inPark(ch.v.x, ch.v.y) || chased) continue;
    const every = Math.max(5, (ch.carry.some(isJackpot) ? CFG.TIP_EVERY_JACKPOT : CFG.TIP_EVERY) - ch.heat * 1.2);
    if (S.t - (ch.tipAt || 0) < every) continue;
    ch.tipAt = S.t;
    const near = W.sites.reduce((b, s) => (!b || dist(s, ch.v) < dist(b, ch.v)) ? s : b, null);
    const idle = S.cops.filter(c => c.st !== 'chase' && c.st !== 'count').sort((a, b) => dist(a.v, ch.v) - dist(b.v, ch.v)).slice(0, 1 + Math.floor(ch.heat / 2));
    for (const c of idle) { c.st = 'respond'; c.goal = { x: ch.v.x, y: ch.v.y }; c.hint = { x: ch.v.x, y: ch.v.y }; c.path = null; }
    ev({ t: 'tip', m: 'Tip-off: a loaded getaway car was seen near ' + near.full + '.', x: ch.v.x, y: ch.v.y, who: ch.id });
  }
  for (const k in S.searchLv) if (!S.cops.some(c => c.st === 'search' && c.sweep[0] == k && c.searchT > 0)) delete S.searchLv[k];
  for (const c of S.cops) copTick(c, dt);
  // a police player holding "search" in front of a hideout rattles its door too
  const pol = all.filter(P => P.role === 'police');
  for (const p of pol) if (p.searching >= 0 && W.hides[p.searching]) S.searchLv[p.searching] = clamp((S.t - p.searchT0) / CFG.SEARCH_HOLD, 0.05, 1);
  // the bust meter: a police vehicle staying close to a slow car fills it
  for (const ch of all) {
    if (ch.role !== 'chor') continue;
    if (!loose(ch) || ch.immune > 0) { ch.bust = 0; continue; }
    let n = 0, by = null;
    for (const c of S.cops) if (c.st !== 'count' && dist(c.v, ch.v) < CFG.BUST_RANGE && W.los(c.v.x, c.v.y, ch.v.x, ch.v.y)) n++;
    if (S.t >= CFG.COUNT) for (const p of pol) if (dist(p.v, ch.v) < CFG.BUST_RANGE && W.los(p.v.x, p.v.y, ch.v.x, ch.v.y)) { n++; by = by || p; }
    if (n) {
      const sp = Math.abs(ch.v.vf), rate = sp < 0.5 ? CFG.BUST_STOPPED : sp < 1.4 ? CFG.BUST_SLOW : sp < 2.4 ? CFG.BUST_ROLLING : CFG.BUST_FAST;
      ch.bust = Math.min(1, ch.bust + rate * (1 + 0.4 * (n - 1)) * dt);
      if (ch.bust >= 1) { arrest(ch, by); if (S.over) return; }
    } else ch.bust = Math.max(0, ch.bust - CFG.BUST_DRAIN * dt);
  }
  if (S.t >= CFG.ROUND) endRound('police', 'Time ran out with ' + money(S.banked) + ' of ' + money(S.target) + ' banked.');
}

// ------------------------------------------------------------------ network: snapshots
const ST_CODE = { patrol: 0, respond: 1, chase: 2, search: 3, count: 4 }, ST_NAME = ['patrol', 'respond', 'chase', 'search', 'count'];
function snapshot() {
  const m = {
    k: 's', t: r2(S.t), b: S.banked, ll: r2(Math.max(0, S.leverLock - S.t)),
    s: S.sites.map((s, i) => [s.st, Math.round(100 * s.prog / CFG.HOLD[W.sites[i].tier])]),
    p: [...S.players.values()].map(P => [P.id, r2(P.v.x), r2(P.v.y), r2(P.v.a), (P.jailed ? 1 : 0) | (P.immune > 0 ? 2 : 0) | (P.nitroOn ? 4 : 0) | (P.lights ? 8 : 0) | (P.brake ? 16 : 0) | (P.drift ? 32 : 0), P.hidden, P.carry, Math.ceil(P.jailLeft), P.arrests, P.own, r2(P.v.vf), r2(P.v.steer), Math.round(P.bust * 100), Math.round(P.heat * 10)]),
    c: S.cops.map(c => [r2(c.v.x), r2(c.v.y), r2(c.v.a), ST_CODE[c.st], c.target || '', r2(c.v.vf), r2(c.v.steer)]),
    sr: Object.keys(S.searchLv).map(k => [+k, r2(S.searchLv[k])]),
    e: S.evOut,
  };
  if (S.over) m.o = S.over;
  return m;
}
function applySnapshot(m) {
  if (S.screen !== 'play') return;
  S.t = m.t; S.banked = m.b; S.leverLock = m.t + m.ll;
  m.s.forEach((v, i) => { if (S.sites[i]) { S.sites[i].st = v[0]; S.sites[i].pct = v[1]; S.sites[i].robbed = v[0] === 2; } });
  for (const v of m.p) {
    const P = S.players.get(v[0]); if (!P) continue;
    if (!P.isMe) { P.net.x = v[1]; P.net.y = v[2]; P.net.a = v[3]; P.net.vf = v[10]; P.net.steer = v[11]; P.nitroOn = !!(v[4] & 4); P.lights = !!(v[4] & 8); P.brake = !!(v[4] & 16); P.drift = !!(v[4] & 32); }
    P.jailed = !!(v[4] & 1); P.immune = (v[4] & 2) ? 1 : 0; P.hidden = v[5]; P.carry = v[6]; P.jailLeft = v[7]; P.arrests = v[8]; P.own = v[9]; P.bust = v[12] / 100; P.heat = v[13] / 10;
  }
  while (S.cops.length < m.c.length) { const q = m.c[S.cops.length]; S.cops.push(newCop(S.cops.length, q[0], q[1], q[2])); }
  m.c.forEach((q, k) => { const c = S.cops[k], v = c.v; v.x = q[0]; v.y = q[1]; v.a = q[2]; c.st = ST_NAME[q[3]]; c.target = q[4] || null; v.vf = q[5]; v.steer = q[6]; c.sirenOn = c.st === 'chase' || c.st === 'respond'; });
  S.searchLv = {}; for (const q of (m.sr || [])) S.searchLv[q[0]] = q[1];
  for (const e of m.e) handleEvent(e);
  if (m.o && !S.over) { S.over = m.o; finishMatch(m.o); }
}
function handleEvent(e) {
  const me = S.me; if (!me) return;
  if (e.to && e.to !== me.id) return;
  const mine = e.who === me.id || (Array.isArray(e.who) && e.who.includes(me.id));
  switch (e.t) {
    case 'alarm': ping(e.x, e.y, 9, '#ff4a4a'); feed(e.m, 'alarm'); sfx.alarm(); S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; if (me.role === 'police') sfx.radio(); break;
    case 'ping': ping(e.x, e.y, 5, '#ff8a4a'); if (me.role === 'police') { feed(e.m, 'alarm'); S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; sfx.radio(); } sfx.bell(); break;
    case 'grab': feed(e.m, 'gold'); if (mine) sfx.grab(); break;
    case 'tip': if (me.role === 'police') { ping(e.x, e.y, 6, '#ff8a4a'); feed(e.m, 'alarm'); S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; sfx.radio(); } else if (mine) { feed('Someone saw your loaded car. The police have been tipped off!', 'alarm'); sfx.bell(); } break;
    case 'bank': feed(e.m, 'good'); if (e.j) { sfx.jackpot(); if (me.role === 'police') { ping(e.x, e.y, 10, '#ff4a4a'); S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; } } else sfx.coin(); break;
    case 'arrest': feed(e.m, 'alarm'); sfx.caught(); if (mine) { banner('BUSTED!', 'red'); S.cam.shake = 0.5; } break;
    case 'free': feed(e.m, 'good'); sfx.free(); if (mine) banner('AZAAD!', 'green'); break;
    case 'chime': banner(e.m, 'gold'); feed(e.m, 'gold'); sfx.chime(); break;
    case 'go': feed(e.m); if (me.role === 'chor') sfx.spotted(); break;
    case 'spot': banner('DEKH LIYA! BHAAG!', 'red'); sfx.spotted(); break;
    case 'left': { feed(e.m); const P = S.players.get(e.who); if (P && !S.isHost) { dropEntity(P); S.players.delete(e.who); } break; }
    default: if (e.m) feed(e.m);
  }
}

// ------------------------------------------------------------------ local player: driving
function request(type, i) { if (S.isHost) doAction(S.me, type, i); else if (S.net) S.net.send({ k: 'a', t: type, i }); }
function findContext(me) {
  const v = me.v, sp = Math.abs(v.vf);
  if (me.jailed) return { type: 'none', label: 'Impounded. ' + (soloChor() ? 'Out in ' : 'A friend can pull a lever. Out in ') + Math.max(0, Math.ceil(me.jailLeft)) + 's' };
  const out = [];
  if (me.role === 'chor') {
    if (me.hidden >= 0) return { type: 'unhide', key: 'unhide', hold: 0.12, act: true, label: 'Hidden in ' + W.hides[me.hidden].name + '. Accelerate to burst out.' };
    if (me.carry.length) for (const e of W.escapes) {
      const d = dist(v, e); if (d > CFG.BANK_RANGE) continue;
      if (sp > CFG.BANK_SPEED) out.push({ s: d / CFG.BANK_RANGE - 0.5, type: 'none', label: 'Slow down to hand over the loot' });
      else out.push({ s: d / CFG.BANK_RANGE - 0.5, type: 'bank', i: e.i, key: 'bank' + e.i, hold: CFG.BANK_HOLD, act: true, label: 'Hold to hand over ' + money(carryValue(me)) });
    }
    W.sites.forEach((s, i) => {
      const d = dist(v, s); if (d > CFG.ROB_RANGE) return;
      const st = S.sites[i].st;
      if (st === 2) return;
      if (st === 1) out.push({ s: d / CFG.ROB_RANGE + 0.2, type: 'none', label: s.coach ? (S.t < CFG.COACH_OPEN ? 'Strongbox opens at 3:00' : 'Strongbox is shut') : (S.t < CFG.JACKPOT_AT ? 'Locked until the clock chimes at 1:00' : 'Locked again for a moment') });
      else if (!canCarry(me, i)) out.push({ s: d / CFG.ROB_RANGE + 0.2, type: 'none', label: 'The boot is full. Hand it over first.' });
      else if (sp > CFG.ROB_SPEED) out.push({ s: d / CFG.ROB_RANGE, type: 'none', label: 'Stop here to rob ' + s.full });
      else out.push({ s: d / CFG.ROB_RANGE, type: 'rob', i, key: 'rob' + i, act: true, label: 'Hold to rob ' + s.full + '  ' + money(s.value) });
    });
    if (chors().some(p => p.jailed && p !== me)) for (const l of W.levers) {
      const d = dist(v, l); if (d > CFG.LEVER_RANGE) continue;
      if (S.t < S.leverLock) out.push({ s: d / CFG.LEVER_RANGE, type: 'none', label: 'Lever locked for ' + Math.ceil(S.leverLock - S.t) + 's' });
      else out.push({ s: d / CFG.LEVER_RANGE - 0.3, type: 'lever', i: l.i, key: 'lever' + l.i, hold: CFG.LEVER_HOLD, act: true, label: 'Hold to open the impound' });
    }
    for (const h of W.hides) {
      if (!inHide(h, v.x, v.y, 0.1)) continue;
      const d = dist(v, h) / 1.5;
      if (me.carry.some(isJackpot)) out.push({ s: d + 0.3, type: 'none', label: 'Too hot to hide: the jackpot is in the boot' });
      else if ([...S.players.values()].some(o => o !== me && o.hidden === h.i)) out.push({ s: d + 0.3, type: 'none', label: 'Someone is already hiding here' });
      else if (sp > CFG.HIDE_SPEED) out.push({ s: d + 0.05, type: 'none', label: 'Slow down to hide in ' + h.name });
      else out.push({ s: d + 0.05, type: 'hide', i: h.i, key: 'hide' + h.i, hold: CFG.HIDE_HOLD, act: true, label: 'Hold to hide in ' + h.name });
    }
  } else {
    if (S.t < CFG.COUNT) return { type: 'none', label: 'Engines on… ' + Math.ceil(CFG.COUNT - S.t) };
    for (const h of W.hides) {
      const d = dist(v, h.search); if (d > CFG.SEARCH_RANGE) continue;
      if (sp > 1) out.push({ s: d, type: 'none', label: 'Stop to search ' + h.name });
      else out.push({ s: d, type: 'search', i: h.i, key: 'search' + h.i, hold: CFG.SEARCH_HOLD, act: true, label: 'Hold to search ' + h.name });
    }
  }
  out.sort((a, b) => a.s - b.s);
  return out[0] || null;
}
function perform(ctx) {
  switch (ctx.type) {
    case 'bank': request('bank', ctx.i); break;
    case 'hide': request('hide', ctx.i); break;
    case 'unhide': request('unhide', 0); break;
    case 'lever': request('lever', ctx.i); sfx.lever(); break;
    case 'search': request('search', ctx.i); S.searchSent = -1; break;
  }
}
const inp = { throttle: 0, steer: 0, handbrake: false, nitro: false };
function readInput() {
  const k = In.keys;
  let th = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let st = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  if (In.stick) { // thumb stick: sideways steers, forward and back are the pedals
    const sx = In.mx, sy = In.my;
    st += Math.sign(sx) * Math.pow(Math.abs(sx), 1.3);
    th += Math.abs(sy) < 0.18 ? 0 : sy > 0 ? Math.min(1, sy * 1.5) : Math.max(-1, sy * 1.5);
  }
  inp.throttle = clamp(th, -1, 1); inp.steer = clamp(st, -1, 1);
  inp.handbrake = k.has('Space') || In.brakeTouch; inp.nitro = k.has('ShiftLeft') || k.has('ShiftRight') || In.nitroTouch;
  return inp;
}
function localUpdate(dt) {
  const me = S.me; if (!me) return;
  const v = me.v, k = In.keys, i = readInput();
  const actHeld = k.has('KeyE') || k.has('KeyF') || k.has('Enter') || In.actTouch;
  if (!actHeld) S.latch = false;
  me.nitroOn = false;
  if (me.jailed) { v.vx = v.vy = v.vf = 0; me.brake = false; me.drift = false; }
  else if (me.hidden >= 0) {
    const h = W.hides[me.hidden], kk = Math.min(1, dt * 6);
    v.x += (h.x - v.x) * kk; v.y += (h.y - v.y) * kk; v.a = lerpAngle(v.a, h.a, kk); v.vx = v.vy = v.vf = 0; me.brake = false; me.drift = false;
    if (i.throttle > 0.4 && !S.unhideSent && !S.latchHide) { request('unhide', 0); S.unhideSent = true; }
    if (i.throttle < 0.2) S.latchHide = false;
  } else if (S.screen === 'play' && !(me.role === 'police' && S.t < CFG.COUNT)) {
    S.unhideSent = false;
    const wantNitro = i.nitro && i.throttle > 0.1 && me.nitro > 0 && !me.nitroEmpty;
    if (wantNitro) { if (!me.nitroWas) sfx.nitro(); me.nitro -= dt; me.nitroWait = CFG.NITRO_DELAY; if (me.nitro <= 0) { me.nitro = 0; me.nitroEmpty = true; } }
    else { me.nitroWait -= dt; if (me.nitroWait <= 0) me.nitro = Math.min(CFG.NITRO_MAX, me.nitro + CFG.NITRO_REGEN * dt); if (me.nitro > 0.9) me.nitroEmpty = false; }
    me.nitroOn = wantNitro; me.nitroWas = wantNitro;
    let mul = 1;
    for (const c of me.carry) mul -= isJackpot(c) ? CFG.CARRY_SLOW_JACKPOT : CFG.CARRY_SLOW;
    inp.nitro = wantNitro;
    stepVehicle(v, inp, dt, { solid: me.role === 'chor' ? W.solidChor : W.solidPolice, others: S.others, speedMul: mul });
    const fxs = Math.sin(v.a), fys = Math.cos(v.a);
    if (v.hit > 0.9) { sfx.crash(clamp(v.hit / 3.5, 0.15, 1)); S.cam.shake = Math.max(S.cam.shake, clamp(v.hit * 0.1, 0.05, 0.45)); fx.sparks(v.x + fxs * 0.4, 0.15, v.y + fys * 0.4, -fxs, -fys, clamp(v.hit / 3, 0.2, 1)); }
    const slipping = v.slip > 0.8 || (i.handbrake && Math.abs(v.vf) > 1.2);
    me.brake = (i.throttle < 0 && v.vf > 0.2) || i.handbrake; me.drift = slipping;
    if (slipping) {
      const ax = v.x - fxs * 0.27, ay = v.y - fys * 0.27, lx = ax + fys * 0.15, ly = ay - fxs * 0.15, rx = ax - fys * 0.15, ry = ay + fxs * 0.15;
      if (me.wheel) { fx.skid(me.wheel[0], me.wheel[1], lx, ly, 0.07, 0.6); fx.skid(me.wheel[2], me.wheel[3], rx, ry, 0.07, 0.6); }
      me.wheel = [lx, ly, rx, ry];
      S.smokeT = (S.smokeT || 0) - dt; if (S.smokeT <= 0) { S.smokeT = 0.045; fx.smoke(ax, 0.1, ay, clamp(v.slip / 2.2, 0.3, 1)); }
    } else me.wheel = null;
    if (wantNitro) { S.flameT = (S.flameT || 0) - dt; if (S.flameT <= 0) { S.flameT = 0.06; fx.smoke(v.x - fxs * 0.5, 0.12, v.y - fys * 0.5, 0.35); } }
  } else { v.vx = v.vy = v.vf = 0; }
  S.inThrottle = i.throttle;

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
      if (ctx.type === 'search' && S.searchSent !== ctx.i) { request('searching', ctx.i); S.searchSent = ctx.i; }
      if (S.hold.t >= ctx.hold) { perform(ctx); S.hold = { key: '', t: 0 }; S.latch = true; if (ctx.type === 'hide') S.latchHide = true; }
    } else { S.hold.t = 0; if (S.searchSent >= 0) { request('searching', -1); S.searchSent = -1; } }
  }
  // clients tell the host where they are
  if (!S.isHost && S.net) {
    const now = performance.now();
    if (now - S.lastSend > 66) { S.lastSend = now; S.net.send({ k: 'p', x: r2(v.x), y: r2(v.y), a: r2(v.a), v: r2(v.vf), s: r2(v.steer), f: (me.nitroOn ? 1 : 0) | (me.lights ? 2 : 0) | (me.brake ? 4 : 0) | (me.drift ? 8 : 0), q: me.tpSeq }); }
  }
}

// ------------------------------------------------------------------ drawing: cars, lights, camera, HUD
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
const carState = { speed: 0, steer: 0, brake: false, lights: true, siren: false, nitro: false, hidden: false, alpha: 1 };
function syncEntities(dt, time) {
  const me = S.me; S.others.length = 0;
  for (const P of S.players.values()) {
    const v = P.v;
    if (!P.isMe) { // ease remote cars toward their latest reported position
      const n = P.net, far = Math.hypot(n.x - v.x, n.y - v.y) > 5, k = far ? 1 : Math.min(1, dt * 12);
      v.x += (n.x - v.x) * k; v.y += (n.y - v.y) * k; v.a = lerpAngle(v.a, n.a, far ? 1 : Math.min(1, dt * 12)); v.vf = n.vf; v.steer = n.steer;
      v.vx = Math.sin(v.a) * v.vf; v.vy = Math.cos(v.a) * v.vf;
      if (loose(P)) S.others.push(v);
    }
    let vis = true, alpha = 1;
    if (P.hidden >= 0) { if (P.isMe || (me && me.role === 'chor' && P.role === 'chor')) alpha = P.isMe ? 1 : 0.4; else vis = false; }
    else if (!P.isMe && P.role === 'chor' && me && me.role === 'police' && !P.jailed) vis = dist(me.v, v) < 16 && W.los(me.v.x, me.v.y, v.x, v.y);
    if (vis && P.immune > 0 && Math.sin(time * 22) > 0) alpha = Math.min(alpha, 0.45);
    P.seen = vis; P.car.g.visible = vis;
    P.car.g.position.set(v.x, 0, v.y); P.car.g.rotation.y = v.a;
    carState.speed = (P.jailed || P.hidden >= 0) ? 0 : v.vf; carState.steer = v.steer; carState.brake = P.brake; carState.lights = P.lights && !P.jailed; carState.siren = P.role === 'police' && P.lights && S.t >= CFG.COUNT; carState.nitro = P.nitroOn; carState.hidden = P.hidden >= 0; carState.alpha = alpha;
    P.car.update(carState, dt, time);
    if (!P.isMe && vis && P.drift && Math.abs(v.vf) > 1) { P.smokeT = (P.smokeT || 0) - dt; if (P.smokeT <= 0) { P.smokeT = 0.07; fx.smoke(v.x - Math.sin(v.a) * 0.27, 0.1, v.y - Math.cos(v.a) * 0.27, 0.5); } }
  }
  for (const c of S.cops) {
    const v = c.v, k = Math.min(1, dt * 13);
    c.rx += (v.x - c.rx) * k; c.ry += (v.y - c.ry) * k; c.ra = lerpAngle(c.ra, v.a, k);
    c.car.g.position.set(c.rx, 0, c.ry); c.car.g.rotation.y = c.ra;
    carState.speed = v.vf; carState.steer = v.steer; carState.brake = c.st === 'search' && Math.abs(v.vf) < 0.4; carState.lights = true; carState.siren = !!c.sirenOn; carState.nitro = false; carState.hidden = false; carState.alpha = 1;
    c.car.update(carState, dt, time);
    c.proxy.x = c.rx; c.proxy.y = c.ry; c.proxy.a = c.ra; c.proxy.vx = Math.sin(v.a) * v.vf; c.proxy.vy = Math.cos(v.a) * v.vf;
    S.others.push(c.proxy);
  }
  // hideout doors and search torches
  for (let i = 0; i < W.hides.length; i++) {
    const hv = H.hideVis[i]; let occ = false;
    for (const P of S.players.values()) if (P.hidden === i) { occ = true; break; }
    const want = occ ? 1 : 0;
    if (hv.closed !== want) { hv.closed = clamp(hv.closed + Math.sign(want - hv.closed) * dt / 0.45, 0, 1); hv.ho.setClosed(hv.closed); }
    const lv = S.searchLv[i] || 0;
    if (hv.search !== lv) { hv.search = lv; hv.ho.setSearch(lv); }
    hv.ho.update(dt, time);
  }
}
function updateLights(dt, time) {
  const me = S.me;
  if (me && (S.screen === 'play' || S.screen === 'over') && me.lights && me.hidden < 0 && !me.jailed) {
    const v = me.v, fx_ = Math.sin(v.a), fy = Math.cos(v.a);
    headlamp.position.set(v.x + fx_ * 0.2, 0.7, v.y + fy * 0.2); headlamp.target.position.set(v.x + fx_ * 6, 0, v.y + fy * 6);
    headlamp.intensity += (16 - headlamp.intensity) * Math.min(1, dt * 8);
  } else headlamp.intensity += (0 - headlamp.intensity) * Math.min(1, dt * 8);
  // one red and one blue lamp follow the nearest wailing jeep, so its siren washes over walls, road and hideout floors
  let best = null, bd = 16;
  const from = me ? me.v : { x: 50, y: 50 };
  for (const c of S.cops) if (c.sirenOn) { const d = Math.hypot(c.rx - from.x, c.ry - from.y); if (d < bd) { bd = d; best = { x: c.rx, y: c.ry }; } }
  for (const P of S.players.values()) if (P.role === 'police' && !P.isMe && P.lights && S.t >= CFG.COUNT) { const d = dist(P.v, from); if (d < bd) { bd = d; best = P.v; } }
  if (!best && me && me.role === 'police' && me.lights && S.screen === 'play' && S.t >= CFG.COUNT) best = me.v;
  if (best) {
    const ph = Math.floor(time * 6) % 2;
    sirenRed.position.set(best.x, 0.8, best.y); sirenBlue.position.set(best.x, 0.8, best.y);
    sirenRed.intensity = ph ? 16 : 0; sirenBlue.intensity = ph ? 0 : 16;
  } else { sirenRed.intensity = 0; sirenBlue.intensity = 0; }
  hemi.intensity = HEMI + fx.flash * 3.2; moon.intensity = MOON + fx.flash * 2.6;
  if (post.enabled) post.uniforms.uFlash.value = fx.flash * 0.16;
}
function updateCamera(dt, time) {
  const cam = S.cam, me = S.me;
  let wantNear = 1.6;
  if ((S.screen === 'play' || S.screen === 'over') && me) {
    const v = me.v, sp = Math.abs(v.vf);
    // hidden in a walled hideout: the camera moves inside, low, looking out through the door
    const h = me.hidden >= 0 ? W.hides[me.hidden] : null, inside = h && h.bay;
    cam.hide += ((inside ? 1 : 0) - cam.hide) * Math.min(1, dt * 3.5);
    if (!In.look) { cam.lookT -= dt; if (cam.lookT <= 0) cam.look *= Math.max(0, 1 - dt * 3); }
    const wantYaw = Math.PI - v.a;
    cam.yaw = lerpAngle(cam.yaw, wantYaw, Math.min(1, dt * (v.vf < -0.3 ? 0.6 : 2.6 + sp * 0.5)));
    const yaw = cam.yaw + cam.look, fx_ = Math.sin(yaw), fz = -Math.cos(yaw), D = cam.dist + sp * 0.42, cp = Math.cos(cam.pitch), spn = Math.sin(cam.pitch);
    const ahead = 0.7 + Math.max(0, v.vf) * 0.42, tx = v.x + Math.sin(v.a) * ahead, tz = v.y + Math.cos(v.a) * ahead;
    v3.set(tx - fx_ * D * cp, D * spn, tz - fz * D * cp); v3b.set(tx, 0.3, tz);
    if (h && !inside) { v3.set(h.x - fx_ * 3.2, 2.6, h.y - fz * 3.2); v3b.set(h.x, 0.25, h.y); }   // grove: come in close above the trees
    if (cam.hide > 0.002) {
      const hh = inside ? h : cam.lastHide; if (inside) cam.lastHide = h;
      if (hh) {
        const ox = Math.sin(hh.a), oz = Math.cos(hh.a), e = cam.hide * cam.hide * (3 - 2 * cam.hide);
        v3.lerp(v3c.set(hh.x - ox * 0.82, 0.46, hh.y - oz * 0.82), e); v3b.lerp(v3d.set(hh.x + ox * 3, 0.3, hh.y + oz * 3), e);
        if (e > 0.5) wantNear = 0.06;
      }
    }
    if (cam.shake > 0.001) { cam.shake *= Math.max(0, 1 - dt * 6); v3.x += (Math.random() - 0.5) * cam.shake; v3.y += (Math.random() - 0.5) * cam.shake * 0.6; v3.z += (Math.random() - 0.5) * cam.shake; }
    const kk = Math.min(1, dt * 9);
    cam.pos.lerp(v3, kk); cam.tgt.lerp(v3b, Math.min(1, dt * 11));
    camera.position.copy(cam.pos); camera.lookAt(cam.tgt);
    const wantFov = (innerWidth < innerHeight ? 60 : 52) + (me.nitroOn ? 9 : 0) + sp * 1.2;
    cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 4);
    camera.updateMatrixWorld();
    if (cam.hide > 0.5) U.uCut.value.z = -1;
    else { v3.set(v.x, 0.25, v.y).project(camera); U.uCut.value.x = v3.x * 0.5 + 0.5; U.uCut.value.y = v3.y * 0.5 + 0.5; v3.set(v.x, 0.25, v.y).applyMatrix4(camera.matrixWorldInverse); U.uCut.value.z = -v3.z; }
  } else {
    cam.orbit += dt * 0.045;
    cam.pos.set(50 + Math.sin(cam.orbit) * 34, 15, 50 + Math.cos(cam.orbit) * 34); cam.tgt.set(50, 0, 50);
    camera.position.copy(cam.pos); camera.lookAt(cam.tgt); U.uCut.value.z = -1; cam.fov += (50 - cam.fov) * Math.min(1, dt * 4);
  }
  if (Math.abs(camera.fov - cam.fov) > 0.05 || camera.near !== wantNear) { camera.fov = cam.fov; camera.near = wantNear; camera.updateProjectionMatrix(); }
}
const v3c = new THREE.Vector3(), v3d = new THREE.Vector3();
function updateLabels() {
  for (const sp of LABELS) {
    if (!sp.visible) continue;
    sp.getWorldPosition(v3); const d = v3.distanceTo(camera.position), s = sp.userData.base * clamp(d / 9.5, 0.55, 2.2);
    sp.scale.set(s * sp.userData.ratio, s, 1); sp.material.opacity = clamp((d - 2.6) / 2.5, 0, 1) * (S.cam.hide > 0.5 ? 0 : 1);
  }
}
function updateWorldVisuals(time) {
  for (let i = 0; i < S.sites.length; i++) {
    const vz = H.siteVis[i]; setSiteVisual(vz, S.sites[i].st);
    // beams fade when the camera is right beside them, so they never fill the screen
    const near = clamp((Math.hypot(camera.position.x - W.sites[i].x, camera.position.z - W.sites[i].y) - 3.5) / 5, 0.12, 1);
    vz.beam.material.opacity = (S.sites[i].st === 0 ? 0.17 + 0.07 * Math.sin(time * 3 + i) : 0.09) * near;
    vz.gem.rotation.y = time * 1.6 + i; vz.gem.position.y = 0.95 + Math.sin(time * 2.2 + i) * 0.08;
  }
  for (let i = 0; i < W.escapes.length; i++) H.escVis[i].beam.material.opacity = 0.2 * clamp((Math.hypot(camera.position.x - W.escapes[i].x, camera.position.z - W.escapes[i].y) - 3.5) / 5, 0.12, 1);
  const locked = S.t < S.leverLock;
  for (const l of H.leverVis) l.bulb.material.color.setHex(locked ? 0xff4a4a : COLORS.police);
  H.thanaLamp.material.color.setHex(Math.floor(time * 2) % 2 ? 0x8fb4ff : 0xff6a6a);
  // arrow on the road ahead pointing to the next useful place
  const me = S.me; let tgt = null, col = COLORS.loot;
  if (me && S.screen === 'play' && loose(me)) {
    if (me.role === 'chor') {
      if (me.carry.length) { col = COLORS.escape; tgt = W.escapes.reduce((b, e) => (!b || dist(me.v, e) < dist(me.v, b)) ? e : b, null); }
      else { let bd = 1e9; W.sites.forEach((s, i) => { if (S.sites[i].st === 0) { const d = dist(me.v, s); if (d < bd) { bd = d; tgt = s; } } }); }
    } else if (S.lastAlarm && performance.now() - S.lastAlarm.t < 16000) { tgt = S.lastAlarm; col = COLORS.alarm; }
  }
  if (tgt && dist(me.v, tgt) > 3) {
    const a = Math.atan2(tgt.x - me.v.x, tgt.y - me.v.y);
    arrow.visible = true; arrow.material.color.setHex(col);
    arrow.position.set(me.v.x + Math.sin(a) * 1.15, 0.07, me.v.y + Math.cos(a) * 1.15); arrow.rotation.y = a;
  } else arrow.visible = false;
}
let hudCache = {};
function setText(id, text) { if (hudCache[id] !== text) { hudCache[id] = text; $(id).textContent = text; } }
function updateHud(dt, time) {
  const me = S.me; if (!me) return;
  const v = me.v, left = CFG.ROUND - S.t;
  setText('timer', mmss(left)); $('timer').classList.toggle('low', left <= 30);
  let phase = '';
  if (S.t < CFG.COUNT) phase = 'Police roll out in ' + Math.ceil(CFG.COUNT - S.t);
  else if (S.t < CFG.JACKPOT_AT) phase = 'Tijoris open in ' + Math.ceil(CFG.JACKPOT_AT - S.t) + 's';
  else if (S.t >= CFG.COACH_OPEN && S.t < CFG.COACH_CLOSE) phase = 'Mail coach open ' + Math.ceil(CFG.COACH_CLOSE - S.t) + 's';
  setText('phase', phase);
  setText('lootText', money(S.banked) + ' / ' + money(S.target));
  $('lootBar').style.width = clamp(100 * S.banked / S.target, 0, 100) + '%';
  if (me.role === 'chor') {
    setText('bag', me.carry.length ? 'Boot: ' + me.carry.map(i => W.sites[i].name).join(' + ') + '  ' + money(carryValue(me)) : 'Boot: empty' + (me.arrests && soloChor() ? ' · busted ' + me.arrests + '/' + CFG.MAX_ARRESTS_SOLO : ''));
    const stars = Math.ceil(me.heat - 0.05);
    if (hudCache.stars !== stars) { hudCache.stars = stars; $('wanted').innerHTML = '★'.repeat(stars) + '<span class="off">' + '★'.repeat(CFG.HEAT_MAX - stars) + '</span>'; }
  } else setText('bag', 'Busts: ' + me.arrests);
  setText('speedNum', String(Math.round(Math.abs(v.vf) * CFG.KMH)));
  $('nitro').firstElementChild.style.width = (100 * me.nitro / CFG.NITRO_MAX) + '%';
  $('nitro').firstElementChild.style.background = me.nitroEmpty ? '#ff6a6a' : '';
  setText('lamp', me.role === 'chor' ? (me.lights ? 'LIGHTS ON' : 'LIGHTS OFF · harder to spot') : (me.lights ? 'SIREN ON' : 'SIREN OFF'));
  $('lamp').classList.toggle('off', !me.lights);
  const ctx = S.ctx, pr = $('prompt');
  if (ctx && S.screen === 'play') {
    pr.hidden = false; setText('promptText', ctx.label);
    let frac = 0;
    if (ctx.type === 'rob') frac = S.isHost ? S.sites[ctx.i].prog / CFG.HOLD[W.sites[ctx.i].tier] : S.sites[ctx.i].pct / 100;
    else if (ctx.act && S.hold.key === ctx.key) frac = S.hold.t / ctx.hold;
    $('promptBarWrap').style.display = ctx.act && ctx.type !== 'unhide' ? '' : 'none';
    $('promptBar').style.width = clamp(frac * 100, 0, 100) + '%';
  } else pr.hidden = true;
  // bust meter: yours if you are the chor, your best catch-in-progress if you are police
  let bust = me.role === 'chor' ? me.bust : 0;
  if (me.role === 'police') for (const P of S.players.values()) if (P.role === 'chor' && P.seen && dist(P.v, v) < 3) bust = Math.max(bust, P.bust);
  const bEl = $('bust');
  if (bust > 0.02 && S.screen === 'play') { bEl.hidden = false; $('bustBar').style.width = (bust * 100) + '%'; setText('bustText', me.role === 'chor' ? 'BUST' : 'BUSTING'); if (me.role === 'chor' && bust > (S.bustWas || 0) + 0.2) { sfx.bustTick(); S.bustWas = bust; } }
  else { bEl.hidden = true; S.bustWas = 0; }
  // danger: who is on me, how close; drives the red edges, the siren and the music
  let danger = 0, chaser = null, nearCop = 99;
  for (const c of S.cops) { const d = Math.hypot(c.rx - v.x, c.ry - v.y); if (d < nearCop) nearCop = d; if (me.role === 'chor' && !me.jailed && c.st === 'chase' && c.target === me.id) { const q = clamp(1 - d / 20, 0.3, 1); if (q > danger) { danger = q; chaser = { x: c.rx, y: c.ry }; } } }
  for (const P of S.players.values()) if (P.role === 'police' && !P.isMe) { const d = dist(P.v, v); if (d < nearCop) nearCop = d; if (me.role === 'chor' && loose(me) && d < 12 && W.los(P.v.x, P.v.y, v.x, v.y)) { const q = clamp(1 - d / 14, 0.3, 1); if (q > danger) { danger = q; chaser = P.v; } } }
  if (S.screen !== 'play') danger = 0;
  const th = $('threat');
  if (chaser && S.cam.hide < 0.5) {
    v3.set(chaser.x, 0.3, chaser.y).project(camera);
    if (v3.z < 1 && Math.abs(v3.x) < 0.93 && Math.abs(v3.y) < 0.88) th.style.display = 'none';
    else {
      const dx = chaser.x - v.x, dy = chaser.y - v.y, yaw = S.cam.yaw + S.cam.look, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const ang = Math.atan2(dx * sy - dy * cy, dx * cy + dy * sy);
      th.style.display = 'block'; th.style.left = (50 + Math.cos(ang) * 43) + '%'; th.style.top = (50 - Math.sin(ang) * 39) + '%';
      th.style.transform = 'translate(-50%,-50%) rotate(' + (90 - ang * 180 / Math.PI).toFixed(0) + 'deg)';
    }
  } else th.style.display = 'none';
  S.danger += (danger - S.danger) * 0.12;
  $('vignette').style.opacity = S.danger > 0.02 ? (S.danger * (0.6 + 0.25 * Math.sin(time * 9))).toFixed(2) : 0;
  // hiding: black bars, drained colour, and a meter for how close the police are
  const hiding = me.hidden >= 0 && S.screen === 'play';
  $('hideui').classList.toggle('on', hiding);
  let hideDanger = 0;
  if (hiding) { hideDanger = clamp(1 - (nearCop - 2) / 12, 0, 1); const lv = S.searchLv[me.hidden] || 0; if (lv > 0) hideDanger = Math.max(hideDanger, 0.7 + 0.3 * lv); $('hideMeter').firstElementChild.style.width = (hideDanger * 100) + '%'; setText('hideText', lv > 0 ? 'THEY ARE CHECKING THIS ONE' : hideDanger > 0.55 ? 'Jeep close. Stay still.' : 'Engine off. Lights off.'); }
  if (hiding && !S.wasHiding) sfx.shutter(); if (!hiding && S.wasHiding) sfx.unshutter(); S.wasHiding = hiding;
  if (post.enabled) post.uniforms.uHide.value += ((hiding ? 1 : 0) - post.uniforms.uHide.value) * Math.min(1, dt * 4);
  // sound
  const playing = S.screen === 'play' && !S.paused;
  engine(Math.abs(v.vf) / CAR.chor.maxSpeed, Math.max(0, S.inThrottle || 0), playing && loose(me));
  skid(playing && me.drift ? clamp(v.slip / 1.6, 0.25, 1) : 0);
  let wail = 0;
  for (const c of S.cops) if (c.sirenOn) wail = Math.max(wail, clamp(1 - Math.hypot(c.rx - v.x, c.ry - v.y) / 26, 0, 1));
  for (const P of S.players.values()) if (P.role === 'police' && P.lights && S.t >= CFG.COUNT) wail = Math.max(wail, P.isMe ? 0.25 : clamp(1 - dist(P.v, v) / 26, 0, 1));
  siren(playing ? wail * (hiding ? 0.55 : 1) : 0);
  heartbeat(hiding ? 0.2 + 0.8 * hideDanger : 0);
  music(playing ? clamp(0.22 + S.danger * 0.7 + (me.carry.length ? 0.12 : 0) + (hiding ? 0.1 : 0), 0, 1) : 0.12);
}
function drawMini() {
  const cv = $('mini'), c = cv.getContext('2d'), Z = cv.width / 100, me = S.me, now = performance.now();
  c.drawImage(miniBase, 0, 0, cv.width, cv.height);
  const dot = (x, y, r, col) => { c.beginPath(); c.arc(x * Z, y * Z, r, 0, TAU); c.fillStyle = col; c.fill(); };
  W.sites.forEach((s, i) => { const st = S.sites[i] ? S.sites[i].st : 0; if (st === 2) return; dot(s.x, s.y, 2.2 + s.tier * 1.1, st === 1 ? '#8a6a4a' : '#f3b43f'); if (s.tier === 3) { c.beginPath(); c.arc(s.x * Z, s.y * Z, 7.5, 0, TAU); c.strokeStyle = st === 1 ? '#8a6a4a' : '#f3b43f'; c.lineWidth = 1.4; c.stroke(); } });
  for (const e of W.escapes) { c.beginPath(); c.moveTo(e.x * Z, e.y * Z - 7); c.lineTo(e.x * Z + 6.5, e.y * Z + 5); c.lineTo(e.x * Z - 6.5, e.y * Z + 5); c.closePath(); c.fillStyle = '#3bc98b'; c.fill(); }
  const anyJailed = chors().some(p => p.jailed);
  for (const l of W.levers) { c.beginPath(); c.arc(l.x * Z, l.y * Z, anyJailed ? 4 + 2 * Math.sin(now / 150) : 2.5, 0, TAU); c.strokeStyle = '#6a98ff'; c.lineWidth = 2; c.stroke(); }
  S.pings = S.pings.filter(p => now - p.t0 < p.dur);
  for (const p of S.pings) { const f = ((now - p.t0) % 1100) / 1100; c.beginPath(); c.arc(p.x * Z, p.y * Z, 3 + f * 16, 0, TAU); c.strokeStyle = p.col; c.globalAlpha = 1 - f; c.lineWidth = 2.5; c.stroke(); c.globalAlpha = 1; dot(p.x, p.y, 3, p.col); }
  if (!me) return;
  for (const k of S.cops) { if (me.role === 'police' || k.st === 'chase' || Math.hypot(k.rx - me.v.x, k.ry - me.v.y) < 20) dot(k.rx, k.ry, 3.4, k.st === 'chase' ? '#ff5050' : '#6a98ff'); }
  for (const P of S.players.values()) {
    if (P.isMe) continue;
    if (P.role === 'police') { if (me.role === 'police' || dist(P.v, me.v) < 20) dot(P.v.x, P.v.y, 3.6, '#8fb4ff'); }
    else if (me.role === 'chor' || P.seen || P.jailed) dot(P.v.x, P.v.y, 3.4, P.jailed ? '#8a8f9c' : '#ffd98a');
  }
  c.save(); c.translate(me.v.x * Z, me.v.y * Z); c.rotate(-me.v.a + Math.PI);
  c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = '#0a0f1c'; c.stroke(); c.restore();
}

// ------------------------------------------------------------------ end of round
function finishMatch(o) {
  const me = S.me, won = me && ((o.w === 'chor') === (me.role === 'chor'));
  siren(0); arrow.visible = false;
  if (won) sfx.win(); else sfx.lose();
  $('endTitle').textContent = o.w === 'chor' ? (won ? 'Bhaag gaye! Chors win' : 'The chors got away') : (won ? 'Pakad liya! Police win' : 'Pakde gaye! Police win');
  $('endTitle').className = 'result ' + (won ? 'win' : 'lose');
  $('endWhy').textContent = o.why;
  for (const p of o.pl) { p.own = +p.own || 0; p.ar = +p.ar || 0; p.n = String(p.n).slice(0, 14); p.r = p.r === 'police' ? 'police' : 'chor'; }
  const mine = o.pl.find(p => p.id === S.myId) || { own: 0, ar: 0 };
  const stats = [['Banked', money(o.b) + ' / ' + money(o.tg)], ['Time', mmss(o.t)], me && me.role === 'chor' ? ['Your loot', money(mine.own)] : ['Your busts', String(mine.ar)]];
  if (S.solo) stats.push(['Night', String(S.night)]);
  const es = $('endStats'); es.innerHTML = '';
  for (const s of stats) { const d = document.createElement('div'), l = document.createElement('span'), vv = document.createElement('b'); l.className = 'label'; l.textContent = s[0]; vv.textContent = s[1]; d.append(l, vv); es.appendChild(d); }
  const list = $('endList'); list.innerHTML = '';
  if (!S.solo) for (const p of o.pl) { const li = document.createElement('li'); const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.n + (p.id === S.myId ? ' (you)' : ''); const tg = document.createElement('span'); tg.className = 'tag ' + p.r; tg.textContent = p.r === 'chor' ? money(p.own) : p.ar + ' busts'; li.append(nm, tg); list.appendChild(li); }
  const before = paintsUnlocked(save.total);
  if (me && me.role === 'chor') save.total += mine.own;
  if (won) save.wins++;
  let note = '';
  if (S.solo) {
    if (won) { save.night = Math.max(save.night, S.night + 1); $('btnAgain').textContent = 'Next night · ' + (S.night + 1); note = 'Night ' + (S.night + 1) + ' needs more loot and brings sharper police.'; }
    else $('btnAgain').textContent = 'Try night ' + S.night + ' again';
    $('btnAgain').disabled = false;
  } else if (S.isHost) { $('btnAgain').textContent = 'Back to the room'; $('btnAgain').disabled = false; }
  else { $('btnAgain').textContent = 'Waiting for the host…'; $('btnAgain').disabled = true; }
  if (paintsUnlocked(save.total) > before) note = 'New car paint unlocked: ' + PAINTS[Math.min(PAINTS.length, paintsUnlocked(save.total)) - 1].name + '. ' + note;
  $('endNote').textContent = note;
  storeSave(); refreshMenu();
  setTimeout(() => { if (S.over === o) setScreen('over'); }, 1100);
}

// ------------------------------------------------------------------ menu, lobby, networking flows
function refreshMenu() {
  $('btnSolo').textContent = 'Play solo · Night ' + save.night + ' · ' + matchSetup(1, 0, save.night).name;
  $('rankName').textContent = rankFor(save.total); $('rankLoot').textContent = money(save.total);
  $('btnMute').textContent = isMuted() ? 'Sound off' : 'Sound on';
  const q = 'Graphics: ' + (save.quality === 'auto' ? 'Auto' : save.quality === 'high' ? 'High' : 'Low'); $('btnQuality').textContent = q; $('btnQuality2').textContent = q;
  const mu = 'Music: ' + (isMusicOn() ? 'on' : 'off'); $('btnMusic').textContent = mu; $('btnMusic2').textContent = mu;
  const box = $('paints'), open = paintsUnlocked(save.total); box.innerHTML = '';
  PAINTS.forEach((p, k) => {
    const b = document.createElement('button'); b.type = 'button'; b.style.background = '#' + p.hex.toString(16).padStart(6, '0'); b.title = p.name + (k >= open ? ' (bank more loot to unlock)' : ''); b.setAttribute('aria-label', p.name);
    if (k >= open) b.className = 'locked'; else b.onclick = () => { save.paint = p.id; storeSave(); refreshMenu(); sfx.click(); };
    if (p.id === save.paint) { b.classList.add('sel'); $('paintName').textContent = '· ' + p.name; }
    box.appendChild(b);
  });
}
function applyQuality() {
  const high = highQ();
  post.setEnabled(high); if (fx) fx.setQuality(high ? 'high' : 'low');
  pixelCap = isTouch ? (high ? 1.75 : 1.25) : (high ? 2 : 1.25);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap)); resize();
}
function leaveNet() { if (S.net) { try { if (S.isHost) S.net.broadcast({ k: 'bye' }); else S.net.send({ k: 'bye' }); } catch (e) {} const n = S.net; S.net = null; setTimeout(() => { try { n.close(); } catch (e) {} }, 150); } }
function toMenu(msg) { leaveNet(); S.isHost = true; S.solo = true; S.myId = 'h'; clearDyn(); arrow.visible = false; fx.setRain(0); setScreen('menu'); refreshMenu(); $('menuErr').textContent = msg || ''; }
function spawnFor(role, k) {
  if (role === 'police') { const p = W.policeSpawns[k % W.policeSpawns.length]; return { x: p.x, y: p.y, a: p.a }; }
  const s = W.spawns[k % W.spawns.length], q = W.nearestWalk(s.x + (k >= 4 ? 0.9 : 0), s.y);
  return { x: q.x, y: q.y, a: s.a };
}
function startSolo() {
  initAudio(); leaveNet(); S.isHost = true; S.solo = true; S.myId = 'h'; S.night = save.night;
  save.name = myName(); storeSave();
  const sp = spawnFor('chor', Math.floor(Math.random() * 4));
  beginMatch({ cfg: matchSetup(1, 0, S.night), players: [{ id: 'h', name: save.name, role: 'chor', x: sp.x, y: sp.y, a: sp.a, paint: paintHex(save.paint) }] });
}
function renderLobby() {
  const L = S.lobby, me = L.players.find(p => p.id === S.myId);
  $('roomCode').textContent = L.code; $('pcount').textContent = L.players.length;
  const ul = $('plist'); ul.innerHTML = '';
  for (const p of L.players) { const li = document.createElement('li'); const sw = document.createElement('span'); sw.style.cssText = 'width:14px;height:14px;border-radius:50%;flex:none;border:1px solid rgba(255,255,255,.3);background:#' + ((p.role === 'chor' ? (p.paint | 0) : 0xdfe6f2).toString(16).padStart(6, '0')); const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.id === S.myId ? ' (you)' : '') + (p.id === 'h' ? ' · host' : ''); const tg = document.createElement('span'); tg.className = 'tag ' + p.role; tg.textContent = p.role === 'chor' ? 'Chor' : 'Police'; li.append(sw, nm, tg); ul.appendChild(li); }
  const nc = L.players.filter(p => p.role === 'chor').length, np = L.players.length - nc, setup = matchSetup(Math.max(1, nc), np, 1);
  $('btnRoleChor').disabled = !!me && me.role === 'chor'; $('btnRolePolice').disabled = !!me && me.role === 'police';
  $('lobbyInfo').textContent = nc === 0 ? 'At least one player must be a chor.' : `${nc} getaway car${nc > 1 ? 's' : ''} against ${np} police player${np === 1 ? '' : 's'}${setup.cops ? ' and ' + setup.cops + ' computer jeep' + (setup.cops > 1 ? 's' : '') : ''}. Chors must bank ${money(setup.target)} in 6 minutes.`;
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
function heartbeatNet() {
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
        if (!S.lobby.players.some(p => p.id === pid)) S.lobby.players.push({ id: pid, name: String(m.name || 'Dost').replace(/[<>]/g, '').trim().slice(0, 14) || 'Dost', role: 'chor', paint: (m.paint | 0) & 0xffffff });
        broadcastLobby();
      } else if (m.k === 'role') { const p = S.lobby.players.find(q => q.id === pid); if (p && S.screen === 'lobby' && (m.role === 'chor' || m.role === 'police')) { p.role = m.role; broadcastLobby(); } }
      else if (m.k === 'p') {
        const P = S.players.get(pid); if (!P || P.jailed || m.q < P.tpSeq || S.screen !== 'play') return;
        if (typeof m.x !== 'number' || typeof m.y !== 'number' || !isFinite(m.x) || !isFinite(m.y)) return;
        P.net.x = clamp(m.x, 0, 100); P.net.y = clamp(m.y, 0, 100); P.net.a = +m.a || 0; P.net.vf = clamp(+m.v || 0, -3, 6); P.net.steer = clamp(+m.s || 0, -1, 1);
        P.nitroOn = !!(m.f & 1); P.lights = !!(m.f & 2); P.brake = !!(m.f & 4); P.drift = !!(m.f & 8);
      } else if (m.k === 'a') doAction(S.players.get(pid), String(m.t), m.i);
    },
    onLeave(pid) { hostDrop(pid); },
  });
  try {
    const code = await net.open();
    S.net = net; S.isHost = true; S.solo = false; S.myId = 'h';
    S.lobby = { code, players: [{ id: 'h', name: save.name, role: 'chor', paint: paintHex(save.paint) }] };
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
      if (m.k === 'lobby') { S.myId = m.you; S.lobby = { code: m.code, players: m.players }; if (S.screen !== 'lobby') { clearDyn(); setScreen('lobby'); } renderLobby(); }
      else if (m.k === 'start') beginMatch(m);
      else if (m.k === 's') applySnapshot(m);
      else if (m.k === 'tp') { const me = S.me; if (me) { const v = me.v; v.x = m.x; v.y = m.y; v.a = +m.a || 0; v.vx = v.vy = v.vf = 0; me.tpSeq = m.q; S.cam.yaw = Math.PI - v.a; } }
      else if (m.k === 'note') feed(m.m);
      else if (m.k === 'busy') toMenu('That room is in the middle of a round. Try again in a few minutes.');
      else if (m.k === 'full') toMenu('That room is full (8 players).');
    },
    onClose() { if (S.net === net) toMenu('Lost the connection to the host.'); },
  });
  try {
    await net.connect(code);
    S.net = net; S.isHost = false; S.solo = false; S.hostHeard = performance.now();
    net.send({ k: 'hello', name: save.name, paint: paintHex(save.paint), v: 2 });
    $('menuErr').textContent = 'Connected. Waiting for the room…';
  } catch (e) { $('menuErr').textContent = e.message; }
  $('btnJoin').disabled = false;
}
function hostStart() {
  const L = S.lobby, cs = L.players.filter(p => p.role === 'chor'), ps = L.players.filter(p => p.role === 'police');
  if (!cs.length) { $('lobbyErr').textContent = 'At least one player must be a chor.'; return; }
  $('lobbyErr').textContent = '';
  const off = Math.floor(Math.random() * 4), players = [];
  cs.forEach((p, k) => { const sp = spawnFor('chor', k + off); players.push({ id: p.id, name: p.name, role: 'chor', x: sp.x, y: sp.y, a: sp.a, paint: p.paint }); });
  ps.forEach((p, k) => { const sp = spawnFor('police', k); players.push({ id: p.id, name: p.name, role: 'police', x: sp.x, y: sp.y, a: sp.a }); });
  const cfg = matchSetup(cs.length, ps.length, 1);
  if (ps.length) cfg.copStart = ps.length; // computer jeeps park clear of the police players' spots
  cfg.rain = Math.random() < 0.3 ? 0.7 : 0;
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
  $('btnMute').onclick = () => { initAudio(); setMuted(!isMuted()); save.muted = isMuted(); storeSave(); refreshMenu(); };
  const cycleQ = () => { save.quality = save.quality === 'auto' ? 'high' : save.quality === 'high' ? 'low' : 'auto'; storeSave(); applyQuality(); refreshMenu(); };
  $('btnQuality').onclick = cycleQ; $('btnQuality2').onclick = cycleQ;
  const togMusic = () => { initAudio(); setMusicOn(!isMusicOn()); save.music = isMusicOn(); storeSave(); refreshMenu(); };
  $('btnMusic').onclick = togMusic; $('btnMusic2').onclick = togMusic;
  $('btnLights').onclick = () => toggleLights();
  $('btnAgain').onclick = () => { if (S.solo) startSolo(); else if (S.isHost) { clearDyn(); setScreen('lobby'); broadcastLobby(); } };
  $('btnEndMenu').onclick = () => toMenu('');
  $('mini').onclick = () => $('mini').classList.toggle('big');
  const hold = (id, key) => { const b = $(id); const on = e => { e.preventDefault(); In[key] = true; b.classList.add('down'); initAudio(); }; const off = () => { In[key] = false; b.classList.remove('down'); }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off); b.addEventListener('contextmenu', e => e.preventDefault()); };
  hold('btnAct', 'actTouch'); hold('btnNitro', 'nitroTouch'); hold('btnBrake', 'brakeTouch');

  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape') { if (S.screen === 'play') togglePause(); return; }
    if (S.screen !== 'play') return;
    if (e.code === 'KeyM') { $('mini').classList.toggle('big'); return; }
    if (e.code === 'KeyL' && !e.repeat) { toggleLights(); return; }
    if (e.code === 'KeyH' && !e.repeat) { sfx.horn(); return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    In.keys.add(e.code);
  });
  window.addEventListener('keyup', e => In.keys.delete(e.code));
  window.addEventListener('blur', () => { In.keys.clear(); In.actTouch = In.nitroTouch = In.brakeTouch = false; });
  const stick = $('stick'), knob = stick.firstElementChild;
  canvas.addEventListener('pointerdown', e => {
    if (S.screen !== 'play') return;
    initAudio();
    if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.5 && !In.stick) {
      In.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      stick.style.display = 'block'; stick.style.left = (e.clientX - 60) + 'px'; stick.style.top = (e.clientY - 60) + 'px'; knob.style.transform = '';
    } else if (!In.look) In.look = { id: e.pointerId, x: e.clientX };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', e => {
    if (In.stick && e.pointerId === In.stick.id) {
      let dx = e.clientX - In.stick.ox, dy = e.clientY - In.stick.oy; const l = Math.hypot(dx, dy), m = 52;
      if (l > m) { dx *= m / l; dy *= m / l; }
      In.mx = dx / m; In.my = -dy / m; knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (In.look && e.pointerId === In.look.id) { S.cam.look = clamp(S.cam.look + (e.clientX - In.look.x) * 0.006, -2.6, 2.6); In.look.x = e.clientX; S.cam.lookT = 1.2; }
  });
  const up = e => {
    if (In.stick && e.pointerId === In.stick.id) { In.stick = null; In.mx = In.my = 0; stick.style.display = 'none'; }
    if (In.look && e.pointerId === In.look.id) In.look = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.cam.dist = clamp(S.cam.dist + e.deltaY * 0.01, 5.5, 14); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('resize', resize);
}
function toggleLights() { const me = S.me; if (!me || S.screen !== 'play') return; me.lights = !me.lights; sfx.click(); }
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
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(U.uRes.value); post.setSize(w, h);
}

// ------------------------------------------------------------------ loops
let lastHost = performance.now(), lastFrame = performance.now(), miniTick = 0, fpsAvg = 60;
function hostLoop() {
  const now = performance.now();
  if (S.screen !== 'play' || !S.isHost || S.paused || S.over) { lastHost = now; return; }
  let rem = Math.min((now - lastHost) / 1000, 1.2); lastHost = now;
  // with the tab in the background no frames are drawn, so place the other players straight from their last report
  if (document.hidden) for (const P of S.players.values()) if (!P.isMe) { P.v.x = P.net.x; P.v.y = P.net.y; P.v.a = P.net.a; P.v.vf = P.net.vf; }
  while (rem > 1e-4 && !S.over) { const h = Math.min(0.025, rem); hostTick(h); rem -= h; }
  if (!S.solo && S.net && now - S.lastSnap >= 95 && !S.over) { S.lastSnap = now; S.net.broadcast(snapshot()); S.evOut = []; }
  else if (S.solo) S.evOut = [];
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - lastFrame) / 1000), time = now / 1000; lastFrame = now;
  fpsAvg += ((dt > 0 ? 1 / dt : 60) - fpsAvg) * 0.05;
  const playing = S.screen === 'play' || S.screen === 'over';
  if (playing) {
    if (S.isHost && !S.over) for (let i = 0; i < S.sites.length; i++) S.sites[i].st = siteState(i);
    // several small steps per frame, so a slow phone still drives at full speed without tunnelling through walls
    if (S.screen === 'play' && !S.paused) { const n = Math.max(1, Math.ceil(dt / 0.017)); for (let k = 0; k < n; k++) localUpdate(dt / n); }
    syncEntities(dt, time); updateWorldVisuals(time); updateHud(dt, time);
    if (++miniTick % 3 === 0) drawMini();
    // storms: a flash now and then, thunder a moment later
    if (S.cfg && S.cfg.rain > 0.6 && S.screen === 'play' && !S.paused) { S.lightningAt -= dt; if (S.lightningAt <= 0) { S.lightningAt = 9 + Math.random() * 16; fx.lightning(); setTimeout(() => sfx.thunder(), 500 + Math.random() * 900); } }
    rain(S.cfg ? S.cfg.rain || 0 : 0);
  } else { music(S.screen === 'menu' || S.screen === 'lobby' ? 0.12 : 0); rain(0); }
  updateCamera(dt, time); updateLights(dt, time); updateLabels();
  fx.update(dt, time, focusPt.set(S.cam.tgt.x, S.cam.tgt.z));
  dressing.update(dt, time);
  post.render(dt);
  // if a phone cannot keep up, quietly drop the expensive effects once
  if (save.quality === 'auto' && playing && !S.dropped) { S.lowFps = fpsAvg < 22 ? S.lowFps + dt : 0; if (S.lowFps > 4) { S.dropped = true; post.setEnabled(false); fx.setQuality('low'); pixelCap = 1; renderer.setPixelRatio(1); resize(); toast('Graphics lowered for smoother driving.'); } }
}
const focusPt = { x: 50, z: 50, set(x, z) { this.x = x; this.z = z; return this; } };

async function boot() {
  const map = await (await fetch('data/map.json')).json();
  try { await Promise.race([Promise.all([document.fonts.load('700 46px "Baloo 2"'), document.fonts.load('600 16px "Hind"')]), new Promise(r => setTimeout(r, 1800))]); } catch (e) { /* fall back to system fonts */ }
  W = buildWorld(map);
  // where a jeep parks to search each hideout: on the lane, a little past the mouth so the way out is not fully blocked
  for (const h of W.hides) {
    const f = h.front || h; let best = { x: f.x, y: f.y };
    if (h.bay) for (const s of [1, -1]) { const x = f.x - h.bay.ny * 1.1 * s, y = f.y + h.bay.nx * 1.1 * s; if (W.policeOk(x, y)) { best = { x, y }; break; } }
    h.search = best;
  }
  const high = highQ();
  H = buildScene(scene, map, W, U, { ground: high ? 2048 : 1024, aniso: Math.min(8, renderer.capabilities.getMaxAnisotropy()), wet: high, cones: true });
  fx = new Fx(scene, { quality: high ? 'high' : 'low' });
  dressing = buildDressing(scene, W, { hash2 });
  miniBase = document.createElement('canvas'); miniBase.width = miniBase.height = 400; paintMini(miniBase, map, W);
  setMuted(!!save.muted); setMusicOn(save.music !== false);
  if (!PAINTS.some(p => p.id === save.paint)) save.paint = PAINTS[0].id;
  bindUi(); applyQuality(); refreshMenu();
  $('loading').hidden = true; setScreen('menu');
  setInterval(hostLoop, 50); setInterval(heartbeatNet, 2000);
  window.addEventListener('pagehide', () => { if (S.net && !S.solo) { try { if (S.isHost) S.net.broadcast({ k: 'bye' }); else S.net.send({ k: 'bye' }); } catch (e) {} } });
  requestAnimationFrame(frame);
  window.__cp = { S, W, CFG, In, doAction, hostTick, startSolo, save, camera, renderer, post, drive, makeDriver, stepVehicle, fps: () => fpsAvg }; // handy for testing in the console
}
boot().catch(err => { console.error(err); $('loading').textContent = 'Could not start the game: ' + err.message; });
