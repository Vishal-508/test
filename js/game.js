// Chor Police: Jugnupur ki Raat. A night car chase: game rules, police AI, multiplayer sync, input, camera, HUD and the main loop.
import * as THREE from '../vendor/three.module.min.js';
import { CFG, matchSetup, rankFor, paintsUnlocked, applyRules, TOWNS, townName, LEVEL_NAMES, roomSetup, NIGHT_KINDS, composeRound, pickNight, pickTwist } from './config.js?v=7';
import { buildWorld, hash2, LANE, N as GRID, CS } from './world.js?v=7';
import { buildScene, paintMini, setSiteVisual, COLORS, LABELS, makeLabel } from './scene.js?v=7';
import { makeVehicle, stepVehicle, makeDriver, drive, CAR } from './vehicle.js?v=7';
import { makeCar, PAINTS } from './cars.js?v=7';
import { Fx } from './fx.js?v=7';
import { buildDressing } from './dressing.js?v=7';
import { buildAmbient } from './ambient.js?v=7';
import { makePost } from './postfx.js?v=7';
import { initAudio, setMuted, isMuted, setMusicOn, isMusicOn, engine, skid, siren, heartbeat, rain, music, sfx } from './audio.js?v=7';
import { HostNet, ClientNet, cleanCode } from './net.js?v=7';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r2 = v => Math.round(v * 100) / 100;
let CUR = '₹';   // the map file may name another currency sign
let MAP_ID = '';  // which town this page loaded ('' is Jugnupur); everyone in a room must be in the same one
const money = n => CUR + Math.round(n).toLocaleString('en-IN');
const TAU = Math.PI * 2;
const wrap = a => (Number.isFinite(a) ? a - TAU * Math.floor((a + Math.PI) / TAU) : 0);   // into -PI..PI without looping, whatever comes in
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const mmss = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const HIDE = CFG.HIDE, BUST = CFG.BUST;

// ------------------------------------------------------------------ saved progress
const SAVE_KEY = 'jugnupur.save.v2';
const save = (() => {
  const d = { name: '', night: 1, total: 0, wins: 0, muted: false, music: true, paint: '', quality: 'auto', cam: 'auto', town: '', medals: {}, seen: {} };
  try { const old = JSON.parse(localStorage.getItem('jugnupur.save.v1') || '{}'); if (old.name) d.name = old.name; } catch (e) { /* no older save */ }
  try { return Object.assign(d, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { return d; }
})();
const storeSave = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode: play without saving */ } };

// ------------------------------------------------------------------ renderer, lights, effects
const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && !matchMedia('(any-pointer: fine)').matches);
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
const camera = new THREE.PerspectiveCamera(52, 1, 1.6, 420);
const HEMI = 1.55, MOON = 1.05;
const hemi = new THREE.HemisphereLight(0x8d93ab, 0x4c4850, HEMI); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xc6ceff, MOON); moon.position.set(-30, 40, 45); scene.add(moon);
const headlamp = new THREE.SpotLight(0xfff1d0, 0, 13, 0.56, 0.85, 1.0); scene.add(headlamp); scene.add(headlamp.target);
const sirenRed = new THREE.PointLight(0xff2a2a, 0, 9, 1.4), sirenBlue = new THREE.PointLight(0x2a5cff, 0, 9, 1.4); scene.add(sirenRed); scene.add(sirenBlue);
const U = { uCut: { value: new THREE.Vector3(0.5, 0.5, -1) }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uPower: { value: 1 } };
const dyn = new THREE.Group(); scene.add(dyn);
const post = makePost(renderer, scene, camera);

const arrowShape = new THREE.Shape(); arrowShape.moveTo(0, 0.5); arrowShape.lineTo(0.28, -0.12); arrowShape.lineTo(0, 0.02); arrowShape.lineTo(-0.28, -0.12); arrowShape.closePath();
const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: COLORS.loot, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
arrow.rotation.order = 'YXZ'; arrow.rotation.x = Math.PI / 2; arrow.position.y = 0.07; arrow.renderOrder = 15; arrow.visible = false; scene.add(arrow);

let W = null, H = null, miniBase = null, fx = null, dressing = null, ambient = null;
let town = null;   // everything that belongs to the town now loaded hangs off this, so another town can take its place

// ------------------------------------------------------------------ state
const S = {
  screen: 'loading', net: null, isHost: true, solo: true, myId: 'h', paused: false,
  closedSites: new Set(), closedHides: new Set(), openEsc: null, hot: null, hotShown: -1, hotAt: 1e9, trackNext: 0, dark: false,
  lobby: { code: '', players: [], opts: { level: 3, town: '', surprises: true, autoLevel: true }, series: { rounds: 0, chor: 0, police: 0 } }, night: 1,
  players: new Map(), cops: [], sites: [], me: null, others: [],
  t: 0, banked: 0, target: 800, over: null, leverLock: 0, cfg: null, flags: {}, evOut: [], pings: [], searchLv: {}, searchFound: {}, openDoors: [],
  cam: { yaw: 0, dist: 7.6, pitch: 0.7, pull: 1, ahead: 0.7, ty: 0.3, orbit: 0, look: 0, lookT: 0, fov: 52, hide: 0, shake: 0, lastHide: null, pos: new THREE.Vector3(50, 19, 80), tgt: new THREE.Vector3(50, 0, 50) },
  hold: { key: '', t: 0 }, latch: false, ctx: null, danger: 0, lastSnap: 0, lastSend: 0, lightningAt: 0, lowFps: 0, exitMode: 0, stuckT: 0, resetT: 0, missT: 0,
};
const In = { keys: new Set(), mx: 0, my: 0, actTouch: false, nitroTouch: false, brakeTouch: false, stick: null, look: null, brakeHeld: false, revOk: false, restT: 0 };

