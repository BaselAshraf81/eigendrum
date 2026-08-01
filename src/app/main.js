/**
 * Eigendrum — wiring.
 *
 * Owns the DOM, the audio context, the animation loop, and the conversation with
 * the solver worker. All the physics lives in src/math, src/geom and src/fem;
 * nothing here is allowed to invent a frequency.
 */

import { Board } from './canvas.js';
import { PRESETS, PRESETS_BY_ID, normalizeShape } from './presets.js';
import { renderComb, renderSpectrum, setSelected } from './spectrum.js';
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
// Accuracy against the exact answers is around half a percent here, far finer
// than the ear can hear, and it keeps the solve fast enough that drawing a shape
// feels immediate.
const TARGET_NODES = 2200;
const MAX_VOICES = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

const el = (id) => document.getElementById(id);
const els = {
  board: el('board'),
  prompt: el('prompt'),
  solving: el('solving'),
  solvingText: el('solving-text'),
  notice: el('notice'),
  readout: el('readout'),
  presets: el('presets'),
  spectrum: el('spectrum'),
  modesCount: el('modes-count'),
  staleNote: el('stale-note'),
  facts: el('facts'),
  aboutBody: el('about-body'),
  drawBtn: el('btn-draw'),
  drawLabel: el('draw-label'),
  kac: el('kac'),
  kacText: el('kac-text'),
  kacSwap: el('btn-kac-swap'),
  pitch: el('ctl-pitch'),
  pitchOut: el('out-pitch'),
  bright: el('ctl-bright'),
  brightOut: el('out-bright'),
  mallet: el('ctl-mallet'),
  malletOut: el('out-mallet'),
  mesh: el('ctl-mesh'),
  sound: el('btn-sound'),
  soundLabel: el('sound-label'),
  soundCut: el('sound-cut'),
  about: el('btn-about'),
  dlgAbout: el('dlg-about'),
  share: el('btn-share'),
  wav: el('btn-wav'),
  png: el('btn-png'),
  shareStatus: el('share-status'),
};

