/**
 * Eigendrum — wiring.
 *
 * Owns the DOM, the audio context, the animation loop, and the conversation with
 * the solver worker. All the physics lives in src/math, src/geom and src/fem;
 * nothing here is allowed to invent a frequency.
 */

import { Board } from './canvas.js';
import { PRESETS, PRESETS_BY_ID, normalizeShape } from './presets.js';
import { renderSpectrum, setSelected } from './spectrum.js';
import { strokeToPolygon } from './draw.js';
import { readHash, shareUrl, writeHash } from './share.js';
import { freqToNote, harmonicity } from '../audio/notes.js';
import {
  decayTimes,
  encodeWav,
  fieldAtTime,
  frequencies,
  nodeWeights,
  renderStrike,
  strikeAmplitudes,
} from '../audio/synth.js';
import {
  diskSpectrum,
  rectangleSpectrum,
  rightIsoscelesTriangleSpectrum,
} from '../math/analytic.js';

const MODES = 16;
// Accuracy against the exact answers is around half a percent here, which is far
// finer than the ear can hear, and it keeps the solve fast enough that drawing a
// shape feels immediate.
const TARGET_NODES = 2200;

const el = (id) => document.getElementById(id);
const els = {
  board: el('board'),
  hint: el('stage-hint'),
  busy: el('stage-busy'),
  busyText: el('busy-text'),
  readout: el('readout'),
  presets: el('presets'),
  spectrum: el('spectrum'),
  facts: el('facts'),
  drawBtn: el('btn-draw'),
  drawHint: el('draw-hint'),
  kac: el('kac-callout'),
  kacText: el('kac-text'),
  kacSwap: el('btn-kac-swap'),
  pitch: el('ctl-pitch'),
  pitchOut: el('out-pitch'),
  bright: el('ctl-bright'),
  brightOut: el('out-bright'),
  mallet: el('ctl-mallet'),
  malletOut: el('out-mallet'),
  mesh: el('ctl-mesh'),
  mute: el('btn-mute'),
  about: el('btn-about'),
  dlgAbout: el('dlg-about'),
  share: el('btn-share'),
  wav: el('btn-wav'),
  png: el('btn-png'),
  shareStatus: el('share-status'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const board = new Board(els.board);

const state = {
  source: { kind: 'preset', id: 'circle' },
  presetId: 'circle',
  drum: null,
  weights: null,
  freqs: null,
  view: 'mode',
  selectedMode: 0,
  strike: null,
  fieldBuf: null,
  cursor: { x: 0, y: 0 },
  drawMode: false,
  drawing: false,
  stroke: [],
  muted: false,
  lastWav: null,
  requestId: 0,
};

// --------------------------------------------------------------------- worker

const worker = new Worker(new URL('../worker/solver.worker.js', import.meta.url), {
  type: 'module',
});

worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.id !== state.requestId) return; // a newer request superseded this one

  if (msg.type === 'progress') {
    const label =
      msg.stage === 'meshing'
        ? 'Building the mesh…'
        : msg.stage === 'assembling'
          ? 'Assembling the matrices…'
          : msg.stage === 'factorising'
            ? 'Factorising…'
            : 'Finding the modes…';
    els.busyText.textContent = label;
    return;
  }

  if (msg.type === 'error') {
    setBusy(false);
    els.readout.innerHTML = `<span class="warn">${escapeHtml(msg.message)}</span>`;
    return;
  }

  setBusy(false);
  onSolved(msg);
};

function solve(source) {
  const preset = source.kind === 'preset' ? PRESETS_BY_ID.get(source.id) : null;
  const rawPolygon = preset ? preset.polygon : source.polygon;
  if (!rawPolygon) return;

  const { polygon, align } = normalizeShape(rawPolygon, preset?.latticePitch || 0);

  state.source = source;
  state.presetId = preset ? preset.id : null;
  state.requestId += 1;
  setBusy(true, 'Building the mesh…');
  updatePresetChips();
  updateKacCallout(preset);

  worker.postMessage({
    id: state.requestId,
    polygon,
    align,
    modes: MODES,
    targetNodes: TARGET_NODES,
  });

  writeHash(
    source.kind === 'preset' ? { kind: 'preset', id: source.id } : { kind: 'custom', polygon },
  );
}

