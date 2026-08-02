/**
 * Levels, objectives and scoring.
 *
 * Every objective is a statement about the amplitude vector a_k produced by a
 * strike, and every threshold is measured against what the drum can actually do
 * rather than against a number someone liked. The worker computes, once per
 * shape, the amplitude of a strike at every mesh node; from that table come
 * `bestWake` (the loudest any point can drive each mode) and `globalPeak` (the
 * loudest strike available anywhere). Scores are fractions of those.
 *
 * That is what makes a level provable. `validate()` scans the table for a point
 * that would earn three stars, so a level that cannot be beaten cannot ship.
 */

/** A strike so soft it wakes nothing is not a way to silence a mode. */
const MIN_LOUDNESS = 0.3;

export const OBJECTIVES = {
  /** Drive one mode as hard as the shape allows. */
  wake: {
    verb: 'make it loud',
    brief: (l) => `Strike so mode ${l.mode + 1} rings as loudly as it can.`,
    field: (l) => ({ kind: 'signed', mode: l.mode }),
    note: 'strike where the colour is deepest',
    score(l, { amps, bestWake }) {
      const best = bestWake[l.mode] || 1;
      const got = Math.abs(amps[l.mode]) / best;
      return { value: got, stars: got >= 0.9 ? 3 : got >= 0.7 ? 2 : got >= 0.45 ? 1 : 0 };
    },
    say(l, r) {
      return `Mode ${l.mode + 1} reached ${(r.value * 100).toFixed(0)}% of the hardest this drum can be driven there.`;
    },
  },

  /** Ring the drum while leaving one mode untouched. */
  silence: {
    verb: 'keep it silent',
    brief: (l) => `Ring the drum, but leave mode ${l.mode + 1} silent.`,
    field: (l) => ({ kind: 'signed', mode: l.mode }),
    note: 'strike on a pale curve, where this mode never moves',
    score(l, { amps, peak, globalPeak }) {
      if (peak < MIN_LOUDNESS * globalPeak) {
        return { value: 1, stars: 0, tooQuiet: true };
      }
      const r = Math.abs(amps[l.mode]) / (peak || 1);
      return { value: r, stars: r < 0.02 ? 3 : r < 0.06 ? 2 : r < 0.12 ? 1 : 0 };
    },
    say(l, r) {
      if (r.tooQuiet) return 'That barely moved the drum. Silence has to be earned by a real strike.';
      return `Mode ${l.mode + 1} came out at ${(r.value * 100).toFixed(1)}% of the loudest mode in your strike.`;
    },
  },

  /** Make one mode the loudest thing in the mixture. */
  isolate: {
    verb: 'make it the loudest',
    brief: (l) => `Strike so mode ${l.mode + 1} is the loudest mode of all.`,
    field: (l) => ({ kind: 'signed', mode: l.mode }),
    note: 'its own hot spot, away from the others',
    score(l, { amps, bestWake }) {
      let top = 0;
      for (let k = 1; k < amps.length; k++) {
        if (Math.abs(amps[k]) > Math.abs(amps[top])) top = k;
      }
      if (top !== l.mode) return { value: 0, stars: 0, beatenBy: top };
      const got = Math.abs(amps[l.mode]) / (bestWake[l.mode] || 1);
      return { value: got, stars: got >= 0.75 ? 3 : got >= 0.55 ? 2 : 1 };
    },
    say(l, r) {
      if (r.beatenBy !== undefined) return `Mode ${r.beatenBy + 1} came out louder than mode ${l.mode + 1}.`;
      return `Mode ${l.mode + 1} led the mixture, at ${(r.value * 100).toFixed(0)}% of its own maximum.`;
    },
  },

  /**
   * Silence two modes at once.
   *
   * The target plate shows max(|phi_j|, |phi_k|), whose near-zero set is exactly
   * the set of points where *both* modes are quiet. So the pale region is
   * literally the winning territory, which is the honest way to draw two nodal
   * curves in one figure: their crossing is the only place both are still.
   */
  double: {
    verb: 'silence both',
    brief: (l) => `Ring the drum with modes ${l.modes[0] + 1} and ${l.modes[1] + 1} both silent.`,
    field: (l) => ({ kind: 'bothQuiet', modes: l.modes }),
    note: 'the pale patches are where both are still at once',
    score(l, { amps, peak, globalPeak }) {
      if (peak < MIN_LOUDNESS * globalPeak) return { value: 1, stars: 0, tooQuiet: true };
      const r = Math.max(...l.modes.map((k) => Math.abs(amps[k]))) / (peak || 1);
      return { value: r, stars: r < 0.03 ? 3 : r < 0.07 ? 2 : r < 0.14 ? 1 : 0 };
    },
    say(l, r) {
      if (r.tooQuiet) return 'That barely moved the drum. Silence has to be earned by a real strike.';
      return `The louder of the two came out at ${(r.value * 100).toFixed(1)}% of your strike's peak.`;
    },
  },
};

/**
 * Chapters. Each introduces exactly one idea, then exercises it.
 *
 * `blind` hides the target plate's field, which converts a reading exercise into
 * a listening one. `mallet` is the strike radius: a wider mallet averages over
 * more of the mode, so it is harder to land cleanly on a nodal line.
 */
