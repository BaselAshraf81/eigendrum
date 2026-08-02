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
  audibleAmps,
  decayTimes,
  encodeWav,
  fieldAtTime,
  frequencies,
  modeNorms,
  nodeWeights,
  renderStrike,
  strikeAmplitudes,
  strikeHeadroom,
} from '../src/audio/synth.js';
import { freqToNote, harmonicity, ratios } from '../src/audio/notes.js';
import { decodeShape, encodeShape } from '../src/app/share.js';
import { strokeToPolygon } from '../src/app/draw.js';
import { normalizeShape, PRESETS } from '../src/app/presets.js';
import { area, simplifyClosed } from '../src/geom/polygon.js';

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

test('what you hear rolls off with frequency instead of being flat', () => {
  // The strike projection is pure geometry and has no rolloff at all: measured on
  // a disk, mode 14 came out with a *larger* projection than the fundamental.
  // Sixteen inharmonic partials at equal level is a gong. audibleAmps supplies
  // the two factors that were missing - the mass normalisation of the modes and
  // the 1/omega from impulsive force excitation - plus the mallet's contact time.
  const { mesh, modes, eigenvalues } = solveDrum(regularPolygon(256, 1), {
    modes: 14,
    targetNodes: 2200,
  });
  const freqs = frequencies(eigenvalues, 130);
  const w = nodeWeights(mesh);
  const norms = modeNorms(mesh, modes, w);
  const projected = strikeAmplitudes(mesh, modes, 0.22, 0, 0.06, w);
  const heard = audibleAmps(projected, norms, freqs, 2.2);

  const loudest = heard.reduce(
    (best, v, k) => (Math.abs(v) > Math.abs(heard[best]) ? k : best),
    0,
  );
  assert.equal(loudest, 0, 'the fundamental must be the loudest partial of a struck drum');

  // And the top of the range has to be well below it, not level with it.
  const top = Math.abs(heard[heard.length - 1]) / Math.abs(heard[0]);
  assert.ok(top < 0.35, `highest mode should be at least 9 dB down, ratio was ${top}`);

  // A nodal-line silence is still exactly silent: the correction is per-mode
  // scaling and cannot invent excitation where there was none.
  const centre = strikeAmplitudes(mesh, modes, 0, 0, 0.06, w);
  const centreHeard = audibleAmps(centre, norms, freqs, 2.2);
  for (const k of [1, 2]) {
    assert.ok(
      Math.abs(centreHeard[k]) < Math.abs(centreHeard[0]) * 0.05,
      `mode ${k + 1} must stay silent from the centre, got ${centreHeard[k]}`,
    );
  }
});

test('a physically scaled strike never reaches the soft limiter', () => {
  // The old default of gain = 3.2 drove the summed modes to a pre-limiter peak of
  // about 11, so two thirds of the first 300 ms came out of tanh hard clipped -
  // audible distortion manufactured by the renderer. The pre-existing clipping
  // test could not see it, because it only measured the limiter's own output,
  // which is inside [-1, 1] by construction. This measures the input.
  const { mesh, modes, eigenvalues } = solveDrum(regularPolygon(256, 1), {
    modes: 14,
    targetNodes: 2200,
  });
  const freqs = frequencies(eigenvalues, 130);
  const w = nodeWeights(mesh);
  const norms = modeNorms(mesh, modes, w);
  const taus = decayTimes(freqs, 1.7, 0.5);
  const head = strikeHeadroom(mesh, modes, norms, freqs, w, 0.06, 2.2);
  const gain = 0.72 / head;

  // The hardest strike available on this drum is the reference, so nothing can
  // exceed it. Sample the waveform densely through the attack.
  const loudest = modes[0].reduce(
    (best, v, i) => (Math.abs(v) > Math.abs(modes[0][best]) ? i : best),
    0,
  );
  const amps = audibleAmps(
    strikeAmplitudes(mesh, modes, mesh.nodes[loudest * 2], mesh.nodes[loudest * 2 + 1], 0.06, w),
    norms,
    freqs,
    2.2,
  );

  const sr = 48000;
  let peak = 0;
  for (let n = 0; n < 0.3 * sr; n++) {
    const t = n / sr;
    let v = 0;
    for (let k = 0; k < freqs.length; k++) {
      v += amps[k] * gain * Math.sin(2 * Math.PI * freqs[k] * t) * Math.exp(-t / taus[k]);
    }
    peak = Math.max(peak, Math.abs(v));
  }
  assert.ok(peak <= 0.9, `pre-limiter peak was ${peak}; tanh would be distorting`);
  assert.ok(peak > 0.1, `pre-limiter peak was only ${peak}; the strike would be inaudible`);
});

