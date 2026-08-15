/**
 * Diagnostic for the "everything sounds the same" report.
 *
 * Uses the EXACT production parameters from src/app/main.js (CONTACT_RATIO 2.2,
 * gain = TARGET_PEAK / strikeHeadroom, brightness 0.5) so the numbers describe
 * what a user actually hears, not a plausible approximation of it.
 *
 * Run: node tools/diag-sameness.mjs
 */

import { solveDrum } from '../src/fem/solve.js';
import { PRESETS_BY_ID, normalizeShape } from '../src/app/presets.js';
import {
  nodeWeights,
  modeNorms,
  frequencies,
  strikeAmplitudes,
  audibleAmps,
  strikeHeadroom,
  decayTimes,
  renderStrike,
} from '../src/audio/synth.js';

// Production constants, copied from src/app/main.js.
const CONTACT_RATIO = 2.2;
const TARGET_PEAK = 0.72;
const BRIGHTNESS = 0.5; // slider default
const BASE_SECONDS = 1.7;
const BASE_HZ = 130; // pitch slider default
const RADIUS = 0.06; // mallet default
const MODES = 16;
const TARGET_NODES = 2000;
const SR = 48000;

function solve(id) {
  const preset = PRESETS_BY_ID.get(id);
  const { polygon, align } = normalizeShape(preset.polygon, preset.latticePitch || 0);
  const out = solveDrum(polygon, { modes: MODES, targetNodes: TARGET_NODES, align });
  const weights = nodeWeights(out.mesh);
  const norms = modeNorms(out.mesh, out.modes, weights);
  const freqs = frequencies(out.eigenvalues, BASE_HZ);
  const taus = decayTimes(freqs, BASE_SECONDS, BRIGHTNESS, BASE_HZ);
  const head = strikeHeadroom(
    out.mesh,
    out.modes,
    norms,
    freqs,
    weights,
    RADIUS,
    CONTACT_RATIO,
    BASE_HZ,
  );
  return { ...out, weights, norms, freqs, taus, gain: TARGET_PEAK / head };
}

function heardAt(d, px, py) {
  const projected = strikeAmplitudes(d.mesh, d.modes, px, py, RADIUS, d.weights);
  return audibleAmps(projected, d.norms, d.freqs, CONTACT_RATIO, BASE_HZ);
}

function peakNode(d) {
  let best = 0;
  let node = 0;
  for (let i = 0; i < d.modes[0].length; i++) {
    const a = Math.abs(d.modes[0][i]);
    if (a > best) {
      best = a;
      node = i;
    }
  }
  return [d.mesh.nodes[node * 2], d.mesh.nodes[node * 2 + 1]];
}

/** Energy share per mode, and the energy-weighted mean frequency. */
function balance(freqs, heard, taus) {
  const e = [];
  let tot = 0;
  for (let k = 0; k < heard.length; k++) {
    const v = heard[k] * heard[k] * taus[k]; // energy of a decaying sinusoid
    e.push(v);
    tot += v;
  }
  let num = 0;
  for (let k = 0; k < freqs.length; k++) num += e[k] * freqs[k];
  return { share: e.map((v) => (tot > 0 ? v / tot : 0)), tot, centroid: tot > 0 ? num / tot : 0 };
}

/** Pre-limiter peak of the raw modal sum, to see whether tanh is doing real work. */
function preLimiterPeak(freqs, heard, taus, gain) {
  // worst case: all modes momentarily in phase
  let s = 0;
  for (let k = 0; k < heard.length; k++) s += Math.abs(heard[k]) * gain;
  return s;
}

function render(d, heard) {
  return renderStrike({
    freqs: d.freqs,
    amps: heard,
    taus: d.taus,
    sampleRate: SR,
    gain: d.gain,
  });
}

function rms(buf, a, b) {
  let acc = 0;
  const lo = Math.max(0, Math.floor(a * SR));
  const hi = Math.min(buf.length, Math.floor(b * SR));
  for (let i = lo; i < hi; i++) acc += buf[i] * buf[i];
  return hi > lo ? Math.sqrt(acc / (hi - lo)) : 0;
}

/** Fraction of samples driven into the flat part of tanh. */
function clippedFraction(buf) {
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > 0.95) n++;
  return n / buf.length;
}

const ids = ['circle', 'square', 'rectangle', 'triangle', 'lshape', 'stadium', 'star', 'gww-a'];
const solved = new Map();
for (const id of ids) solved.set(id, solve(id));

console.log('=== 1. Modal balance per shape, hardest strike, production params ===\n');
console.log('shape        f1     mode1%  mode1+2%  centroid  tau1    tau16   prelim.peak  clip%');
for (const id of ids) {
  const d = solved.get(id);
  const [px, py] = peakNode(d);
  const heard = heardAt(d, px, py);
  const b = balance(d.freqs, heard, d.taus);
  const buf = render(d, heard);
  console.log(
    `${id.padEnd(11)} ${d.freqs[0].toFixed(0).padStart(4)}Hz ` +
      `${(b.share[0] * 100).toFixed(1).padStart(6)} ` +
      `${((b.share[0] + b.share[1]) * 100).toFixed(1).padStart(9)} ` +
      `${b.centroid.toFixed(1).padStart(9)} ` +
      `${d.taus[0].toFixed(2).padStart(6)} ${d.taus[15].toFixed(3).padStart(7)} ` +
      `${preLimiterPeak(d.freqs, heard, d.taus, d.gain).toFixed(2).padStart(11)} ` +
      `${(clippedFraction(buf) * 100).toFixed(1).padStart(6)}`,
  );
}

