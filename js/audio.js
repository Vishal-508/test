// All sound is synthesised with WebAudio, so the game ships no audio files.
//
//   continuous voices (engine, skid, siren, heartbeat, rain) ──┐
//   music bed (a step sequencer playing persistent voices) ────┼─> master (mute) ─> compressor ─> out gain ─> soft clip ─> speakers
//   one-shot sfx (each creates and stops its own nodes) ───────┘
//
// Every continuous voice is built once in initAudio() and afterwards only steered with setTargetAtTime, so the
// per-frame functions create no nodes and allocate nothing. Until initAudio() has run (or where there is no
// AudioContext at all) every export is a silent no-op. Nothing is ever scheduled on a context that is not running,
// and the context is put to sleep while muted or while the tab is hidden.

const NOISE_SEC = 2;          // length of the shared white-noise buffer
const LEVEL = { engine: 0.17, skid: 0.62, siren: 0.135, heart: 0.34, rain: 0.1, music: 0.33, sfx: 0.85, out: 0.9 };

let ctx = null, master = null, sfxBus = null, outNode = null, noiseBuf = null, noiseSrc = null;
let muted = false, musicOn = true;
let wokeAt = -1e9, pausedByHide = false;
let mEnv = [], mPitch = [], hEnv = [], hPitch = [];   // the sequencers' AudioParams, for clearAhead()
let analyser = null, scope = null, lastPeak = 0;
const C = {};                 // controls of the continuous voices: { p: AudioParam, v: last target sent }
const M = {};                 // AudioParams of the music voices, written by the sequencer

const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);            // NaN and negatives become 0
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------- small node helpers (init and one-shots only)
function mkGain(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
function mkOsc(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; }
function mkFilter(type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; return b; }
// src -> gain(v) -> dest, where dest is a node or an AudioParam
function send(src, dest, v) { const g = mkGain(v); src.connect(g); g.connect(dest); return g; }
function ctl(param, v) { param.value = v; return { p: param, v }; }
// Move a control towards v. The param is only touched when the target really changes, so calling this every frame is cheap.
function aim(c, v, tc) {
  const d = v - c.v;
  if ((d < 0 ? -d : d) <= (c.v < 0 ? -c.v : c.v) * 0.004 + 1e-4 && !(v === 0 && c.v !== 0)) return;
  c.v = v; c.p.setTargetAtTime(v, ctx.currentTime, tc);
}
// How far ahead of AudioContext time a sequencer should schedule: a quarter of a second at a healthy frame rate, further
// when the calls come slowly or unevenly (a slow phone, a hitch), so the beat does not drop out. tr = { last, gap, dt }.
function lookAhead(tr, now) {
  let dt = tr.last > 0 ? now - tr.last : 0; tr.last = now;
  if (!(dt > 0) || dt > 1) dt = 0;                                      // the first call, or the first after a long break
  tr.gap = dt > tr.gap ? dt : tr.gap + (dt - tr.gap) * 0.02;            // the longest recent gap between calls, forgotten slowly
  tr.dt = dt;
  const a = 0.25 + 2 * tr.gap;
  return a < 1.2 ? a : 1.2;
}
// One percussive envelope on a persistent VCA: rise to vel at t, fall away after hold. Never clicks, whatever came before.
function hit(gainParam, vel, t, attack, hold, release) { gainParam.setTargetAtTime(vel, t, attack); gainParam.setTargetAtTime(0, t + hold, release); }
// A sequencer is (re)starting: drop whatever it had scheduled from now on and close its envelopes, so old and new notes never mix.
function clearAhead(envs, pitches, now) {
  for (let i = 0; i < pitches.length; i++) pitches[i].cancelScheduledValues(now);
  for (let i = 0; i < envs.length; i++) { envs[i].cancelScheduledValues(now); envs[i].setTargetAtTime(0, now, 0.02); }
}

// Start or restart the context's clock (not while muted: a muted game leaves the audio hardware alone).
function wake() {
  if (!ctx || muted || ctx.state === 'running' || ctx.state === 'closed') return;
  wokeAt = nowMs();
  try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* stays silent */ }
}
function sleep() {
  if (!ctx || ctx.state === 'closed' || !ctx.suspend) return;
  try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* keeps running, silently */ }
}
function sleepIfMuted() { if (muted) sleep(); }
// One-shots are only scheduled on a running context (or one that is just starting inside the gesture that created it),
// so sounds asked for while the context is blocked or the tab is hidden cannot pile up and all fire at once later.
function live() {
  if (!ctx || muted) return false;
  return ctx.state === 'running' || (ctx.state === 'suspended' && nowMs() - wokeAt < 400);
}

// Linear up to 0.6, then a smooth shoulder that never passes 0.98: the last guard against digital clipping.
function softClipCurve() {
  const n = 2049, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) * 2 - 1) * 2, a = x < 0 ? -x : x;          // the stage before feeds this at half level
    const y = a <= 0.6 ? a : 0.6 + 0.38 * Math.tanh((a - 0.6) / 0.38);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

