// Tunable game numbers. Distances are in map units (1 unit = 5 metres), speeds in units per second, times in seconds.
// Car handling numbers live in js/vehicle.js (CAR, NITRO).
export const CFG = {
  ROUND: 240,          // length of a round
  COUNT: 5,            // police wait in the thana yard this long before they may move
  JACKPOT_AT: 45,      // the three tijoris unlock when the clock tower chimes
  COACH_OPEN: 120,     // the mail coach strongbox is open for 45 seconds
  COACH_CLOSE: 165,
  OVERTIME: 30,        // extra seconds if a chor is carrying the winning loot when the clock runs out

  NITRO: { DRAIN: 0.4, REGEN: 0.04, DELAY: 1.2, MIN: 0.2, BANK: 0.5, NEAR_MISS: 0.1 },   // the tank runs from 0 to 1
  CARRY_SLOW: 0.03, CARRY_SLOW_JACKPOT: 0.08,               // top speed lost per bag carried
  KMH: 26,                                                  // what one unit/second shows as on the speedometer

  COP_CRUISE: 1.7, COP_RESPOND: 2.8, COP_CHASE: 3.1,   // an empty getaway car tops out at 3.4, a loaded one at about 3.2
  VISION: 12, VISION_DARK: 8, DARK_SPEED: 2.0, VISION_PARK: 0.72, FOV: 60 * Math.PI / 180, NEAR: 2.2, NOISE_RANGE: 6,

  // the bust meter fills while a police vehicle is within RANGE of a car going slower than VSAFE
  BUST: { RANGE: 1.6, RATE: 0.9, VSAFE: 2.6, VSTOP: 0.6, EXTRA: 0.4, DRAIN: 0.5, GALI: 0.35, GALI_RANGE: 6 },

  ROB_RANGE: 1.5, ROB_SPEED: 0.5,      // stop inside the gold ring and the job starts by itself
  HOLD: { 1: 3, 2: 6, 3: 10 },         // seconds stopped, by loot tier
  VALUE: { 1: 150, 2: 350, 3: 900 },
  SIREN_AT: 0.35,                      // a tijori's siren starts this far into the job
  BANK_RANGE: 2.2, BANK_SPEED: 1.4, BANK_HOLD: 1.2, BANK_CLEAR: 2.5, BANK_IMMUNE: 3, CAMP: 4,
  LEVER_RANGE: 1.8, LEVER_HOLD: 2.5,

  HIDE: {
    RANGE: 2.1, SPEED: 2.8,            // how near the door and how slow you must be to be let in
    IN: 1.5, IN_GROVE: 1.0, OUT: 0.6,  // seconds for the swing-in and the roll-out
    COOL: 7, COOL_NITRO: 10,           // seconds until a parked engine is cold
    SEARCH: 3.0, TOUCH: 2.2,           // a search takes SEARCH seconds; the officer touches the bonnet at TOUCH
    COLD_FIND: 5.0,                    // a police player who keeps searching this long finds even a cold car
    INFORMER: 25,                      // hide this long and an informer gives your door away (not on the first night)
    DOORS: 16,                         // jeeps that lose you check the doors within this distance of where they last saw you
    SLIP: 1.2, BURST: 2.4,             // speed you leave at
  },

  JAIL_SOLO: 10,       // one-chor games: car released after this long, third bust ends the round
  JAIL_MULTI: 35,      // team games: released if nobody stops at a lever
  MAX_ARRESTS_SOLO: 3,
  IMMUNE: 4, LEVER_LOCK: 15, RELOCK: 25,
  TIP_EVERY: 12, TIP_EVERY_JACKPOT: 8,   // carrying loot through lit streets gets you reported this often
  HEAT_MAX: 5,

  MAX_PLAYERS: 8, PROTO: 5,
};

