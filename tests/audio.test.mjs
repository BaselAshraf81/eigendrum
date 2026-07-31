/**
 * Tests for the audio pipeline and the shape plumbing.
 *
 * The interesting ones here are physical rather than mechanical: the strike model
 * should reproduce facts about drums that nobody coded in explicitly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { solveDrum } from '../src/fem/solve.js';
import { besselJZero } from '../src/math/bessel.js';
import { regularPolygon } from '../src/math/analytic.js';
import {
  decayTimes,
  encodeWav,
  fieldAtTime,
  frequencies,
  nodeWeights,
  renderStrike,
  strikeAmplitudes,
} from '../src/audio/synth.js';
import { freqToNote, harmonicity, ratios } from '../src/audio/notes.js';
import { decodeShape, encodeShape } from '../src/app/share.js';
import { strokeToPolygon } from '../src/app/draw.js';
import { normalizeShape, PRESETS } from '../src/app/presets.js';
import { area } from '../src/geom/polygon.js';

const circle = () => solveDrum(regularPolygon(256, 1), { modes: 6, targetNodes: 2600 });

test('frequency ratios of a circle follow the Bessel zeros', () => {
  const { eigenvalues } = circle();
  const freqs = frequencies(eigenvalues, 100);
  assert.ok(Math.abs(freqs[0] - 100) < 1e-9, 'fundamental should be pinned to the base pitch');

  // The second mode of a disk is the first zero of J1 over the first of J0.
  const expected = besselJZero(1, 1) / besselJZero(0, 1);
  const got = freqs[1] / freqs[0];
  assert.ok(
    Math.abs(got - expected) / expected < 0.01,
    `ratio ${got} should be near ${expected}`,
  );
  assert.ok(Math.abs(expected - 1.5933) < 0.001, 'sanity: that ratio is about 1.5933');
});

test('a circle is inharmonic, which is why drums have no clear pitch', () => {
  const { eigenvalues } = circle();
  const freqs = Array.from(frequencies(eigenvalues, 120));
  const h = harmonicity(freqs);
  assert.ok(h.centsOff > 60, `expected clearly inharmonic, got ${h.centsOff} cents`);
  assert.match(h.verdict, /nharmonic/);
});

test('striking the centre of a circle cannot excite modes with a nodal diameter', () => {
  // Mode 1 of a disk is radially symmetric, so its peak is at the centre.
  // Modes 2 and 3 have a nodal line straight through the centre, so a centred
  // strike must barely move them. Nothing in the code special-cases this; it
  // falls out of projecting the mallet onto the mode shapes.
  const { mesh, modes } = circle();
  const w = nodeWeights(mesh);
  const amps = strikeAmplitudes(mesh, modes, 0, 0, 0.06, w);

  const first = Math.abs(amps[0]);
  assert.ok(first > 0.2, `fundamental should be driven hard, got ${first}`);
  for (const k of [1, 2]) {
    assert.ok(
      Math.abs(amps[k]) < first * 0.05,
      `mode ${k + 1} should be nearly silent from the centre, got ${amps[k]} vs ${first}`,
    );
  }
});

test('an off-centre strike does excite the second mode', () => {
  const { mesh, modes } = circle();
  const amps = strikeAmplitudes(mesh, modes, 0.25, 0, 0.06);
  assert.ok(
    Math.abs(amps[1]) > 0.05 * Math.abs(amps[0]),
    'moving off centre should wake the second mode up',
  );
});

test('a wider mallet produces a duller strike', () => {
  const { mesh, modes } = circle();
  const hard = strikeAmplitudes(mesh, modes, 0.2, 0.1, 0.03);
  const soft = strikeAmplitudes(mesh, modes, 0.2, 0.1, 0.25);
  const brightness = (a) => Math.abs(a[a.length - 1]) / Math.abs(a[0]);
  assert.ok(
    brightness(soft) < brightness(hard),
    'a soft beater should drive the high modes relatively less',
  );
});

test('decay times fall with frequency', () => {
  const freqs = Float64Array.from([100, 200, 400, 800]);
  const taus = decayTimes(freqs, 1.5, 0.5);
  for (let i = 1; i < taus.length; i++) {
    assert.ok(taus[i] < taus[i - 1], 'higher modes must fade faster');
    assert.ok(taus[i] > 0);
  }
});

test('a rendered strike is finite, audible, and never clips', () => {
  const { mesh, modes, eigenvalues } = circle();
  const freqs = frequencies(eigenvalues, 130);
  const amps = strikeAmplitudes(mesh, modes, 0.1, 0.1, 0.09);
  const taus = decayTimes(freqs, 1.7, 0.5);
  const samples = renderStrike({ freqs, amps, taus, sampleRate: 24000 });

  assert.ok(samples.length > 1000);
  let peak = 0;
  for (const v of samples) {
    assert.ok(Number.isFinite(v), 'sample was not finite');
    peak = Math.max(peak, Math.abs(v));
  }
  assert.ok(peak > 0.05, `expected an audible signal, peak was ${peak}`);
  assert.ok(peak <= 1, `soft limiter should keep it inside range, got ${peak}`);
  assert.ok(Math.abs(samples[0]) < 1e-6, 'a struck membrane starts at rest, so no click');
});

test('modes above the Nyquist frequency are dropped rather than aliased', () => {
  const freqs = Float64Array.from([200, 40000]);
  const amps = Float64Array.from([0.5, 0.5]);
  const taus = Float64Array.from([1, 1]);
  const low = renderStrike({ freqs: freqs.subarray(0, 1), amps: amps.subarray(0, 1), taus: taus.subarray(0, 1), sampleRate: 48000 });
  const both = renderStrike({ freqs, amps, taus, sampleRate: 48000 });
  for (let i = 0; i < Math.min(low.length, both.length); i++) {
    assert.ok(Math.abs(low[i] - both[i]) < 1e-9, 'the 40 kHz mode should contribute nothing');
  }
});

test('the animation field agrees with the modes it sums', () => {
  const { mesh, modes, eigenvalues } = circle();
  const freqs = frequencies(eigenvalues, 130);
  const amps = strikeAmplitudes(mesh, modes, 0.05, 0.05, 0.08);
  const taus = decayTimes(freqs, 1.7, 0.5);
  const out = new Float64Array(mesh.nodeCount);

  fieldAtTime(modes, amps, freqs, taus, 0, out);
  for (const v of out) assert.ok(Math.abs(v) < 1e-12, 'at t=0 the membrane is still flat');

  fieldAtTime(modes, amps, freqs, taus, 1 / (4 * freqs[0]), out);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0, 'a quarter period later it should be moving');

  // Boundary nodes are clamped, always.
  for (let i = 0; i < mesh.nodeCount; i++) {
    if (mesh.isBoundary[i]) assert.equal(out[i], 0, 'the rim never moves');
  }
});

test('WAV encoding produces a well-formed header', async () => {
  const blob = encodeWav(new Float32Array(1000).fill(0.5), 44100);
  assert.equal(blob.type, 'audio/wav');
  const buf = new DataView(await blob.arrayBuffer());
  const tag = (o) => String.fromCharCode(buf.getUint8(o), buf.getUint8(o + 1), buf.getUint8(o + 2), buf.getUint8(o + 3));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(12), 'fmt ');
  assert.equal(tag(36), 'data');
  assert.equal(buf.getUint32(24, true), 44100, 'sample rate');
  assert.equal(buf.getUint16(22, true), 1, 'mono');
  assert.equal(buf.byteLength, 44 + 2000);
});

test('note naming is correct at known anchors', () => {
  assert.equal(freqToNote(440).name, 'A');
  assert.equal(freqToNote(440).octave, 4);
  assert.equal(freqToNote(440).cents, 0);
  assert.equal(freqToNote(261.6256).name, 'C');
  assert.equal(freqToNote(261.6256).octave, 4);
  // Avoid exactly 50 cents: that sits equidistant between two names, so either
  // answer is right and the test would only be asserting a rounding convention.
  const sharp = freqToNote(440 * Math.pow(2, 30 / 1200));
  assert.equal(sharp.name, 'A');
  assert.equal(sharp.cents, 30);
  const flat = freqToNote(440 * Math.pow(2, -30 / 1200));
  assert.equal(flat.cents, -30);
  assert.equal(freqToNote(440).label, 'A4');
});

test('ratios are relative to the fundamental', () => {
  assert.deepEqual(ratios([100, 200, 350]), [1, 2, 3.5]);
});

test('shape encoding survives a round trip through a URL', () => {
  const original = regularPolygon(40, 0.8);
  const decoded = decodeShape(encodeShape(original));
  assert.equal(decoded.length, original.length);
  for (let i = 0; i < original.length; i++) {
    // 16-bit fixed point over +/-4 gives a resolution of about 1.2e-4.
    assert.ok(Math.abs(decoded[i].x - original[i].x) < 2e-4);
    assert.ok(Math.abs(decoded[i].y - original[i].y) < 2e-4);
  }
  assert.equal(decodeShape('not valid base64 @@@'), null);
});

test('normalising a shape gives it unit area and keeps the lattice pitch consistent', () => {
  for (const preset of PRESETS) {
    const { polygon, align } = normalizeShape(preset.polygon, preset.latticePitch || 0);
    assert.ok(Math.abs(area(polygon) - 1) < 1e-9, `${preset.id} should have unit area`);
    if (preset.latticePitch) {
      assert.ok(align > 0, `${preset.id} should keep an aligned lattice pitch`);
    }
  }
});

test('freehand strokes are cleaned up, and bad ones are rejected', () => {
  // A circular stroke with realistic jitter should be accepted.
  const stroke = [];
  for (let i = 0; i <= 160; i++) {
    const a = (2 * Math.PI * i) / 160;
    const r = 0.6 + 0.002 * Math.sin(i * 3.7);
    stroke.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const ok = strokeToPolygon(stroke);
  assert.ok(ok.ok, ok.error);
  assert.ok(ok.polygon.length >= 8 && ok.polygon.length <= 220);

  assert.equal(strokeToPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }]).ok, false);

  // A figure of eight has no well-defined interior.
  const eight = [];
  for (let i = 0; i <= 200; i++) {
    const t = (2 * Math.PI * i) / 200;
    eight.push({ x: 0.5 * Math.sin(2 * t), y: 0.5 * Math.sin(t) });
  }
  const bad = strokeToPolygon(eight);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /crosses itself|no area|too simple/);
});