// ------------------------------------------------------------------ small UI helpers
function show(id, on) { $(id).hidden = !on; }
function setScreen(name) {
  S.screen = name;
  show('menu', name === 'menu'); show('lobby', name === 'lobby'); show('end', name === 'over'); show('hud', name === 'play' || name === 'over'); show('pause', false);
  if (name !== 'play') { siren(0); skid(0); heartbeat(0); engine(0, 0, false); $('vignette').style.opacity = 0; $('hideui').classList.remove('on'); }
}
let toastTimer = 0;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3400); }
function feed(text, kind, ms) {
  const f = $('feed'), d = document.createElement('div'); d.textContent = text; if (kind) d.className = kind; f.appendChild(d);
  while (f.children.length > 2) f.removeChild(f.firstChild);   // never more than two lines up at once
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 3600);
}
let bannerTimer = 0;
function banner(text, kind) { const b = $('banner'); b.textContent = text; b.className = 'on ' + (kind || ''); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { b.className = ''; }, 1600); }
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
    id: p.id, name: p.name, role: p.role, v: makeVehicle(kind, p.x, p.y, p.a || 0), net: { x: p.x, y: p.y, a: p.a || 0, vf: 0, steer: 0, t: 0 },
    hidden: -1, hiding: -1, hideAt: 0, exitFrom: -1, exitAt: 0, exitMode: 0, engHot: 0, hidT: 0, blown: false, seenIn: false,
    jailed: false, jailLeft: 0, immune: 0, carry: [], arrests: 0, own: 0, bust: 0, heat: 0,
    lights: true, nitroOn: false, brake: false, drift: false, nitro: 1, nitroWait: 0, nitroAt: -99, crashT: 0,
    bankT: 0, leverT: 0, bankPct: 0, leverPct: 0, bankBlocked: false, robAt: -1, galiT: 0, campT: 0, searching: -1, searchT0: 0,
    tpSeq: 0, isMe, tipAt: 0, spotAt: -9, wheel: null, scr: null, wasHidden: -1,
    car: makeCar(kind, { paint: p.paint || PAINTS[0].hex }),
  };
  dyn.add(P.car.g);
  if (!isMe) { P.tag = makeLabel(p.name, { color: kind === 'chor' ? '#ffd98a' : '#9dbcff', h: 0.3 }); P.tag.position.y = 0.95; P.car.g.add(P.tag); }
  return P;
}
function newCop(k, x, y, a) {
  const c = { id: k, v: makeVehicle('police', x, y, a || 0), drv: makeDriver(), rx: x, ry: y, ra: a || 0, st: 'count', path: null, goal: null, goalPt: null, target: null, lastSeen: null, sawT: -9, sawIn: null, sweep: [], pre: null, wait: 0, repath: 0, searchT: 0, found: null, hint: null, sirenOn: false, campT: 0, car: makeCar('police', {}) };
  c.proxy = { x, y, a: a || 0, vx: 0, vy: 0, P: CAR.police };
  c.name = (S.copNames && S.copNames[k % S.copNames.length]) || 'a police jeep';
  dyn.add(c.car.g);
  return c;
}
function beginMatch(m) {
  clearDyn();
  applyRules(m.cfg.rules);   // tonight's numbers (a longer round, loot worth more...): the same for every player
  S.closedSites = new Set(Array.isArray(m.cfg.closedSites) ? m.cfg.closedSites : []);
  S.closedHides = new Set(Array.isArray(m.cfg.closedHides) ? m.cfg.closedHides : []);
  S.openEsc = Array.isArray(m.cfg.openEsc) && m.cfg.openEsc.length ? new Set(m.cfg.openEsc) : null;
  S.hot = null; S.hotAt = m.cfg.hot ? 28 + Math.random() * 14 : 1e9; S.trackNext = CFG.COUNT + (m.cfg.tracker || 0); S.hotShown = -1;
  S.cfg = m.cfg; S.target = m.cfg.target; S.t = 0; S.banked = 0; S.over = null; S.leverLock = 0; S.pings = []; S.evOut = []; S.flags = {}; S.searchLv = {}; S.searchFound = {}; S.openDoors = [];
  m.players.forEach(p => S.players.set(p.id, newPlayer(p)));
  S.me = S.players.get(S.myId);
  S.sites = W.sites.map((s, i) => ({ robbed: S.closedSites.has(i), val: CFG.VALUE[s.tier], lockUntil: s.tier === 3 ? CFG.JACKPOT_AT : 0, prog: 0, alarmAt: -99, sirened: false, st: (s.tier === 3 || s.coach) ? 1 : 0, pct: 0 }));
  S.copNames = shuffled((TOWNS.find(t => t.id === MAP_ID) || TOWNS[0]).officers);
  if (S.isHost) for (let k = 0; k < m.cfg.cops; k++) { const sp = W.policeSpawns[(k + (m.cfg.copStart || 0)) % W.policeSpawns.length]; S.cops.push(newCop(k, sp.x, sp.y, sp.a)); }
  const me = S.me;
  S.cam.yaw = Math.PI - me.v.a; S.cam.look = 0; S.cam.hide = 0; S.cam.shake = 0;
  S.cam.pos.set(me.v.x, 14, me.v.y + 10); S.cam.tgt.set(me.v.x, 0, me.v.y);
  S.hold = { key: '', t: 0 }; S.latch = true; S.paused = false; S.danger = 0; S.lastAlarm = null; S.lightningAt = 8 + Math.random() * 10; S.stuckT = 0; S.resetT = 0;
  $('feed').innerHTML = '';
  hudCache = {}; $('status').className = 'pill'; $('status').textContent = '';
  $('role').textContent = me.role === 'chor' ? 'CHOR' : 'POLICE'; $('role').className = 'pill ' + me.role;
  $('btnAct').textContent = me.role === 'chor' ? 'HIDE' : 'SEARCH';
  $('btnLights').textContent = me.role === 'chor' ? 'Lights' : 'Siren';
  $('wanted').style.display = me.role === 'chor' ? '' : 'none';
  $('infRow').style.display = m.cfg.informer ? '' : 'none';
  fx.setRain(m.cfg.rain || 0); nightLook(m.cfg);
  // name tags and markers for tonight: what each place is worth, which hand-off points are open, which hideouts are padlocked
  W.sites.forEach((d, i) => H.relabelSite(i, `${d.name}  ${money(CFG.VALUE[d.tier])}`, false));
  W.escapes.forEach((e, i) => { H.escVis[i].g.visible = escOpen(i); });
  W.hides.forEach((h, i) => { const lb = H.hideVis[i].label; lb.material.color.setHex(S.closedHides.has(i) ? 0x9a6a6a : 0xffffff); });
  setScreen('play');
  lastHost = performance.now();
  if (m.cfg.name) banner(m.cfg.name, 'gold');
  // one line about what is unusual tonight (the rest is in the pause menu); how-to hints only the first time someone plays a side
  const once = key => { if (!save.seen || typeof save.seen !== 'object') save.seen = {}; if (save.seen[key]) return false; save.seen[key] = 1; storeSave(); return true; };
  if (m.cfg.twist) feed(m.cfg.twist.name + ': ' + m.cfg.twist.blurb, 'gold', 7000);
  else if (m.cfg.night && m.cfg.night.name !== NIGHT_KINDS[0].name) feed(m.cfg.night.blurb, 'gold', 6000);
  else if (me.role === 'chor' && once('chor')) feed('Stop on a gold ring to rob it. Roll through a green beam to bank.', 'gold', 8000);
  else if (me.role === 'police' && once('police')) feed('Stay beside a slow getaway car to bust it. Hold SEARCH at a hideout door.', '', 8000);
  if (isTouch && innerHeight > innerWidth && once('sideways')) toast('Turn your phone sideways for a wider view of the road.');
  try { if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) { /* screen may dim; harmless */ }
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
const carryValue = P => P.carry.reduce((s, i) => s + (S.sites[i] ? S.sites[i].val : CFG.VALUE[W.sites[i].tier]), 0);
const escOpen = i => !S.openEsc || S.openEsc.has(i);            // tonight's hand-off points
const openEscapes = () => W.escapes.filter(e => escOpen(e.i));
const isHot = i => !!S.hot && S.hot.i === i;                     // the place paying double right now
const worth = i => CFG.VALUE[W.sites[i].tier] * (isHot(i) ? 2 : 1);
const chors = () => [...S.players.values()].filter(p => p.role === 'chor');
const soloChor = () => chors().length <= 1;
const loose = P => !P.jailed && P.hidden < 0;
const hideOf = i => (i >= 0 && i < W.hides.length) ? W.hides[i] : null;
// where the police can see a car: its own spot, or the lane outside the door while it is being let in
const spot = P => (P.hiding >= 0 && hideOf(P.hiding)) ? hideOf(P.hiding).front : P.v;

// ------------------------------------------------------------------ host: rules
function ev(e) { S.evOut.push(e); handleEvent(e); }
function teleport(P, x, y, a) {
  const v = P.v; v.x = x; v.y = y; v.a = a; v.vx = v.vy = v.vf = 0; P.net.x = x; P.net.y = y; P.net.a = a; P.net.vf = 0; P.tpSeq++;
  if (P.isMe) P.scr = null;
  else if (S.net && !S.solo) S.net.send(P.id, { k: 'tp', x, y, a, q: P.tpSeq });
}
function addHeat(P, n) { P.heat = clamp(P.heat + n, 0, CFG.HEAT_MAX); }
function dispatch(to, n, hint) { // send the n nearest free jeeps to a place
  const idle = S.cops.filter(c => c.st !== 'chase' && c.st !== 'count').sort((a, b) => dist(a.v, to) - dist(b.v, to)).slice(0, n);
  for (const c of idle) { c.st = 'respond'; c.goal = { x: to.x, y: to.y }; c.hint = hint ? { x: to.x, y: to.y } : null; c.path = null; }
}
function alarm(i, loud, n) {
  const d = W.sites[i]; S.sites[i].alarmAt = S.t;
  dispatch(d, n, true);
  ev({ t: loud ? 'alarm' : 'ping', m: loud ? 'SIREN at ' + d.full + '!' : 'Alarm bell at ' + d.full, x: d.x, y: d.y });
}
function arrest(ch, by, who) {   // by: the police player who made the bust; who: the name of the officer when a computer jeep did
  if (ch.jailed || ch.immune > 0) return;
  for (const i of ch.carry) { S.sites[i].robbed = false; S.sites[i].val = CFG.VALUE[W.sites[i].tier]; S.sites[i].lockUntil = S.t + CFG.RELOCK; S.sites[i].prog = 0; S.sites[i].sirened = false; }
  const lost = carryValue(ch);
  ch.carry = []; ch.hidden = -1; ch.hiding = -1; ch.exitFrom = -1; ch.bust = 0; ch.heat = 1; ch.jailed = true; ch.arrests++; ch.bankT = 0; ch.leverT = 0;
  ch.jailLeft = soloChor() ? CFG.JAIL_SOLO : CFG.JAIL_MULTI;
  const jailed = chors().filter(p => p.jailed).length, slot = W.cageSlots[(jailed - 1) % W.cageSlots.length];
  teleport(ch, slot.x, slot.y, 0);
  S.leverLock = S.t + CFG.LEVER_LOCK;
  for (const c of S.cops) if (c.target === ch.id) { c.st = 'patrol'; c.target = null; c.path = null; c.wait = 1.5; }
  if (by && by.role === 'police') by.arrests++;
  ev({ t: 'arrest', m: ch.name + ' was busted by ' + (by ? by.name : who || 'a police jeep') + (lost ? '. ' + money(lost) + ' goes back.' : '.'), who: ch.id });
  if (soloChor()) { if (ch.arrests >= CFG.MAX_ARRESTS_SOLO) endRound('police', 'Busted ' + CFG.MAX_ARRESTS_SOLO + ' times.'); }
  else if (chors().every(p => p.jailed)) endRound('police', 'Every getaway car is in the impound.');
}
function release(P, how) {
  if (!P.jailed) return;
  P.jailed = false; P.jailLeft = 0; P.immune = CFG.IMMUNE; P.bust = 0;
  const rp = W.releasePoints[(S.flags.rel = (S.flags.rel || 0) + 1) % W.releasePoints.length];
  teleport(P, rp.x, rp.y, rp.a);
  ev({ t: 'fuel', to: P.id, n: 0.5, min: true });
  if (how === 'bail') ev({ t: 'free', m: P.name + ' is back on the road.', who: [P.id] });
}
function endRound(w, why) {
  if (S.over) return;
  let lv = 0, nx = 0;
  if (!S.solo && S.isHost) { // a room keeps score from round to round, and the level climbs when the chors win
    const L = S.lobby; L.series.rounds++; L.series[w === 'chor' ? 'chor' : 'police']++;
    lv = L.opts.level; if (L.opts.autoLevel && w === 'chor') L.opts.level = Math.min(10, L.opts.level + 1); nx = L.opts.level;
  }
  S.over = { w, why, lv, nx, sr: (!S.solo && S.isHost) ? S.lobby.series : null, t: Math.round(S.t), b: S.banked, tg: S.target, pl: [...S.players.values()].map(p => ({ id: p.id, n: p.name, r: p.role, own: p.own, ar: p.arrests })) };
  if (S.net && !S.solo) S.net.broadcast(snapshot(false));
  finishMatch(S.over);
}
function doAction(P, type, i) {
  if (!P || S.over || S.screen !== 'play' || P.jailed) return;
  i = i | 0;
  const slack = P.isMe ? 0.3 : 1.4, v = P.v; // remote players are judged on slightly older positions
  if (P.role === 'chor') {
    if (type === 'hide') { // asking to be let into a hideout from the lane outside its door
      const h = hideOf(i); if (!h || S.closedHides.has(i) || P.hidden >= 0 || P.hiding >= 0 || dist(v, h.front) > HIDE.RANGE + slack || Math.abs(v.vf) > HIDE.SPEED + 0.8) return;
      if ([...S.players.values()].some(o => o !== P && (o.hidden === i || o.hiding === i))) return;
      P.hiding = i; P.hideAt = S.t + (h.grove ? HIDE.IN_GROVE : HIDE.IN); P.seenIn = false; P.bankT = 0;
      for (const c of S.cops) if (c.sawIn && c.sawIn.id === P.id) c.sawIn = null;   // earlier sightings are forgotten; a jeep watching this entry notes it again
    } else if (type === 'unhide') { // i: 0 slip out quietly, 1 burst out
      if (P.hidden < 0) return;
      const h = hideOf(P.hidden);
      P.exitFrom = P.hidden; P.exitAt = S.t + HIDE.OUT; P.exitMode = i ? 1 : 0; P.hidden = -1; P.immune = Math.max(P.immune, HIDE.OUT);
      if (i && h) for (const c of S.cops) if ((c.st === 'patrol' || c.st === 'search') && dist(c.v, h.front) < 8) { c.st = 'respond'; c.goal = { x: h.front.x, y: h.front.y }; c.path = null; }   // a roaring exit is heard
    }
  } else if (type === 'searching') { // a police player starts (or with -1 stops) searching a door
    if (i >= 0 && hideOf(i) && dist(v, hideOf(i).search) < CFG.LEVER_RANGE + 1 + slack) { if (P.searching !== i) { P.searching = i; P.searchT0 = S.t; } } else P.searching = -1;
  }
}
function removePlayer(id) {
  const P = S.players.get(id); if (!P) return;
  for (const i of P.carry) { S.sites[i].robbed = false; S.sites[i].val = CFG.VALUE[W.sites[i].tier]; S.sites[i].prog = 0; }
  dropEntity(P); S.players.delete(id);
  ev({ t: 'left', m: P.name + ' left the game.', who: id });
  if (S.isHost && !S.over && S.screen === 'play') {
    const all = chors();
    if (!all.length) endRound('police', 'No getaway cars left in town.');
    else if (all.length > 1 && all.every(p => p.jailed)) endRound('police', 'Every getaway car is in the impound.');
    else if (P.role === 'police') { // a police player left: computer jeeps take over so the chors still have someone to dodge
      const humans = [...S.players.values()].filter(p => p.role === 'police').length, want = roomSetup(all.length, humans, (S.cfg && S.cfg.level) || 3).cops;
      while (S.cops.length < want) { const sp = W.policeSpawns[S.cops.length % W.policeSpawns.length]; const c = newCop(S.cops.length, sp.x, sp.y, sp.a); c.st = 'patrol'; S.cops.push(c); }
    }
  }
}

// ------------------------------------------------------------------ host: police jeeps driven by the computer
function copGo(c, x, y) { c.path = W.findPath(c.v.x, c.v.y, x, y) || null; c.drv.seg = 0; c.goalPt = { x, y }; }
let hostOthers = [];
const copEnv = { solid: null, others: null, speedMul: 1, gripMul: 1 };
function copDrive(c, want, dt) { // returns true on arrival
  if (!c.path || c.path.length < 2) { copStop(c, dt); return true; }
  const inp = drive(c.v, c.path, c.drv, want, dt), arrived = inp.arrived;
  if (inp.wedged && c.goalPt) { const g = c.goalPt; c.path = W.findPath(c.v.x, c.v.y, g.x, g.y) || c.path; c.drv.seg = 0; }
  copEnv.solid = W.solidPolice; copEnv.others = hostOthers; copEnv.speedMul = S.cfg.carMul || 1; copEnv.gripMul = S.cfg.gripMul || 1;
  stepVehicle(c.v, inp, dt, copEnv);
  return arrived;
}
const STOP = { throttle: -1, steer: 0 }, COAST = { throttle: 0, steer: 0 };
function copStop(c, dt) { copEnv.solid = W.solidPolice; copEnv.others = hostOthers; stepVehicle(c.v, c.v.vf > 0.15 ? STOP : COAST, dt, copEnv); if (Math.abs(c.v.vf) < 0.15) { c.v.vx *= 0.5; c.v.vy *= 0.5; } }
function copSees(c, ch) {
  if (ch.hidden >= 0 || ch.jailed) return false;
  const p = spot(ch), d = dist(c.v, p), chasing = c.st === 'chase' && c.target === ch.id;
  const dark = !ch.lights && Math.abs(ch.v.vf) < CFG.DARK_SPEED;   // lights off only hides a car that is creeping
  const range = (dark ? CFG.VISION_DARK : CFG.VISION) * S.cfg.visionMul * (W.inPark(p.x, p.y) ? CFG.VISION_PARK : 1) + (chasing ? 4 : 0);
  if (d > range) return false;
  if (d > CFG.NEAR && !chasing) {
    const dot = (Math.sin(c.v.a) * (p.x - c.v.x) + Math.cos(c.v.a) * (p.y - c.v.y)) / d;
    if (dot < Math.cos(CFG.FOV)) return false;
  }
  return W.los(c.v.x, c.v.y, p.x, p.y);
}
function doorsNear(p, n) { // the hideout doors a jeep would check, nearest first
  return W.hides.filter(h => !S.closedHides.has(h.i)).map(h => ({ i: h.i, d: dist(h.front, p) })).filter(o => o.d < HIDE.DOORS).sort((a, b) => a.d - b.d).slice(0, n).map(o => o.i);
}
function pickPatrol(c) {
  if (c.hint) { // after an alarm: go and look at the way out a chor would most likely run for
    const h = c.hint; c.hint = null;
    if (Math.random() < 0.7) return openEscapes().reduce((b, e) => (!b || dist(e, h) < dist(b, h)) ? e : b, null);
  }
  const cand = [];
  W.sites.forEach((s, i) => { if (!S.sites[i].robbed) cand.push({ x: s.x, y: s.y, w: [0, 1, 2, 4][s.tier] }); });
  openEscapes().forEach(e => cand.push({ x: e.x, y: e.y, w: 2 }));
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
function startSweep(c, around, first, stars) {
  c.st = 'search'; c.sweepT = 0; c.sweep = doorsNear(around, stars >= 3 ? 3 : 2); c.pre = first ? { x: around.x, y: around.y } : null; c.path = null; c.searchT = 0; c.found = null; c.target = null;
}
function copTick(c, dt) {
  const v = c.v;
  if (S.t < CFG.COUNT) { c.st = 'count'; c.sirenOn = false; return; }
  if (c.st === 'count') { c.st = 'patrol'; c.wait = 0.5 * c.id; }
  const sp = S.cfg.speedMul * (S.cfg.carMul || 1);
  let seen = null, sd = 1e9;
  for (const ch of chors()) {
    if (!copSees(c, ch)) continue;
    const d = dist(v, spot(ch));
    if (ch.hiding >= 0) { ch.seenIn = true; c.sawIn = { id: ch.id, i: ch.hiding }; }   // watched them being let in: that door is blown
    if (d < sd) { sd = d; seen = ch; }
  }
  if (seen) {
    if (c.st !== 'chase' || c.target !== seen.id) { ev({ t: 'spot', to: seen.id }); c.repath = 0; if (S.t - seen.spotAt > 6) { addHeat(seen, 0.5); seen.spotAt = S.t; } }
    if (c.st === 'search' && c.sweep.length) delete S.searchLv[c.sweep[0]];
    c.st = 'chase'; c.target = seen.id; const p = spot(seen); c.lastSeen = { x: p.x, y: p.y, t: S.t }; c.sawT = S.t;
  } else if (c.st === 'patrol') { // a screaming engine nearby gives you away
    for (const ch of chors()) if (ch.nitroOn && loose(ch) && dist(v, ch.v) < CFG.NOISE_RANGE) { c.st = 'respond'; c.goal = { x: ch.v.x, y: ch.v.y }; c.path = null; break; }
  }
  c.sirenOn = c.st === 'chase' || c.st === 'respond';
  if (c.st === 'chase') {
    const tg = S.players.get(c.target);
    if (!tg || tg.jailed) { c.st = 'patrol'; c.target = null; c.path = null; c.wait = 1; copStop(c, dt); return; }
    if (tg.hidden >= 0) { // they vanished behind a door: the one who watched goes straight to it, the rest check the doors nearby
      if (c.sawIn && c.sawIn.id === tg.id && c.sawIn.i === tg.hidden) { c.st = 'search'; c.sweepT = 0; c.sweep = [tg.hidden]; c.pre = null; c.path = null; c.searchT = 0; c.found = null; c.target = null; }
      else startSweep(c, c.lastSeen, true, tg.heat);
      copStop(c, dt); return;
    }
    if (!seen && S.t - c.lastSeen.t > 2.6) { startSweep(c, c.lastSeen, true, tg.heat); copStop(c, dt); return; }
    const p = spot(tg), d = dist(v, p), fresh = seen || S.t - c.lastSeen.t < 0.8;
    c.repath -= dt;
    // the second jeep on the same car does not follow in file: it heads for where the car is going
    const tail = S.cops.find(o => o !== c && o.st === 'chase' && o.target === tg.id && o.id < c.id);
    if (fresh && d < 4.5 && W.los(v.x, v.y, p.x, p.y)) { // close and in view: go straight for where they will be
      const lead = clamp(d / 3.5, 0, 0.6);
      c.path = [{ x: v.x, y: v.y }, { x: p.x + tg.v.vx * lead, y: p.y + tg.v.vy * lead }]; c.drv.seg = 0; c.goalPt = null; c.repath = 0;
    } else if (c.repath <= 0) {
      c.repath = 0.45;
      if (tail && fresh && d > 5 && Math.abs(tg.v.vf) > 1.5) { const ah = clamp(d * 0.9, 5, 12), q = W.nearestWalk(clamp(p.x + Math.sin(tg.v.a) * ah, 1, 99), clamp(p.y + Math.cos(tg.v.a) * ah, 1, 99), true); copGo(c, q.x, q.y); }
      else copGo(c, fresh ? p.x : c.lastSeen.x, fresh ? p.y : c.lastSeen.y);
    }
    copDrive(c, CFG.COP_CHASE * sp * (1 + 0.012 * tg.heat), dt);
  } else if (c.st === 'respond') {
    if (!c.path) { copGo(c, c.goal.x, c.goal.y); c.respT = 0; }
    c.respT = (c.respT || 0) + dt;
    if (copDrive(c, CFG.COP_RESPOND * sp, dt) || c.respT > 80) startSweep(c, c.goal, false, 0);
  } else if (c.st === 'search') {
    if (c.pre) { if (!c.path) copGo(c, c.pre.x, c.pre.y); if (copDrive(c, CFG.COP_RESPOND * sp, dt)) { c.pre = null; c.path = null; } return; }
    if (!c.sweep.length) { c.st = 'patrol'; c.path = null; c.wait = 0.5; copStop(c, dt); return; }
    const h = W.hides[c.sweep[0]];
    c.sweepT = (c.sweepT || 0) + dt;
    if (!h || (c.sweepT > 18 + (c.sweepLen || 0) && c.searchT === 0)) { c.sweep.shift(); c.path = null; c.sweepT = 0; return; }   // no such door, or it cannot be reached: move on
    if (!c.path) { copGo(c, h.search.x, h.search.y); c.sweepLen = c.path ? c.path.reduce((t, q, k) => k ? t + dist(q, c.path[k - 1]) : 0, 0) : 0; }
    const there = copDrive(c, CFG.COP_RESPOND * 0.8 * sp, dt) || dist(v, h.search) < 1.0;
    if (there && Math.abs(v.vf) < 0.6) { // parked outside: the officer walks up, shines a torch through the gaps, puts a hand on the bonnet
      const was = c.searchT; c.searchT += dt; S.searchLv[h.i] = clamp(c.searchT / HIDE.SEARCH, 0.05, 1);
      const occ = chors().find(p => p.hidden === h.i && !p.jailed);
      if (was < HIDE.TOUCH && c.searchT >= HIDE.TOUCH && occ && (occ.blown || occ.engHot > 0 || (c.sawIn && c.sawIn.id === occ.id && c.sawIn.i === h.i))) c.found = occ.id;
      if (c.found) S.searchFound[h.i] = 1;
      if (c.searchT >= HIDE.SEARCH) {
        if (occ && c.found === occ.id) { occ.immune = 0; arrest(occ, null, c.name); }
        else if (occ) { ev({ t: 'safe', to: occ.id }); addHeat(occ, -1); }
        c.searchT = 0; c.found = null; c.sweep.shift(); c.path = null; c.sweepT = 0; delete S.searchLv[h.i]; delete S.searchFound[h.i];
      }
    } else if (c.searchT > 0) { c.searchT = 0; c.found = null; delete S.searchLv[h.i]; delete S.searchFound[h.i]; }
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
  if (!F.go && S.t >= CFG.COUNT) { F.go = 1; ev({ t: 'go', m: 'The police are rolling. Drive!', b: (S.cfg.night || S.cfg.twist) ? 1 : 0 }); }
  if (!F.jack && S.t >= CFG.JACKPOT_AT) { F.jack = 1; ev({ t: 'chime', m: 'The clock tower chimes. The three tijoris are open!' }); }
  if (!F.co && S.t >= CFG.COACH_OPEN) { F.co = 1; if (W.sites.some(s => s.coach)) ev({ t: 'chime', m: W.sites.find(q => q.coach).full + ' is open for 45 seconds!' }); }
  if (!F.cc && S.t >= CFG.COACH_CLOSE) { F.cc = 1; const ci = W.sites.findIndex(s => s.coach); if (ci >= 0 && !S.sites[ci].robbed) ev({ t: 'info', m: W.sites[ci].full + ' is shut again.' }); }
  if (!F.min && S.t >= CFG.ROUND - 45) { F.min = 1; ev({ t: 'info', m: '45 seconds left!' }); }
  const all = [...S.players.values()], pol = all.filter(P => P.role === 'police'), started = S.t >= CFG.COUNT;
  // now and then one small place pays double for a short while: everybody is told, chors and police alike
  if (S.cfg.hot) {
    if (S.hot && (S.t >= S.hot.until || S.sites[S.hot.i].robbed)) { S.hot = null; S.hotAt = S.t + 28 + Math.random() * 22; }
    if (!S.hot && S.t >= S.hotAt && S.t < CFG.ROUND - 32) {
      const pool = []; W.sites.forEach((d, i) => { if (!S.sites[i].robbed && !d.coach && d.tier < 3 && S.t >= S.sites[i].lockUntil) pool.push(i); });
      if (pool.length) { const i = pool[Math.floor(Math.random() * pool.length)], d = W.sites[i]; S.hot = { i, until: S.t + 26 }; ev({ t: 'hot', i, m: 'Hot tip: ' + d.full + ' pays double for the next 25 seconds!', x: d.x, y: d.y }); }
      else S.hotAt = S.t + 12;
    }
  }
  // a night when the police radio keeps giving the getaway cars away
  if (S.cfg.tracker && S.t >= S.trackNext) {
    S.trackNext = S.t + S.cfg.tracker;
    const pts = all.filter(P => P.role === 'chor' && loose(P)).map(P => [r2(P.v.x), r2(P.v.y)]);
    if (pts.length) { ev({ t: 'track', pts }); for (const q of pts) dispatch({ x: q[0], y: q[1] }, 1, false); }
  }
  hostOthers = [];
  for (const P of all) {
    if (P.immune > 0) P.immune -= dt;
    if (P.crashT > 0) P.crashT -= dt;
    if (!P.isMe && performance.now() - P.net.t > 700) { P.net.vf = 0; P.v.vf = 0; P.nitroOn = false; }   // no word from them (tab hidden, bad link): they are not moving
    if (P.nitroOn) P.nitroAt = S.t;
    if (P.jailed) { P.jailLeft -= dt; if (P.jailLeft <= 0) release(P, 'bail'); }
    // hideouts: the door shuts behind a car that was let in; a parked engine cools; sit too long and an informer talks
    if (P.hiding >= 0 && S.t >= P.hideAt) { P.hidden = P.hiding; P.hiding = -1; P.engHot = S.t - P.nitroAt < 5 ? HIDE.COOL_NITRO / HIDE.COOL : 1; P.hidT = 0; P.blown = P.seenIn; P.bust = 0; }
    if (P.exitFrom >= 0 && S.t >= P.exitAt + 0.3) P.exitFrom = -1;
    if (P.hidden >= 0) {
      P.engHot = Math.max(0, P.engHot - dt / HIDE.COOL); P.hidT += dt;
      if (S.cfg.informer && !P.blown && P.hidT >= HIDE.INFORMER) {
        P.blown = true; const h = hideOf(P.hidden);
        const c = S.cops.filter(q => q.st !== 'chase' && q.st !== 'count').sort((a, b) => dist(a.v, h.front) - dist(b.v, h.front))[0];
        if (c) { c.st = 'search'; c.sweepT = 0; c.sweep = [h.i]; c.pre = null; c.path = null; c.searchT = 0; c.found = null; }
        ev({ t: 'informer', m: 'Informer: a getaway car is hiding in ' + h.name + '.', x: h.front.x, y: h.front.y, who: P.id });
      }
    }
    if (loose(P) && P.hiding < 0) hostOthers.push(P.v);
  }
  for (const c of S.cops) hostOthers.push(c.v);
  // open doors: while a car is being let in, and while one rolls out
  S.openDoors = [];
  for (const P of all) { if (P.hiding >= 0 && S.t < P.hideAt - 0.35) S.openDoors.push(P.hiding); if (P.exitFrom >= 0) S.openDoors.push(P.exitFrom); }

  // stop-to-rob: a getaway car stopped inside a gold ring works on the job; two cars are faster
  for (let i = 0; i < W.sites.length; i++) {
    const s = S.sites[i], d = W.sites[i]; s.st = siteState(i);
    if (s.st !== 0) { s.prog = 0; s.sirened = false; continue; }
    const hs = all.filter(P => P.role === 'chor' && loose(P) && P.hiding < 0 && dist(P.v, d) < CFG.ROB_RANGE + (P.isMe ? 0 : 0.4) && Math.abs(P.v.vf) < CFG.ROB_SPEED + (P.isMe ? 0 : 0.3) && canCarry(P, i));
    for (const P of hs) P.robAt = i;
    if (hs.length) {
      if (d.tier === 2 && s.prog === 0 && S.t - s.alarmAt > 5) alarm(i, false, 1);
      s.prog += dt * Math.pow(hs.length, 0.9);
      if (d.tier === 3 && !s.sirened && s.prog >= CFG.HOLD[3] * CFG.SIREN_AT) { s.sirened = true; hs.forEach(P => addHeat(P, 1)); alarm(i, true, 2 + Math.ceil(hs[0].heat)); }
      if (s.prog >= CFG.HOLD[d.tier]) {
        s.val = worth(i); s.robbed = true; s.prog = 0; s.st = 2; hs[0].carry.push(i); hs.forEach(P => addHeat(P, [0, 0.5, 1, 1][d.tier]));
        ev({ t: 'grab', m: hs[0].name + ' robbed ' + d.full + ' (' + money(s.val) + (isHot(i) ? ', double!' : '') + ').', who: hs[0].id });
        if (isHot(i)) { S.hot = null; S.hotAt = S.t + 28 + Math.random() * 22; }
        if (d.tier !== 3) alarm(i, false, 1);
      }
    } else if (s.prog > 0) { s.prog = Math.max(0, s.prog - dt * 2.5); if (s.prog === 0) s.sirened = false; }
  }
  // police who park on a hand-off stop counting as guarding it after a few seconds
  const policeCars = [];
  for (const c of S.cops) if (c.st !== 'count') policeCars.push(c);
  if (started) for (const p of pol) policeCars.push(p);
  for (const pc of policeCars) { const near = openEscapes().some(e => dist(pc.v, e) < 3); pc.campT = near && Math.abs(pc.v.vf) < 0.3 ? (pc.campT || 0) + dt : 0; }

  for (const ch of all) {
    if (ch.role !== 'chor') continue;
    const v = ch.v, sp = Math.abs(v.vf), free = loose(ch) && ch.hiding < 0, inGali = W.laneAt(v.x, v.y) === LANE.GALI;
    const chased = S.cops.some(c => c.st === 'chase' && c.target === ch.id);
    // roll-to-bank: slow down inside a green beam with no police on top of you
    ch.bankBlocked = false; let banking = false;
    if (free && ch.carry.length) for (const e of W.escapes) {
      if (!escOpen(e.i) || dist(v, e) > CFG.BANK_RANGE || sp > CFG.BANK_SPEED + (ch.isMe ? 0 : 0.3)) continue;
      if (policeCars.some(pc => (pc.campT || 0) < CFG.CAMP && dist(pc.v, v) < CFG.BANK_CLEAR && W.los(pc.v.x, pc.v.y, v.x, v.y))) { ch.bankBlocked = true; break; }
      banking = true; ch.bankT += dt;
      if (ch.bankT >= CFG.BANK_HOLD) {
        const val = carryValue(ch), jack = ch.carry.some(isJackpot);
        ch.carry = []; ch.own += val; S.banked += val; ch.bankT = 0; ch.immune = Math.max(ch.immune, CFG.BANK_IMMUNE); ch.bust = 0; addHeat(ch, -1);
        ev({ t: 'bank', m: ch.name + ' handed over ' + money(val) + ' at ' + e.name + '.', j: jack ? 1 : 0, x: e.x, y: e.y, who: ch.id });
        ev({ t: 'fuel', to: ch.id, n: CFG.NITRO.BANK });
        if (S.banked >= S.target) { endRound('chor', 'Target banked with ' + mmss(Math.max(0, CFG.ROUND - S.t)) + ' to spare.'); return; }
      }
      break;
    }
    if (!banking) ch.bankT = 0;
    // impound levers: stop beside one to let your friends out
    let lev = false;
    if (free && S.t >= S.leverLock && sp < 0.6 && all.some(p => p.jailed && p !== ch)) for (const l of W.levers) {
      if (dist(v, l) > CFG.LEVER_RANGE) continue;
      lev = true; ch.leverT += dt;
      if (ch.leverT >= CFG.LEVER_HOLD) {
        const inside = chors().filter(p => p.jailed); inside.forEach(p => release(p, 'lever')); ch.leverT = 0;
        ev({ t: 'free', m: ch.name + ' pulled the lever. ' + inside.map(p => p.name).join(', ') + ' ' + (inside.length > 1 ? 'are' : 'is') + ' out!', who: inside.map(p => p.id), x: l.x, y: l.y });
      }
      break;
    }
    if (!lev) ch.leverT = 0;
    // heat cools when nobody has eyes on you (not while skulking in a tang gali); witnesses report a loaded car in lit streets
    if (!chased && !(inGali && free)) ch.heat = Math.max(0, ch.heat - dt * (ch.hidden >= 0 ? 0.12 : 0.04));
    ch.galiT = free && inGali && sp < 0.3 ? ch.galiT + dt : 0;
    if (ch.galiT > 6) { ch.galiT = 0; dispatch(v, 1, false); ev({ t: 'tip', m: 'Tip-off: a car is sitting in ' + nearName(v) + '.', x: v.x, y: v.y, who: ch.id }); }
    if (!ch.carry.length) ch.tipAt = S.t;
    else if (free && !W.inPark(v.x, v.y) && !chased) {
      const every = Math.max(5, (ch.carry.some(isJackpot) ? CFG.TIP_EVERY_JACKPOT : CFG.TIP_EVERY) * (S.cfg.tipMul || 1) - ch.heat * 1.2);
      if (S.t - ch.tipAt >= every) { ch.tipAt = S.t; dispatch(v, 1 + Math.floor(ch.heat / 2), true); ev({ t: 'tip', m: 'Tip-off: a loaded getaway car was seen near ' + nearName(v) + '.', x: v.x, y: v.y, who: ch.id }); }
    } else ch.tipAt += dt;   // nobody can call in a car that is behind a door, in the park or already being chased
    // the bust meter: a police vehicle staying close to a slow car fills it
    if (!loose(ch) || ch.immune > 0) { ch.bust = 0; continue; }
    const p = spot(ch), spd = ch.hiding >= 0 ? 1.0 : sp;
    let n = 0, by = null, who = '', far = false;
    for (const pc of policeCars) {
      const d = dist(pc.v, p);
      if (d < BUST.RANGE && W.los(pc.v.x, pc.v.y, p.x, p.y)) { n++; if (pc.role === 'police') by = by || pc; else who = who || pc.name; }
      else if (inGali && d < BUST.GALI_RANGE && spd < BUST.VSTOP && W.los(pc.v.x, pc.v.y, p.x, p.y)) far = true;
    }
    const slow = clamp((BUST.VSAFE - spd) / (BUST.VSAFE - BUST.VSTOP), 0, 1);
    let rate = n ? BUST.RATE * (S.cfg.bustMul || 1) * slow * (1 + BUST.EXTRA * (n - 1)) * (ch.crashT > 0 ? 0.5 : 1) : far ? BUST.GALI : 0;
    if (rate > 0) { ch.bust = Math.min(1, ch.bust + rate * dt); if (ch.bust >= 1) { arrest(ch, by, who); if (S.over) return; } }
    else ch.bust = Math.max(0, ch.bust - BUST.DRAIN * dt);
  }
  S.searchLv = {}; S.searchFound = {};   // rebuilt every tick by whoever is searching right now
  for (const c of S.cops) copTick(c, dt);
  // a police player searching a door: hot or blown cars are found at 3 seconds, cold ones only if they keep at it
  for (const p of pol) {
    if (p.searching < 0) continue;
    const h = hideOf(p.searching);
    if (!h || dist(p.v, h.search) > CFG.LEVER_RANGE + 2 || Math.abs(p.v.vf) > 1.2) { delete S.searchLv[p.searching]; delete S.searchFound[p.searching]; p.searching = -1; continue; }
    const t = S.t - p.searchT0, occ = chors().find(q => q.hidden === h.i && !q.jailed), hot = occ && (occ.blown || occ.engHot > 0);
    S.searchLv[h.i] = clamp(t / HIDE.COLD_FIND, 0.05, 1);
    if (occ && ((hot && t >= HIDE.TOUCH) || t >= HIDE.SEARCH)) S.searchFound[h.i] = 1;
    if (occ && ((hot && t >= HIDE.SEARCH) || t >= HIDE.COLD_FIND)) { occ.immune = 0; arrest(occ, p); delete S.searchLv[h.i]; delete S.searchFound[h.i]; p.searching = -1; if (S.over) return; }
    else if (t >= HIDE.COLD_FIND) { if (p.isMe) feed('Nobody in there.'); else if (S.net) S.net.send(p.id, { k: 'note', m: 'Nobody in there.' }); delete S.searchLv[h.i]; delete S.searchFound[h.i]; p.searching = -1; }
  }
  // the clock: if a loose chor is carrying enough to win, play on until that loot is banked or lost
  if (S.t >= CFG.ROUND) {
    const hope = chors().some(p => !p.jailed && p.carry.length && S.banked + carryValue(p) >= S.target);
    if (hope && S.t < CFG.ROUND + CFG.OVERTIME) { if (!F.ot) { F.ot = 1; ev({ t: 'chime', m: 'AAKHRI DAUD! Bank it before they get you.' }); } }
    else endRound('police', 'Time ran out with ' + money(S.banked) + ' of ' + money(S.target) + ' banked.');
  }
}
function nearName(p) { return W.sites.reduce((b, s) => (!b || dist(s, p) < dist(b, p)) ? s : b, null).full; }

// ------------------------------------------------------------------ network: snapshots
const ST_CODE = { patrol: 0, respond: 1, chase: 2, search: 3, count: 4 }, ST_NAME = ['patrol', 'respond', 'chase', 'search', 'count'];
function snapshot(forPolice) {
  const m = {
    k: 's', t: r2(S.t), b: S.banked, ll: r2(Math.max(0, S.leverLock - S.t)),
    s: S.sites.map((s, i) => [s.st, Math.round(100 * s.prog / CFG.HOLD[W.sites[i].tier]), s.val]),
    h: S.hot ? [S.hot.i, Math.max(0, Math.ceil(S.hot.until - S.t))] : 0,
    p: [...S.players.values()].map(P => {
      const blank = forPolice && P.role === 'chor' && P.hidden >= 0;   // police clients are never told where a hidden car is
      return [P.id, blank ? 0 : r2(P.v.x), blank ? 0 : r2(P.v.y), r2(P.v.a),
        (P.jailed ? 1 : 0) | (P.immune > 0 ? 2 : 0) | (P.nitroOn ? 4 : 0) | (P.lights ? 8 : 0) | (P.brake ? 16 : 0) | (P.drift ? 32 : 0) | (P.bankBlocked ? 64 : 0) | (P.blown ? 128 : 0),
        blank ? 999 : P.hidden, P.carry, Math.ceil(P.jailLeft), P.arrests, P.own, r2(P.v.vf), r2(P.v.steer), Math.round(P.bust * 100), Math.round(P.heat * 10),
        P.hiding, Math.round(P.engHot * 100), Math.round(P.hidT), Math.round(100 * P.bankT / CFG.BANK_HOLD), Math.round(100 * P.leverT / CFG.LEVER_HOLD), P.exitFrom, Math.round(performance.now() - (P.net.t || performance.now()))];
    }),
    c: S.cops.map(c => [r2(c.v.x), r2(c.v.y), r2(c.v.a), ST_CODE[c.st], c.target || '', r2(c.v.vf), r2(c.v.steer)]),
    sr: Object.keys(S.searchLv).map(k => [+k, r2(S.searchLv[k]), S.searchFound[k] ? 1 : 0]),
    od: S.openDoors, e: S.evOut,
  };
  if (S.over) m.o = S.over;
  return m;
}
function applySnapshot(m) {
  if (S.screen !== 'play') return;
  const now = performance.now();
  S.t = m.t; S.banked = m.b; S.leverLock = m.t + m.ll;
  m.s.forEach((v, i) => { if (S.sites[i]) { S.sites[i].st = v[0]; S.sites[i].pct = v[1]; S.sites[i].robbed = v[0] === 2; if (v[2] > 0) S.sites[i].val = v[2]; } });
  S.hot = Array.isArray(m.h) && W.sites[m.h[0]] ? { i: m.h[0] | 0, until: m.t + (+m.h[1] || 0) } : null;
  for (const v of m.p) {
    const P = S.players.get(v[0]); if (!P) continue;
    if (!P.isMe) { const n = P.net; n.x = v[1]; n.y = v[2]; n.a = v[3]; n.vf = v[10]; n.steer = v[11]; n.t = now - Math.min(250, v[20] || 0); P.nitroOn = !!(v[4] & 4); P.lights = !!(v[4] & 8); P.brake = !!(v[4] & 16); P.drift = !!(v[4] & 32); }
    P.jailed = !!(v[4] & 1); P.immune = (v[4] & 2) ? 1 : 0; P.bankBlocked = !!(v[4] & 64); P.blown = !!(v[4] & 128);
    P.hidden = v[5]; P.carry = v[6]; P.jailLeft = v[7]; P.arrests = v[8]; P.own = v[9]; P.bust = v[12] / 100; P.heat = v[13] / 10;
    P.hiding = v[14]; P.engHot = v[15] / 100; P.hidT = v[16]; P.bankPct = v[17]; P.leverPct = v[18]; P.exitFrom = v[19];
  }
  while (S.cops.length < m.c.length) { const q = m.c[S.cops.length]; S.cops.push(newCop(S.cops.length, q[0], q[1], q[2])); }
  m.c.forEach((q, k) => { const c = S.cops[k], v = c.v; v.x = q[0]; v.y = q[1]; v.a = q[2]; c.st = ST_NAME[q[3]]; c.target = q[4] || null; v.vf = q[5]; v.steer = q[6]; c.sirenOn = c.st === 'chase' || c.st === 'respond'; c.netT = now; });
  S.searchLv = {}; S.searchFound = {}; for (const q of (m.sr || [])) { S.searchLv[q[0]] = q[1]; if (q[2]) S.searchFound[q[0]] = 1; }
  S.openDoors = m.od || [];
  for (const e of m.e) handleEvent(e);
  if (m.o && !S.over) { S.over = m.o; finishMatch(m.o); }
}
function handleEvent(e) {
  const me = S.me; if (!me) return;
  if (e.to && e.to !== me.id) return;
  const mine = e.who === me.id || (Array.isArray(e.who) && e.who.includes(me.id)), mark = () => { S.lastAlarm = { x: e.x, y: e.y, t: performance.now() }; };
  switch (e.t) {
    case 'alarm': ping(e.x, e.y, 9, '#ff4a4a'); sfx.alarm(); mark(); if (me.role === 'police') { feed(e.m, 'alarm'); sfx.radio(); } break;
    case 'ping': ping(e.x, e.y, 5, '#ff8a4a'); if (me.role === 'police') { feed(e.m, 'alarm'); mark(); sfx.radio(); } sfx.bell(); break;
    case 'grab': if (mine) sfx.grab(); else feed(e.m, 'gold'); break;   // my own grab shows in the boot
    case 'tip': if (me.role === 'police') { ping(e.x, e.y, 6, '#ff8a4a'); feed(e.m, 'alarm'); mark(); sfx.radio(); } else if (mine) { feed('Tip-off! The police know where you are.', 'alarm'); sfx.bell(); } break;
    case 'informer': if (me.role === 'police') { ping(e.x, e.y, 8, '#c9a0ff'); feed(e.m, 'alarm'); mark(); sfx.radio(); } else if (mine) { banner('INFORMER!', 'red'); sfx.spotted(); } break;
    case 'bank': if (!mine) feed(e.m, 'good'); if (e.j) { sfx.jackpot(); if (me.role === 'police') { ping(e.x, e.y, 10, '#ff4a4a'); mark(); } } else sfx.coin(); break;   // my own shows on the loot bar
    case 'fuel': me.nitro = e.min ? Math.max(me.nitro, e.n) : Math.min(1, me.nitro + e.n); break;
    case 'arrest': sfx.caught(); if (mine) { banner('BUSTED!', 'red'); S.cam.shake = 0.5; } else feed(e.m, 'alarm'); break;
    case 'free': sfx.free(); if (mine) banner('AZAAD!', 'green'); else feed(e.m, 'good'); break;
    case 'safe': banner('BACH GAYE!', 'green'); sfx.free(); me.nitro = Math.min(1, me.nitro + CFG.NITRO.NEAR_MISS * 2); nitroFlash(); break;
    case 'chime': feed(e.m, 'gold', 4500); sfx.chime(); break;
    case 'hot': ping(e.x, e.y, 12, '#ffe27a'); feed(e.m, 'gold', 4500); sfx.chime(); if (me.role === 'police') mark(); break;
    case 'track':
      if (me.role === 'police') { for (const q of (e.pts || [])) ping(+q[0] || 0, +q[1] || 0, 6, '#ff4a4a'); feed('Radio: getaway cars located.', 'alarm'); sfx.radio(); }
      else if (loose(me)) { feed('The police radio gave your position away!', 'alarm'); sfx.bell(); }
      break;
    case 'go': if (me.role === 'chor') sfx.radio(); break;        // the line under the clock has been counting down
    case 'spot': sfx.spotted(); break;                              // the HUNTED tag, the red edges and the siren say it
    case 'left': { feed(e.m); const P = S.players.get(e.who); if (P && !S.isHost) { dropEntity(P); S.players.delete(e.who); } break; }
    default: if (e.m) feed(e.m);
  }
}

// ------------------------------------------------------------------ local player: driving
let nitroFlashT = 0;
function nitroFlash() { const el = $('nitro'); el.classList.add('gain'); clearTimeout(nitroFlashT); nitroFlashT = setTimeout(() => el.classList.remove('gain'), 600); }
function request(type, i) { if (S.isHost) doAction(S.me, type, i); else if (S.net) S.net.send({ k: 'a', t: type, i }); }
// What the place I am at is doing for me right now. Robbing, banking and levers need no button: you stop, they happen.
function findContext(me) {
  const v = me.v, sp = Math.abs(v.vf);
  if (me.jailed) return { type: 'none', label: 'Impounded. ' + (soloChor() ? 'Out in ' : 'A friend can stop at a lever. Out in ') + Math.max(0, Math.ceil(me.jailLeft)) + 's' };
  if (me.scr) return null;
  const out = [];
  if (me.role === 'chor') {
    if (me.hidden >= 0) return null;
    if (me.carry.length) for (const e of W.escapes) {
      const d = dist(v, e); if (!escOpen(e.i) || d > CFG.BANK_RANGE) continue;
      const frac = S.isHost ? me.bankT / CFG.BANK_HOLD : me.bankPct / 100;
      out.push({ s: -1, type: 'auto', brake: true, frac: sp > CFG.BANK_SPEED || me.bankBlocked ? 0 : frac, label: me.bankBlocked ? 'Police too close to hand over!' : sp > CFG.BANK_SPEED ? 'Slow down to hand over ' + money(carryValue(me)) : 'Handing over ' + money(carryValue(me)) + '…' });
    }
    W.sites.forEach((s, i) => {
      const d = dist(v, s); if (d > CFG.ROB_RANGE) return;
      const st = S.sites[i].st;
      if (st === 2) return;
      if (st === 1) { if (sp < 1.2) out.push({ s: d / CFG.ROB_RANGE + 0.2, type: 'none', label: s.coach ? (S.t < CFG.COACH_OPEN ? 'Strongbox opens at ' + mmss(CFG.ROUND - CFG.COACH_OPEN) + ' on the clock' : 'Strongbox is shut') : (S.t < CFG.JACKPOT_AT ? 'Locked until the clock tower chimes' : 'Locked again for a moment') }); }
      else if (!canCarry(me, i)) { if (sp < 1.2) out.push({ s: d / CFG.ROB_RANGE + 0.2, type: 'none', label: 'The boot is full. Hand it over first.' }); }
      else out.push({ s: d / CFG.ROB_RANGE - 0.4, type: 'auto', brake: true, frac: S.isHost ? S.sites[i].prog / CFG.HOLD[s.tier] : S.sites[i].pct / 100, label: sp > CFG.ROB_SPEED ? 'Stop here to rob ' + s.full + (isHot(i) ? ' · DOUBLE' : '') : 'Robbing ' + s.full + '  ' + money(worth(i)) + (s.tier === 3 && !(S.sites[i].prog >= CFG.HOLD[3] * CFG.SIREN_AT || S.sites[i].pct >= CFG.SIREN_AT * 100) ? '  (siren soon)' : '') });
    });
    if (chors().some(p => p.jailed && p !== me)) for (const l of W.levers) {
      const d = dist(v, l); if (d > CFG.LEVER_RANGE) continue;
      if (S.t < S.leverLock) out.push({ s: d / CFG.LEVER_RANGE, type: 'none', label: 'Lever locked for ' + Math.ceil(S.leverLock - S.t) + 's' });
      else out.push({ s: d / CFG.LEVER_RANGE - 0.3, type: 'auto', brake: true, frac: S.isHost ? me.leverT / CFG.LEVER_HOLD : me.leverPct / 100, label: sp > 0.6 ? 'Stop here to open the impound' : 'Opening the impound…' });
    }
    if (me.hiding < 0) for (const h of W.hides) {
      const d = dist(v, h.front); if (d > HIDE.RANGE) continue;
      if (sp > HIDE.SPEED) continue;   // driving past a door at speed: say nothing (the violet arrows on the road mark it)
      if (S.closedHides.has(h.i)) out.push({ s: d / HIDE.RANGE + 0.4, type: 'none', label: h.name + ' is padlocked tonight' });
      else if ([...S.players.values()].some(o => o !== me && (o.hidden === h.i || o.hiding === h.i))) out.push({ s: d / HIDE.RANGE + 0.3, type: 'none', label: 'Someone is already in ' + h.name });
      else out.push({ s: d / HIDE.RANGE + 0.05, type: 'hide', i: h.i, key: 'hide' + h.i, hold: 0.12, act: true, label: (isTouch ? 'HIDE: ' : 'Press E: hide in ') + h.name });
    }
  } else {
    if (S.t < CFG.COUNT) return { type: 'none', label: 'Engines on… ' + Math.ceil(CFG.COUNT - S.t) };
    for (const h of W.hides) {
      const d = dist(v, h.search); if (d > CFG.LEVER_RANGE + 0.6) continue;
      if (sp > 2) continue;            // a jeep driving past says nothing
      if (sp > 1) out.push({ s: d, type: 'none', label: 'Stop to search ' + h.name });
      else out.push({ s: d, type: 'search', i: h.i, key: 'search' + h.i, act: true, frac: S.searchLv[h.i] || 0, label: (S.searchLv[h.i] || 0) > 0 ? 'Searching ' + h.name + '…' : 'Hold to search ' + h.name });
    }
  }
  out.sort((a, b) => a.s - b.s);
  return out[0] || null;
}
// Scripted moves in and out of a hideout: the game drives, nothing can be hit, the police can still see you until the door shuts.
function startScript(me, type, h, mode) {
  const v = me.v, ox = Math.sin(h.a), oy = Math.cos(h.a);
  if (type === 'in') me.scr = { type, h, t: 0, T: Math.max(0.5, (S.isHost ? me.hideAt - S.t : (h.grove ? HIDE.IN_GROVE : HIDE.IN) - 0.1)), x0: v.x, y0: v.y, a0: v.a, x1: h.mouth.x + ox * 0.9, y1: h.mouth.y + oy * 0.9 };
  else {
    // roll out to the middle of the lane and turn along it: the way you are steering, else away from the nearest police
    const kk = In.keys;
    let side = (kk.has('KeyD') || kk.has('ArrowRight') ? 1 : 0) - (kk.has('KeyA') || kk.has('ArrowLeft') ? 1 : 0);
    if (!side) { let best = null, bd = 30; for (const c of S.cops) { const d = Math.hypot(c.rx - h.front.x, c.ry - h.front.y); if (d < bd) { bd = d; best = { x: c.rx, y: c.ry }; } } for (const P of S.players.values()) if (P.role === 'police') { const d = dist(P.v, h.front); if (d < bd) { bd = d; best = P.v; } }
      const lx = oy, ly = -ox; side = best ? (((best.x - h.front.x) * lx + (best.y - h.front.y) * ly) > 0 ? -1 : 1) : 1; side = -side; }
    // side > 0 means a right turn as seen from the driver's seat leaving the door
    const run = sd => { for (let d = 0.5; d <= 2.5; d += 0.5) if (!W.walkable(h.front.x - oy * sd * d, h.front.y + ox * sd * d)) return false; return true; };
    if (!run(side) && run(-side)) side = -side;   // the lane is shut that way
    const rx = -oy * side, ry = ox * side;
    me.scr = { type, h, t: 0, T: HIDE.OUT, x0: h.x, y0: h.y, cx: h.front.x, cy: h.front.y, x1: h.front.x + rx * 0.9, y1: h.front.y + ry * 0.9, a1: Math.atan2(rx, ry), speed: mode ? HIDE.BURST : HIDE.SLIP };
  }
  v.vx = v.vy = v.vf = 0; me.wheel = null;
}
function runScript(me, dt) {
  const s = me.scr, v = me.v, h = s.h; s.t += dt;
  const f = clamp(s.t / s.T, 0, 1);
  if (s.type === 'in') {
    const k = 0.5;
    if (f < k) { const e = smooth(f / k); v.x = s.x0 + (s.x1 - s.x0) * e; v.y = s.y0 + (s.y1 - s.y0) * e; v.a = lerpAngle(s.a0, h.a, e); v.vf = 0.8; }
    else { const e = smooth((f - k) / (1 - k)); v.x = s.x1 + (h.x - s.x1) * e; v.y = s.y1 + (h.y - s.y1) * e; v.a = h.a; v.vf = -0.9; }
    if (f >= 1) { v.x = h.x; v.y = h.y; v.a = h.a; v.vf = 0; if (me.hidden >= 0 || s.t > s.T + 1.5) me.scr = null; }
    if (me.hiding < 0 && me.hidden < 0 && s.t > 0.6) me.scr = null;   // the host said no (or we were busted on the doorstep)
  } else {
    const e = smooth(f), u = 1 - e;   // quadratic curve: out of the door, then round into the lane
    v.x = u * u * s.x0 + 2 * u * e * s.cx + e * e * s.x1; v.y = u * u * s.y0 + 2 * u * e * s.cy + e * e * s.y1;
    const tx = 2 * u * (s.cx - s.x0) + 2 * e * (s.x1 - s.cx), ty = 2 * u * (s.cy - s.y0) + 2 * e * (s.y1 - s.cy);
    v.a = Math.atan2(tx, ty); v.vf = s.speed * (0.4 + 0.6 * e);
    if (f >= 1) { v.vx = Math.sin(v.a) * s.speed; v.vy = Math.cos(v.a) * s.speed; v.vf = s.speed; me.scr = null; S.cam.yaw = Math.PI - v.a; }
  }
}
const inp = { throttle: 0, steer: 0, handbrake: false, nitro: false };
function readInput(me, dt, assist) {
  const k = In.keys, v = me.v;
  let th = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let st = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  if (In.stick) { // one thumb: holding it down drives, sideways steers, pulling back brakes
    const sx = In.mx, sy = In.my;
    st += Math.sign(sx) * Math.pow(Math.abs(sx), 1.25);
    th += sy > -0.25 ? 0.6 + 0.4 * clamp(sy / 0.6, 0, 1) : sy < -0.45 ? -1 : 0;
  }
  th = clamp(th, -1, 1);
  // reverse only engages on a fresh press of the brake at a standstill, so braking to a stop never rolls you backwards out of a job
  if (th < 0) {
    if (!In.brakeHeld) { In.brakeHeld = true; In.revOk = v.vf < 0.3; In.restT = 0; }
    if (Math.abs(v.vf) < 0.1) In.restT += dt;
    if (!In.revOk && In.restT < 0.4 && v.vf <= 0.08) th = 0;
  } else In.brakeHeld = false;
  // when you lift off inside a ring or a beam the car brakes itself to a stop
  if (assist && th === 0 && v.vf > 0.12) th = -0.7;
  inp.throttle = th; inp.steer = clamp(st, -1, 1);
  inp.handbrake = k.has('Space') || In.brakeTouch; inp.nitro = k.has('ShiftLeft') || k.has('ShiftRight') || In.nitroTouch;
  return inp;
}
const myEnv = { solid: null, others: null, speedMul: 1, gripMul: 1 };
function drivePhysics(me, dt) {
  const v = me.v;
  me.nitroOn = false;
  if (me.scr) { runScript(me, dt); me.brake = false; me.drift = false; return; }
  if (me.jailed || me.hidden >= 0) { v.vx = v.vy = v.vf = 0; me.brake = false; me.drift = false; if (me.hidden >= 0 && hideOf(me.hidden)) { const h = hideOf(me.hidden); v.x = h.x; v.y = h.y; v.a = h.a; } return; }
  if (me.role === 'police' && S.t < CFG.COUNT) { v.vx = v.vy = v.vf = 0; return; }
  const i = readInput(me, dt, S.ctx && S.ctx.brake);
  const N = CFG.NITRO, wantNitro = i.nitro && i.throttle > 0.1 && (me.nitroWas ? me.nitro > 0 : me.nitro >= N.MIN);
  if (wantNitro) { if (!me.nitroWas) sfx.nitro(); me.nitro = Math.max(0, me.nitro - N.DRAIN * dt); me.nitroWait = N.DELAY; }
  else { me.nitroWait -= dt; if (me.nitroWait <= 0) me.nitro = Math.min(1, me.nitro + N.REGEN * dt); }
  me.nitroOn = wantNitro; me.nitroWas = wantNitro; inp.nitro = wantNitro;
  let mul = 1;
  for (const c of me.carry) mul -= isJackpot(c) ? CFG.CARRY_SLOW_JACKPOT : CFG.CARRY_SLOW;
  myEnv.solid = me.role === 'chor' ? W.solidChor : W.solidPolice; myEnv.others = S.others; myEnv.speedMul = mul * (S.cfg.carMul || 1); myEnv.gripMul = S.cfg.gripMul || 1;
  stepVehicle(v, inp, dt, myEnv);
  if (v.boost > 0) { me.nitro = Math.min(1, me.nitro + v.boost); S.boostMsg = v.boost >= 0.2 ? 'DRIFT! +nitro' : ''; }
  const fxs = Math.sin(v.a), fys = Math.cos(v.a);
  if (v.crash) { sfx.crash(clamp(v.hit / 3.5, 0.3, 1)); S.cam.shake = Math.max(S.cam.shake, 0.4); me.nitro = Math.max(0, me.nitro - 0.15); me.crashFlag = 0.8; fx.sparks(v.x + fxs * 0.4, 0.15, v.y + fys * 0.4, -fxs, -fys, 1); }
  else if (v.hit > 0.9) { sfx.crash(clamp(v.hit / 5, 0.1, 0.5)); S.cam.shake = Math.max(S.cam.shake, 0.1); fx.sparks(v.x + fxs * 0.4, 0.15, v.y + fys * 0.4, -fxs, -fys, 0.35); }
  if (me.crashFlag > 0) me.crashFlag -= dt;
  const slipping = v.slip > 0.8 || (i.handbrake && Math.abs(v.vf) > 1.2);
  me.brake = (i.throttle < 0 && v.vf > 0.2) || i.handbrake; me.drift = slipping;
  if (slipping) {
    const ax = v.x - fxs * 0.27, ay = v.y - fys * 0.27, lx = ax + fys * 0.15, ly = ay - fxs * 0.15, rx = ax - fys * 0.15, ry = ay + fxs * 0.15;
    if (me.wheel) { fx.skid(me.wheel[0], me.wheel[1], lx, ly, 0.07, 0.6); fx.skid(me.wheel[2], me.wheel[3], rx, ry, 0.07, 0.6); }
    me.wheel = [lx, ly, rx, ry];
    S.smokeT = (S.smokeT || 0) - dt; if (S.smokeT <= 0) { S.smokeT = 0.045; fx.smoke(ax, 0.1, ay, clamp(v.slip / 2.2, 0.3, 1)); }
  } else me.wheel = null;
  if (wantNitro) { S.flameT = (S.flameT || 0) - dt; if (S.flameT <= 0) { S.flameT = 0.06; fx.smoke(v.x - fxs * 0.5, 0.12, v.y - fys * 0.5, 0.35); } }
  // jammed against something with the pedal down: put the car back on the road by itself after a while
  S.stuckT = (Math.abs(v.vf) < 0.15 && Math.abs(i.throttle) > 0.5) ? S.stuckT + dt : 0;
  if (S.stuckT > 4) resetCar(me);
}
function resetCar(me) {
  const q = W.safeSpot(me.v.x, me.v.y, me.role !== 'chor'), v = me.v;
  v.x = q.x; v.y = q.y; v.a = q.a; v.vx = v.vy = v.vf = 0; v.stall = 0.5; S.stuckT = 0; S.resetT = 0; S.cam.yaw = Math.PI - v.a;
}
// once per frame: scripts starting and ending, the action button, close shaves, telling the host where I am
function localFrame(dt) {
  const me = S.me; if (!me) return;
  const v = me.v, k = In.keys;
  const actHeld = k.has('KeyE') || k.has('KeyF') || k.has('Enter') || In.actTouch;
  if (!actHeld) S.latch = false;
  // the host let me in, or let me out: the game takes the wheel for a moment
  if (me.hiding >= 0 && !me.scr && me.hidden < 0 && hideOf(me.hiding)) { startScript(me, 'in', hideOf(me.hiding)); sfx.unshutter(); }
  if (me.wasHidden >= 0 && me.hidden < 0 && !me.jailed && !me.scr && hideOf(me.wasHidden)) { startScript(me, 'out', hideOf(me.wasHidden), S.exitMode); sfx.unshutter(); if (S.exitMode) sfx.nitro(); }
  me.wasHidden = me.hidden >= 0 && me.hidden < 900 ? me.hidden : -1;
  if (me.jailed) me.scr = null;
  // leaving a hideout from the keyboard: E slips out, holding W bursts out
  const fwd = k.has('KeyW') || k.has('ArrowUp');
  if (me.scr && actHeld) S.latch = true;                 // a key still down from the way in does not count
  if (me.hidden < 0 || me.scr) S.burstArm = false;
  else {
    if (!fwd) S.burstArm = true;
    if (actHeld && !S.latch) { leaveHide(0); S.latch = true; }
    S.burstT = fwd && S.burstArm ? (S.burstT || 0) + dt : 0;
    if (S.burstT > 0.25) { leaveHide(1); S.burstT = 0; }
  }
  if (k.has('KeyR') && loose(me) && !me.scr) { S.resetT += dt; if (S.resetT > 1) resetCar(me); } else S.resetT = 0;
  const ctx = S.over ? null : findContext(me); S.ctx = ctx;
  const can = actHeld && !S.latch && ctx && ctx.act;
  if (ctx && ctx.type === 'search') { // police: hold to keep searching
    if (can) { if (S.searchSent !== ctx.i) { request('searching', ctx.i); S.searchSent = ctx.i; sfx.click(); } }
    else if (S.searchSent >= 0) { request('searching', -1); S.searchSent = -1; }
  } else {
    if (S.searchSent >= 0) { request('searching', -1); S.searchSent = -1; }
    if (can && ctx.type === 'hide') { request('hide', ctx.i); S.latch = true; sfx.click(); }
  }
  if (ctx && ctx.type === 'auto' && ctx.frac > 0 && ctx.frac < 1) { S.tickSfx = (S.tickSfx || 0) - dt; if (S.tickSfx <= 0) { sfx.tick(); S.tickSfx = 0.33; } }
  // baal-baal: a jeep flashing past your door at speed pays a little nitro
  if (me.role === 'chor' && loose(me) && !me.scr) {
    S.missT -= dt; let close = false;
    for (const o of S.others) if (o.P === CAR.police) { const d = Math.hypot(o.x - v.x, o.y - v.y), rel = Math.hypot((o.vx || 0) - v.vx, (o.vy || 0) - v.vy); if (d < 1.15 && rel > 2.6 && Math.abs(v.vf) > 2.3) close = true; }
    if (close && !v.bump) S.missArm = 0.5; else if (S.missArm > 0) { S.missArm -= dt; if (S.missArm <= 0 && S.missT <= 0 && me.bust < 0.5) { S.missT = 4; me.nitro = Math.min(1, me.nitro + CFG.NITRO.NEAR_MISS); nitroFlash(); } }
    if (v.bump) S.missArm = 0;
  }
  if (S.boostMsg) { nitroFlash(); S.boostMsg = ''; }
  // clients tell the host where they are
  if (!S.isHost && S.net) {
    const now = performance.now();
    if (now - S.lastSend > 50) { S.lastSend = now; S.net.send({ k: 'p', x: r2(v.x), y: r2(v.y), a: r2(v.a), v: r2(v.vf), s: r2(v.steer), f: (me.nitroOn ? 1 : 0) | (me.lights ? 2 : 0) | (me.brake ? 4 : 0) | (me.drift ? 8 : 0) | (me.crashFlag > 0 ? 16 : 0), q: me.tpSeq }); }
  } else if (me.crashFlag > 0) me.crashT = me.crashFlag;
}
function leaveHide(mode) { const me = S.me; if (!me || me.hidden < 0 || me.scr) return; S.exitMode = mode; request('unhide', mode); }

// ------------------------------------------------------------------ drawing: cars, lights, camera, HUD
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), v3c = new THREE.Vector3(), v3d = new THREE.Vector3();
const carState = { speed: 0, steer: 0, brake: false, lights: true, siren: false, nitro: false, hidden: false, alpha: 1 };
function syncEntities(dt, time) {
  const me = S.me, now = performance.now(); S.others.length = 0;
  for (const P of S.players.values()) {
    const v = P.v;
    if (!P.isMe) { // show remote cars where they are now: their last report pushed forward by its age, then eased toward
      const n = P.net, age = clamp((now - (n.t || now)) / 1000, 0, 0.25), px = n.x + Math.sin(n.a) * n.vf * age, py = n.y + Math.cos(n.a) * n.vf * age;
      const far = Math.hypot(px - v.x, py - v.y) > 5, k = far ? 1 : Math.min(1, dt * 14);
      v.x += (px - v.x) * k; v.y += (py - v.y) * k; v.a = lerpAngle(v.a, n.a, k); v.vf = n.vf; v.steer = n.steer;
      v.vx = Math.sin(v.a) * v.vf; v.vy = Math.cos(v.a) * v.vf;
      if (loose(P) && P.hiding < 0 && P.exitFrom < 0) S.others.push(v);
    }
    let vis = true, alpha = 1;
    if (P.hidden >= 0) vis = P.isMe;
    else if (!P.isMe && P.role === 'chor' && me && me.role === 'police' && !P.jailed) { const p = spot(P); vis = dist(me.v, p) < 16 && W.los(me.v.x, me.v.y, p.x, p.y); }
    if (vis && P.immune > 0 && Math.sin(time * 22) > 0) alpha = 0.45;
    P.seen = vis; P.car.g.visible = vis;
    P.car.g.position.set(v.x, 0, v.y); P.car.g.rotation.y = v.a;
    carState.speed = (P.jailed || P.hidden >= 0) ? 0 : v.vf; carState.steer = v.steer; carState.brake = P.brake; carState.lights = P.lights && !P.jailed; carState.siren = P.role === 'police' && P.lights && S.t >= CFG.COUNT; carState.nitro = P.nitroOn; carState.hidden = P.hidden >= 0; carState.alpha = alpha;
    P.car.update(carState, dt, time);
    if (!P.isMe && vis && P.drift && Math.abs(v.vf) > 1) { P.smokeT = (P.smokeT || 0) - dt; if (P.smokeT <= 0) { P.smokeT = 0.07; fx.smoke(v.x - Math.sin(v.a) * 0.27, 0.1, v.y - Math.cos(v.a) * 0.27, 0.5); } }
  }
  for (const c of S.cops) {
    const v = c.v, k = Math.min(1, dt * 14);
    let tx = v.x, ty = v.y;
    if (!S.isHost && c.netT) { const age = clamp((now - c.netT) / 1000, 0, 0.2); tx += Math.sin(v.a) * v.vf * age; ty += Math.cos(v.a) * v.vf * age; }
    c.rx += (tx - c.rx) * k; c.ry += (ty - c.ry) * k; c.ra = lerpAngle(c.ra, v.a, k);
    c.car.g.position.set(c.rx, 0, c.ry); c.car.g.rotation.y = c.ra;
    carState.speed = v.vf; carState.steer = v.steer; carState.brake = c.st === 'search' && Math.abs(v.vf) < 0.4; carState.lights = true; carState.siren = !!c.sirenOn; carState.nitro = false; carState.hidden = false; carState.alpha = 1;
    c.car.update(carState, dt, time);
    c.proxy.x = c.rx; c.proxy.y = c.ry; c.proxy.a = c.ra; c.proxy.vx = Math.sin(v.a) * v.vf; c.proxy.vy = Math.cos(v.a) * v.vf;
    S.others.push(c.proxy);
  }
  // hideout doors: shut unless a car is going in or out; search torches at the gaps
  for (let i = 0; i < W.hides.length; i++) {
    const hv = H.hideVis[i], want = S.openDoors.indexOf(i) >= 0 ? 0 : 1;
    if (hv.closed !== want) { const was = hv.closed; hv.closed = clamp(hv.closed + Math.sign(want - hv.closed) * dt / 0.3, 0, 1); hv.ho.setClosed(hv.closed); if (want === 1 && was < 0.5 && hv.closed >= 0.5 && me && dist(me.v, W.hides[i]) < 14) sfx.shutter(); }
    const lv = S.searchLv[i] || 0;
    if (hv.search !== lv) { hv.search = lv; hv.ho.setSearch(lv); }
    // a hideout far off in the haze is not drawn at all (each one is several objects, and from street level dozens are in view)
    const near = Math.hypot(camera.position.x - W.hides[i].x, camera.position.z - W.hides[i].y) < Math.min(36, scene.fog.far * 0.6);
    if (hv.ho.g.visible !== near) hv.ho.g.visible = near;
    if (near) hv.ho.update(dt, time);
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
  for (const c of S.cops) if (c.sirenOn || c.st === 'search') { const d = Math.hypot(c.rx - from.x, c.ry - from.y); if (d < bd) { bd = d; best = { x: c.rx, y: c.ry }; } }
  for (const P of S.players.values()) if (P.role === 'police' && !P.isMe && P.lights && S.t >= CFG.COUNT) { const d = dist(P.v, from); if (d < bd) { bd = d; best = P.v; } }
  if (!best && me && me.role === 'police' && me.lights && S.screen === 'play' && S.t >= CFG.COUNT) best = me.v;
  if (best) {
    const ph = Math.floor(time * 6) % 2;
    sirenRed.position.set(best.x, 0.8, best.y); sirenBlue.position.set(best.x, 0.8, best.y);
    sirenRed.intensity = ph ? 16 : 0; sirenBlue.intensity = ph ? 0 : 16;
  } else { sirenRed.intensity = 0; sirenBlue.intensity = 0; }
  hemi.intensity = HEMI * LIGHT_MUL + fx.flash * 3.2; moon.intensity = MOON * LIGHT_MUL + fx.flash * 2.6;
  if (post.enabled) post.uniforms.uFlash.value = fx.flash * 0.16;
}
// Two ways to follow the car: 'high' looks down over the rooftops, 'street' sits low behind the boot.
const CAMS = {
  high: { dist: 7.6, pitch: 0.7, fov: 52, ahead: 0.7, aheadV: 0.42, grow: 0.42, near: 1.6, ty: 0.3, collide: false },
  street: { dist: 2.9, pitch: 0.29, fov: 60, ahead: 0.6, aheadV: 0.12, grow: 0.13, near: 0.15, ty: 0.5, collide: true },
};
const camMode = () => (save.cam === 'street' || save.cam === 'high') ? save.cam : ((W && W.layout.camera) || 'high');
function camPreset() {
  const m = camMode(), C = CAMS[m], o = W && W.layout.cams && W.layout.cams[m];
  return o ? Object.assign({}, C, o) : C;
}
function toggleCam() { save.cam = camMode() === 'street' ? 'high' : 'street'; storeSave(); refreshMenu(); toast(save.cam === 'street' ? 'Street view' : 'High view'); }
function updateCamera(dt, time) {
  const cam = S.cam, me = S.me, C = camPreset();
  let wantNear = C.near;
  if ((S.screen === 'play' || S.screen === 'over') && me) {
    const v = me.v, sp = Math.abs(v.vf);
    // behind a hideout door the camera moves inside, low, looking out through the gaps
    const h = me.hidden >= 0 ? hideOf(me.hidden) : null, inside = !!h;
    cam.hide += ((inside ? 1 : 0) - cam.hide) * Math.min(1, dt * 3.5);
    if (inside) cam.lastHide = h;
    if (!In.look) { cam.lookT -= dt; if (cam.lookT <= 0) cam.look *= Math.max(0, 1 - dt * 3); }
    cam.yaw = lerpAngle(cam.yaw, Math.PI - v.a, Math.min(1, dt * (me.scr ? 1.2 : v.vf < -0.3 ? 0.6 : 2.6 + sp * 0.5)));
    const ease = Math.min(1, dt * 3);   // switching view glides from one to the other
    cam.dist += (C.dist - cam.dist) * ease; cam.pitch += (C.pitch - cam.pitch) * ease; cam.ahead += (C.ahead - cam.ahead) * ease; cam.ty += (C.ty - cam.ty) * ease;
    const yaw = cam.yaw + (inside ? 0 : cam.look), fx_ = Math.sin(yaw), fz = -Math.cos(yaw), D = cam.dist + sp * C.grow, cp = Math.cos(cam.pitch), spn = Math.sin(cam.pitch);
    const ahead = cam.ahead + Math.max(0, v.vf) * C.aheadV, tx = v.x + Math.sin(v.a) * ahead, tz = v.y + Math.cos(v.a) * ahead;
    v3.set(tx - fx_ * D * cp, D * spn, tz - fz * D * cp); v3b.set(tx, cam.ty, tz);
    if (C.collide && !inside) {
      // never sit inside a building: walk from the car toward the camera and stop short of anything taller than the line of sight
      const sx = v.x, sz = v.y, sy = 0.6, ex = v3.x, ey = v3.y, ez = v3.z, n = Math.max(1, Math.ceil(Math.hypot(ex - sx, ez - sz) / 0.18));
      let f = 1;
      for (let k = 1; k <= n; k++) {
        const t = k / n, x = sx + (ex - sx) * t, z = sz + (ez - sz) * t, y = sy + (ey - sy) * t;
        if (x < 0 || z < 0 || x >= 100 || z >= 100) continue;
        if (W.hgt[Math.floor(z / CS) * GRID + Math.floor(x / CS)] > y - 0.15) { f = Math.max(0.2, (k - 1.6) / n); break; }
      }
      cam.pull += (f - cam.pull) * Math.min(1, dt * (f < cam.pull ? 16 : 2.2));
      if (cam.pull < 0.995) { const q = cam.pull; v3.set(sx + (ex - sx) * q, Math.max(0.55, sy + (ey - sy) * q + (1 - q) * 0.4), sz + (ez - sz) * q); }
    } else cam.pull = 1;
    if (cam.hide > 0.002 && cam.lastHide) {
      const hh = cam.lastHide, ox = Math.sin(hh.a), oz = Math.cos(hh.a), e = smooth(cam.hide), back = hh.grove ? 0.7 : 0.8, pan = clamp(cam.look, -0.7, 0.7);
      v3.lerp(v3c.set(hh.x - ox * back, hh.grove ? 0.62 : 0.47, hh.y - oz * back), e);
      v3b.lerp(v3d.set(hh.x + ox * 3 + oz * pan * 3, 0.3, hh.y + oz * 3 - ox * pan * 3), e);
      if (e > 0.5) wantNear = 0.06;
    }
    if (cam.shake > 0.001) { cam.shake *= Math.max(0, 1 - dt * 6); v3.x += (Math.random() - 0.5) * cam.shake; v3.y += (Math.random() - 0.5) * cam.shake * 0.6; v3.z += (Math.random() - 0.5) * cam.shake; }
    cam.pos.lerp(v3, Math.min(1, dt * 9)); cam.tgt.lerp(v3b, Math.min(1, dt * 11));
    camera.position.copy(cam.pos); camera.lookAt(cam.tgt);
    cam.fov += ((innerWidth < innerHeight ? C.fov + 8 : C.fov) + (me.nitroOn ? 9 : 0) + sp * 1.2 - cam.fov) * Math.min(1, dt * 4);
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
function updateLabels() {
  const street = camMode() === 'street' && (S.screen === 'play' || S.screen === 'over');
  if (H.cones) H.cones.visible = !street && !S.dark;
  if (hudCache.street !== street) { hudCache.street = street; document.body.classList.toggle('streetcam', street); }   // from below, the lamps' cones of light would fill the screen
  // Name tags show only near the car, or the whole town's would pile up across the view: loot and hand-off tags
  // from a couple of streets away, hideout and landmark names only when you are right beside them.
  const playing = (S.screen === 'play' || S.screen === 'over') && S.me, cx = playing ? S.me.v.x : S.cam.tgt.x, cz = playing ? S.me.v.y : S.cam.tgt.z;
  for (const sp of LABELS) {
    if (!sp.visible) continue;
    sp.getWorldPosition(v3); const d = v3.distanceTo(camera.position), s = sp.userData.base * clamp(d / 9.5, 0.55, 2.2);
    const reach = sp.userData.far ? 26 : 6.5, away = Math.hypot(v3.x - cx, v3.z - cz);
    sp.scale.set(s * sp.userData.ratio, s, 1); sp.material.opacity = clamp((d - 2.6) / 2.5, 0, 1) * clamp((reach - away) / 3, 0, 1) * (S.cam.hide > 0.5 ? 0 : 1);
    sp.material.visible = sp.material.opacity > 0.01;   // a name tag that has faded out is not drawn
  }
}
function updateWorldVisuals(time) {
  for (let i = 0; i < S.sites.length; i++) {
    const vz = H.siteVis[i]; setSiteVisual(vz, S.sites[i].st);
    // beams fade when the camera is right beside them, so they never fill the screen
    const near = clamp((Math.hypot(camera.position.x - W.sites[i].x, camera.position.z - W.sites[i].y) - 3.5) / 5, 0.12, 1);
    const hot = isHot(i) && S.sites[i].st === 0;
    vz.beam.material.opacity = (S.sites[i].st === 0 ? (hot ? 0.34 + 0.16 * Math.sin(time * 9) : 0.17 + 0.07 * Math.sin(time * 3 + i)) : 0.09) * near;
    vz.gem.rotation.y = time * (hot ? 5 : 1.6) + i; vz.gem.position.y = 0.95 + Math.sin(time * 2.2 + i) * 0.08;
    vz.gem.scale.setScalar(vz.sc * (hot ? 1.7 + 0.25 * Math.sin(time * 9) : 1));
  }
  // the hot target wears a new name tag while it lasts
  const hotNow = S.hot && S.sites[S.hot.i] && S.sites[S.hot.i].st === 0 ? S.hot.i : -1;
  if (hotNow !== S.hotShown) {
    if (S.hotShown >= 0 && W.sites[S.hotShown]) H.relabelSite(S.hotShown, `${W.sites[S.hotShown].name}  ${money(CFG.VALUE[W.sites[S.hotShown].tier])}`, false);
    if (hotNow >= 0) H.relabelSite(hotNow, `${W.sites[hotNow].name}  ${money(worth(hotNow))}  ×2`, true);
    S.hotShown = hotNow;
  }
  for (let i = 0; i < W.escapes.length; i++) H.escVis[i].beam.material.opacity = 0.2 * clamp((Math.hypot(camera.position.x - W.escapes[i].x, camera.position.z - W.escapes[i].y) - 3.5) / 5, 0.12, 1);
  const locked = S.t < S.leverLock;
  const jailedNow = chors().some(q => q.jailed);   // the lever's name tag only matters while somebody is in the impound
  for (const l of H.leverVis) { l.bulb.material.color.setHex(locked ? 0xff4a4a : COLORS.police); l.label.visible = jailedNow; }
  H.thanaLamp.material.color.setHex(Math.floor(time * 2) % 2 ? 0x8fb4ff : 0xff6a6a);
  // arrow on the road ahead pointing to the next useful place
  const me = S.me; let tgt = null, col = COLORS.loot;
  if (me && S.screen === 'play' && loose(me) && !me.scr) {
    if (me.role === 'chor') {
      if (me.carry.length) { col = COLORS.escape; tgt = openEscapes().reduce((b, e) => (!b || dist(me.v, e) < dist(me.v, b)) ? e : b, null); }
      else if (S.hot && S.sites[S.hot.i].st === 0) tgt = W.sites[S.hot.i];
      else { let bd = 1e9; W.sites.forEach((s, i) => { if (S.sites[i].st === 0) { const d = dist(me.v, s); if (d < bd) { bd = d; tgt = s; } } }); }
    } else if (S.lastAlarm && performance.now() - S.lastAlarm.t < 16000) { tgt = S.lastAlarm; col = COLORS.alarm; }
  }
  if (tgt && dist(me.v, tgt) > 3) {
    const a = Math.atan2(tgt.x - me.v.x, tgt.y - me.v.y);
    arrow.visible = true; arrow.material.color.setHex(col);
    const near = camMode() === 'street' ? 0.6 : 1;   // smaller and closer in the street view, where it sits right in front of the camera
    arrow.position.set(me.v.x + Math.sin(a) * 1.15 * (near < 1 ? 0.85 : 1), 0.07, me.v.y + Math.cos(a) * 1.15 * (near < 1 ? 0.85 : 1)); arrow.rotation.y = a; arrow.scale.setScalar(near);
  } else arrow.visible = false;
}
let hudCache = {};
function setText(id, text) { if (hudCache[id] !== text) { hudCache[id] = text; $(id).textContent = text; } }
function setBar(id, frac) { const w = Math.round(clamp(frac, 0, 1) * 100); if (hudCache[id] !== w) { hudCache[id] = w; $(id).style.width = w + '%'; } }
function updateHud(dt, time) {
  const me = S.me; if (!me) return;
  const v = me.v, left = CFG.ROUND - S.t;
  setText('timer', left >= 0 ? mmss(left) : '+' + mmss(-left)); $('timer').classList.toggle('low', left <= 30);
  let phase = '';
  if (S.t < CFG.COUNT) phase = 'Police roll out in ' + Math.ceil(CFG.COUNT - S.t);
  else if (S.t < CFG.JACKPOT_AT) phase = 'Tijoris open in ' + Math.ceil(CFG.JACKPOT_AT - S.t) + 's';
  else if (S.t >= CFG.COACH_OPEN && S.t < CFG.COACH_CLOSE) phase = 'Strongbox open ' + Math.ceil(CFG.COACH_CLOSE - S.t) + 's';
  else if (left < 0) phase = 'Aakhri daud';
  if (S.hot && S.sites[S.hot.i] && S.sites[S.hot.i].st === 0 && S.t >= CFG.COUNT) phase = 'Hot target: ' + W.sites[S.hot.i].name + ' ×2 · ' + Math.max(0, Math.ceil(S.hot.until - S.t)) + 's';
  setText('phase', phase);
  setText('lootText', money(S.banked) + ' / ' + money(S.target)); setBar('lootBar', S.banked / S.target);
  // danger: who is on me, how close; drives the red edges, the siren and the music
  let danger = 0, chaser = null, nearCop = 99, hunted = false;
  for (const c of S.cops) { const d = Math.hypot(c.rx - v.x, c.ry - v.y); if (d < nearCop) nearCop = d; if (me.role === 'chor' && !me.jailed && c.st === 'chase' && c.target === me.id) { hunted = true; const q = clamp(1 - d / 20, 0.3, 1); if (q > danger) { danger = q; chaser = { x: c.rx, y: c.ry }; } } }
  for (const P of S.players.values()) if (P.role === 'police' && !P.isMe) { const d = dist(P.v, v); if (d < nearCop) nearCop = d; if (me.role === 'chor' && loose(me) && d < 12 && W.los(P.v.x, P.v.y, v.x, v.y)) { const q = clamp(1 - d / 14, 0.3, 1); if (q > danger) { danger = q; chaser = P.v; } } }
  if (S.screen !== 'play') danger = 0;
  if (me.role === 'chor') {
    setText('bag', me.carry.length ? 'Boot: ' + me.carry.map(i => W.sites[i].name).join(' + ') + '  ' + money(carryValue(me)) : 'Boot: empty' + (me.arrests && soloChor() ? ' · busted ' + me.arrests + '/' + CFG.MAX_ARRESTS_SOLO : ''));
    const stars = Math.ceil(me.heat - 0.05);
    if (hudCache.stars !== stars) { hudCache.stars = stars; $('wanted').innerHTML = '★'.repeat(stars) + '<span class="off">' + '★'.repeat(CFG.HEAT_MAX - stars) + '</span>'; }
    const word = me.jailed ? 'IMPOUND' : me.hidden >= 0 ? 'HIDDEN' : hunted || danger > 0 ? 'HUNTED' : stars > 0 ? 'WANTED' : 'CLEAR';
    if (hudCache.word !== word) { hudCache.word = word; const el = $('status'); el.textContent = word; el.className = 'pill ' + (word === 'HUNTED' ? 'hunted' : word === 'WANTED' ? 'wanted' : word === 'HIDDEN' ? 'hidden' : 'clear'); }
  } else { setText('bag', 'Busts: ' + me.arrests); setText('status', ''); }
  setText('speedNum', String(Math.round(Math.abs(v.vf) * CFG.KMH)));
  setBar('nitroFill', me.nitro); $('nitroFill').style.background = me.nitro < CFG.NITRO.MIN ? '#ff6a6a' : '';
  setText('lamp', me.lights ? '' : me.role === 'chor' ? 'LIGHTS OFF' : 'SIREN OFF');
  const helpOn = S.t < 12; if (hudCache.help !== helpOn) { hudCache.help = helpOn; $('help').style.opacity = helpOn ? 1 : 0; }
  $('lamp').classList.toggle('off', !me.lights);
  const ctx = S.ctx, pr = $('prompt');
  if (ctx && S.screen === 'play') {
    pr.hidden = false; setText('promptText', ctx.label);
    const bar = ctx.type === 'auto' || ctx.type === 'search';
    $('promptBarWrap').style.display = bar ? '' : 'none';
    if (bar) $('promptBar').style.width = clamp((ctx.frac || 0) * 100, 0, 100) + '%';
  } else pr.hidden = true;
  // bust meter: yours if you are the chor, your best catch-in-progress if you are police
  let bust = me.role === 'chor' ? me.bust : 0;
  if (me.role === 'police') for (const P of S.players.values()) if (P.role === 'chor' && P.seen && dist(spot(P), v) < 3) bust = Math.max(bust, P.bust);
  const bEl = $('bust');
  if (bust > 0.02 && S.screen === 'play') { bEl.hidden = false; $('bustBar').style.width = (bust * 100) + '%'; setText('bustText', me.role === 'chor' ? (Math.abs(v.vf) < CFG.BUST.VSAFE ? 'TOO SLOW! MOVE!' : 'BUST') : 'BUSTING'); if (me.role === 'chor' && bust > (S.bustWas || 0) + 0.2) { sfx.bustTick(); S.bustWas = bust; } }
  else { bEl.hidden = true; S.bustWas = 0; }
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
  // inside a hideout: black bars, drained colour, and the three things that decide whether you are found
  const hiding = me.hidden >= 0 && S.screen === 'play';
  $('hideui').classList.toggle('on', hiding);
  if (hudCache.hiding !== hiding) { hudCache.hiding = hiding; document.body.classList.toggle('hiding', hiding); }
  let hideDanger = 0;
  if (hiding) {
    const lv = S.searchLv[me.hidden] || 0, found = !!S.searchFound[me.hidden];
    hideDanger = clamp(1 - (nearCop - 2) / 12, 0, 1); if (lv > 0) hideDanger = Math.max(hideDanger, 0.7 + 0.3 * lv);
    setBar('hotBar', me.engHot); setBar('nearBar', hideDanger); setBar('infBar', me.blown ? 1 : me.hidT / HIDE.INFORMER);
    setText('hideText', found ? 'DEKH LIYA! GET OUT NOW!' : lv > 0 ? (me.engHot > 0 || me.blown ? 'They are at this door, and your engine is warm…' : 'They are at this door. Engine cold. Sit tight.') : me.blown ? 'They know this door. Move.' : me.engHot > 0 ? 'Engine cooling. Stay out of sight.' : hideDanger > 0.55 ? 'Jeep close. Engine cold. Sit tight.' : 'Engine cold. Lights off.');
    $('hideText').style.color = found || me.blown ? '#ff8a8a' : '';
    if (found && !S.foundWas) sfx.spotted(); S.foundWas = found;
  } else S.foundWas = false;
  if (post.enabled) post.uniforms.uHide.value += ((hiding ? 1 : 0) - post.uniforms.uHide.value) * Math.min(1, dt * 4);
  // sound
  const playing = S.screen === 'play' && !S.paused;
  engine(Math.abs(v.vf) / CAR.chor.vmax, Math.max(0, inp.throttle), playing && loose(me));
  skid(playing && me.drift && !me.scr ? clamp(v.slip / 1.6, 0.25, 1) : 0);
  let wail = 0;
  for (const c of S.cops) if (c.sirenOn) wail = Math.max(wail, clamp(1 - Math.hypot(c.rx - v.x, c.ry - v.y) / 26, 0, 1));
  for (const P of S.players.values()) if (P.role === 'police' && P.lights && S.t >= CFG.COUNT) wail = Math.max(wail, P.isMe ? 0.25 : clamp(1 - dist(P.v, v) / 26, 0, 1));
  siren(playing ? wail * (hiding ? 0.55 : 1) : 0);
  heartbeat(hiding ? 0.2 + 0.8 * hideDanger : 0);
  music(playing ? clamp(0.22 + S.danger * 0.7 + (me.carry.length ? 0.12 : 0) + (hiding ? 0.1 : 0), 0, 1) : 0.12);
}
// Radar: heading-up, the road ahead is at the top. Tap it for the whole town, north up.
function drawMini() {
  const cv = $('mini'), c = cv.getContext('2d'), me = S.me, now = performance.now(), big = cv.classList.contains('big'), size = cv.width;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, size, size);
  let Z = size / 100;
  if (!big && me) { // zoom to about 28 units around the car and turn the map so the view direction is up
    Z = size / 56; c.save(); c.beginPath(); c.arc(size / 2, size / 2, size / 2, 0, TAU); c.clip();
    c.fillStyle = '#0a0f1c'; c.fillRect(0, 0, size, size);
    c.translate(size / 2, size / 2); c.rotate(-(S.cam.yaw)); c.translate(-me.v.x * Z, -me.v.y * Z);
  }
  c.drawImage(miniBase, 0, 0, 100 * Z, 100 * Z);
  const dot = (x, y, r, col) => { c.beginPath(); c.arc(x * Z, y * Z, r, 0, TAU); c.fillStyle = col; c.fill(); };
  for (const h of W.hides) { if (S.closedHides && S.closedHides.has(h.i)) continue; c.fillStyle = '#b49cff'; c.fillRect(h.mouth.x * Z - 3, h.mouth.y * Z - 3, 6, 6); }
  W.sites.forEach((s, i) => { const st = S.sites[i] ? S.sites[i].st : 0; if (st === 2) return; dot(s.x, s.y, 3 + s.tier * 1.3, st === 1 ? '#8a6a4a' : '#f3b43f'); if (s.tier === 3) { c.beginPath(); c.arc(s.x * Z, s.y * Z, 9, 0, TAU); c.strokeStyle = st === 1 ? '#8a6a4a' : '#f3b43f'; c.lineWidth = 1.6; c.stroke(); } });
  if (S.hot && S.sites[S.hot.i] && S.sites[S.hot.i].st === 0) { const hs = W.sites[S.hot.i], f = (now % 700) / 700; c.beginPath(); c.arc(hs.x * Z, hs.y * Z, 8 + f * 14, 0, TAU); c.strokeStyle = '#ffe27a'; c.globalAlpha = 1 - f; c.lineWidth = 3; c.stroke(); c.globalAlpha = 1; }
  for (const e of W.escapes) { if (!escOpen(e.i)) continue; c.beginPath(); c.moveTo(e.x * Z, e.y * Z - 8); c.lineTo(e.x * Z + 7.5, e.y * Z + 6); c.lineTo(e.x * Z - 7.5, e.y * Z + 6); c.closePath(); c.fillStyle = '#3bc98b'; c.fill(); }
  const anyJailed = chors().some(p => p.jailed);
  for (const l of W.levers) { c.beginPath(); c.arc(l.x * Z, l.y * Z, anyJailed ? 5 + 2 * Math.sin(now / 150) : 3, 0, TAU); c.strokeStyle = '#6a98ff'; c.lineWidth = 2; c.stroke(); }
  S.pings = S.pings.filter(p => now - p.t0 < p.dur);
  for (const p of S.pings) { const f = ((now - p.t0) % 1100) / 1100; c.beginPath(); c.arc(p.x * Z, p.y * Z, 3 + f * 18, 0, TAU); c.strokeStyle = p.col; c.globalAlpha = 1 - f; c.lineWidth = 2.5; c.stroke(); c.globalAlpha = 1; dot(p.x, p.y, 3.5, p.col); }
  if (me) {
    for (const k of S.cops) { if (me.role === 'police' || k.st === 'chase' || Math.hypot(k.rx - me.v.x, k.ry - me.v.y) < 22) dot(k.rx, k.ry, 4, k.st === 'chase' ? '#ff5050' : '#6a98ff'); }
    for (const P of S.players.values()) {
      if (P.isMe || P.hidden >= 0) continue;
      if (P.role === 'police') { if (me.role === 'police' || dist(P.v, me.v) < 22) dot(P.v.x, P.v.y, 4.2, '#8fb4ff'); }
      else if (me.role === 'chor' || P.seen || P.jailed) dot(P.v.x, P.v.y, 4, P.jailed ? '#8a8f9c' : '#ffd98a');
    }
    c.save(); c.translate(me.v.x * Z, me.v.y * Z); c.rotate(-me.v.a + Math.PI);
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3.5); c.lineTo(-6, 7); c.closePath(); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 1.4; c.strokeStyle = '#0a0f1c'; c.stroke(); c.restore();
  }
  if (!big && me) {
    c.restore();
    // rim pins: where the next job or hand-off is when it is off the radar
    const pin = (x, y, col, tri) => {
      const dx = x - me.v.x, dy = y - me.v.y, d = Math.hypot(dx, dy); if (d * Z < size / 2 - 10) return;
      const a = Math.atan2(dy, dx) - S.cam.yaw, px = size / 2 + Math.cos(a) * (size / 2 - 9), py = size / 2 + Math.sin(a) * (size / 2 - 9);
      c.fillStyle = col; c.beginPath(); if (tri) { c.moveTo(px, py - 6); c.lineTo(px + 5.5, py + 4.5); c.lineTo(px - 5.5, py + 4.5); c.closePath(); } else c.arc(px, py, 5, 0, TAU); c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#0a0f1c'; c.stroke();
    };
    if (S.hot && S.sites[S.hot.i] && S.sites[S.hot.i].st === 0) pin(W.sites[S.hot.i].x, W.sites[S.hot.i].y, '#ffe27a', false);
    if (me.role === 'chor') { if (me.carry.length) for (const e of openEscapes()) pin(e.x, e.y, '#3bc98b', true); else { let best = null, bd = 1e9; W.sites.forEach((s, i) => { if (S.sites[i].st === 0) { const d = dist(me.v, s); if (d < bd) { bd = d; best = s; } } }); if (best) pin(best.x, best.y, '#f3b43f', false); } }
    else if (S.lastAlarm && now - S.lastAlarm.t < 16000) pin(S.lastAlarm.x, S.lastAlarm.y, '#ff4a4a', false);
    for (const k of S.cops) if (me.role === 'chor' && k.st === 'chase' && k.target === me.id) pin(k.rx, k.ry, '#ff5050', false);
    c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 1.5, 0, TAU); c.lineWidth = 3; c.strokeStyle = S.danger > 0.1 ? '#ff5050' : '#28324b'; c.stroke();
  }
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
  let note = '';
  const before = paintsUnlocked(save.total);
  if (me && me.role === 'chor') save.total += mine.own;
  if (won) save.wins++;
  if (S.solo) {
    // three medals a night: win it, win it without being busted, win it inside the par time
    const medals = won ? 1 + (mine.ar === 0 ? 1 : 0) + (o.t <= (S.cfg.par || 150) ? 1 : 0) : 0;
    save.medals[S.night] = Math.max(save.medals[S.night] || 0, medals);
    stats.push(['Night ' + S.night, won ? '★'.repeat(medals) + '☆'.repeat(3 - medals) : '☆☆☆']);
    if (won) { save.night = Math.max(save.night, S.night + 1); $('btnAgain').textContent = 'Next night · ' + (S.night + 1); note = medals < 3 ? 'Stars: win, win without a bust, win inside ' + mmss(S.cfg.par || 150) + '. ' : 'All three stars! '; note += 'Night ' + (S.night + 1) + ' needs more loot and brings sharper police.'; }
    else $('btnAgain').textContent = 'Try night ' + S.night + ' again';
    $('btnAgain').disabled = false;
  } else {
    if (S.isHost) { $('btnAgain').textContent = 'Back to the room'; $('btnAgain').disabled = false; }
    else { $('btnAgain').textContent = 'Waiting for the host…'; $('btnAgain').disabled = true; }
    if (S.cfg && S.cfg.name) $('endWhy').textContent = o.why + '  ' + S.cfg.name + (S.cfg.twist ? ' · Twist: ' + S.cfg.twist.name : '') + '.';
    const q = cleanSeries(o.sr); if (q.rounds) stats.push(['Series', 'Chors ' + q.chor + ' – ' + q.police + ' Police']);
    const lv = o.lv | 0, nx = o.nx | 0;
    if (lv && nx > lv) note = 'The chors cleared level ' + lv + '. Next round is level ' + nx + ' · ' + LEVEL_NAMES[nx] + '. ';
    else if (lv) note = 'Next round stays at level ' + nx + ' · ' + LEVEL_NAMES[nx] + '. ';
  }
  const es = $('endStats'); es.innerHTML = '';
  for (const s of stats) { const d = document.createElement('div'), l = document.createElement('span'), vv = document.createElement('b'); l.className = 'label'; l.textContent = s[0]; vv.textContent = s[1]; d.append(l, vv); es.appendChild(d); }
  const list = $('endList'); list.innerHTML = '';
  if (!S.solo) for (const p of o.pl) { const li = document.createElement('li'); const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.n + (p.id === S.myId ? ' (you)' : ''); const tg = document.createElement('span'); tg.className = 'tag ' + p.r; tg.textContent = p.r === 'chor' ? money(p.own) : p.ar + ' busts'; li.append(nm, tg); list.appendChild(li); }
  if (paintsUnlocked(save.total) > before) note = 'New car paint unlocked: ' + PAINTS[Math.min(PAINTS.length, paintsUnlocked(save.total)) - 1].name + '. ' + note;
  $('endNote').textContent = note;
  storeSave(); refreshMenu();
  setTimeout(() => { if (S.over === o) setScreen('over'); }, 1100);
}

// ------------------------------------------------------------------ menu, lobby, networking flows
function refreshMenu() {
  const st = save.medals[save.night] || 0;
  $('btnSolo').textContent = 'Play solo · Night ' + save.night + ' · ' + matchSetup(1, 0, save.night).name + (st ? '  ' + '★'.repeat(st) : '');
  $('rankName').textContent = rankFor(save.total); $('rankLoot').textContent = money(save.total);
  const tw = TOWNS.find(t => t.id === MAP_ID) || TOWNS[0]; $('btnTown').textContent = 'Town: ' + tw.name + ' · ' + tw.country + '  (tap to change)';
  $('btnMute').textContent = isMuted() ? 'Sound off' : 'Sound on';
  const q = 'Graphics: ' + (save.quality === 'auto' ? 'Auto' : save.quality === 'high' ? 'High' : 'Low'); $('btnQuality').textContent = q; $('btnQuality2').textContent = q;
  const mu = 'Music: ' + (isMusicOn() ? 'on' : 'off'); $('btnMusic').textContent = mu; $('btnMusic2').textContent = mu;
  $('btnCam').textContent = 'View: ' + (camMode() === 'street' ? 'Street' : 'High');
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
function toMenu(msg) { leaveNet(); S.isHost = true; S.solo = true; S.myId = 'h'; nightLook(null); document.body.classList.remove('hiding'); hudCache.hiding = false; clearDyn(); arrow.visible = false; fx.setRain(0); S.openDoors = []; S.searchLv = {}; setScreen('menu'); refreshMenu(); $('menuErr').textContent = msg || ''; }
function spawnFor(role, k) {
  if (role === 'police') { const p = W.policeSpawns[k % W.policeSpawns.length]; return { x: p.x, y: p.y, a: p.a }; }
  // up to four cars per corner; a second car at the same corner starts a car-length behind the first
  const s = W.spawns[k % W.spawns.length], row = Math.floor(k / W.spawns.length);
  return { x: s.x - Math.sin(s.a) * 1.3 * row, y: s.y - Math.cos(s.a) * 1.3 * row, a: s.a };
}
function startSolo() {
  initAudio(); leaveNet(); S.isHost = true; S.solo = true; S.myId = 'h'; S.night = save.night;
  save.name = myName(); storeSave();
  const sp = spawnFor('chor', Math.floor(Math.random() * 4));
  beginMatch({ cfg: matchSetup(1, 0, S.night), players: [{ id: 'h', name: save.name, role: 'chor', x: sp.x, y: sp.y, a: sp.a, paint: paintHex(save.paint) }] });
}
// What the host has chosen for the room: level 1 to 10, which town ('' Jugnupur, 'hotaru', or '?' for a different one each round),
// whether each round gets a random night and twist, and whether the level goes up when the chors win.
const cleanOpts = o => ({
  level: Math.max(1, Math.min(10, (o && o.level) | 0 || 3)),
  town: o && (o.town === '?' || TOWNS.some(t => t.id === o.town)) ? o.town : '',
  surprises: !o || o.surprises !== false, autoLevel: !o || o.autoLevel !== false,
});
const cleanSeries = q => ({ rounds: Math.max(0, (q && q.rounds) | 0), chor: Math.max(0, (q && q.chor) | 0), police: Math.max(0, (q && q.police) | 0) });
function renderLobby() {
  const L = S.lobby, me = L.players.find(p => p.id === S.myId), O = L.opts, host = S.isHost;
  $('roomCode').textContent = L.code; $('pcount').textContent = L.players.length;
  const ul = $('plist'); ul.innerHTML = '';
  for (const p of L.players) { const li = document.createElement('li'); const sw = document.createElement('span'); sw.style.cssText = 'width:14px;height:14px;border-radius:50%;flex:none;border:1px solid rgba(255,255,255,.3);background:#' + ((p.role === 'chor' ? (p.paint | 0) : 0xdfe6f2).toString(16).padStart(6, '0')); const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.id === S.myId ? ' (you)' : '') + (p.id === 'h' ? ' · host' : ''); const tg = document.createElement('span'); tg.className = 'tag ' + p.role; tg.textContent = p.role === 'chor' ? 'Chor' : 'Police'; li.append(sw, nm, tg); ul.appendChild(li); }
  const nc = L.players.filter(p => p.role === 'chor').length, np = L.players.length - nc, setup = roomSetup(Math.max(1, nc), np, O.level);
  $('btnRoleChor').disabled = !!me && me.role === 'chor'; $('btnRolePolice').disabled = !!me && me.role === 'police';
  // tonight's settings: everyone sees them, only the host can change them
  $('optTown').textContent = 'Town: ' + (O.town === '?' ? 'Surprise me · tonight ' + townName(MAP_ID) : townName(MAP_ID));
  $('optLevel').textContent = 'Level ' + O.level + ' · ' + LEVEL_NAMES[O.level];
  $('optSurprise').textContent = 'Surprises: ' + (O.surprises ? 'on' : 'off');
  $('optAuto').textContent = 'Auto level-up: ' + (O.autoLevel ? 'on' : 'off');
  for (const id of ['optTown', 'optSurprise', 'optAuto', 'btnShuffle']) $(id).disabled = !host;
  $('optLevelDown').disabled = !host || O.level <= 1; $('optLevelUp').disabled = !host || O.level >= 10;
  $('btnShuffle').hidden = !host; $('hostNote').hidden = host;
  $('lobbyInfo').textContent = nc === 0 ? 'At least one player must be a chor.' : `${nc} getaway car${nc > 1 ? 's' : ''} against ${np} police player${np === 1 ? '' : 's'}${setup.cops ? ' and ' + setup.cops + ' computer jeep' + (setup.cops > 1 ? 's' : '') : ''}. Chors must bank about ${money(setup.target)}.` + (O.surprises ? ' Each round brings a different night, a twist and new start points.' : '');
  const Q = L.series; $('seriesLine').textContent = Q.rounds ? `Rounds played: ${Q.rounds} · Chors ${Q.chor} – ${Q.police} Police` : '';
  $('btnStart').hidden = !host; $('btnStart').disabled = nc === 0;
  if (!host) $('lobbyInfo').textContent += ' Waiting for the host to start.';
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
let lastBeat = 0;
function heartbeatNet() {
  if (!S.net || S.solo) { lastBeat = 0; return; }
  const now = performance.now();
  // if this page itself was frozen for a while (building a town, a slow first frame), the silence was ours: do not blame the others
  if (lastBeat && now - lastBeat > 6000) { if (S.hostHeard) S.hostHeard = Math.max(S.hostHeard, now); for (const k of Object.keys(heard)) heard[k] = Math.max(heard[k], now); }
  lastBeat = now;
  if (S.isHost) {
    if (S.screen !== 'play') S.net.broadcast({ k: 'hb' });
    for (const p of S.lobby.players.slice()) if (p.id !== 'h') { if (!heard[p.id]) heard[p.id] = now; else if (now - heard[p.id] > 15000) { S.net.kick(p.id); hostDrop(p.id); } }
  } else {
    S.net.send({ k: 'hb' });
    if (S.hostHeard && now - S.hostHeard > 15000) toMenu('Lost the connection to the host.');
  }
}
function broadcastLobby() { if (!S.net || !S.isHost) return; for (const p of S.lobby.players) if (p.id !== 'h') S.net.send(p.id, { k: 'lobby', you: p.id, code: S.lobby.code, players: S.lobby.players, map: MAP_ID, opts: S.lobby.opts, series: S.lobby.series }); renderLobby(); }
async function createRoom() {
  initAudio(); $('menuErr').textContent = 'Creating a room…'; $('btnCreate').disabled = true;
  save.name = myName(); storeSave(); leaveNet();
  const net = new HostNet({
    onJoin() {},
    onData(pid, m) {
      if (!m || typeof m !== 'object') return;
      heard[pid] = performance.now();
      if (m.k === 'hb') return;
      if (m.k === 'wait') { heard[pid] = performance.now() + 45000; return; }   // they are busy loading a town: be patient
      if (m.k === 'bye') { net.kick(pid); hostDrop(pid); return; }
      if (m.k === 'hello') {
        if (m.v !== CFG.PROTO) { net.send(pid, { k: 'old' }); setTimeout(() => net.kick(pid), 400); return; }
        if (S.screen !== 'lobby') { net.send(pid, { k: 'busy' }); setTimeout(() => net.kick(pid), 400); return; }
        if (S.lobby.players.length >= CFG.MAX_PLAYERS) { net.send(pid, { k: 'full' }); setTimeout(() => net.kick(pid), 400); return; }
        if (!S.lobby.players.some(p => p.id === pid)) S.lobby.players.push({ id: pid, name: String(m.name || 'Dost').replace(/[<>]/g, '').trim().slice(0, 14) || 'Dost', role: 'chor', paint: (m.paint | 0) & 0xffffff });
        broadcastLobby();
      } else if (m.k === 'role') { const p = S.lobby.players.find(q => q.id === pid); if (p && S.screen === 'lobby' && (m.role === 'chor' || m.role === 'police')) { p.role = m.role; broadcastLobby(); } }
      else if (m.k === 'p') {
        const P = S.players.get(pid); if (!P || P.jailed || !(m.q >= P.tpSeq) || S.screen !== 'play') return;
        if (typeof m.x !== 'number' || typeof m.y !== 'number' || !isFinite(m.x) || !isFinite(m.y)) return;
        const n = P.net; n.x = clamp(m.x, 0, 100); n.y = clamp(m.y, 0, 100); n.a = Number.isFinite(+m.a) ? +m.a % TAU : 0; n.vf = clamp(+m.v || 0, -3, 6); n.steer = clamp(+m.s || 0, -1, 1); n.t = performance.now();
        P.nitroOn = !!(m.f & 1); P.lights = !!(m.f & 2); P.brake = !!(m.f & 4); P.drift = !!(m.f & 8); if (m.f & 16) P.crashT = 0.8;
      } else if (m.k === 'a') doAction(S.players.get(pid), String(m.t), m.i);
    },
    onLeave(pid) { hostDrop(pid); },
  });
  try {
    const code = await net.open();
    if (S.screen !== 'menu' || S.net) { net.close(); $('btnCreate').disabled = false; return; }   // gave up waiting and started something else
    S.net = net; S.isHost = true; S.solo = false; S.myId = 'h';
    S.lobby = { code, players: [{ id: 'h', name: save.name, role: 'chor', paint: paintHex(save.paint) }], opts: cleanOpts({ level: 3, town: MAP_ID }), series: cleanSeries(null), lastTwist: '' };
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
      if (m.k === 'wait') { S.hostHeard = performance.now() + 45000; return; }   // the host is busy loading a town
      if (m.k === 'bye') { toMenu('The host closed the room.'); return; }
      if (m.k === 'lobby') {
        S.myId = m.you; S.lobby = { code: cleanCode(m.code), players: Array.isArray(m.players) ? m.players : [], opts: cleanOpts(m.opts), series: cleanSeries(m.series) };
        if (S.screen !== 'lobby') { clearDyn(); nightLook(null); setScreen('lobby'); }
        renderLobby();
        ensureTown(String(m.map || ''));   // be in the host's town, ready for the start
      }
      else if (m.k === 'start') { const go = m; ensureTown(String(go.map || '')).then(() => { if (S.net === net) beginMatch(go); }); }
      else if (m.k === 's') applySnapshot(m);
      else if (m.k === 'tp') { const me = S.me; if (me) { const v = me.v; v.x = m.x; v.y = m.y; v.a = +m.a || 0; v.vx = v.vy = v.vf = 0; me.tpSeq = m.q; me.scr = null; me.jailed = true; me.hidden = me.hiding = me.wasHidden = -1; S.cam.yaw = Math.PI - v.a; } }
      else if (m.k === 'note') feed(m.m);
      else if (m.k === 'busy') toMenu('That room is in the middle of a round. Try again in a few minutes.');
      else if (m.k === 'full') toMenu('That room is full (8 players).');
      else if (m.k === 'old') toMenu('You and the host have different versions of the game. Both of you reload the page, then try again.');
    },
    onClose() { if (S.net === net) toMenu('Lost the connection to the host.'); },
  });
  try {
    await net.connect(code);
    if (S.screen !== 'menu' || S.net) { net.close(); $('btnJoin').disabled = false; return; }
    S.net = net; S.isHost = false; S.solo = false; S.hostHeard = performance.now();
    net.send({ k: 'hello', name: save.name, paint: paintHex(save.paint), v: CFG.PROTO });
    $('menuErr').textContent = 'Connected. Waiting for the room…';
  } catch (e) { $('menuErr').textContent = e.message; }
  $('btnJoin').disabled = false;
}
const shuffled = list => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
// A different place to start every round: somewhere on a proper road, well away from the police station, the loot and each other.
function randomSpawns(n) {
  const out = [], thana = W.policeSpawns[0];
  for (let tries = 0; tries < 600 && out.length < n; tries++) {
    const q = W.safeSpot(4 + Math.random() * 92, 8 + Math.random() * 84, false);
    if (!W.policeOk(q.x, q.y) || W.inPark(q.x, q.y)) continue;
    if (Math.hypot(q.x - thana.x, q.y - thana.y) < 26) continue;
    if (W.sites.some(d => Math.hypot(d.x - q.x, d.y - q.y) < 5) || W.escapes.some(d => Math.hypot(d.x - q.x, d.y - q.y) < 8)) continue;
    if (tries < 400 && W.posts.some(d => Math.hypot(d.x - q.x, d.y - q.y) < 14)) continue;   // police players may start at a post
    if (out.some(o => Math.hypot(o.x - q.x, o.y - q.y) < (tries < 300 ? 14 : 3))) continue;
    out.push(q);
  }
  while (out.length < n) out.push(spawnFor('chor', out.length));
  return out;
}
// What is different about this round: the kind of night, a twist, which small places are shut, which hideouts are padlocked.
function planRound(setup) {
  const L = setup.level, night = pickNight(L, Math.random), twist = pickTwist(L, Math.random, S.lobby.lastTwist);
  S.lobby.lastTwist = twist ? twist.id : '';
  const cfg = composeRound(setup, night, twist);
  const small = []; W.sites.forEach((d, i) => { if (d.tier < 3 && !d.coach) small.push(i); });
  cfg.closedSites = shuffled(small).slice(0, 2);
  cfg.closedHides = shuffled(W.hides.map(h => h.i)).slice(0, Math.round(W.hides.length * ((twist && twist.lockHides) || 0.12)));
  cfg.openEsc = twist && twist.escapes ? shuffled(W.escapes.map(e => e.i)).slice(0, twist.escapes) : null;
  cfg.hot = 1;
  return cfg;
}
function hostStart() {
  const L = S.lobby, cs = L.players.filter(p => p.role === 'chor'), ps = L.players.filter(p => p.role === 'police');
  if (!cs.length) { $('lobbyErr').textContent = 'At least one player must be a chor.'; return; }
  $('lobbyErr').textContent = '';
  const O = L.opts, setup = roomSetup(cs.length, ps.length, O.level);
  const cfg = O.surprises ? planRound(setup) : Object.assign(composeRound(setup, NIGHT_KINDS[0], null), { name: 'Level ' + setup.level, night: null });
  // never ask for more than the town holds tonight
  applyRules(cfg.rules);
  const shut = new Set(cfg.closedSites || []), avail = W.sites.reduce((sum, d, i) => sum + (shut.has(i) ? 0 : CFG.VALUE[d.tier]), 0);
  cfg.target = Math.max(300, Math.min(cfg.target, Math.floor(avail * 0.7 / 50) * 50));
  const players = [], chorAt = O.surprises ? randomSpawns(cs.length) : cs.map((p, k) => spawnFor('chor', k));
  const posts = O.surprises ? shuffled(W.posts) : [];   // police players may start at one of the posts round town instead of the station yard
  cs.forEach((p, k) => { const sp = chorAt[k]; players.push({ id: p.id, name: p.name, role: 'chor', x: sp.x, y: sp.y, a: sp.a, paint: p.paint }); });
  ps.forEach((p, k) => { const sp = posts[k] ? W.safeSpot(posts[k].x, posts[k].y, true) : spawnFor('police', k); players.push({ id: p.id, name: p.name, role: 'police', x: sp.x, y: sp.y, a: sp.a }); });
  if (ps.length) cfg.copStart = ps.length; // computer jeeps park clear of the police players' spots
  const msg = { k: 'start', cfg, players, map: MAP_ID };
  S.net.broadcast(msg); beginMatch(msg);
}
// Random sides, keeping the same number of police as now (and always at least one chor).
function shuffleSides() {
  if (!S.isHost || S.screen !== 'lobby') return;
  const L = S.lobby, n = L.players.length, was = L.players.filter(p => p.role === 'police').length;
  const np = Math.min(n - 1, (was === 0 || was === n) ? Math.floor(n / 2) : was);   // everyone on one side: split the room down the middle
  shuffled(L.players).forEach((p, k) => { p.role = k < np ? 'police' : 'chor'; });
  broadcastLobby();
}
// The host changes tonight's settings.
function setOpt(change) {
  if (!S.isHost || S.screen !== 'lobby') return;
  const O = S.lobby.opts; change(O); S.lobby.opts = cleanOpts(O); sfx.click();
  broadcastLobby();
}
// 'Surprise me': a town different from the one loaded now.
const otherTown = () => { const pool = TOWNS.filter(t => t.id !== MAP_ID); return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : MAP_ID; };
function cycleTown() {
  if (!S.isHost || S.screen !== 'lobby') return;
  const order = TOWNS.map(t => t.id).concat(['?']), O = S.lobby.opts, cur = O.town === '?' ? '?' : MAP_ID;
  const next = order[(order.indexOf(cur) + 1) % order.length];
  O.town = next; sfx.click();
  ensureTown(next === '?' ? otherTown() : next).then(() => broadcastLobby());
  broadcastLobby();
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
  $('optTown').onclick = () => cycleTown();
  $('optLevelDown').onclick = () => setOpt(o => { o.level--; }); $('optLevelUp').onclick = () => setOpt(o => { o.level++; });
  $('optSurprise').onclick = () => setOpt(o => { o.surprises = !o.surprises; }); $('optAuto').onclick = () => setOpt(o => { o.autoLevel = !o.autoLevel; });
  $('btnShuffle').onclick = () => { shuffleSides(); sfx.click(); };
  $('btnTown').onclick = () => { const k = TOWNS.findIndex(t => t.id === MAP_ID), next = TOWNS[(k + 1) % TOWNS.length].id; save.town = next; storeSave(); sfx.click(); ensureTown(next); };
  $('btnLeave').onclick = () => toMenu('');
  $('btnCopy').onclick = async () => {
    const link = location.origin + location.pathname + '?' + (MAP_ID ? 'map=' + MAP_ID + '&' : '') + 'room=' + S.lobby.code;
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
  $('btnCam').onclick = () => { toggleCam(); sfx.click(); };
  $('btnLights').onclick = () => toggleLights();
  $('btnSlip').onclick = () => leaveHide(0); $('btnBurst').onclick = () => leaveHide(1);
  if (!isTouch) { $('btnSlip').textContent = 'Slip out quietly · E'; $('btnBurst').textContent = 'Burst out · W'; }
  $('btnAgain').onclick = () => {
    if (S.solo) { startSolo(); return; }
    if (!S.isHost) return;
    clearDyn(); nightLook(null); setScreen('lobby'); broadcastLobby();
    if (S.lobby.opts.town === '?') ensureTown(otherTown()).then(() => broadcastLobby());   // a different town for the next round
  };
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
    if (e.code === 'KeyC' && !e.repeat) { toggleCam(); return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    In.keys.add(e.code);
  });
  window.addEventListener('keyup', e => In.keys.delete(e.code));
  window.addEventListener('blur', () => { In.keys.clear(); In.actTouch = In.nitroTouch = In.brakeTouch = false; });
  const stick = $('stick'), knob = stick.firstElementChild;
  canvas.addEventListener('pointerdown', e => {
    if (S.screen !== 'play') return;
    initAudio();
    const hid = S.me && S.me.hidden >= 0;
    if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.5 && !In.stick && !hid) {
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
  // phones drop the graphics context when the tab goes to the background; let it come back instead of leaving a black screen
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); toast('Graphics paused…'); });
  canvas.addEventListener('webglcontextrestored', () => { toast('Graphics are back.'); resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (S.solo && S.screen === 'play' && !S.over) togglePause(true); return; } if (!document.hidden) { initAudio(); try { if (S.screen === 'play' && navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {} } });
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
  const c = S.cfg || {};
  $('pauseTonight').textContent = (c.night || c.twist) ? [c.name, c.night ? c.night.blurb : '', c.twist ? 'Twist · ' + c.twist.name + ': ' + c.twist.blurb : ''].filter(Boolean).join(' ') : '';
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
  if (document.hidden) for (const P of S.players.values()) { if (!P.isMe) { P.v.x = P.net.x; P.v.y = P.net.y; P.v.a = P.net.a; P.v.vf = P.net.vf; } else { P.v.vx = P.v.vy = P.v.vf = 0; } }
  while (rem > 1e-4 && !S.over) { const h = Math.min(0.02, rem); hostTick(h); rem -= h; }
  if (!S.solo && S.net && now - S.lastSnap >= 60 && !S.over) { // chors get the full picture; police are not told where hidden cars are
    S.lastSnap = now; const full = snapshot(false), fog = snapshot(true);
    for (const P of S.players.values()) if (!P.isMe) S.net.send(P.id, P.role === 'police' ? fog : full);
    S.evOut = [];
  } else if (S.solo) S.evOut = [];
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - lastFrame) / 1000), time = now / 1000; lastFrame = now;
  fpsAvg += ((dt > 0 ? 1 / dt : 60) - fpsAvg) * 0.05;
  const playing = S.screen === 'play' || S.screen === 'over';
  if (playing) {
    if (S.isHost && !S.over) for (let i = 0; i < S.sites.length; i++) S.sites[i].st = siteState(i);
    // physics in several small steps per frame (so a slow phone still drives at full speed and cannot tunnel through a wall); everything else once
    if (S.screen === 'play' && !S.paused && S.me) { const n = Math.max(1, Math.ceil(dt / 0.017)); for (let k = 0; k < n; k++) drivePhysics(S.me, dt / n); localFrame(dt); }
    syncEntities(dt, time); updateWorldVisuals(time); updateHud(dt, time);
    if (++miniTick % 2 === 0) drawMini();
    // storms: a flash now and then, thunder a moment later
    if (S.cfg && S.cfg.rain > 0.6 && S.screen === 'play' && !S.paused) { S.lightningAt -= dt; if (S.lightningAt <= 0) { S.lightningAt = 9 + Math.random() * 16; fx.lightning(); setTimeout(() => sfx.thunder(), 500 + Math.random() * 900); } }
    rain(S.cfg ? S.cfg.rain || 0 : 0);
  } else {
    music(S.screen === 'menu' || S.screen === 'lobby' ? 0.12 : 0); rain(0);
    for (let i = 0; i < W.hides.length; i++) { const hv = H.hideVis[i]; if (hv.closed !== 1) { hv.closed = 1; hv.ho.setClosed(1); } if (hv.search) { hv.search = 0; hv.ho.setSearch(0); } }
  }
  updateCamera(dt, time); updateLights(dt, time); updateLabels();
  fx.update(dt, time, focusPt.set(S.cam.tgt.x, S.cam.tgt.z));
  if (dressing) dressing.update(dt, time);
  if (ambient) ambient.update(dt, time, focusPt, fx);
  U.uTime.value = time % 3600;
  post.render(dt);
  // if a phone cannot keep up, quietly drop the expensive effects once
  if (save.quality === 'auto' && playing && !S.dropped) { S.lowFps = fpsAvg < 22 ? S.lowFps + dt : 0; if (S.lowFps > 4) { S.dropped = true; post.setEnabled(false); fx.setQuality('low'); pixelCap = 1; renderer.setPixelRatio(1); resize(); toast('Graphics lowered for smoother driving.'); } }
}
const focusPt = { x: 50, z: 50, set(x, z) { this.x = x; this.z = z; return this; } };