function onSolved(msg) {
  state.drum = { mesh: msg.mesh, modes: msg.modes, eigenvalues: msg.eigenvalues };
  state.diagnostics = msg.diagnostics;
  state.weights = nodeWeights(msg.mesh);
  state.fieldBuf = new Float64Array(msg.mesh.nodeCount);
  state.strike = null;
  state.view = 'mode';
  state.selectedMode = 0;
  state.cursor = { x: 0, y: 0 };
  state.lastWav = null;

  recomputeFrequencies();
  board.setDrum(state.drum);
  renderSpectrum(els.spectrum, Array.from(state.freqs), state.selectedMode, selectMode);
  renderFacts();
  renderReadout();
  els.hint.hidden = false;
  els.hint.textContent = state.drawMode
    ? 'Drag to draw an outline'
    : 'Tap the drum to strike it';
}

function recomputeFrequencies() {
  if (!state.drum) return;
  state.freqs = frequencies(state.drum.eigenvalues, Number(els.pitch.value));
}

// ---------------------------------------------------------------------- audio

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function malletRadius() {
  // Slider is a percentage of the drum's typical dimension (area is 1, so a
  // characteristic length is about 1).
  return Number(els.mallet.value) / 100;
}

function brightness() {
  return Number(els.bright.value) / 100;
}

function strike(x, y) {
  const { drum } = state;
  if (!drum) return;

  const amps = strikeAmplitudes(drum.mesh, drum.modes, x, y, malletRadius(), state.weights);
  const freqs = state.freqs;
  const taus = decayTimes(freqs, 1.7, brightness());

  // Reference amplitude for the colour scale: peak displacement near the moment
  // the fundamental first reaches full swing.
  const probe = new Float64Array(drum.mesh.nodeCount);
  fieldAtTime(drum.modes, amps, freqs, taus, 1 / (4 * freqs[0]), probe);
  let peak = 0;
  for (let i = 0; i < probe.length; i++) {
    const a = Math.abs(probe[i]);
    if (a > peak) peak = a;
  }

  state.strike = {
    x,
    y,
    amps,
    taus,
    t0: performance.now(),
    refAmp: peak > 1e-9 ? peak : 1,
    maxTau: Math.max(...taus),
  };
  state.view = 'struck';
  els.hint.hidden = true;

  if (state.muted) return;
  const ctx = ensureAudio();
  if (!ctx) return;

  const samples = renderStrike({
    freqs,
    amps,
    taus,
    sampleRate: ctx.sampleRate,
  });
  state.lastWav = { samples, sampleRate: ctx.sampleRate };

  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.85;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

// -------------------------------------------------------------------- rendering

function frame(now) {
  board.resize();
  board.clear();

  if (state.drawing || (state.drawMode && state.stroke.length)) {
    board.drawStroke(state.stroke, false);
    requestAnimationFrame(frame);
    return;
  }

  if (state.drum) {
    const { drum } = state;

    if (state.view === 'struck' && state.strike) {
      const t = (now - state.strike.t0) / 1000;
      fieldAtTime(drum.modes, state.strike.amps, state.freqs, state.strike.taus, t, state.fieldBuf);
      board.drawField(state.fieldBuf, state.strike.refAmp);
      if (t > state.strike.maxTau * 3.2) {
        state.view = 'mode';
        els.hint.hidden = false;
      }
    } else {
      const phi = drum.modes[state.selectedMode] || drum.modes[0];
      // A real standing wave passes through flat twice a cycle, which would leave
      // the drum invisible half the time. Keep the sign inversion — that is the
      // interesting part — but floor the magnitude so the shape always reads.
      let osc = 0.85;
      if (!reducedMotion) {
        const s = Math.sin(2 * Math.PI * 0.5 * (now / 1000));
        osc = (s < 0 ? -1 : 1) * (0.34 + 0.66 * Math.abs(s));
      }
      for (let i = 0; i < phi.length; i++) state.fieldBuf[i] = phi[i] * osc;
      board.drawField(state.fieldBuf, 1);
    }

    if (els.mesh.checked) board.drawMesh();
    board.drawOutline();

    if (state.strike && state.view === 'struck') {
      board.drawStrikeMarker(
        state.strike.x,
        state.strike.y,
        (now - state.strike.t0) / 1000,
      );
    }

    if (document.activeElement === els.board && !state.drawMode) {
      const p = board.toPixel(state.cursor.x, state.cursor.y);
      const ctx = board.ctx;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 * board.dpr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2 * board.dpr;
      ctx.stroke();
    }
  }

  requestAnimationFrame(frame);
}

function renderReadout() {
  if (!state.drum || !state.freqs) return;
  const f0 = state.freqs[0];
  const note = freqToNote(f0);
  const harm = harmonicity(Array.from(state.freqs));
  const r1 = state.freqs[1] / f0;
  els.readout.innerHTML =
    `Lowest mode <strong>${f0.toFixed(1)} Hz</strong> (${note.label}). ` +
    `Second mode is <strong>${r1.toFixed(3)}\u00D7</strong> the first — ` +
    `${escapeHtml(harm.verdict)}.`;
}

function fmtPercent(v) {
  if (v === 0) return 'exact';
  if (v < 0.0001) return '< 0.01%';
  return `${(v * 100).toFixed(v < 0.01 ? 3 : 2)}%`;
}

/** Closed-form spectrum for the unit-area version of a preset, if one exists. */
function exactSpectrum(presetId, count) {
  switch (presetId) {
    case 'circle':
      // Unit area means radius 1/sqrt(pi), and lambda = (j/R)^2 = j^2 * pi.
      return diskSpectrum(count, 1 / Math.sqrt(Math.PI));
    case 'square':
      return rectangleSpectrum(count, 1, 1);
    case 'righttriangle':
      // Unit area with legs L gives L^2/2 = 1, so L = sqrt(2).
      return rightIsoscelesTriangleSpectrum(count, Math.SQRT2);
    default:
      return null;
  }
}

function renderFacts() {
  const d = state.diagnostics;
  if (!d) return;
  const rows = [];

  const exact = exactSpectrum(state.presetId, Math.min(8, state.drum.eigenvalues.length));
  if (exact) {
    let worst = 0;
    for (let k = 0; k < exact.length; k++) {
      worst = Math.max(
        worst,
        Math.abs(state.drum.eigenvalues[k] - exact[k]) / exact[k],
      );
    }
    rows.push([
      'Error vs exact answer',
      fmtPercent(worst),
      worst < 0.01 ? 'good' : 'warn',
    ]);
  } else {
    rows.push(['Exact answer', 'no formula exists', '']);
  }

  rows.push(['Unknowns solved', d.unknowns.toLocaleString(), '']);
  rows.push(['Triangles', d.triangleCount.toLocaleString(), '']);
  rows.push(['Smallest angle', `${d.minAngleDeg.toFixed(1)}\u00B0`, '']);
  rows.push([
    'Shape reproduced to',
    d.areaError < 1e-12 ? 'exact' : fmtPercent(d.areaError),
    d.areaError < 1e-12 ? 'good' : '',
  ]);
  rows.push(['Eigen residual', d.maxResidual.toExponential(1), '']);
  rows.push(['Solve time', `${d.solveMs} ms`, '']);

  els.facts.textContent = '';
  for (const [label, value, cls] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (cls) dd.className = cls;
    els.facts.append(dt, dd);
  }
}

function setBusy(on, text = 'Solving…') {
  els.busy.hidden = !on;
  if (on) els.busyText.textContent = text;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ---------------------------------------------------------------------- chips

function updatePresetChips() {
  [...els.presets.children].forEach((chip) => {
    chip.setAttribute('aria-pressed', String(chip.dataset.id === state.presetId));
  });
}

function buildPresetChips() {
  for (const preset of PRESETS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.id = preset.id;
    chip.textContent = preset.name;
    chip.title = preset.blurb;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      setDrawMode(false);
      solve({ kind: 'preset', id: preset.id });
    });
    els.presets.appendChild(chip);
  }
}