// ------------------------------------------------------------------ a round can bend the numbers
// The host decides what is different tonight (a longer round, loot worth more, engines that cool slowly...) and
// sends it with the start of the round; every player applies the same changes with applyRules().
const BASE = JSON.parse(JSON.stringify(CFG));
export function applyRules(r) {
  for (const k of Object.keys(BASE)) { if (BASE[k] && typeof BASE[k] === 'object') Object.assign(CFG[k], BASE[k]); else CFG[k] = BASE[k]; }   // back to the standard numbers
  if (!r) return;
  const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  CFG.ROUND = r.round ? num(r.round, 120, 420, BASE.ROUND) : BASE.ROUND;
  CFG.COACH_OPEN = Math.round(CFG.ROUND * 0.5); CFG.COACH_CLOSE = CFG.COACH_OPEN + 45;
  CFG.JACKPOT_AT = num(r.jackpotAt, 0, 120, BASE.JACKPOT_AT);
  const hold = num(r.holdMul, 0.3, 2, 1), loot = num(r.lootMul, 0.5, 3, 1), cool = num(r.coolMul, 0.3, 3, 1);
  for (const t of [1, 2, 3]) { CFG.HOLD[t] = BASE.HOLD[t] * hold; CFG.VALUE[t] = Math.round(BASE.VALUE[t] * loot / 10) * 10; }
  CFG.HIDE.COOL = BASE.HIDE.COOL * cool; CFG.HIDE.COOL_NITRO = BASE.HIDE.COOL_NITRO * cool;
  CFG.HIDE.INFORMER = num(r.informerAt, 6, 60, BASE.HIDE.INFORMER);
  CFG.NITRO.REGEN = BASE.NITRO.REGEN * num(r.nitroMul, 0.1, 8, 1);
}

// ------------------------------------------------------------------ towns
// `officers`: who drives the computer jeeps (dealt out afresh every round, so the bust messages name different people)
export const TOWNS = [
  { id: '', name: 'Jugnupur', country: 'India', officers: ['Insp. Tiwari', 'Havaldar Pandu', 'Daroga Shamsher', 'SI Bhola', 'Hav. Tukaram', 'Insp. Rathore', 'Sipahi Lallan', 'Daroga Yadav', 'SI Meena', 'Insp. Durga', 'Hav. Ganpat', 'SI Kiran'] },
  { id: 'hotaru', name: 'Hotaru-cho', country: 'Japan', officers: ['Junsa Sato', 'Junsa Tanaka', 'Keibu Yamada', 'Junsa Suzuki', 'Keibu-ho Ito', 'Junsa Kimura', 'Keibu Mori', 'Junsa Ono', 'Junsa-cho Abe', 'Keibu Hayashi', 'Junsa Ogawa', 'Junsa Endo'] },
  { id: 'lucciola', name: 'Porto Lucciola', country: 'Italy', officers: ['Isp. Russo', 'Agente Bianchi', 'Comm. Ferrari', 'Agente Esposito', 'Isp. Romano', 'Agente Colombo', 'Brig. Ricci', 'Agente Marino', 'Isp. Greco', 'Agente Conti', 'Brig. De Luca', 'Agente Costa'] },
];
export const townName = id => { const t = TOWNS.find(q => q.id === id); return t ? t.name : 'Jugnupur'; };

