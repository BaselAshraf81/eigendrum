/**
 * Modal synthesis.
 *
 * A struck membrane's displacement is a sum over its modes:
 *
 *     u(x, t) = sum_k  a_k * phi_k(x) * sin(2 pi f_k t) * exp(-t / tau_k)
 *
 * The parts that come from the shape, and are therefore not negotiable:
 *   - f_k, the frequencies, from sqrt(lambda_k)
 *   - phi_k, the mode shapes, which decide how hard each mode is driven by a
 *     strike in a given place
 *
 * The parts that are honest modelling choices, because they depend on the
 * material and the mallet rather than the outline:
 *   - tau_k, the decay times
 *   - the overall pitch, which is set by size and tension
 *
 * The UI says as much. Nothing here is allowed to alter an overtone *ratio*.
 */

/** Lumped node areas: each triangle gives a third of its area to each vertex. */
export function nodeWeights(mesh) {
  const { nodes, nodeCount, triangles, triangleCount } = mesh;
  const w = new Float64Array(nodeCount);
  for (let t = 0; t < triangleCount; t++) {
    const a = triangles[t * 3];
    const b = triangles[t * 3 + 1];
    const c = triangles[t * 3 + 2];
    const ax = nodes[a * 2];
    const ay = nodes[a * 2 + 1];
    const area =
      Math.abs(
        (nodes[b * 2] - ax) * (nodes[c * 2 + 1] - ay) -
          (nodes[c * 2] - ax) * (nodes[b * 2 + 1] - ay),
      ) / 2;
    const share = area / 3;
    w[a] += share;
    w[b] += share;
    w[c] += share;
  }
  return w;
}

/**
 * Frequencies in Hz, with the fundamental pinned to `baseHz`.
 *
 * Only the overall scale is chosen; the ratios are exactly sqrt(lambda_k /
 * lambda_1), which is pure geometry. Physically this is the statement that
 * pitch is set by size and tension while timbre is set by shape.
 */
export function frequencies(eigenvalues, baseHz = 130) {
  const out = new Float64Array(eigenvalues.length);
  if (!eigenvalues.length) return out;
  const root = Math.sqrt(eigenvalues[0]);
  for (let k = 0; k < eigenvalues.length; k++) {
    out[k] = (baseHz * Math.sqrt(eigenvalues[k])) / root;
  }
  return out;
}

/**
 * How strongly a strike at (px, py) drives each mode.
 *
 * This is the projection of the mallet's force distribution onto each mode:
 * a_k = integral(phi_k * g), with g a normalised Gaussian of the given radius.
 * Two consequences fall out for free, both audible:
 *   - striking a mode's nodal line cannot excite that mode at all
 *   - a wide mallet cannot excite fine modes, so it sounds duller
 */
export function strikeAmplitudes(mesh, modes, px, py, radius, weights = null) {
  const { nodes, nodeCount } = mesh;
  const w = weights || nodeWeights(mesh);
  const g = new Float64Array(nodeCount);
  const r2 = Math.max(1e-9, radius * radius);
  let sum = 0;

  for (let i = 0; i < nodeCount; i++) {
    const dx = nodes[i * 2] - px;
    const dy = nodes[i * 2 + 1] - py;
    const v = Math.exp(-(dx * dx + dy * dy) / r2) * w[i];
    g[i] = v;
    sum += v;
  }

  if (sum <= 0) {
    // Degenerate mallet: fall back to the single nearest node.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodeCount; i++) {
      const dx = nodes[i * 2] - px;
      const dy = nodes[i * 2 + 1] - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    g.fill(0);
    g[best] = 1;
    sum = 1;
  }

  for (let i = 0; i < nodeCount; i++) g[i] /= sum;

  const amps = new Float64Array(modes.length);
  for (let k = 0; k < modes.length; k++) {
    const phi = modes[k];
    let acc = 0;
    for (let i = 0; i < nodeCount; i++) acc += g[i] * phi[i];
    amps[k] = acc;
  }
  return amps;
}

