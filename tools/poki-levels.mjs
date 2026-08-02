/**
 * Proves every level in the game is winnable, and times the work the player waits
 * for.
 *
 * This is the game's equivalent of the accuracy bench: the design claims that no
 * unwinnable level can ship, and this is the thing that makes the claim checkable.
 * It runs the same vendored engine the browser runs, so a pass here is a pass
 * there.
 *
 *   npm run poki:levels
 */

import { performance } from 'node:perf_hooks';
import { solveDrum } from '../poki-ready-copy/engine/fem/solve.js';
import { nodeWeights, strikeAmplitudes } from '../poki-ready-copy/engine/audio/synth.js';
import { PRESETS_BY_ID, GWW_A, GWW_B, normalizeShape } from '../poki-ready-copy/engine/app/presets.js';
import { CHAPTERS, OBJECTIVES, levelModes, solveSet } from '../poki-ready-copy/game/levels.js';

const TARGET_NODES = Number(process.env.NODES || 1200);
const MODE_COUNT = 12;

function shapeOf(id) {
  if (id === 'gww-a') return { raw: GWW_A, pitch: 1 };
  if (id === 'gww-b') return { raw: GWW_B, pitch: 1 };
  const preset = PRESETS_BY_ID.get(id);
  if (!preset) throw new Error(`unknown shape "${id}"`);
  return { raw: preset.polygon, pitch: preset.latticePitch || 0 };
}

const solveCache = new Map();
function drumFor(id) {
  if (solveCache.has(id)) return solveCache.get(id);
  const { raw, pitch } = shapeOf(id);
  const { polygon, align } = normalizeShape(raw, pitch);
  const t0 = performance.now();
  const drum = solveDrum(polygon, { modes: MODE_COUNT, targetNodes: TARGET_NODES, align });
  drum.weights = nodeWeights(drum.mesh);
  drum.solveMs = performance.now() - t0;
  solveCache.set(id, drum);
  return drum;
}

function buildTable(drum, mallet) {
  const { mesh, modes, weights } = drum;
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

console.log(`levels verified against the vendored engine at ${TARGET_NODES} target nodes\n`);
console.log('chapter        lv  shape         objective          winners  solve   table   total');
console.log('-'.repeat(84));

const failures = [];
let worstTotal = 0;

for (const chapter of CHAPTERS) {
  for (let i = 0; i < chapter.levels.length; i++) {
    const level = chapter.levels[i];
    const drum = drumFor(level.shape);
    const t1 = performance.now();
    const stats = buildTable(drum, level.mallet);
    const tableMs = performance.now() - t1;

    const winners = solveSet(level, stats);
    const total = drum.solveMs + tableMs;
    worstTotal = Math.max(worstTotal, total);

    const modes = levelModes(level).map((m) => m + 1).join('+');
    const label = `${level.kind} ${modes}`;
    console.log(
      `${chapter.id.padEnd(14)} ${String(i + 1).padStart(2)}  ${level.shape.padEnd(13)} ${label.padEnd(18)} ` +
        `${String(winners.length).padStart(7)}  ${drum.solveMs.toFixed(0).padStart(5)}   ${tableMs.toFixed(0).padStart(5)}   ${total.toFixed(0).padStart(5)}`,
    );

    if (winners.length === 0) {
      failures.push(`${chapter.id} level ${i + 1} (${label} on ${level.shape}) has NO winning strike`);
    } else if (winners.length < 3) {
      // Solvable, but on a knife edge. A player with a mouse cannot be expected to
      // find two nodes out of twelve hundred.
      failures.push(
        `${chapter.id} level ${i + 1} (${label} on ${level.shape}) has only ${winners.length} winning point(s): too tight to be fair`,
      );
    }
  }
}

// The capstone claims the pair is isospectral. Check it here rather than trusting it.
const a = drumFor('gww-a');
const bDrum = drumFor('gww-b');
let worstDiff = 0;
for (let k = 0; k < MODE_COUNT; k++) {
  const ea = Math.sqrt(a.eigenvalues[k]);
  const eb = Math.sqrt(bDrum.eigenvalues[k]);
  worstDiff = Math.max(worstDiff, Math.abs(ea - eb) / ea);
}
console.log(
  `\ncapstone: the two Kac drums agree to ${(worstDiff * 100).toPrecision(3)}% across ${MODE_COUNT} modes`,
);
if (worstDiff > 1e-6) {
  failures.push(`the capstone pair differs by ${(worstDiff * 100).toPrecision(3)}%, so the reveal would be a lie`);
}

console.log(`worst single-level wait: ${worstTotal.toFixed(0)} ms`);

if (failures.length) {
  console.error(`\nFAILED with ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nEvery level has a provably winning strike.');