// ---------------------------------------------------------------- continuous voices (built once)
// A small petrol engine: saw at the firing rate, a square an octave up, a saw an octave down and a breath of noise,
// through one low-pass, chopped a little at half the firing rate so the idle putters.
function buildEngine() {
  const lp = mkFilter('lowpass', 500, 2.5), trem = mkGain(1), out = mkGain(0);
  const o1 = mkOsc('sawtooth', 46), o2 = mkOsc('square', 92), o3 = mkOsc('sawtooth', 23);
  o2.detune.value = 9; o3.detune.value = -7;
  send(o1, lp, 0.5); send(o2, lp, 0.2); send(o3, lp, 0.4);
  const breath = mkFilter('bandpass', 430, 0.8); noiseSrc.connect(breath);
  const ng = send(breath, lp, 0.15);
  const lfo = mkOsc('sine', 23), depth = send(lfo, trem.gain, 0.4);
  lp.connect(trem); trem.connect(out); out.connect(master);
  C.eF1 = ctl(o1.frequency, 46); C.eF2 = ctl(o2.frequency, 92); C.eF3 = ctl(o3.frequency, 23); C.eLfo = ctl(lfo.frequency, 23);
  C.eCut = ctl(lp.frequency, 500); C.eDepth = ctl(depth.gain, 0.4); C.eNoise = ctl(ng.gain, 0.15); C.eVol = ctl(out.gain, 0);
}

// Tyre screech: two narrow bands of noise that wobble.
function buildSkid() {
  const b1 = mkFilter('bandpass', 1050, 8), b2 = mkFilter('bandpass', 1480, 11), out = mkGain(0);
  noiseSrc.connect(b1); noiseSrc.connect(b2); b1.connect(out); send(b2, out, 0.75);
  const w1 = send(mkOsc('sine', 5.7), b1.frequency, 70); w1.connect(b2.frequency);
  const w2 = send(mkOsc('triangle', 0.83), b1.frequency, 110); w2.connect(b2.frequency);
  out.connect(master);
  C.sF1 = ctl(b1.frequency, 1050); C.sF2 = ctl(b2.frequency, 1480); C.sVol = ctl(out.gain, 0);
}

// Two-tone police wail: a square LFO, rounded off so the pitch slides between the two notes.
function buildSiren() {
  const a = mkOsc('sawtooth', 720), b = mkOsc('square', 720); b.detune.value = 8;
  const glide = mkFilter('lowpass', 7, 0);
  send(mkOsc('square', 1.3), glide, 110); glide.connect(a.frequency); glide.connect(b.frequency);
  const lp = mkFilter('lowpass', 1200, 1), hp = mkFilter('highpass', 420, 0), out = mkGain(0);
  send(a, lp, 0.6); send(b, lp, 0.25); lp.connect(hp); hp.connect(out); out.connect(master);
  C.wCut = ctl(lp.frequency, 1200); C.wVol = ctl(out.gain, 0);
}

// Rain: a bright hiss plus a low patter, breathing slowly like gusts.
function buildRain() {
  const hp = mkFilter('highpass', 900, 0), lp = mkFilter('lowpass', 5200, 0), low = mkFilter('bandpass', 360, 0.7);
  const gust = mkGain(1), out = mkGain(0);
  noiseSrc.connect(hp); hp.connect(lp); lp.connect(gust); noiseSrc.connect(low); send(low, gust, 0.6);
  send(mkOsc('sine', 0.19), gust.gain, 0.14);
  gust.connect(out); out.connect(master);
  C.rCut = ctl(lp.frequency, 5200); C.rVol = ctl(out.gain, 0);
}

// Heartbeat: one soft thumping voice, its envelope scheduled by heartbeat().
function buildHeart() {
  const o = mkOsc('triangle', 60), lp = mkFilter('lowpass', 420, 0), vca = mkGain(0), out = mkGain(0);
  o.connect(lp); lp.connect(vca); vca.connect(out); out.connect(master);
  M.heartF = o.frequency; M.heartG = vca.gain; C.hVol = ctl(out.gain, 0);
  hEnv = [M.heartG]; hPitch = [M.heartF];
}