// ------------------------------------------------------------------ towns: one is loaded at a time, and can be swapped for another
function unloadTown() {
  if (!town) return;
  clearDyn();
  try { if (dressing) dressing.dispose(); } catch (e) { /* already gone */ }
  try { if (ambient) ambient.dispose(); } catch (e) { /* already gone */ }
  if (H) for (const hv of H.hideVis) { try { hv.ho.dispose(); } catch (e) { /* already gone */ } }
  town.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { for (const k of ['map', 'emissiveMap', 'roughnessMap']) if (m[k]) m[k].dispose(); m.dispose(); }
    if (o.isInstancedMesh) o.dispose();
  });
  scene.remove(town); town = null; LABELS.length = 0; dressing = null; ambient = null;
}
async function loadTown(id) {
  id = TOWNS.some(t => t.id === id) ? id : '';
  let map = null;
  try { const r = await fetch(id ? 'data/map-' + id + '.json' : 'data/map.json'); if (r.ok) map = await r.json(); } catch (e) { map = null; }
  if (!map) { if (!id) throw new Error('The town could not be loaded.'); return loadTown(''); }
  unloadTown();
  MAP_ID = id; CUR = (typeof map.currency === 'string' && map.currency.length <= 3) ? map.currency : '₹';
  W = buildWorld(map);
  town = new THREE.Group(); scene.add(town);
  const high = highQ();
  H = buildScene(town, map, W, U, { ground: high ? 2048 : 1024, aniso: Math.min(8, renderer.capabilities.getMaxAnisotropy()), wet: high, cones: true });
  dressing = buildDressing(town, W, { hash2, U, vocab: map.signs || null });
  for (const vz of H.siteVis) if (vz.label) vz.label.userData.far = true;   // loot name tags are worth seeing from further off
  for (const vz of (H.escVis || [])) if (vz.label) vz.label.userData.far = true;
  ambient = buildAmbient(town, W, map, { hash2, camera, cutMat: H.cutMat });
  miniBase = document.createElement('canvas'); miniBase.width = miniBase.height = 500; paintMini(miniBase, map, W);
  S.sites = []; S.openDoors = []; S.searchLv = {}; S.searchFound = {}; S.hot = null; hudCache = {};
  nightLook(null);
}
// Switches town if another one is wanted, with a word on screen while it builds. Calls queue up, so two never run at once.
let townQueue = Promise.resolve();
function ensureTown(id) {
  id = TOWNS.some(t => t.id === id) ? id : '';
  townQueue = townQueue.then(async () => {
    if (id === MAP_ID && town) return;
    const ld = $('loading'); ld.textContent = 'Loading ' + townName(id) + '…'; ld.hidden = false;
    // building a town keeps this page busy for a few seconds: tell the others, so nobody takes the silence for a lost connection
    if (S.net && !S.solo) { try { if (S.isHost) S.net.broadcast({ k: 'wait' }); else S.net.send({ k: 'wait' }); } catch (e) { /* not connected */ } }
    await new Promise(r => setTimeout(r, 60));   // let the words appear (and the note go out) before the building starts
    try { await loadTown(id); } catch (e) { toast('That town could not be loaded.'); }
    const now = performance.now(); if (S.hostHeard) S.hostHeard = Math.max(S.hostHeard, now); for (const k of Object.keys(heard)) heard[k] = Math.max(heard[k], now);
    ld.hidden = true; refreshMenu(); if (S.screen === 'lobby') renderLobby();
  });
  return townQueue;
}
// How the night looks: fog, street lamps, lit windows and signs, moonlight. null puts the town back to its usual look.
let LIGHT_MUL = 1;
const MIST = 0x4a5364;
function nightLook(cfg) {
  const misty = !!(cfg && cfg.fog), dark = !!(cfg && cfg.dark);
  const fg = (cfg && cfg.fog) || (W && W.layout.fog) || [16, 52];
  scene.fog.near = fg[0]; scene.fog.far = fg[1];
  scene.fog.color.setHex(misty ? MIST : COLORS.fog); scene.background.setHex(misty ? MIST : COLORS.fog);
  LIGHT_MUL = dark ? 0.72 : (cfg && cfg.bright) ? 1.3 : 1;
  U.uPower.value = dark ? 0.05 : 1;                                   // windows and shop lights
  if (H && H.ground) H.ground.material.emissiveIntensity = dark ? 0.55 : 2.1;   // pools of lamp light on the road
  if (H && H.bulbs) H.bulbs.material.color.setScalar(dark ? 0.08 : 1);
  if (ambient) ambient.setNight({ power: dark ? 0.04 : 1, mist: misty ? 0.9 : 0, mistColor: MIST });
  if (dressing && dressing.group) dressing.group.traverse(o => { if (o.material && o.material.isMeshBasicMaterial) o.material.color.setScalar(dark ? 0.07 : 1); });   // neon signs
  S.dark = dark;
}