const combEls = {
  axis: el('comb-axis'),
  lo: el('comb-lo'),
  hi: el('comb-hi'),
  caption: el('comb-caption'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const board = new Board(els.board);

const state = {
  source: { kind: 'preset', id: 'circle' },
  presetId: 'circle',
  drum: null,
  diagnostics: null,
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
  voices: [],
  // The other half of the isospectral pair, solved in the background so the comb
  // can draw its spectrum against this one and the match can be measured rather
  // than asserted.
  partner: null,
  partnerReqId: 0,
};

// --------------------------------------------------------------------- worker

const worker = new Worker(new URL('../worker/solver.worker.js', import.meta.url), {
  type: 'module',
});

const STAGES = {
  meshing: 'building the mesh',
  assembling: 'assembling the matrices',
  factorising: 'factorising',
  solving: 'finding the modes',
};

worker.onmessage = (event) => {
  const msg = event.data;

  // The background solve of the paired Kac drum, on its own request lane.
  if (msg.id === state.partnerReqId) {
    if (msg.type === 'done') {
      state.partner = { eigenvalues: msg.eigenvalues };
      refreshComb();
      updateKacMatch();
    }
    return;
  }

  if (msg.id !== state.requestId) return; // a newer request superseded this one

  if (msg.type === 'progress') {
    els.solvingText.textContent = STAGES[msg.stage] || 'solving';
    return;
  }
  if (msg.type === 'error') {
    setSolving(false);
    showNotice(msg.message);
    return;
  }
  setSolving(false);
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
  clearNotice();
  setSolving(true);
  updatePresetChips();
  updateKac(preset);

  worker.postMessage({
    id: state.requestId,
    polygon,
    align,
    modes: MODES,
    targetNodes: TARGET_NODES,
  });

  // For a Kac drum, solve its partner too. The pair's whole claim is that the two
  // spectra are the same, and that is only worth showing if we have both.
  state.partner = null;
  const pairedId = preset?.pairedWith;
  if (pairedId && PRESETS_BY_ID.has(pairedId)) {
    const other = PRESETS_BY_ID.get(pairedId);
    const otherShape = normalizeShape(other.polygon, other.latticePitch || 0);
    state.partnerReqId = state.requestId + 100000;
    worker.postMessage({
      id: state.partnerReqId,
      polygon: otherShape.polygon,
      align: otherShape.align,
      modes: MODES,
      targetNodes: TARGET_NODES,
    });
  } else {
    state.partnerReqId = 0;
  }

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
  els.modesCount.textContent = `${state.freqs.length} computed`;
  refreshComb();
  renderFacts();
  renderReadout();
  updateKacMatch();
  showPrompt();
}

function partnerFreqs() {
  if (!state.partner) return null;
  return Array.from(frequencies(state.partner.eigenvalues, Number(els.pitch.value)));
}

function refreshComb() {
  if (!state.freqs) return;
  // No tick is highlighted while the drum is ringing, because then you are
  // looking at every mode at once rather than one of them.
  const selected = state.view === 'struck' ? -1 : state.selectedMode;
  renderComb(combEls, Array.from(state.freqs), selected, partnerFreqs());
}

/** States the measured agreement between the two Kac drums, rather than claiming it. */
function updateKacMatch() {
  const existing = els.kac.querySelector('.kac-match');
  if (els.kac.hidden || !state.partner || !state.drum) {
    if (existing) existing.remove();
    return;
  }
  const a = state.drum.eigenvalues;
  const b = state.partner.eigenvalues;
  const n = Math.min(a.length, b.length);
  let worst = 0;
  for (let k = 0; k < n; k++) {
    worst = Math.max(worst, Math.abs(a[k] - b[k]) / ((a[k] + b[k]) / 2));
  }

  const line = document.createElement('p');
  line.className = 'kac-match';
  line.textContent =
    worst < 1e-9
      ? `Solved both just now: all ${n} frequencies agree to every digit computed.`
      : `Solved both just now: all ${n} frequencies agree to within ${(worst * 100).toPrecision(2)}%.`;
  if (existing) existing.replaceWith(line);
  else els.kacText.after(line);
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

const malletRadius = () => Number(els.mallet.value) / 100;
const brightness = () => Number(els.bright.value) / 100;

function strike(x, y) {
  const { drum } = state;
  if (!drum) return;

  const amps = strikeAmplitudes(drum.mesh, drum.modes, x, y, malletRadius(), state.weights);
  const freqs = state.freqs;
  const taus = decayTimes(freqs, 1.7, brightness());

  // Reference amplitude for the colour bands: peak displacement near the moment
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
  els.prompt.hidden = true;
  // Say what is actually on screen. Leaving the readout on "Mode 8" while sixteen
  // modes ring together would be the interface lying about the physics.
  showStruckReadout();
  setSelected(els.spectrum, -1);
  refreshComb();

  if (state.muted) return;
  const ctx = ensureAudio();
  if (!ctx) return;

  const samples = renderStrike({ freqs, amps, taus, sampleRate: ctx.sampleRate });
  state.lastWav = { samples, sampleRate: ctx.sampleRate };

  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.85;
  src.connect(gain).connect(ctx.destination);

  // Overlapping strikes are natural — a real drum does not mute itself when you
  // hit it again — but the pile-up has to be bounded.
  src.addEventListener('ended', () => {
    const i = state.voices.indexOf(src);
    if (i >= 0) state.voices.splice(i, 1);
  });
  state.voices.push(src);
  while (state.voices.length > MAX_VOICES) {
    const oldest = state.voices.shift();
    try {
      oldest.stop();
    } catch {
      /* already finished */
    }
  }
  src.start();
}

// ------------------------------------------------------------------ rendering

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
    let refAmp = 1;
    let ringing = false;

    if (state.view === 'struck' && state.strike) {
      const elapsed = (now - state.strike.t0) / 1000;
      // Under prefers-reduced-motion, hold the peak displacement instead of
      // animating the ring-out. The information survives; the movement does not.
      const t = reducedMotion ? Math.min(elapsed, 1 / (4 * state.freqs[0])) : elapsed;
      fieldAtTime(drum.modes, state.strike.amps, state.freqs, state.strike.taus, t, state.fieldBuf);
      refAmp = state.strike.refAmp;
      ringing = true;
      board.drawField(state.fieldBuf, refAmp);
      if (elapsed > state.strike.maxTau * 3.2) {
        state.view = 'mode';
        restoreModeView();
        showPrompt();
      }
    } else {
      // At rest. Nothing is vibrating, so nothing may move or change colour: the
      // resting view is the selected mode as a still figure.
      state.fieldBuf.set(drum.modes[state.selectedMode] || drum.modes[0]);
      board.drawField(state.fieldBuf, 1);
    }

    if (els.mesh.checked) {
      board.drawMesh(undefined, ringing ? state.fieldBuf : null, refAmp, ringing);
    }
    board.drawOutline();

    if (ringing) {
      board.drawStrikeMarker(state.strike.x, state.strike.y, (now - state.strike.t0) / 1000);
    }

    if (document.activeElement === els.board && !state.drawMode) {
      const p = board.toPixel(state.cursor.x, state.cursor.y);
      const ctx = board.ctx;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 * board.dpr, 0, Math.PI * 2);
      ctx.strokeStyle = '#14120f';
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
  const ratio = state.freqs[1] / f0;
  els.readout.replaceChildren(
    text('Lowest mode '),
    strong(`${f0.toFixed(1)} Hz`),
    text(` (${note.label}). The second sits at `),
    strong(`${ratio.toFixed(3)}×`),
    text(' the first — '),
    span('note', `${harm.verdict}.`),
  );
}

function showModeReadout(i) {
  const f = state.freqs[i];
  const note = freqToNote(f);
  const parts = [text('Mode '), strong(String(i + 1)), text(' at '), strong(`${f.toFixed(1)} Hz`)];
  if (i === 0) {
    parts.push(text(` (${note.label}), the lowest this outline allows. `));
  } else {
    parts.push(
      text(` (${note.label}), `),
      strong(`\u00D7${(f / state.freqs[0]).toFixed(3)}`),
      text(' the lowest. '),
    );
  }
  parts.push(span('note', 'The pale channels are nodal lines, where the surface never moves.'));
  els.readout.replaceChildren(...parts);
}

function showStruckReadout() {
  els.readout.replaceChildren(
    strong('Struck.'),
    text(` All ${state.freqs.length} modes are ringing together, so what you see is their sum and not any one of them. `),
    span('note', 'Modes with a nodal line under the mallet were never excited at all.'),
  );
}

/** Back to rest: mode 1 shows the whole drum, any other shows itself. */
function restoreModeView() {
  if (!state.freqs) return;
  setSelected(els.spectrum, state.selectedMode);
  if (state.selectedMode === 0) renderReadout();
  else showModeReadout(state.selectedMode);
  refreshComb();
}

const text = (s) => document.createTextNode(s);
function strong(s) {
  const b = document.createElement('b');
  b.textContent = s;
  return b;
}
function span(cls, s) {
  const n = document.createElement('span');
  n.className = cls;
  n.textContent = s;
  return n;
}

function fmtPercent(v) {
  if (v < 1e-12) return 'exact';
  if (v < 0.0001) return '<0.01%';
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
      worst = Math.max(worst, Math.abs(state.drum.eigenvalues[k] - exact[k]) / exact[k]);
    }
    rows.push(['error against exact answer', fmtPercent(worst), true]);
  } else {
    rows.push(['exact answer', 'no formula exists', false]);
  }

  rows.push(['unknowns solved', d.unknowns.toLocaleString(), false]);
  rows.push(['triangles', d.triangleCount.toLocaleString(), false]);
  rows.push(['smallest angle', `${d.minAngleDeg.toFixed(1)}°`, false]);
  rows.push(['outline reproduced to', fmtPercent(d.areaError), d.areaError < 1e-12]);
  rows.push(['eigen residual', d.maxResidual.toExponential(1), false]);
  rows.push(['solve time', `${d.solveMs} ms`, false]);

  els.facts.replaceChildren();
  for (const [label, value, flag] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (flag) dd.className = 'flag';
    els.facts.append(dt, dd);
  }
}