// ---------------------------------------------------------------- music: a step sequencer at 112 BPM
const BPM = 112, STEP = 60 / BPM / 4, LOOP = 128;                     // 16th-note steps, 8 bars of 16
const ROOT = 73.416;                                                  // D2
const hz = semi => ROOT * Math.pow(2, semi / 12);
const BAR_ROOT = [0, 0, -4, -2, 0, 0, -4, -5];                        // Dm Dm Bb C | Dm Dm Bb A
const BAR_THIRD = [3, 3, 4, 4, 3, 3, 4, 4];                           // minor on D; major on Bb, C and the tense A
const BASS_PAT = [0, 0, 12, 0, 0, 12, 0, 7];                          // 8th notes over the bar's root
const ARP_PAT = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 4, 3, 2, 1, 2];     // 16th notes over the chord tones
const DRONE_HZ = new Float32Array(8), BASS_HZ = new Float32Array(64), ARP_HZ = new Float32Array(LOOP), BELL_HZ = new Float32Array(LOOP);
for (let bar = 0; bar < 8; bar++) {
  const r = BAR_ROOT[bar], tones = [0, BAR_THIRD[bar], 7, 12, 12 + BAR_THIRD[bar]];
  DRONE_HZ[bar] = hz(r);
  for (let k = 0; k < 8; k++) BASS_HZ[bar * 8 + k] = hz(r + BASS_PAT[k]);
  for (let k = 0; k < 16; k++) ARP_HZ[bar * 16 + k] = hz(r + 24 + tones[ARP_PAT[k]]);
}
// a few lonely high notes that hang in the echo
BELL_HZ[0] = hz(43); BELL_HZ[40] = hz(39); BELL_HZ[64] = hz(48); BELL_HZ[88] = hz(43); BELL_HZ[104] = hz(39); BELL_HZ[116] = hz(47);

const mTrack = { last: 0, gap: 0, dt: 0 };
let mInt = 0, mNext = 0, mStep = 0, mRun = false;
let mBass = 0, mHat = 0, mHat16 = 0, mKick = 0, mSnare = 0, mArp = 0;

function buildMusic() {
  const bus = mkGain(0); bus.connect(master); C.mVol = ctl(bus.gain, 0);
  // a dotted-eighth echo for the arpeggio and the high notes
  const echo = ctx.createDelay(1); echo.delayTime.value = STEP * 3;
  const damp = mkFilter('lowpass', 2200, 0);
  echo.connect(damp); send(damp, echo, 0.36); send(damp, bus, 0.5);
  // the low pulse
  const kick = mkOsc('triangle', 50), kickV = mkGain(0); kick.connect(kickV); send(kickV, bus, 0.37);
  M.kickF = kick.frequency; M.kickG = kickV.gain;
  // the slow bass note: root, octave and a quiet twelfth, its low-pass drifting slowly
  const dlp = mkFilter('lowpass', 420, 2), dA = mkOsc('sawtooth', ROOT), dB = mkOsc('sawtooth', ROOT * 2), dC = mkOsc('triangle', ROOT * 3);
  dB.detune.value = 9;
  send(dA, dlp, 0.5); send(dB, dlp, 0.32); send(dC, dlp, 0.2);
  send(mkOsc('sine', 0.07), dlp.frequency, 170);
  const dV = send(dlp, bus, 0); C.mDrone = ctl(dV.gain, 0);
  M.droneA = dA.frequency; M.droneB = dB.frequency; M.droneC = dC.frequency;
  // the driving bass line
  const blp = mkFilter('lowpass', 240, 4), bA = mkOsc('sawtooth', ROOT), bB = mkOsc('square', ROOT), bassV = mkGain(0);
  bB.detune.value = -11;
  send(bA, blp, 0.6); send(bB, blp, 0.3); blp.connect(bassV); send(bassV, bus, 0.52);
  M.bassA = bA.frequency; M.bassB = bB.frequency; M.bassCut = blp.frequency; M.bassG = bassV.gain;
  // hi-hat and snare, both cut from the shared noise
  const hatV = mkGain(0), hhp = mkFilter('highpass', 7600, 0); noiseSrc.connect(hhp); hhp.connect(hatV); send(hatV, bus, 0.5);
  const snV = mkGain(0), sbp = mkFilter('bandpass', 1900, 0.8); noiseSrc.connect(sbp); sbp.connect(snV); send(snV, bus, 0.75);
  M.hatG = hatV.gain; M.snareG = snV.gain;
  // the arpeggio
  const alp = mkFilter('lowpass', 2600, 1), aA = mkOsc('square', 294), aB = mkOsc('triangle', 294), arpV = mkGain(0);
  aB.detune.value = 7;
  send(aA, alp, 0.28); send(aB, alp, 0.6); alp.connect(arpV); send(arpV, bus, 0.5); send(arpV, echo, 0.32);
  M.arpA = aA.frequency; M.arpB = aB.frequency; M.arpG = arpV.gain;
  // the lonely high notes
  const bell = mkOsc('sine', 880), bellV = mkGain(0); bell.connect(bellV); send(bellV, bus, 0.16); send(bellV, echo, 0.3);
  M.bellF = bell.frequency; M.bellG = bellV.gain;
  mEnv = [M.kickG, M.bassG, M.hatG, M.snareG, M.arpG, M.bellG];
  mPitch = [M.kickF, M.droneA, M.droneB, M.droneC, M.bassA, M.bassB, M.bassCut, M.arpA, M.arpB, M.bellF];
}