async function boot() {
  // ?map=hotaru opens that town; otherwise the one picked last time, otherwise Jugnupur
  const asked = (new URLSearchParams(location.search).get('map') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  try { await Promise.race([Promise.all([document.fonts.load('700 46px "Baloo 2"'), document.fonts.load('600 16px "Hind"')]), new Promise(r => setTimeout(r, 1800))]); } catch (e) { /* fall back to system fonts */ }
  fx = new Fx(scene, { quality: highQ() ? 'high' : 'low' });
  await loadTown(TOWNS.some(t => t.id === asked) && asked ? asked : (save.town || ''));
  setMuted(!!save.muted); setMusicOn(save.music !== false);
  if (!PAINTS.some(p => p.id === save.paint)) save.paint = PAINTS[0].id;
  bindUi(); applyQuality(); refreshMenu();
  $('loading').hidden = true; setScreen('menu');
  setInterval(hostLoop, 33); setInterval(heartbeatNet, 2000);
  window.addEventListener('pagehide', () => { if (S.net && !S.solo) { try { if (S.isHost) S.net.broadcast({ k: 'bye' }); else S.net.send({ k: 'bye' }); } catch (e) {} } });
  requestAnimationFrame(frame);
  window.__cp = { S, get W() { return W; }, randomSpawns, nightLook, heard, get town() { return MAP_ID; }, ensureTown, CFG, In, scene, doAction, hostTick, startSolo, save, camera, renderer, post, drive, makeDriver, stepVehicle, fps: () => fpsAvg }; // handy for testing in the console
}
boot().catch(err => { console.error(err); $('loading').textContent = 'Could not start the game: ' + err.message; });