/**
 * Decay time per mode. High modes lose energy faster, which is why a struck
 * drum's tone darkens as it rings out. `brightness` in [0, 1] trades a dull
 * thud against a long shimmer.
 */
export function decayTimes(freqs, baseSeconds = 1.7, brightness = 0.5) {
  const out = new Float64Array(freqs.length);
  if (!freqs.length) return out;
  const exponent = 1.35 - brightness; // 0.35 (bright) .. 1.35 (dull)
  for (let k = 0; k < freqs.length; k++) {
    const ratio = freqs[k] / freqs[0];
    out[k] = Math.max(0.02, baseSeconds / Math.pow(ratio, exponent));
  }
  return out;
}

/**
 * Renders a strike into a mono Float32Array.
 *
 * Sums the decaying sinusoids directly. A struck membrane starts flat and
 * moving, so each mode starts at zero displacement - hence sine rather than
 * cosine, and no click at onset.
 */
export function renderStrike({
  freqs,
  amps,
  taus,
  sampleRate = 48000,
  duration = null,
  gain = 3.2,
}) {
  const longest = taus.length ? Math.max(...taus) : 0.3;
  const seconds = Math.min(4.5, Math.max(0.25, duration ?? longest * 2.9));
  const length = Math.max(1, Math.floor(seconds * sampleRate));
  const out = new Float32Array(length);

  const nyquist = sampleRate / 2;
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (!(f > 0) || f >= nyquist) continue; // never alias
    const a = amps[k] * gain;
    if (Math.abs(a) < 1e-6) continue;
    const tau = taus[k];

    // Evaluate by recurrence rather than calling sin and exp per sample. Two
    // Math calls per sample across sixteen modes and a quarter of a million
    // samples is on the order of four million transcendental evaluations, which
    // is enough main-thread work to visibly stall the animation when strikes come
    // quickly. Rotating a unit vector and scaling an envelope is a handful of
    // multiplies instead, and the drift over a few hundred thousand steps is
    // around 1e-10 relative - far below the 16-bit floor we render to.
    const w = (2 * Math.PI * f) / sampleRate;
    const cosw = Math.cos(w);
    const sinw = Math.sin(w);
    const decay = Math.exp(-1 / (tau * sampleRate));

    // Stop once this mode is inaudible instead of grinding out silence.
    const audibleSamples = Math.ceil(6.9 * tau * sampleRate); // exp(-6.9) ~ 1e-3
    const nEnd = Math.min(length, audibleSamples);

    let sin = 0;
    let cos = 1;
    let env = 1;
    for (let n = 0; n < nEnd; n++) {
      out[n] += a * sin * env;
      const nextSin = sin * cosw + cos * sinw;
      cos = cos * cosw - sin * sinw;
      sin = nextSin;
      env *= decay;
    }
  }

  // Soft limiter rather than peak normalisation: a strike near the rim really is
  // quieter than one in the middle, and flattening that would throw away
  // information the physics is trying to tell you.
  for (let n = 0; n < length; n++) out[n] = Math.tanh(out[n]);

  // Short fade-out so truncation cannot click.
  const fade = Math.min(length, Math.floor(0.012 * sampleRate));
  for (let i = 0; i < fade; i++) {
    out[length - fade + i] *= 1 - i / fade;
  }
  return out;
}

/** Displacement field at time t, for animating the drumhead as it rings. */
export function fieldAtTime(modes, amps, freqs, taus, t, out) {
  const n = out.length;
  out.fill(0);
  for (let k = 0; k < modes.length; k++) {
    const env = Math.exp(-t / taus[k]);
    if (env < 1e-4) continue;
    const c = amps[k] * Math.sin(2 * Math.PI * freqs[k] * t) * env;
    if (Math.abs(c) < 1e-9) continue;
    const phi = modes[k];
    for (let i = 0; i < n; i++) out[i] += c * phi[i];
  }
  return out;
}

/** Minimal 16-bit PCM WAV container. */
export function encodeWav(samples, sampleRate = 48000) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeStr = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    o += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
