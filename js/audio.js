// All sound is synthesised with WebAudio, so the game ships no audio files.
let ctx = null, master = null, sirenGain = null, sirenOsc = null, sirenLfo = null, muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
    // a two-tone siren that is always running; its volume follows how hard you are being chased
    sirenOsc = ctx.createOscillator(); sirenOsc.type = 'sawtooth'; sirenOsc.frequency.value = 660;
    sirenLfo = ctx.createOscillator(); sirenLfo.type = 'square'; sirenLfo.frequency.value = 1.6;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 140; sirenLfo.connect(lfoGain); lfoGain.connect(sirenOsc.frequency);
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 1500;
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
    sirenOsc.connect(filt); filt.connect(sirenGain); sirenGain.connect(master);
    sirenOsc.start(); sirenLfo.start();
  } catch (e) { ctx = null; }
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export function isMuted() { return muted; }
export function setSiren(level) { if (ctx && sirenGain) sirenGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.11, ctx.currentTime, 0.15); }

function tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slideTo = null) {
  if (!ctx) return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  coin() { tone(988, 0.09, 'square', 0.16); tone(1319, 0.28, 'square', 0.16, 0.08); },
  jackpot() { [659, 784, 988, 1319, 1568].forEach((f, k) => tone(f, 0.22, 'square', 0.15, k * 0.09)); },
  grab() { tone(520, 0.08, 'triangle', 0.25); tone(780, 0.14, 'triangle', 0.25, 0.07); },
  tick() { tone(1500, 0.03, 'square', 0.05); },
  alarm() { for (let k = 0; k < 6; k++) tone(k % 2 ? 880 : 1040, 0.13, 'square', 0.14, k * 0.14); },
  bell() { tone(1400, 0.5, 'sine', 0.2); tone(2100, 0.35, 'sine', 0.1); },
  chime() { [523, 659, 784, 1046].forEach((f, k) => { tone(f, 1.4, 'sine', 0.2, k * 0.42); tone(f * 2, 0.9, 'sine', 0.05, k * 0.42); }); },
  caught() { tone(2300, 0.5, 'square', 0.14); tone(2500, 0.5, 'square', 0.1, 0.02); tone(140, 0.5, 'sawtooth', 0.3, 0.5, 60); },
  free() { tone(180, 0.1, 'square', 0.25); tone(360, 0.12, 'square', 0.2, 0.1); tone(720, 0.3, 'triangle', 0.2, 0.2); },
  hide() { tone(300, 0.14, 'sine', 0.18, 0, 160); },
  pipe() { tone(120, 0.5, 'sawtooth', 0.14, 0, 60); },
  win() { [523, 659, 784, 1046, 1319].forEach((f, k) => tone(f, 0.4, 'triangle', 0.22, k * 0.13)); },
  lose() { [392, 330, 262, 196].forEach((f, k) => tone(f, 0.5, 'sawtooth', 0.16, k * 0.2)); },
  spotted() { tone(880, 0.1, 'square', 0.14); tone(1175, 0.2, 'square', 0.14, 0.1); },
  click() { tone(660, 0.05, 'triangle', 0.15); },
};