// ------------------------------------------------------------------ rooms: levels, nights and twists
// A room has a level from 1 to 10. Higher levels mean more jeeps, faster and sharper police and a bigger target.
export const LEVEL_NAMES = ['', 'Aasaan', 'Aasaan', 'Theek-thaak', 'Theek-thaak', 'Mushkil', 'Mushkil', 'Khatarnak', 'Khatarnak', 'Namumkin', 'Namumkin'];
export function roomSetup(nChors, nHumanPolice, level) {
  const L = Math.max(1, Math.min(10, level | 0 || 3)), n = Math.max(1, Math.min(8, nChors | 0));
  const base = [0, 800, 1300, 1700, 2000, 2200, 2300, 2300, 2300][n];
  const wanted = [0, 3, 3, 4, 4, 5, 5, 5, 5][n] + Math.floor((L - 3) / 2);   // levels 1-2 one jeep fewer, 5-6 one more, 7-8 two, 9-10 three
  // computer jeeps are easier to fool than a person, so one police player stands in for two of them
  return {
    level: L, target: Math.round(base * (0.82 + 0.06 * L) / 50) * 50,
    cops: Math.max(0, Math.min(7, Math.max(1, wanted)) - 2 * nHumanPolice),
    speedMul: Math.min(0.9 + 0.016 * (L - 1), 1.05), visionMul: Math.min(1 + 0.03 * (L - 1), 1.27),
    bustMul: Math.min(0.75 + 0.05 * (L - 1), 1.15), tipMul: Math.max(0.8, 1.4 - 0.08 * (L - 1)),
    rain: 0, informer: L >= 2, par: 150, name: '',
  };
}
// What kind of night it is. Picked at random for each round when the room has surprises switched on.
//   w how often it comes up, minLevel the lowest level it appears at; the rest are its effects.
export const NIGHT_KINDS = [
  { id: 'saaf', name: 'Saaf Raat', blurb: 'A clear night.', w: 3 },
  { id: 'barsaat', name: 'Barsaat', blurb: 'Rain. Wet roads slide, and the police see less.', w: 2, rain: 0.85, grip: 0.62, vision: 0.9 },
  { id: 'toofan', name: 'Toofani Raat', blurb: 'Storm. Very slippery, short sight, few witnesses about.', w: 1, minLevel: 3, rain: 1, grip: 0.5, vision: 0.82, tip: 1.5 },
  { id: 'kohra', name: 'Kohra', blurb: 'Fog. Nobody sees far tonight.', w: 2, fog: [2, 20], vision: 0.68 },
  { id: 'bijli', name: 'Bijli Gul', blurb: 'Power cut. The street lamps are out.', w: 1.5, dark: 1, vision: 0.78 },
  { id: 'mela', name: 'Mela ki Raat', blurb: 'Festival night. The tills are full, and so are the streets.', w: 1.5, loot: 1.25, tip: 0.6 },
  { id: 'purnima', name: 'Purnima', blurb: 'Full moon. The police see further.', w: 1.5, vision: 1.2, bright: 1 },
];
// One odd rule for the round, on most nights.
export const TWISTS = [
  { id: 'tez', name: 'Tez Gaadiyan', blurb: 'Every engine in town is tuned: all cars are faster.', car: 1.12 },
  { id: 'nitro', name: 'Nitro ki Barsaat', blurb: 'Nitro refills four times as fast.', nitro: 4 },
  { id: 'sookha', name: 'Sookha Tank', blurb: 'Nitro hardly refills by itself. Drift for it.', nitro: 0.3 },
  { id: 'garam', name: 'Garam Engine', blurb: 'Engines take twice as long to cool in a hideout.', cool: 2 },
  { id: 'thanda', name: 'Thanda Engine', blurb: 'Engines cool in half the time.', cool: 0.5 },
  { id: 'mukhbir', name: 'Mukhbir Raat', blurb: 'Informers everywhere: 12 seconds in a hideout and somebody talks.', informerAt: 12, minLevel: 2 },
  { id: 'sona', name: 'Sone ki Raat', blurb: 'Everything is worth half as much again, and the target is higher.', loot: 1.5, target: 1.4 },
  { id: 'khuli', name: 'Khuli Tijori', blurb: 'The tijoris are open from the first second.', jackpotAt: 1 },
  { id: 'der', name: 'Der se Tijori', blurb: 'The tijoris stay shut for the first 75 seconds.', jackpotAt: 75 },
  { id: 'dheele', name: 'Dheele Taale', blurb: 'Weak locks: every job takes half the time.', hold: 0.5 },
  { id: 'mazboot', name: 'Mazboot Taale', blurb: 'Strong locks: every job takes half as long again.', hold: 1.5 },
  { id: 'lambi', name: 'Lambi Raat', blurb: 'A five-minute round, with a bigger target.', round: 300, target: 1.25 },
  { id: 'chhoti', name: 'Chhoti Raat', blurb: 'Three minutes only, and a smaller target.', round: 180, target: 0.72 },
  { id: 'do', name: 'Do Raaste', blurb: 'Only two hand-off points are open tonight.', escapes: 2 },
  { id: 'band', name: 'Band Darwaze', blurb: 'A third of the hideouts are padlocked.', lockHides: 0.34 },
  { id: 'naka', name: 'Naka-bandi', blurb: 'Two extra police jeeps are out.', cops: 2 },
  { id: 'nazar', name: 'Nazar', blurb: 'Every 20 seconds the police radio says where each getaway car is.', tracker: 20 },
];
// Puts a level's setup, a kind of night and a twist together into what the round runs on.
// `rnd` is a function giving numbers from 0 to 1 (Math.random in the game, a fixed one in tests).
export function composeRound(setup, night, twist) {
  const c = Object.assign({}, setup), n = night || NIGHT_KINDS[0], t = twist || null, loot = (n.loot || 1) * ((t && t.loot) || 1);
  c.rain = n.rain || 0; c.gripMul = n.grip || 1; c.fog = n.fog || null; c.dark = n.dark ? 1 : 0; c.bright = n.bright ? 1 : 0;
  c.visionMul = setup.visionMul * (n.vision || 1); c.tipMul = setup.tipMul * (n.tip || 1);
  c.carMul = (t && t.car) || 1; c.tracker = (t && t.tracker) || 0; c.cops = setup.cops + ((t && t.cops) || 0);
  c.target = Math.round(setup.target * ((t && t.target) || 1) / 50) * 50;
  c.rules = { round: (t && t.round) || undefined, jackpotAt: t && t.jackpotAt != null ? t.jackpotAt : undefined, holdMul: (t && t.hold) || 1, lootMul: loot, coolMul: (t && t.cool) || 1, informerAt: (t && t.informerAt) || undefined, nitroMul: (t && t.nitro) || 1 };
  c.night = { name: n.name, blurb: n.blurb }; c.twist = t ? { name: t.name, blurb: t.blurb } : null;
  c.name = 'Level ' + setup.level + ' · ' + n.name;
  return c;
}
export function pickNight(level, rnd) {
  const pool = NIGHT_KINDS.filter(n => (n.minLevel || 1) <= level), total = pool.reduce((s, n) => s + n.w, 0);
  let r = rnd() * total;
  for (const n of pool) { r -= n.w; if (r <= 0) return n; }
  return pool[0];
}
export function pickTwist(level, rnd, avoid) {
  if (rnd() < 0.2) return null;   // one night in five is plain
  const pool = TWISTS.filter(t => (t.minLevel || 1) <= level && t.id !== avoid);
  return pool[Math.floor(rnd() * pool.length)] || null;
}