/**
 * Every level below was chosen from `npm run poki:survey`, which counts the winning
 * strike points each shape actually offers for each objective, and every one is
 * re-proved by `npm run poki:levels`. Authoring them by taste first produced six
 * unwinnable levels out of twenty-five, which is the whole argument for measuring
 * instead of guessing.
 *
 * Two facts the survey turned up, both of which now constrain authoring:
 *
 *   - `silence` on mode 1 is impossible on every shape, and not by accident. The
 *     first eigenfunction of any domain has no interior nodal line at all (Courant),
 *     so there is nowhere on any drum that leaves the fundamental cold. No level
 *     may ask for it.
 *   - `double` needs symmetry. Two nodal families only cross often when the shape
 *     puts them at an angle to each other, so the circle, rectangle, triangle and
 *     star are generous and the stadium and L-shape are nearly barren. The original
 *     crossings chapter was built on exactly the barren ones.
 *
 * Mallet radius is held at 0.05 throughout. It is a real difficulty knob, but
 * varying it changes which levels are winnable, and a single value keeps the
 * guarantee auditable against one survey.
 */
const MALLET = 0.05;

export const CHAPTERS = [
  {
    id: 'hot-spots',
    name: 'hot spots',
    premise: 'Every mode has places where it moves most. Find them.',
    levels: [
      { shape: 'circle', kind: 'wake', mode: 0, mallet: MALLET },
      { shape: 'circle', kind: 'wake', mode: 1, mallet: MALLET },
      { shape: 'square', kind: 'wake', mode: 0, mallet: MALLET },
      { shape: 'square', kind: 'wake', mode: 3, mallet: MALLET },
      { shape: 'circle', kind: 'wake', mode: 4, mallet: MALLET },
    ],
  },
  {
    id: 'still-water',
    name: 'still water',
    premise:
      'A mode stands still along certain curves. Strike one of those and that mode cannot hear you at all.',
    levels: [
      { shape: 'circle', kind: 'silence', mode: 4, mallet: MALLET },
      { shape: 'circle', kind: 'silence', mode: 1, mallet: MALLET },
      { shape: 'rectangle', kind: 'silence', mode: 4, mallet: MALLET },
      { shape: 'rectangle', kind: 'silence', mode: 8, mallet: MALLET },
      { shape: 'circle', kind: 'silence', mode: 5, mallet: MALLET },
    ],
  },
  {
    id: 'loudest',
    name: 'loudest',
    premise: 'Waking a mode is easy. Making it beat every other mode is not.',
    levels: [
      { shape: 'triangle', kind: 'isolate', mode: 1, mallet: MALLET },
      { shape: 'lshape', kind: 'isolate', mode: 2, mallet: MALLET },
      { shape: 'triangle', kind: 'isolate', mode: 3, mallet: MALLET },
      { shape: 'pentagon', kind: 'isolate', mode: 2, mallet: MALLET },
      { shape: 'lshape', kind: 'isolate', mode: 3, mallet: MALLET },
    ],
  },
  {
    id: 'crossings',
    name: 'crossings',
    premise:
      'Two modes, both silent, one strike. Their still curves cross in only a few places on the whole drum.',
    levels: [
      { shape: 'star', kind: 'double', modes: [1, 3], mallet: MALLET },
      { shape: 'triangle', kind: 'double', modes: [1, 4], mallet: MALLET },
      { shape: 'circle', kind: 'double', modes: [1, 4], mallet: MALLET },
      { shape: 'pentagon', kind: 'double', modes: [3, 6], mallet: MALLET },
      { shape: 'rectangle', kind: 'double', modes: [2, 4], mallet: MALLET },
    ],
  },
  {
    id: 'by-ear',
    name: 'by ear',
    premise:
      'The diagram is gone. You still have the drum, the strip of what woke up, and your ears.',
    levels: [
      { shape: 'star', kind: 'silence', mode: 3, mallet: MALLET, blind: true },
      { shape: 'star', kind: 'silence', mode: 1, mallet: MALLET, blind: true },
      { shape: 'stadium', kind: 'isolate', mode: 5, mallet: MALLET, blind: true },
      { shape: 'star', kind: 'double', modes: [1, 6], mallet: MALLET, blind: true },
      { shape: 'pentagon', kind: 'silence', mode: 8, mallet: MALLET, blind: true },
    ],
  },
];

/** Modes a level actually talks about, for labelling and for the target field. */
export function levelModes(level) {
  return level.modes ? level.modes : [level.mode];
}

export function levelTitle(level) {
  const ms = levelModes(level);
  return ms.length > 1 ? `modes ${ms[0] + 1} and ${ms[1] + 1}` : `mode ${ms[0] + 1}`;
}

/** Scores one strike. `amps` is the real projection at the point the player hit. */
export function scoreStrike(level, amps, stats) {
  let peak = 0;
  for (let k = 0; k < amps.length; k++) peak = Math.max(peak, Math.abs(amps[k]));
  const objective = OBJECTIVES[level.kind];
  const result = objective.score(level, { amps, peak, ...stats });
  return { ...result, peak, say: objective.say(level, result) };
}

/**
 * Proves a level is winnable, by finding a node that would earn three stars.
 *
 * Returns the winning node indices, which is also exactly what an honest hint
 * needs. If this comes back empty the level is broken and must not be played.
 */
export function solveSet(level, stats, { limit = Infinity } = {}) {
  const { table, peaks, modeCount, nodeCount } = stats;
  const winners = [];
  const amps = new Float64Array(modeCount);
  for (let i = 0; i < nodeCount && winners.length < limit; i++) {
    for (let k = 0; k < modeCount; k++) amps[k] = table[i * modeCount + k];
    const objective = OBJECTIVES[level.kind];
    const r = objective.score(level, { amps, peak: peaks[i], ...stats });
    if (r.stars === 3) winners.push(i);
  }
  return winners;
}
