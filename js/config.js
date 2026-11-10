// Tunable game numbers. Distances are in map units (1 unit = 5 metres), times in seconds.
export const CFG = {
  ROUND: 360,          // length of a round
  COUNT: 8,            // police count in the thana before they may move
  JACKPOT_AT: 60,      // the three tijoris unlock when the clock tower chimes
  COACH_OPEN: 180,     // the mail coach strongbox is open for one minute
  COACH_CLOSE: 240,

  CHOR_WALK: 1.25, CHOR_SPRINT: 1.8,
  POLICE_WALK: 1.3, POLICE_SPRINT: 1.7,
  STAMINA_MAX: 4.5, STAMINA_REGEN: 0.55, STAMINA_DELAY: 0.8,
  CARRY_SLOW: 0.1, CARRY_SLOW_JACKPOT: 0.15,

  COP_PATROL: 1.0, COP_RUN: 1.3, COP_CHASE: 1.47,
  VISION: 10.5, VISION_PARK: 6.5, FOV: 65 * Math.PI / 180, NOISE_RANGE: 4.5,

  ARREST_DIST: 0.75,
  ROB_RANGE: 1.8, BANK_RANGE: 2.0, HIDE_RANGE: 1.3, LEVER_RANGE: 1.6, PIPE_RANGE: 1.3, SEARCH_RANGE: 1.6,
  HOLD: { 1: 4, 2: 9, 3: 15 },        // seconds to rob, by loot tier
  VALUE: { 1: 150, 2: 350, 3: 600 },
  BANK_HOLD: 0.9, LEVER_HOLD: 3, HIDE_HOLD: 0.25, PIPE_HOLD: 0.6, PIPE_TRAVEL: 2.5, SEARCH_HOLD: 0.7,

  JAIL_SOLO: 15,       // one-chor games: bail after this long, third arrest ends the round
  JAIL_MULTI: 45,      // team games: bail if nobody pulls a lever
  MAX_ARRESTS_SOLO: 3,
  IMMUNE: 4, LEVER_LOCK: 20, RELOCK: 30,
  TIP_EVERY: 11, TIP_EVERY_JACKPOT: 7,   // while a chor carries loot in a lit street, someone tips off the police this often

  MAX_PLAYERS: 8,
};

// Loot the chors must bank, and how many police they face, by number of chors.
export function matchSetup(nChors, nHumanPolice, night) {
  if (nChors <= 1 && nHumanPolice === 0) { // solo ladder: each night is a little harder
    const n = Math.max(1, night || 1);
    return {
      target: Math.min(700 + 200 * (n - 1), 2600),
      cops: Math.min(2 + Math.floor((n - 1) / 2), 6),
      speedMul: Math.min(0.95 + 0.025 * (n - 1), 1.18),   // the first night is a touch gentler
      visionMul: Math.min(1 + 0.03 * (n - 1), 1.25),
    };
  }
  // computer constables are easier to fool than a person, so one police player stands in for two of them
  const target = [0, 700, 1300, 1550, 1750, 1850, 1850, 1850, 1850][Math.min(nChors, 8)];
  const wanted = [0, 3, 3, 4, 4, 5, 5, 5, 5][Math.min(nChors, 8)];
  return { target, cops: Math.max(0, wanted - 2 * nHumanPolice), speedMul: 1, visionMul: 1 };
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
