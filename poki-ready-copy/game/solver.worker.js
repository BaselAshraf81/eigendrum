/**
 * The game's worker. Solves a drum, then builds the amplitude table the whole
 * game rests on.
 *
 * The table holds the amplitude vector a_k for a strike centred on every mesh
 * node. It costs O(nodes^2 * modes) once, and it buys three things that would
 * otherwise be guesses:
 *
 *   - proof that a level is winnable, by search rather than by hope
 *   - the true best value each mode can be driven to, so a score can be a
 *     fraction of what is actually possible
 *   - honest hints, since the winning set is computed and not authored
 *
 * Solves are cached by shape, because a chapter reuses shapes across its levels
 * and the solve is the expensive half. The table depends on mallet radius, which
 * varies per level, so that half is recomputed.
 */

import { solveDrum } from '../engine/fem/solve.js';
import { nodeWeights, strikeAmplitudes, frequencies } from '../engine/audio/synth.js';

const solved = new Map();

function drumFor(shapeId, polygon, opts, report) {
  const key = `${shapeId}:${opts.targetNodes}:${opts.modes}`;
  if (solved.has(key)) {
    report(1);
    return solved.get(key);
  }
  const drum = solveDrum(polygon, { ...opts, onProgress: report });
  drum.weights = nodeWeights(drum.mesh);
  solved.set(key, drum);
  return drum;
}

/** Amplitudes for a strike at every node, plus the statistics scoring needs. */
function buildTable(drum, mallet) {
  const { mesh, modes, weights } = drum;
  const nodeCount = mesh.nodeCount;
  const modeCount = modes.length;
  const table = new Float32Array(nodeCount * modeCount);
  const peaks = new Float32Array(nodeCount);
  const bestWake = new Float32Array(modeCount);
  let globalPeak = 0;

  for (let i = 0; i < nodeCount; i++) {
    const amps = strikeAmplitudes(
      mesh,
      modes,
      mesh.nodes[i * 2],
      mesh.nodes[i * 2 + 1],
      mallet,
      weights,
    );
    let peak = 0;
    for (let k = 0; k < modeCount; k++) {
      const v = amps[k];
      table[i * modeCount + k] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a > bestWake[k]) bestWake[k] = a;
    }
    peaks[i] = peak;
    if (peak > globalPeak) globalPeak = peak;
  }

  return { table, peaks, bestWake, globalPeak, nodeCount, modeCount };
}

self.onmessage = (event) => {
  const { id, shapeId, polygon, mallet, targetNodes = 1200, modeCount = 12, align = 0 } = event.data;
  try {
    // The solve is the slow part, so it owns most of the progress bar.
    const drum = drumFor(
      shapeId,
      polygon,
      { targetNodes, modes: modeCount, align },
      (p) => self.postMessage({ id, progress: p * 0.8 }),
    );
    self.postMessage({ id, progress: 0.82 });

    const stats = buildTable(drum, mallet);
    self.postMessage({ id, progress: 1 });

    const payload = {
      id,
      ok: true,
      mesh: drum.mesh,
      eigenvalues: drum.eigenvalues,
      modes: drum.modes,
      freqs: frequencies(drum.eigenvalues, 138),
      ...stats,
    };
    self.postMessage(payload);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