// Schedule everything that sounds on 16th-note step i (0..127) at AudioContext time t.
function musicStep(i, t) {
  const bar = i >> 4, s = i & 15;
  if (s === 0) {                                                       // the slow bass note follows the chord
    const f = DRONE_HZ[bar];
    M.droneA.setTargetAtTime(f, t, 0.05); M.droneB.setTargetAtTime(f * 2, t, 0.05); M.droneC.setTargetAtTime(f * 3, t, 0.05);
  }
  // sparse pulse: the downbeat and a push before beat 4; it fills in to four-on-the-floor as the chase heats up
  let k = s === 0 ? 1 : s === 10 ? 0.6 : 0;
  if (s && (s & 3) === 0 && mKick * 0.85 > k) k = mKick * 0.85;
  if (k > 0.02) { M.kickF.setValueAtTime(150, t); M.kickF.exponentialRampToValueAtTime(48, t + 0.1); hit(M.kickG, k, t, 0.002, 0.05, 0.07); }
  if (mBass > 0.02 && (s & 1) === 0) {                                 // driving 8th-note bass, brighter with intensity
    const f = BASS_HZ[bar * 8 + (s >> 1)];
    M.bassA.setValueAtTime(f, t); M.bassB.setValueAtTime(f, t);
    M.bassCut.setTargetAtTime(700 + 1300 * mArp + 500 * mBass, t, 0.004); M.bassCut.setTargetAtTime(230, t + 0.02, 0.07);
    hit(M.bassG, mBass * (s & 3 ? 0.8 : 1), t, 0.003, 0.07, 0.055);
  }
  if (mHat > 0.02) {                                                   // hat: off-beats first, then every 8th, then 16ths
    const v = (s & 3) === 2 ? 1 : (s & 1) === 0 ? 0.45 : 0.5 * mHat16;
    if (v > 0.02) hit(M.hatG, v * mHat, t, 0.001, 0.008, 0.013);
  }
  if (mSnare > 0.02 && (s === 4 || s === 12)) hit(M.snareG, mSnare, t, 0.001, 0.02, 0.045);
  if (mArp > 0.02) {
    const f = ARP_HZ[i];
    M.arpA.setValueAtTime(f, t); M.arpB.setValueAtTime(f, t);
    hit(M.arpG, mArp * (s & 3 ? 0.7 : 1), t, 0.003, 0.045, 0.05);
  }
  if (BELL_HZ[i] > 0) { M.bellF.setValueAtTime(BELL_HZ[i], t); hit(M.bellG, 1 - 0.45 * mBass, t, 0.004, 0.05, 0.45); }
}

// ---------------------------------------------------------------- setup, mute, music switch
// Create the AudioContext and every continuous voice, or resume a suspended context. Call it from user gestures; safe to repeat.
export function initAudio() {
  if (ctx) { wake(); return; }
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AC) return;
  try {
    ctx = new AC();
    master = mkGain(muted ? 0 : 1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 10; comp.attack.value = 0.004; comp.release.value = 0.2;
    const out = mkGain(LEVEL.out * 0.5), clip = ctx.createWaveShaper(); clip.curve = softClipCurve();
    master.connect(comp); comp.connect(out); out.connect(clip); clip.connect(ctx.destination); outNode = clip;
    sfxBus = mkGain(LEVEL.sfx); sfxBus.connect(master);
    // one buffer of white noise shared by every noisy sound, and one looping source of it for the continuous voices
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SEC), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = noiseBuf; noiseSrc.loop = true; noiseSrc.start();
    buildEngine(); buildSkid(); buildSiren(); buildRain(); buildHeart(); buildMusic();
    wokeAt = nowMs(); if (muted) sleep(); else wake();
  } catch (e) {
    try { if (ctx && ctx.close) ctx.close(); } catch (e2) { /* nothing to do */ }
    ctx = null; master = null; sfxBus = null; outNode = null; noiseBuf = null; noiseSrc = null; analyser = null;
  }
}

// Mute or unmute everything. Works before initAudio() too: the choice is remembered. While muted the context is
// suspended (after a short fade), so a muted game costs no audio CPU; unmuting resumes it (do that from a user gesture).
export function setMuted(m) {
  muted = !!m;
  if (!ctx || !master) return;
  try {
    master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.03);
    if (muted) setTimeout(sleepIfMuted, 250); else wake();
  } catch (e) { /* stays as it is */ }
}
// True while everything is muted.
export function isMuted() { return muted; }

// Switch the music bed on or off (sound effects are not affected). Works before initAudio() too.
export function setMusicOn(on) {
  musicOn = !!on;
  // fade at once, even if music() is not being called right now
  try { if (ctx && !musicOn && C.mVol && ctx.state === 'running') aim(C.mVol, 0, 0.12); } catch (e) { /* music() will do it */ }
}
// True while the music bed is switched on.
export function isMusicOn() { return musicOn; }

// ---------------------------------------------------------------- per-frame voices
// Each of these returns at once unless the context is running, and catches its own errors: sound must never break a frame.
const GEAR_AT = [0.35, 0.6, 0.85];            // speedFrac where the engine changes up
const GEAR_RPM = [0.1, 0.52, 0.6, 0.66];      // revs (0..1) right after changing into each gear
let gear = 0, shiftUntil = 0;