function updateKacCallout(preset) {
  if (preset && preset.pairedWith) {
    els.kac.hidden = false;
    els.kacText.textContent = preset.blurb;
    els.kacSwap.dataset.target = preset.pairedWith;
  } else {
    els.kac.hidden = true;
  }
}

function selectMode(i) {
  state.selectedMode = i;
  state.view = 'mode';
  state.strike = null;
  setSelected(els.spectrum, i);
  const f = state.freqs[i];
  const note = freqToNote(f);
  els.readout.innerHTML =
    `Mode <strong>${i + 1}</strong> at <strong>${f.toFixed(1)} Hz</strong> (${note.label}). ` +
    'Dark curves are nodal lines, where the surface never moves.';
}

// ---------------------------------------------------------------------- input

function setDrawMode(on) {
  state.drawMode = on;
  state.stroke = [];
  state.drawing = false;
  els.drawBtn.setAttribute('aria-pressed', String(on));
  els.drawBtn.textContent = on ? 'Cancel drawing' : 'Draw your own';
  els.drawHint.hidden = !on;
  els.hint.hidden = false;
  els.hint.textContent = on ? 'Drag to draw an outline' : 'Tap the drum to strike it';
  els.board.style.cursor = on ? 'cell' : 'crosshair';
}

els.board.addEventListener('pointerdown', (e) => {
  els.board.focus();
  if (state.drawMode) {
    state.drawing = true;
    state.stroke = [board.fromClientDraw(e.clientX, e.clientY)];
    els.board.setPointerCapture(e.pointerId);
    return;
  }
  const p = board.fromClient(e.clientX, e.clientY);
  if (board.containsShapePoint(p.x, p.y)) {
    state.cursor = p;
    strike(p.x, p.y);
  }
});

