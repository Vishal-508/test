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

  MAX_PLAYERS: 8, PROTO: 3,
};

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
