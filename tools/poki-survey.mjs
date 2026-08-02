/**
 * Surveys which objectives each shape can actually support.
 *
 * Authoring levels by taste produced six unwinnable ones out of twenty-five. The
 * fix is not better guessing, it is to read the answer off the drum: for every
 * shape, this counts how many winning strike points exist for every objective and
 * every mode, so levels get chosen from what the physics offers rather than from
 * what seemed reasonable.
 *
 *   node tools/poki-survey.mjs [shape ...]
 */

import { solveDrum } from '../poki-ready-copy/engine/fem/solve.js';
import { nodeWeights, strikeAmplitudes } from '../poki-ready-copy/engine/audio/synth.js';
import { PRESETS_BY_ID, normalizeShape } from '../poki-ready-copy/engine/app/presets.js';
import { OBJECTIVES, solveSet } from '../poki-ready-copy/game/levels.js';

const TARGET_NODES = 1200;
const MODE_COUNT = 12;
const MALLET = 0.05;
const SHAPES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['circle', 'square', 'rectangle', 'triangle', 'righttriangle', 'lshape', 'stadium', 'star', 'pentagon'];

/** A level is only fair if a player can plausibly find a winning point. */
const FAIR = 8;

function tableFor(id, mallet) {
  const preset = PRESETS_BY_ID.get(id);
  const { polygon, align } = normalizeShape(preset.polygon, preset.latticePitch || 0);
  const drum = solveDrum(polygon, { modes: MODE_COUNT, targetNodes: TARGET_NODES, align });
  const weights = nodeWeights(drum.mesh);
  const { mesh, modes } = drum;
  const nodeCount = mesh.nodeCount;
  const modeCount = modes.length;
  const table = new Float32Array(nodeCount * modeCount);
  const peaks = new Float32Array(nodeCount);
  const bestWake = new Float32Array(modeCount);
  let globalPeak = 0;
  for (let i = 0; i < nodeCount; i++) {
    const amps = strikeAmplitudes(mesh, modes, mesh.nodes[i * 2], mesh.nodes[i * 2 + 1], mallet, weights);
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

const count = (level, stats) => solveSet(level, stats).length;

for (const shape of SHAPES) {
  const stats = tableFor(shape, MALLET);
  console.log(`\n=== ${shape} ===`);

  for (const kind of ['wake', 'silence', 'isolate']) {
    const row = [];
    for (let m = 0; m < MODE_COUNT; m++) {
      const n = count({ shape, kind, mode: m, mallet: MALLET }, stats);
      row.push(`${m + 1}:${n >= FAIR ? String(n).padStart(3) : n === 0 ? '  .' : `~${n}`}`);
    }
    console.log(`${kind.padEnd(8)} ${row.join(' ')}`);
  }

  // Pairs, which is where the trouble was. Only the generous ones are worth having.
  const good = [];
  for (let j = 0; j < 8; j++) {
    for (let k = j + 1; k < 8; k++) {
      const n = count({ shape, kind: 'double', modes: [j, k], mallet: MALLET }, stats);
      if (n >= FAIR) good.push(`${j + 1}+${k + 1}:${n}`);
    }
  }
  console.log(`double   ${good.length ? good.join(' ') : 'none with a fair number of winning points'}`);
}

console.log(`\n(counts are winning strike points out of ~1200 nodes; "." none, "~n" fewer than ${FAIR})`);
