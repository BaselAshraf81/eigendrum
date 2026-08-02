/**
 * What you hit the drum with, and how hard.
 *
 * Mallet width is not a stat. A strike is the projection of the mallet's footprint
 * onto each mode, so a wide soft beater averages a rapidly alternating mode against
 * itself and physically cannot excite it. That is real low-pass filtering, and it
 * means the tool genuinely changes which modes are reachable rather than changing a
 * number in the player's favour.
 *
 * Force is the honest opposite. In a linear membrane it scales every mode by the
 * same factor: hitting harder gives the same chord, louder. So force is expressive,
 * it is never scored, and the game says so out loud rather than pretending
 * otherwise. Scoring always reads the unit-force amplitudes, which is to say it
 * measures *where* you hit and nothing else.
 */

export const MALLETS = [
  {
    id: 'stick',
    name: 'wooden stick',
    radius: 0.03,
    blurb: 'Narrow and hard. Reaches the finest modes, because it barely averages at all.',
    unlockedAt: 0,
  },
  {
    id: 'finger',
    name: 'fingertip',
    // 0.05 exactly, because that is the radius the level survey was run at and every
    // level's solvability is proven against it.
    radius: 0.05,
    blurb: 'A middling footprint. Wakes most of what a drum has to offer.',
    unlockedAt: 1,
  },
  {
    id: 'beater',
    name: 'felt beater',
    radius: 0.095,
    blurb:
      'Wide and soft. It cancels the fast modes against themselves, so the high end simply will not answer.',
    unlockedAt: 2,
  },
];

export const MALLETS_BY_ID = new Map(MALLETS.map((m) => [m.id, m]));
export const DEFAULT_MALLET = 'finger';

export function malletRadius(id) {
  return (MALLETS_BY_ID.get(id) || MALLETS_BY_ID.get(DEFAULT_MALLET)).radius;
}

/** Mallets a player has earned. Chapter index decides it, so it cannot be lost. */
export function unlockedMallets(chaptersCleared) {
  return MALLETS.filter((m) => m.unlockedAt <= chaptersCleared);
}

/**
 * Force, 0.35 to 1. Charged by holding, and it only ever scales loudness.
 *
 * The floor is not zero because a strike that moves nothing is not a strike; the
 * silence objectives already require a real hit before they will count.
 */
export const FORCE_MIN = 0.35;
export const FORCE_MAX = 1;
export const CHARGE_MS = 620;

/** Where a hold of this duration has charged to. Linear, so the ring is readable. */
export function forceFor(heldMs) {
  const t = Math.min(1, Math.max(0, heldMs / CHARGE_MS));
  return FORCE_MIN + (FORCE_MAX - FORCE_MIN) * t;
}
