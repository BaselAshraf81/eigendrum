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

import { malletRadius, DEFAULT_MALLET } from './mallets.js';

/** A strike so soft it wakes nothing is not a way to silence a mode. */
const MIN_LOUDNESS = 0.3;

/**
 * The three opening beats. Deliberately unfailable, and worded without the word
 * "mode", which is introduced only after the player has seen three of them behave
 * differently.
 *
 * `elsewhere` is the one that does the teaching: it will not pass until the mixture
 * genuinely differs from the previous strike, so the player cannot help noticing
 * that position is the variable.
 */
const TUTORIAL = {
  tap: {
    brief: 'Tap the drum anywhere.',
    pass: 'That is the drum ringing. The bars on the right are every way this shape can vibrate, and how much of each one you just woke.',
    retry: 'Tap somewhere on the drum itself.',
    score: ({ peak }) => ({ value: peak, stars: peak > 0 ? 3 : 0 }),
  },
  elsewhere: {
    brief: 'Now tap somewhere well away from your first hit.',
    pass: 'Different spot, different mixture, same drum. Where you hit decides what you hear.',
    retry: 'Too close to the last hit, so the mixture barely changed. Try much further away.',
    score: ({ amps, peak, previous }) => {
      if (!(peak > 0)) return { value: 0, stars: 0 };
      if (!previous) return { value: 1, stars: 3 };
      // How far the normalised mixture moved. Distance, not just loudness, so a
      // harder hit in the same place will not pass.
      let mine = 0;
      let theirs = 0;
      for (let k = 0; k < amps.length; k++) {
        mine = Math.max(mine, Math.abs(amps[k]));
        theirs = Math.max(theirs, Math.abs(previous[k] || 0));
      }
      let diff = 0;
      for (let k = 0; k < amps.length; k++) {
        diff += Math.abs(Math.abs(amps[k]) / (mine || 1) - Math.abs(previous[k] || 0) / (theirs || 1));
      }
      const spread = diff / amps.length;
      return { value: spread, stars: spread > 0.08 ? 3 : 0 };
    },
  },
  quiet: {
    brief: 'Same again, but softly: press and let go straight away.',
    pass: 'Quieter, and otherwise identical. Hitting harder scales every mode by the same amount, so force is loudness and nothing else. Position is the part that changes the sound.',
    retry: 'Still too hard. Tap and release immediately, without holding.',
    score: ({ peak, force }) => ({ value: force, stars: peak > 0 && force < 0.55 ? 3 : 0 }),
  },
};

export const OBJECTIVES = {
  /**
   * The opening beats, which ask for nothing and teach by consequence.
   *
   * A player's first contact used to be "strike so mode 1 rings as loudly as it can",
   * which is jargon before a single cause has been shown. These three cannot be
   * failed. They are marked `trivial` because they are not spatial puzzles, so the
   * solvability proof has nothing to check: any real strike satisfies them.
   */
  tutorial: {
    trivial: true,
    verb: 'just try it',
    brief: (l) => TUTORIAL[l.step].brief,
    field: (l) => ({ kind: 'signed', mode: 0 }),
    note: 'this is the deepest way this shape can move',
    score(l, { amps, peak, previous, force }) {
      return TUTORIAL[l.step].score({ amps, peak, previous, force });
    },
    say(l, r) {
      return r.stars > 0 ? TUTORIAL[l.step].pass : TUTORIAL[l.step].retry;
    },
  },

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
/**
 * The radius every level's solvability is proven at: the fingertip, the tool a player
 * starts with. At runtime the player's own choice is used instead, and if their tool
 * cannot reach the objective the game says so plainly rather than letting them fail
 * without knowing why. A wide beater genuinely cannot excite a fine mode, and finding
 * that out is the point of having tools at all.
 */
const MALLET = malletRadius(DEFAULT_MALLET);

export const CHAPTERS = [
  {
    id: 'hot-spots',
    name: 'hot spots',
    premise: 'Every way a drum can vibrate has places where it moves most. Find them.',
    levels: [
      { shape: 'circle', kind: 'tutorial', step: 'tap', mode: 0, mallet: MALLET, title: 'the whole drum' },
      { shape: 'circle', kind: 'tutorial', step: 'elsewhere', mode: 0, mallet: MALLET, title: 'somewhere else' },
      { shape: 'circle', kind: 'tutorial', step: 'quiet', mode: 0, mallet: MALLET, title: 'gently' },
      // The word "mode" is used for the first time here, after three of them have
      // been seen behaving differently.
      {
        shape: 'circle',
        kind: 'wake',
        mode: 0,
        mallet: MALLET,
        brief:
          'Those bars are called modes. Wake the first one as hard as this drum will let you.',
      },
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
  if (level.title) return level.title;
  const ms = levelModes(level);
  return ms.length > 1 ? `modes ${ms[0] + 1} and ${ms[1] + 1}` : `mode ${ms[0] + 1}`;
}

export function levelBrief(level) {
  return level.brief || OBJECTIVES[level.kind].brief(level);
}

/**
 * Scores one strike.
 *
 * `amps` is the unit-force projection at the point the player hit, so force never
 * enters a score: what is measured is *where* you struck. `context` carries force and
 * the previous strike's amplitudes, which only the tutorial reads.
 */
export function scoreStrike(level, amps, stats, context = {}) {
  let peak = 0;
  for (let k = 0; k < amps.length; k++) peak = Math.max(peak, Math.abs(amps[k]));
  const objective = OBJECTIVES[level.kind];
  const result = objective.score(level, { amps, peak, force: 1, previous: null, ...stats, ...context });
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
  // A tutorial beat is not a spatial puzzle: any real strike satisfies it, so there
  // is nothing here to prove and every interior point is a winner.
  if (OBJECTIVES[level.kind].trivial) {
    const all = [];
    for (let i = 0; i < nodeCount && all.length < Math.min(limit, 64); i++) {
      if (peaks[i] > 0) all.push(i);
    }
    return all;
  }
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