function setSolving(on) {
  els.solving.hidden = !on;
  if (on) els.solvingText.textContent = 'building the mesh';
}

function showNotice(message) {
  els.notice.textContent = message;
  els.notice.hidden = false;
}
function clearNotice() {
  els.notice.hidden = true;
  els.notice.textContent = '';
}

function showPrompt() {
  els.prompt.hidden = false;
  els.prompt.textContent = state.drawMode ? 'drag to trace' : 'tap the drum';
}

// ------------------------------------------------------------------- presets

/**
 * Draws the preset's own outline as its glyph, so the button shows the thing it
 * selects rather than a stand-in icon.
 */
function formGlyph(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const s = 19 / Math.max(w, h);
  const ox = 12 - ((minX + maxX) / 2) * s;
  const oy = 12 + ((minY + maxY) / 2) * s;

  let d = '';
  polygon.forEach((p, i) => {
    const x = (p.x * s + ox).toFixed(2);
    const y = (oy - p.y * s).toFixed(2);
    d += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
  });
  d += 'Z';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#14120f');
  path.setAttribute('data-fill', '');
  svg.append(path);
  return svg;
}

function buildPresetChips() {
  for (const preset of PRESETS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'form-chip';
    chip.dataset.id = preset.id;
    chip.title = preset.blurb;
    chip.setAttribute('aria-pressed', 'false');
    const label = document.createElement('span');
    label.textContent = preset.name.toLowerCase();
    chip.append(formGlyph(preset.polygon), label);
    chip.addEventListener('click', () => {
      setDrawMode(false);
      solve({ kind: 'preset', id: preset.id });
    });
    // The draw button shares this row and lives at its end.
    els.presets.insertBefore(chip, els.drawBtn);
  }
}