test('decay times follow Rayleigh damping, so loss grows with frequency squared', () => {
  // C = alpha M + beta K gives 1/tau = alpha + beta omega^2. The old law used a
  // tunable power of the frequency ratio which sat below 1 at the default, leaving
  // the high inharmonic cluster ringing for half a second.
  const freqs = Float64Array.from([100, 200, 400]);
  const taus = decayTimes(freqs, 1.7, 0.5);
  const rate = (i) => 1 / taus[i];
  const excess = (i) => rate(i) - rate(0);
  // Doubling the ratio must quadruple the frequency-dependent part of the loss.
  assert.ok(
    Math.abs(excess(2) / excess(1) - (16 - 1) / (4 - 1)) < 1e-9,
    'the frequency-dependent loss term must be quadratic',
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

test('the fast recurrence renders exactly what the direct formula would', () => {
  // renderStrike evaluates decaying sinusoids by rotating a unit vector instead
  // of calling Math.sin and Math.exp per sample, because the direct version was
  // slow enough to stall the animation. This pins the two together so the
  // optimisation cannot quietly change the sound.
  const sampleRate = 16000;
  const gain = 3.2;
  const freqs = Float64Array.from([131.3, 209.7, 288.1, 460.5]);
  const amps = Float64Array.from([0.42, -0.19, 0.08, -0.03]);
  const taus = Float64Array.from([1.1, 0.7, 0.45, 0.2]);

  const longest = Math.max(...taus);
  const seconds = Math.min(4.5, Math.max(0.25, longest * 2.9));
  const length = Math.max(1, Math.floor(seconds * sampleRate));
  const expected = new Float32Array(length);
  for (let k = 0; k < freqs.length; k++) {
    const a = amps[k] * gain;
    const tau = taus[k];
    const nEnd = Math.min(length, Math.ceil(6.9 * tau * sampleRate));
    for (let n = 0; n < nEnd; n++) {
      const t = n / sampleRate;
      expected[n] += a * Math.sin(2 * Math.PI * freqs[k] * t) * Math.exp(-t / tau);
    }
  }
  for (let n = 0; n < length; n++) expected[n] = Math.tanh(expected[n]);
  const fade = Math.min(length, Math.floor(0.012 * sampleRate));
  for (let i = 0; i < fade; i++) expected[length - fade + i] *= 1 - i / fade;

  const got = renderStrike({ freqs, amps, taus, sampleRate, gain });
  assert.equal(got.length, expected.length);

  let worst = 0;
  for (let n = 0; n < length; n++) worst = Math.max(worst, Math.abs(got[n] - expected[n]));
  assert.ok(worst < 2e-5, `recurrence drifted from the direct formula by ${worst}`);
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

test('closed-curve simplification does not depend on where the stroke started', () => {
  // The open-polyline version always keeps the first and last points, so the
  // result depended on where the pointer happened to go down and any wobble
  // there became a permanent corner. Splitting at geometric extremes instead
  // makes the outcome a property of the shape.
  const ellipse = (offset) => {
    const pts = [];
    for (let i = 0; i < 200; i++) {
      const a = (2 * Math.PI * ((i + offset) % 200)) / 200;
      pts.push({ x: 0.7 * Math.cos(a), y: 0.42 * Math.sin(a) });
    }
    return pts;
  };
  const key = (poly) =>
    poly
      .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)
      .sort()
      .join('|');

  const fromStart = simplifyClosed(ellipse(0), 0.004);
  const fromMiddle = simplifyClosed(ellipse(57), 0.004);
  assert.equal(key(fromStart), key(fromMiddle), 'seam position changed the result');
  assert.ok(fromStart.length > 8 && fromStart.length < 90, `got ${fromStart.length} vertices`);

  // And a smooth curve should not acquire a spike anywhere.
  const n = fromStart.length;
  let sharpest = 180;
  for (let i = 0; i < n; i++) {
    const a = fromStart[(i - 1 + n) % n];
    const b = fromStart[i];
    const c = fromStart[(i + 1) % n];
    const v1 = Math.atan2(b.y - a.y, b.x - a.x);
    const v2 = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(v2 - v1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    sharpest = Math.min(sharpest, 180 - (turn * 180) / Math.PI);
  }
  assert.ok(sharpest > 120, `a smooth ellipse grew a ${sharpest.toFixed(1)} degree corner`);
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