console.log('\n=== 2. Overtone ratios: how different ARE the shapes, numerically? ===\n');
for (const id of ids) {
  const d = solved.get(id);
  const r = Array.from(d.freqs)
    .slice(0, 6)
    .map((f) => (f / d.freqs[0]).toFixed(3));
  console.log(`  ${id.padEnd(11)} ${r.join('  ')}`);
}
{
  // How far apart are two shapes, measured only on what is actually loud?
  const ref = solved.get('circle');
  console.log('\n  audible distance from circle (energy-weighted, semitones of centroid):');
  const [rx, ry] = peakNode(ref);
  const refB = balance(ref.freqs, heardAt(ref, rx, ry), ref.taus);
  for (const id of ids) {
    const d = solved.get(id);
    const [px, py] = peakNode(d);
    const b = balance(d.freqs, heardAt(d, px, py), d.taus);
    const semis = 12 * Math.log2(b.centroid / refB.centroid);
    console.log(`    ${id.padEnd(11)} ${semis >= 0 ? '+' : ''}${semis.toFixed(2)} st`);
  }
}

console.log('\n=== 3. Strike position, on the circle ===\n');
{
  const d = solved.get('circle');
  const spots = [
    ['dead centre', 0, 0],
    ['quarter out', 0.14, 0],
    ['half out', 0.28, 0],
    ['near rim', 0.5, 0],
  ];
  console.log('spot          mode1%  centroid  loudness(rel)  clip%');
  const cents = [];
  for (const [label, px, py] of spots) {
    const heard = heardAt(d, px, py);
    const b = balance(d.freqs, heard, d.taus);
    const buf = render(d, heard);
    cents.push(b.centroid);
    console.log(
      `${label.padEnd(13)} ${(b.share[0] * 100).toFixed(1).padStart(6)} ` +
        `${b.centroid.toFixed(1).padStart(9)} ` +
        `${rms(buf, 0, 0.3).toFixed(4).padStart(14)} ` +
        `${(clippedFraction(buf) * 100).toFixed(1).padStart(6)}`,
    );
  }
  console.log(
    `\n  centroid spread: ${(12 * Math.log2(Math.max(...cents) / Math.min(...cents))).toFixed(2)} semitones`,
  );
}

console.log('\n=== 4. What is left after the transient? (circle, off-centre) ===\n');
{
  const d = solved.get('circle');
  const heard = heardAt(d, 0.2, 0.2);
  const buf = render(d, heard);
  console.log('  window      rms      what dominates');
  for (const [a, b] of [
    [0, 0.05],
    [0.05, 0.15],
    [0.15, 0.4],
    [0.4, 1.0],
    [1.0, 2.0],
  ]) {
    // which modes still have envelope above 1e-2 at the window's start
    const alive = [];
    for (let k = 0; k < d.freqs.length; k++) {
      if (Math.exp(-a / d.taus[k]) * Math.abs(heard[k]) > 0.02 * Math.abs(heard[0])) {
        alive.push(k + 1);
      }
    }
    console.log(
      `  ${String(a).padStart(4)}-${String(b).padEnd(5)} ${rms(buf, a, b).toFixed(4).padStart(7)}   modes ${alive.join(',') || 'none'}`,
    );
  }
  console.log(`\n  total rendered length: ${(buf.length / SR).toFixed(2)}s`);
}

console.log('\n=== 5. Does the fundamental now follow the shape? ===\n');
{
  const f = [];
  for (const id of ids) {
    const d = solved.get(id);
    f.push(d.freqs[0]);
    const st = 12 * Math.log2(d.freqs[0] / BASE_HZ);
    console.log(
      `    ${id.padEnd(11)} lambda1=${d.eigenvalues[0].toFixed(3).padStart(7)}  ` +
        `f1=${d.freqs[0].toFixed(1).padStart(6)} Hz  ` +
        `${st >= 0 ? '+' : ''}${st.toFixed(2)} st above the reference disk`,
    );
  }
  console.log(
    `\n  pitch spread across shapes: ${(12 * Math.log2(Math.max(...f) / Math.min(...f))).toFixed(2)} semitones`,
  );
}

console.log('\n=== 6. Isospectral pair must still agree exactly ===\n');
{
  const a = solve('gww-a');
  const b = solve('gww-b');
  let worst = 0;
  for (let k = 0; k < a.freqs.length; k++) {
    worst = Math.max(worst, Math.abs(a.freqs[k] / b.freqs[k] - 1));
  }
  console.log(`  gww-a f1=${a.freqs[0].toFixed(4)} Hz   gww-b f1=${b.freqs[0].toFixed(4)} Hz`);
  console.log(`  worst relative frequency disagreement: ${(worst * 100).toExponential(3)}%`);
}