function updatePresetChips() {
  for (const chip of els.presets.children) {
    // Skip the draw button, which owns its own pressed state.
    if (!chip.dataset.id) continue;
    chip.setAttribute('aria-pressed', String(chip.dataset.id === state.presetId));
  }
}

function updateKac(preset) {
  if (preset && preset.pairedWith) {
    els.kac.hidden = false;
    els.kacText.textContent = preset.blurb;
    els.kacSwap.dataset.target = preset.pairedWith;
  } else {
    els.kac.hidden = true;
  }
  const stale = els.kac.querySelector('.kac-match');
  if (stale) stale.remove();
}

function selectMode(i) {
  state.selectedMode = i;
  state.view = 'mode';
  state.strike = null;
  setSelected(els.spectrum, i);
  showModeReadout(i);
  refreshComb();
  showPrompt();
}

// ---------------------------------------------------------------------- input

function setDrawMode(on) {
  state.drawMode = on;
  state.stroke = [];
  state.drawing = false;
  els.drawBtn.setAttribute('aria-pressed', String(on));
  els.drawLabel.textContent = on ? 'cancel drawing' : 'draw your own';
  els.board.style.cursor = on ? 'cell' : 'crosshair';
  // While you are tracing, every number on the right still belongs to the drum
  // that is no longer on screen. Say so rather than letting them read as current.
  els.staleNote.hidden = !on;
  if (on) {
    els.readout.replaceChildren(
      strong('Trace an outline'),
      text(' on the plate. Release to solve it. '),
      span('note', 'It has to be a single loop that does not cross itself.'),
    );
  } else if (state.drum) {
    restoreModeView();
  }
  showPrompt();
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
    showNotice(result.error);
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

// ------------------------------------------------------------------ controls

els.pitch.addEventListener('input', () => {
  els.pitchOut.textContent = `${els.pitch.value} hz`;
  recomputeFrequencies();
  if (state.freqs) {
    renderSpectrum(els.spectrum, Array.from(state.freqs), state.selectedMode, selectMode);
    refreshComb();
    if (state.view !== 'struck') restoreModeView();
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

els.drawBtn.addEventListener('click', () => setDrawMode(!state.drawMode));

els.kacSwap.addEventListener('click', () => {
  const target = els.kacSwap.dataset.target;
  if (target) solve({ kind: 'preset', id: target });
});

els.sound.addEventListener('click', () => {
  state.muted = !state.muted;
  els.sound.setAttribute('aria-pressed', String(state.muted));
  els.soundLabel.textContent = state.muted ? 'sound off' : 'sound on';
  els.soundCut.style.display = state.muted ? '' : 'none';
});
els.soundCut.style.display = 'none';

els.about.addEventListener('click', () => {
  els.dlgAbout.showModal();
  // Without this the dialog opens scrolled to its own close button, hiding the
  // title, the equation and the accuracy section.
  els.dlgAbout.scrollTop = 0;
  els.aboutBody.scrollTop = 0;
  els.aboutBody.focus({ preventScroll: true });
});

els.share.addEventListener('click', async () => {
  const url = shareUrl(
    state.source.kind === 'preset'
      ? { kind: 'preset', id: state.source.id }
      : { kind: 'custom', polygon: normalizeShape(state.source.polygon).polygon },
  );
  try {
    await navigator.clipboard.writeText(url);
    els.shareStatus.textContent = 'link copied';
  } catch {
    els.shareStatus.textContent = url;
  }
});

els.wav.addEventListener('click', () => {
  if (!state.lastWav) {
    els.shareStatus.textContent = 'strike the drum first, then save its sound';
    return;
  }
  download(
    encodeWav(state.lastWav.samples, state.lastWav.sampleRate),
    `eigendrum-${state.presetId || 'custom'}.wav`,
  );
  els.shareStatus.textContent = 'sound saved';
});

els.png.addEventListener('click', () => {
  els.board.toBlob((blob) => {
    if (blob) download(blob, `eigendrum-${state.presetId || 'custom'}.png`);
    els.shareStatus.textContent = 'image saved';
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

// -------------------------------------------------------------------- startup

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