// Engine of the local car; call every frame. speedFrac = |speed| / top speed (0..1.35 with nitro), throttle 0..1,
// on = false silences it. Revs climb through four gears and drop back at about 0.35, 0.6 and 0.85.
export function engine(speedFrac, throttle, on) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const s = speedFrac > 0 ? (speedFrac < 1.5 ? speedFrac : 1.5) : 0, th = clamp01(throttle);
    let up = false;
    while (gear < 3 && s > GEAR_AT[gear]) { gear++; up = true; }
    while (gear > 0 && s < GEAR_AT[gear - 1] - 0.03) gear--;            // a little hysteresis, so it does not hunt between gears
    const lo = gear ? GEAR_AT[gear - 1] : 0, hi = gear < 3 ? GEAR_AT[gear] : 1.15;
    let rpm = GEAR_RPM[gear] + (1 - GEAR_RPM[gear]) * (s - lo) / (hi - lo);
    if (gear === 0 && rpm < 0.1 + 0.2 * th) rpm = 0.1 + 0.2 * th;       // blip the throttle at a standstill
    rpm += 0.04 * th; if (rpm > 1.25) rpm = 1.25;
    const f = 36 + 100 * rpm, r1 = rpm < 1 ? rpm : 1;                   // firing rate: 46 Hz at idle, about 140 Hz flat out
    aim(C.eF1, f, 0.06); aim(C.eF2, f * 2, 0.06); aim(C.eF3, f * 0.5, 0.06); aim(C.eLfo, f * 0.5, 0.06);
    aim(C.eCut, 480 + 700 * rpm + 1600 * th * (0.35 + 0.65 * r1), 0.1);
    aim(C.eDepth, 0.42 - 0.26 * r1, 0.1);
    aim(C.eNoise, 0.12 + 0.4 * th, 0.1);
    const now = ctx.currentTime;
    if (up) shiftUntil = now + 0.09;                                    // lift off for a moment on the change up
    let vol = on ? LEVEL.engine * (0.3 + 0.45 * th + 0.25 * r1) : 0;
    if (now < shiftUntil) vol *= 0.55;
    aim(C.eVol, vol, on ? 0.05 : 0.09);
  } catch (e) { /* stays as it was */ }
}

// Tyre screech loop, 0..1.
export function skid(level) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const lv = clamp01(level);
    aim(C.sVol, LEVEL.skid * Math.sqrt(lv) * (0.5 + 0.5 * lv), 0.06);
    if (lv > 0) { aim(C.sF1, 950 + 250 * lv, 0.1); aim(C.sF2, 1350 + 250 * lv, 0.1); }
  } catch (e) { /* stays as it was */ }
}

// Loudness of the nearest police siren, 0..1 (0 = silent). Nearer also sounds brighter.
export function siren(level) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const lv = clamp01(level);
    aim(C.wVol, LEVEL.siren * lv, 0.15);
    if (lv > 0) aim(C.wCut, 800 + 2200 * lv, 0.2);
  } catch (e) { /* stays as it was */ }
}

const hbTrack = { last: 0, gap: 0, dt: 0 };
let hbNext = 0, hbOn = false;
// Heartbeat while hiding, 0..1: a soft double thump, about 60 beats a minute rising to 150, louder with level. Call every frame.
export function heartbeat(level) {
  if (!ctx) return;
  if (ctx.state !== 'running') { hbOn = false; return; }
  try {
    const lv = clamp01(level);
    aim(C.hVol, lv > 0 ? LEVEL.heart * (0.4 + 0.6 * lv) : 0, 0.1);
    const now = ctx.currentTime, ahead = lookAhead(hbTrack, now);
    if (lv <= 0 || muted) { hbOn = false; return; }
    if (!hbOn || hbNext < now - 0.2) { hbOn = true; hbNext = now + 0.05; clearAhead(hEnv, hPitch, now); }
    while (hbNext < now + ahead) {
      const period = 60 / (60 + 90 * lv);
      if (hbNext > now + 0.004) {
        const t2 = hbNext + 0.16 + 0.2 * (period - 0.4);                // lub ... dub
        M.heartF.setValueAtTime(150, hbNext); M.heartF.exponentialRampToValueAtTime(62, hbNext + 0.09); hit(M.heartG, 1, hbNext, 0.005, 0.03, 0.04);
        M.heartF.setValueAtTime(128, t2); M.heartF.exponentialRampToValueAtTime(56, t2 + 0.09); hit(M.heartG, 0.7, t2, 0.005, 0.03, 0.045);
      }
      hbNext += period;
    }
  } catch (e) { hbOn = false; }
}

// Steady rain, 0..1.
export function rain(level) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const lv = clamp01(level);
    aim(C.rVol, LEVEL.rain * lv * (0.5 + 0.5 * lv), 0.4);
    if (lv > 0) aim(C.rCut, 3800 + 3000 * lv, 0.5);
  } catch (e) { /* stays as it was */ }
}