const NIGHTS = ['Pehli Raat', 'Chandni Raat', 'Barsaat ki Raat', 'Naka-bandi', 'Amavas', 'Toofani Raat', 'Sarraf ka Badla', 'Kotwal ki Kasam', 'Kali Raat', 'Aakhri Daud'];

// Loot the chors must bank, and how many police jeeps they face.
export function matchSetup(nChors, nHumanPolice, night) {
  if (nChors <= 1 && nHumanPolice === 0) { // solo ladder: each night is a little harder
    const n = Math.max(1, night || 1);
    return {
      target: Math.min(800 + 125 * (n - 1), 2200),
      cops: Math.min(2 + Math.floor((n - 1) / 3), 5),
      speedMul: Math.min(0.9 + 0.015 * (n - 1), 1.02),     // jeeps are slower than you on the first nights
      visionMul: Math.min(1 + 0.03 * (n - 1), 1.25),
      bustMul: Math.min(0.7 + 0.06 * (n - 1), 1),          // ...and the bust meter fills more gently
      tipMul: Math.max(1, 1.5 - 0.1 * (n - 1)),            // ...and witnesses are slower to call in a loaded car
      rain: n % 3 === 0 ? 0.85 : n % 5 === 0 ? 0.5 : 0,
      informer: n >= 2,
      par: 150,
      name: NIGHTS[(n - 1) % NIGHTS.length] + (n > NIGHTS.length ? ' ' + Math.ceil(n / NIGHTS.length) : ''),
    };
  }
  // computer jeeps are easier to fool than a person, so one police player stands in for two of them
  const target = [0, 800, 1300, 1700, 2000, 2200, 2300, 2300, 2300][Math.min(nChors, 8)];
  const wanted = [0, 3, 3, 4, 4, 5, 5, 5, 5][Math.min(nChors, 8)];
  return { target, cops: Math.max(0, wanted - 2 * nHumanPolice), speedMul: 1, visionMul: 1, bustMul: 1, tipMul: 1, rain: 0, informer: true, par: 150, name: '' };
}

export const RANKS = [
  [0, 'Naya Chor'], [2000, 'Jebkatra'], [6000, 'Chhota Chor'], [12000, 'Shaatir Chor'],
  [22000, 'Ustaad'], [36000, 'Sarraf ka Dushman'], [55000, 'Jugnupur ka Don'],
];
export function rankFor(totalLoot) {
  let r = RANKS[0][1];
  for (const [need, name] of RANKS) if (totalLoot >= need) r = name;
  return r;
}
// getaway-car paints unlock with total loot banked (the first three are free)
export function paintsUnlocked(totalLoot) { return 3 + Math.min(5, Math.floor(totalLoot / 3000)); }
