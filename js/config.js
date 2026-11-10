// Tunable game numbers. Distances are in map units (1 unit = 5 metres), speeds in units per second, times in seconds.
// Car handling numbers live in js/vehicle.js (CAR).
export const CFG = {
  ROUND: 360,          // length of a round
  COUNT: 6,            // police wait in the thana yard this long before they may move
  JACKPOT_AT: 60,      // the three tijoris unlock when the clock tower chimes
  COACH_OPEN: 180,     // the mail coach strongbox is open for one minute
  COACH_CLOSE: 240,

  NITRO_MAX: 3.2, NITRO_REGEN: 0.24, NITRO_DELAY: 1.2,       // seconds of boost, refill per second, wait before refilling
  CARRY_SLOW: 0.035, CARRY_SLOW_JACKPOT: 0.08,               // top speed lost per bag carried
  KMH: 26,                                                   // what one unit/second shows as on the speedometer

  COP_CRUISE: 1.7, COP_RESPOND: 3.0, COP_CHASE: 3.42,
  VISION: 12.5, VISION_DARK: 8, VISION_PARK: 0.72, FOV: 60 * Math.PI / 180, NEAR: 2.2, NOISE_RANGE: 6,

  BUST_RANGE: 1.55,    // a police vehicle this close fills the bust meter
  BUST_STOPPED: 1.5, BUST_SLOW: 0.75, BUST_ROLLING: 0.28, BUST_FAST: 0.08,   // fill per second by how fast the chor is moving
  BUST_DRAIN: 0.55,

  ROB_RANGE: 1.7, ROB_SPEED: 0.8, BANK_RANGE: 2.2, BANK_SPEED: 1.4, LEVER_RANGE: 1.8, HIDE_SPEED: 0.7, SEARCH_RANGE: 2.4,
  HOLD: { 1: 3, 2: 6, 3: 10 },        // seconds parked to rob, by loot tier
  VALUE: { 1: 150, 2: 350, 3: 600 },
  BANK_HOLD: 0.8, LEVER_HOLD: 2.5, HIDE_HOLD: 0.3, SEARCH_HOLD: 1.3, AI_SEARCH: 1.6,

  JAIL_SOLO: 12,       // one-chor games: car released after this long, third bust ends the round
  JAIL_MULTI: 40,      // team games: released if nobody pulls a lever
  MAX_ARRESTS_SOLO: 3,
  IMMUNE: 5, LEVER_LOCK: 20, RELOCK: 30,
  TIP_EVERY: 12, TIP_EVERY_JACKPOT: 8,   // carrying loot through lit streets gets you reported this often
  HEAT_MAX: 5,

  MAX_PLAYERS: 8,
};

const NIGHTS = ['Pehli Raat', 'Chandni Raat', 'Barsaat ki Raat', 'Naka-bandi', 'Amavas', 'Toofani Raat', 'Sarraf ka Badla', 'Kotwal ki Kasam'];

// Loot the chors must bank, and how many police jeeps they face.
export function matchSetup(nChors, nHumanPolice, night) {
  if (nChors <= 1 && nHumanPolice === 0) { // solo ladder: each night is a little harder
    const n = Math.max(1, night || 1);
    return {
      target: Math.min(700 + 200 * (n - 1), 2600),
      cops: Math.min(2 + Math.floor((n - 1) / 2), 6),
      speedMul: Math.min(0.93 + 0.02 * (n - 1), 1.1),
      visionMul: Math.min(1 + 0.03 * (n - 1), 1.25),
      rain: n % 3 === 0 ? 0.85 : n % 5 === 0 ? 0.5 : 0,
      name: NIGHTS[(n - 1) % NIGHTS.length] + (n > NIGHTS.length ? ' ' + Math.ceil(n / NIGHTS.length) : ''),
    };
  }
  // computer jeeps are easier to fool than a person, so one police player stands in for two of them
  const target = [0, 700, 1300, 1550, 1750, 1850, 1850, 1850, 1850][Math.min(nChors, 8)];
  const wanted = [0, 3, 3, 4, 4, 5, 5, 5, 5][Math.min(nChors, 8)];
  return { target, cops: Math.max(0, wanted - 2 * nHumanPolice), speedMul: 1, visionMul: 1, rain: 0, name: '' };
}

export const RANKS = [
  [0, 'Naya Chor'], [1500, 'Jebkatra'], [4000, 'Chhota Chor'], [8000, 'Shaatir Chor'],
  [15000, 'Ustaad'], [25000, 'Sarraf ka Dushman'], [40000, 'Jugnupur ka Don'],
];
export function rankFor(totalLoot) {
  let r = RANKS[0][1];
  for (const [need, name] of RANKS) if (totalLoot >= need) r = name;
  return r;
}
// getaway-car paints unlock with total loot banked (the first three are free)
export function paintsUnlocked(totalLoot) { return 3 + Math.min(5, Math.floor(totalLoot / 2500)); }