// The music bed; call every frame with intensity 0..1. 0 is silence; from about 0.1 a sparse low pulse and a slow
// minor-key bass note; then a driving 8th-note bass (fading in from 0.3 to 0.5), hi-hat (0.45 to 0.6), four-on-the-floor
// kick and snare (0.5 to 0.8) and an arpeggio (0.6 to 0.8). Layers fade with a time constant of about 0.6 s and never
// click. Silent while the music is switched off or everything is muted.
export function music(intensity) {
  if (!ctx) return;
  if (ctx.state !== 'running') { mRun = false; return; }
  try {
    const allowed = musicOn && !muted, now = ctx.currentTime, ahead = lookAhead(mTrack, now);
    const goal = allowed ? clamp01(intensity) : 0;
    mInt += (goal - mInt) * (1 - Math.exp(-mTrack.dt / 0.6));
    if (goal === 0 && mInt < 0.003) mInt = 0;
    aim(C.mVol, allowed ? LEVEL.music * smooth(0, 0.08, mInt) : 0, 0.12);
    if (!allowed || mInt === 0) { mRun = false; return; }
    mBass = smooth(0.28, 0.5, mInt); mHat = smooth(0.42, 0.62, mInt); mHat16 = smooth(0.7, 0.9, mInt);
    mKick = smooth(0.5, 0.72, mInt); mSnare = smooth(0.6, 0.8, mInt); mArp = smooth(0.58, 0.82, mInt);
    aim(C.mDrone, 0.16 - 0.05 * mBass, 0.15);
    if (!mRun || mNext < now - 0.3) {                                  // (re)start: come in on the downbeat of the next bar
      mRun = true; mNext = now + 0.06; mStep = (((mStep + 15) >> 4) << 4) % LOOP; clearAhead(mEnv, mPitch, now);
    }
    while (mNext < now + ahead) {
      if (mNext > now + 0.004) musicStep(mStep, mNext);
      mStep = (mStep + 1) % LOOP; mNext += STEP;
    }
  } catch (e) { mRun = false; }
}