els.board.addEventListener('pointermove', (e) => {
  if (!state.drawing) return;
  const p = board.fromClientDraw(e.clientX, e.clientY);
  const last = state.stroke[state.stroke.length - 1];
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.004) state.stroke.push(p);
});

function finishStroke() {
  if (!state.drawing) return;
  state.drawing = false;
  const result = strokeToPolygon(state.stroke);
  state.stroke = [];
  if (!result.ok) {
    els.readout.innerHTML = `<span class="warn">${escapeHtml(result.error)}</span>`;
    return;
  }
  setDrawMode(false);
  solve({ kind: 'custom', polygon: result.polygon });
}

els.board.addEventListener('pointerup', finishStroke);
els.board.addEventListener('pointercancel', () => {
  state.drawing = false;
  state.stroke = [];
});

els.board.addEventListener('keydown', (e) => {
  if (state.drawMode) return;
  const step = e.shiftKey ? 0.02 : 0.06;
  let handled = true;
  switch (e.key) {
    case 'ArrowLeft':
      state.cursor.x -= step;
      break;
    case 'ArrowRight':
      state.cursor.x += step;
      break;
    case 'ArrowUp':
      state.cursor.y += step;
      break;
    case 'ArrowDown':
      state.cursor.y -= step;
      break;
    case 'Enter':
    case ' ':
      if (board.containsShapePoint(state.cursor.x, state.cursor.y)) {
        strike(state.cursor.x, state.cursor.y);
      }
      break;
    default:
      handled = false;
  }
  if (handled) e.preventDefault();
});

// -------------------------------------------------------------------- controls

els.pitch.addEventListener('input', () => {
  els.pitchOut.textContent = `${els.pitch.value} Hz`;
  recomputeFrequencies();
  if (state.freqs) {
    renderSpectrum(els.spectrum, Array.from(state.freqs), state.selectedMode, selectMode);
    renderReadout();
  }
});

els.bright.addEventListener('input', () => {
  const v = brightness();
  els.brightOut.textContent = v < 0.28 ? 'short thud' : v > 0.72 ? 'long shimmer' : 'balanced';
});

els.mallet.addEventListener('input', () => {
  const v = Number(els.mallet.value);
  els.malletOut.textContent = v < 7 ? 'hard stick' : v > 20 ? 'soft beater' : 'medium';
});

els.mesh.addEventListener('change', () => {});

els.drawBtn.addEventListener('click', () => setDrawMode(!state.drawMode));

els.kacSwap.addEventListener('click', () => {
  const target = els.kacSwap.dataset.target;
  if (target) solve({ kind: 'preset', id: target });
});

els.mute.addEventListener('click', () => {
  state.muted = !state.muted;
  els.mute.setAttribute('aria-pressed', String(state.muted));
  els.mute.textContent = state.muted ? 'Sound off' : 'Sound on';
});

els.about.addEventListener('click', () => els.dlgAbout.showModal());

els.share.addEventListener('click', async () => {
  const url = shareUrl(
    state.source.kind === 'preset'
      ? { kind: 'preset', id: state.source.id }
      : { kind: 'custom', polygon: normalizeShape(state.source.polygon).polygon },
  );
  try {
    await navigator.clipboard.writeText(url);
    els.shareStatus.textContent = 'Link copied.';
  } catch {
    els.shareStatus.textContent = url;
  }
});

els.wav.addEventListener('click', () => {
  if (!state.lastWav) {
    els.shareStatus.textContent = 'Strike the drum first, then download its sound.';
    return;
  }
  const blob = encodeWav(state.lastWav.samples, state.lastWav.sampleRate);
  download(blob, `eigendrum-${state.presetId || 'custom'}.wav`);
  els.shareStatus.textContent = 'Sound saved.';
});

els.png.addEventListener('click', () => {
  els.board.toBlob((blob) => {
    if (blob) download(blob, `eigendrum-${state.presetId || 'custom'}.png`);
    els.shareStatus.textContent = 'Image saved.';
  });
});

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

window.addEventListener('resize', () => board.resize());

// ------------------------------------------------------------------- start up

buildPresetChips();
board.resize();
requestAnimationFrame(frame);

const fromUrl = readHash();
if (fromUrl?.kind === 'custom') solve({ kind: 'custom', polygon: fromUrl.polygon });
else if (fromUrl?.kind === 'preset' && PRESETS_BY_ID.has(fromUrl.id)) {
  solve({ kind: 'preset', id: fromUrl.id });
} else {
  solve({ kind: 'preset', id: 'circle' });
}