// ---------------------------------------------------------------- one-shots
const lastShot = Object.create(null);
// False when the same sound was started less than sec ago (stops a burst of calls from stacking up).
function spaced(name, sec) {
  const t = ctx.currentTime, was = lastShot[name];
  if (was !== undefined && t >= was && t - was < sec) return false;
  lastShot[name] = t; return true;
}
// A plucked tone: quick attack, then it dies away over dur. slideTo bends the pitch.
function tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slideTo = 0) {
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  if (vol < 0.0002) vol = 0.0002;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.05);
  o.onended = () => { g.disconnect(); };
}
// A held tone: fades in fast, stays level, fades out fast (horns and radio blips).
function held(freq, dur, type, vol, when = 0) {
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.setValueAtTime(vol, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.05);
  o.onended = () => { g.disconnect(); };
}
// A burst of filtered noise from the shared buffer: the filter sweeps f0 -> f1, the level peaks after attack and dies by dur.
function burst(dur, vol, when, type, f0, f1, q, attack) {
  const t = ctx.currentTime + when, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  if (vol < 0.0002) vol = 0.0002;
  s.buffer = noiseBuf; s.loop = true;
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxBus);
  s.start(t, Math.random() * (NOISE_SEC - 0.2)); s.stop(t + dur + 0.05);
  s.onended = () => { g.disconnect(); };
}
// A roller shutter: slats clattering past (a train of noise pulses through a sliding band and a ringing resonance).
function shutterRattle(down) {
  const t0 = ctx.currentTime + (down ? 0 : 0.07), n = 13, gapSec = 0.036;
  const s = ctx.createBufferSource(), band = ctx.createBiquadFilter(), ring = ctx.createBiquadFilter(), g = ctx.createGain();
  const fa = down ? 2700 : 750, fb = down ? 750 : 2700, end = t0 + n * gapSec;
  s.buffer = noiseBuf; s.loop = true;
  band.type = 'bandpass'; band.Q.value = 2.2; band.frequency.setValueAtTime(fa, t0); band.frequency.exponentialRampToValueAtTime(fb, end);
  ring.type = 'bandpass'; ring.Q.value = 16; ring.frequency.setValueAtTime(fa * 0.6, t0); ring.frequency.exponentialRampToValueAtTime(fb * 0.6, end);
  g.gain.setValueAtTime(0, t0);
  for (let k = 0; k < n; k++) {
    const t = t0 + k * gapSec, pk = (down ? 0.6 + 0.28 * k / n : 0.88 - 0.32 * k / n) * (k & 1 ? 0.8 : 1);
    g.gain.linearRampToValueAtTime(pk, t + 0.005); g.gain.linearRampToValueAtTime(pk * 0.12, t + gapSec);
  }
  g.gain.linearRampToValueAtTime(0, end + 0.05);
  s.connect(band); band.connect(g); s.connect(ring); const rg = ctx.createGain(); rg.gain.value = 2.2; ring.connect(rg); rg.connect(g); g.connect(sfxBus);
  s.start(t0, Math.random() * (NOISE_SEC - 0.2)); s.stop(end + 0.1);
  s.onended = () => { g.disconnect(); };
  return n * gapSec + (down ? 0 : 0.07);
}
// Thunder: a crack, then a long low rumble that rolls away.
function thunderRoll() {
  const t0 = ctx.currentTime, dur = 2.6;
  const s = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  lp.type = 'lowpass'; lp.Q.value = 0; lp.frequency.setValueAtTime(900, t0); lp.frequency.exponentialRampToValueAtTime(240, t0 + 0.5); lp.frequency.exponentialRampToValueAtTime(110, t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(2.2, t0 + 0.04); g.gain.linearRampToValueAtTime(1.0, t0 + 0.3);
  for (let k = 0; k < 5; k++) {                                         // the roll: uneven swells, each a little weaker
    const t = t0 + 0.42 + k * 0.4 + Math.random() * 0.12, fade = 1 - k / 6.5;
    g.gain.linearRampToValueAtTime((1.6 + Math.random() * 1.3) * fade, t); g.gain.linearRampToValueAtTime((0.7 + Math.random() * 0.4) * fade, t + 0.2);
  }
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  s.connect(lp); lp.connect(g); g.connect(sfxBus);
  s.start(t0, Math.random() * (NOISE_SEC - 0.2)); s.stop(t0 + dur + 0.1);
  s.onended = () => { g.disconnect(); };
  burst(0.25, 0.5, 0, 'bandpass', 1500, 320, 0.7, 0.008);
  tone(70, 1.4, 'sine', 0.3, 0.02, 36);
}
// Wrap a one-shot so it is silent before initAudio(), while muted or suspended, and can never throw into the game.
function shot(fn) { return function (a) { if (!live()) return; try { fn(a); } catch (e) { /* a sound must never break the game */ } }; }

// Short one-shot effects. Each is a function; crash takes a strength 0..1.
export const sfx = {
  // menu click
  click: shot(() => { tone(660, 0.05, 'triangle', 0.15); }),
  // one tick of the robbing timer
  tick: shot(() => { if (spaced('tick', 0.04)) tone(1500, 0.03, 'square', 0.07); }),
  // loot banked
  coin: shot(() => { tone(988, 0.09, 'square', 0.16); tone(1319, 0.28, 'square', 0.16, 0.08); }),
  // the big score
  jackpot: shot(() => { [659, 784, 988, 1319, 1568].forEach((f, k) => tone(f, 0.22, 'square', 0.15, k * 0.09)); tone(2637, 0.5, 'sine', 0.05, 0.45); }),
  // loot picked up
  grab: shot(() => { tone(520, 0.08, 'triangle', 0.25); tone(780, 0.14, 'triangle', 0.25, 0.07); burst(0.09, 0.3, 0, 'bandpass', 1800, 3600, 1.2, 0.02); }),
  // burglar alarm
  alarm: shot(() => { if (!spaced('alarm', 0.3)) return; for (let k = 0; k < 6; k++) { tone(k % 2 ? 880 : 1040, 0.13, 'square', 0.14, k * 0.14); tone(k % 2 ? 1766 : 2087, 0.1, 'square', 0.03, k * 0.14); } }),
  // a witness rings the bell
  bell: shot(() => { tone(1400, 0.5, 'sine', 0.2); tone(2100, 0.35, 'sine', 0.1); tone(3530, 0.18, 'sine', 0.04); }),
  // the clock tower
  chime: shot(() => { [523, 659, 784, 1046].forEach((f, k) => { tone(f, 1.4, 'sine', 0.2, k * 0.42); tone(f * 2, 0.9, 'sine', 0.05, k * 0.42); }); }),
  // busted: a police whistle, then the heart sinks
  caught: shot(() => { tone(2300, 0.5, 'square', 0.14); tone(2500, 0.5, 'square', 0.1, 0.02); tone(140, 0.5, 'sawtooth', 0.3, 0.5, 60); }),
  // sprung from the lock-up
  free: shot(() => { tone(180, 0.1, 'square', 0.25); tone(360, 0.12, 'square', 0.2, 0.1); tone(720, 0.3, 'triangle', 0.2, 0.2); }),
  // a hideout shutter rattles down and lands (about 0.5 s)
  shutter: shot(() => {
    if (!spaced('shutter', 0.25)) return;
    const end = shutterRattle(true);
    tone(118, 0.18, 'sine', 0.34, end, 46); burst(0.12, 0.7, end, 'lowpass', 1400, 260, 0.7, 0.004);
    tone(523, 0.16, 'square', 0.035, end); tone(1371, 0.1, 'square', 0.02, end);
  }),
  // ... and rattles back up
  unshutter: shot(() => {
    if (!spaced('shutter', 0.25)) return;
    tone(170, 0.07, 'square', 0.12, 0, 92); burst(0.04, 0.32, 0, 'highpass', 2400, 2400, 0.7, 0.003);
    const end = shutterRattle(false);
    tone(1371, 0.12, 'square', 0.02, end); tone(820, 0.1, 'square', 0.03, end);
  }),
  // a heavy lever thrown
  lever: shot(() => {
    burst(0.035, 0.34, 0, 'highpass', 2600, 2600, 0.7, 0.002); tone(175, 0.09, 'square', 0.15, 0.01, 88);
    burst(0.06, 0.5, 0.1, 'bandpass', 1500, 900, 2, 0.003); tone(98, 0.17, 'triangle', 0.24, 0.11, 58); tone(1730, 0.25, 'sine', 0.03, 0.11);
  }),
  // hitting something: a thud plus a burst of crunching noise, both scaled by strength 0..1
  crash: shot(strength => {
    if (!spaced('crash', 0.09)) return;
    const s = strength === undefined ? 0.6 : clamp01(strength);
    if (s < 0.02) return;
    tone(135, 0.2 + 0.2 * s, 'sine', 0.52 * s, 0, 42);
    burst(0.12 + 0.3 * s, 1.25 * s, 0, 'lowpass', 3400, 240, 0.7, 0.004);
    if (s > 0.45) { burst(0.28, 0.9 * s, 0.015, 'bandpass', 4300, 2500, 3, 0.004); tone(310, 0.12, 'square', 0.08 * s, 0.01, 180); }
  }),
  // two-tone car horn (0.35 s)
  horn: shot(() => { if (!spaced('horn', 0.2)) return; held(415, 0.35, 'sawtooth', 0.13); held(523, 0.35, 'sawtooth', 0.105); held(832, 0.35, 'square', 0.03); }),
  // nitro: a whoosh with a rising whine under it
  nitro: shot(() => { if (!spaced('nitro', 0.3)) return; burst(0.95, 1.15, 0, 'bandpass', 380, 3600, 1.4, 0.28); burst(0.5, 0.4, 0, 'highpass', 5000, 7000, 0.7, 0.05); tone(150, 0.75, 'sawtooth', 0.05, 0, 640); }),
  // the police have seen you
  spotted: shot(() => { tone(880, 0.1, 'square', 0.16); tone(1175, 0.2, 'square', 0.16, 0.1); }),
  // the bust meter climbing: a short rising warning blip
  bustTick: shot(() => { tone(740, 0.1, 'square', 0.15, 0, 1480); }),
  // police radio: squelch, three blips, squelch
  radio: shot(() => {
    if (!spaced('radio', 0.3)) return;
    burst(0.07, 0.45, 0, 'bandpass', 2300, 2300, 0.8, 0.004);
    held(1320, 0.055, 'square', 0.06, 0.09); held(990, 0.055, 'square', 0.06, 0.17); held(1320, 0.07, 'square', 0.06, 0.25);
    burst(0.3, 0.1, 0.08, 'bandpass', 1700, 1700, 0.7, 0.02);
    burst(0.14, 0.5, 0.34, 'bandpass', 2700, 1500, 0.8, 0.004);
  }),
  // a long low rolling rumble (about 2.5 s)
  thunder: shot(() => { if (spaced('thunder', 0.5)) thunderRoll(); }),
  // round won
  win: shot(() => { [523, 659, 784, 1046, 1319].forEach((f, k) => tone(f, 0.4, 'triangle', 0.22, k * 0.13)); }),
  // round lost
  lose: shot(() => { [392, 330, 262, 196].forEach((f, k) => tone(f, 0.5, 'sawtooth', 0.16, k * 0.2)); }),
};

// ---------------------------------------------------------------- debugging
// Current output level as RMS 0..1, measured after the limiter (0 when audio is not running). For previews and tests only:
// the analyser is created on the first call, so the game never pays for it.
export function _debugLevel() {
  if (!ctx || !outNode || ctx.state !== 'running') { lastPeak = 0; return 0; }
  try {
    if (!analyser) {
      analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
      outNode.connect(analyser); scope = new Float32Array(analyser.fftSize);
    }
    if (!analyser.getFloatTimeDomainData) return 0;
    analyser.getFloatTimeDomainData(scope);
    let sum = 0, pk = 0;
    for (let i = 0; i < scope.length; i++) { const v = scope[i], a = v < 0 ? -v : v; sum += v * v; if (a > pk) pk = a; }
    lastPeak = pk;
    const rms = Math.sqrt(sum / scope.length);
    return rms < 1 ? rms : 1;
  } catch (e) { return 0; }
}
// Largest absolute sample seen by the last _debugLevel() call (1 would be clipping).
export function _debugPeak() { return lastPeak; }

// A hidden tab stops calling the per-frame functions, so stop the sound there and bring it back with the tab.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    try {
      if (document.hidden) { if (ctx.state === 'running') { pausedByHide = true; sleep(); } }
      else if (pausedByHide) { pausedByHide = false; wake(); }
    } catch (e) { /* stays as it is */ }
  });
}
