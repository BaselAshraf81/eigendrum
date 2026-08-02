/**
 * Draw mode and free mode: the instrument, inside the game.
 *
 * Both are the same surface with a different way of getting a shape. Draw mode traces
 * an outline; free mode picks from the built-in gallery, the isospectral pair
 * included. Neither scores anything, which is the point of having them: the game
 * teaches you to read a drum, and these are where you go and use that.
 *
 * The honesty boundary from the root PRODUCT.md is enforced here rather than hidden:
 * the dials change pitch and ring-out, which belong to size, tension and air, and
 * they cannot touch a frequency *ratio*, which belongs to the outline alone.
 */

import { PRESETS, PRESETS_BY_ID, normalizeShape } from '../engine/app/presets.js';
import { strokeToPolygon } from '../engine/app/draw.js';
import { strikeAmplitudes, nodeWeights, decayTimes, fieldAtTime, frequencies } from '../engine/audio/synth.js';
import { freqToNote, harmonicity } from '../engine/audio/notes.js';
import { requestDrum } from './solve.js';
import { MALLETS, malletRadius, DEFAULT_MALLET, forceFor, CHARGE_MS } from './mallets.js';
import { modeField, envelopeField } from './plate.js';
import * as hud from './hud.js';
import * as audio from './audio.js';

const TARGET_NODES = 1200;
const MODE_COUNT = 12;

/** Shapes offered in free mode, in a deliberate order: simple, then strange. */
/** A single mode on its own, for the at-rest sand figure. */
function unitAmps(count, index) {
  const a = new Float64Array(count);
  a[index] = 1;
  return a;
}

const GALLERY = [
  'circle',
  'square',
  'rectangle',
  'triangle',
  'righttriangle',
  'pentagon',
  'lshape',
  'stadium',
  'star',
  'gww-a',
  'gww-b',
];

export class Sandbox {
  constructor({ plate, els, showSolving, onLeave }) {
    this.plate = plate;
    this.els = els;
    this.showSolving = showSolving;
    this.onLeave = onLeave;

    this.kind = 'free';
    this.drum = null;
    this.freqs = null;
    this.weights = null;
    this.shapeId = 'circle';
    this.mallet = DEFAULT_MALLET;
    this.baseHz = 138;
    this.decay = 1.35;
    this.sand = false;

    this.strike = null;
    this.amps = null;
    this.taus = null;
    this.t0 = 0;
    this.ringing = false;
    this.figure = 0;
    this.settle = 1;
    this.settleT0 = 0;

    this.drawing = false;
    this.stroke = [];
    this.customCount = 0;
    this.generation = 0;
  }

  // ------------------------------------------------------------------ lifecycle

  async enter(kind) {
    this.kind = kind;
    this.strike = null;
    this.amps = null;
    this.ringing = false;
    this.stroke = [];
    this.drawing = false;
    this.plate.setHidden(false);
    this.plate.setField(null, 1);
    // Size the canvas before anything is traced on it. Coming here straight from the
    // menu, nothing had resized it yet, so the backing store still held its markup
    // defaults and every drawn point was mapped against the wrong dimensions.
    this.plate.resize();

    this.buildTray();
    hud.clearStrip(this.els.strip, []);

    if (kind === 'draw') {
      this.drum = null;
      this.els.drumTitle.textContent = 'your drum';
      this.els.drumVerb.textContent = 'trace it';
      this.els.drumNote.textContent = 'drag a closed loop';
      this.els.brief.textContent =
        'Draw any closed outline and it becomes a drumhead clamped at its rim. Then hit it.';
      this.render();
    } else {
      this.els.drumTitle.textContent = 'the drum';
      this.els.drumVerb.textContent = 'strike it';
      await this.loadPreset(this.shapeId);
    }
  }

  leave() {
    this.ringing = false;
  }

  // ------------------------------------------------------------------- the tray

  buildTray() {
    const { els } = this;
    // Play mode hides every group but the mallets, so unhide them all before
    // deciding what this mode wants. Leaving that to the other screen once left the
    // sand control permanently unclickable.
    for (const group of els.tray.querySelectorAll('.tray-group')) group.hidden = false;
    els.tray.hidden = false;

    if (this.kind === 'free') {
      els.trayShapes.replaceChildren(
        ...GALLERY.map((id) => {
          const preset = PRESETS_BY_ID.get(id);
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.textContent = preset ? preset.name.toLowerCase() : id;
          b.setAttribute('aria-pressed', String(id === this.shapeId));
          b.onclick = () => this.loadPreset(id);
          return b;
        }),
      );
    } else {
      const redraw = document.createElement('button');
      redraw.type = 'button';
      redraw.className = 'chip';
      redraw.textContent = 'draw another';
      redraw.onclick = () => this.enter('draw');
      els.trayShapes.replaceChildren(redraw);
      els.trayShapesGroup.hidden = false;
      els.trayShapesGroup.querySelector('.tray-label').textContent = 'outline';
    }
    if (this.kind === 'free') {
      els.trayShapesGroup.querySelector('.tray-label').textContent = 'drum';
    }

    els.trayMallets.replaceChildren(
      ...MALLETS.map((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = m.name;
        b.title = m.blurb;
        b.setAttribute('aria-pressed', String(m.id === this.mallet));
        b.onclick = () => {
          this.mallet = m.id;
          this.buildTray();
          this.els.drumNote.textContent = m.blurb;
        };
        return b;
      }),
    );

    els.dialPitch.value = String(this.baseHz);
    els.dialDecay.value = String(this.decay);
    els.btnSand.setAttribute('aria-pressed', String(this.sand));
  }

  setPitch(hz) {
    this.baseHz = hz;
    if (this.drum) this.freqs = frequencies(this.drum.eigenvalues, this.baseHz);
    this.describe();
  }

  setDecay(seconds) {
    this.decay = seconds;
  }

  toggleSand() {
    this.sand = !this.sand;
    this.els.btnSand.setAttribute('aria-pressed', String(this.sand));
    this.showField();
    this.render();
  }

  /**
   * Puts the right field on the plate for the current view.
   *
   * Sand wants the envelope of whatever is ringing, or of the fundamental at rest.
   * The colour view wants the live displacement, which the frame loop supplies.
   */
  showField() {
    if (!this.drum) return;
    if (this.sand) {
      const amps = this.amps || unitAmps(this.drum.modes.length, this.figure);
      this.plate.setField(envelopeField(this.drum.modes, amps), 1);
      // Restart the settle, so grains gather onto the new figure rather than cutting
      // to it. This is the whole reason the view is worth having.
      this.settleT0 = performance.now();
      this.settle = 0;
    } else if (!this.ringing) {
      this.plate.setField(modeField(this.drum.modes, this.figure), 1);
    }
  }

  /**
   * Steps the figure being shown.
   *
   * A single mode is what a Chladni figure actually is; the envelope of a whole strike
   * only vanishes at the rim, because different modes' still curves do not coincide.
   * Reaching one mode therefore has to be obvious, not buried in the strip.
   */
  stepFigure(delta) {
    if (!this.drum) return;
    const count = this.drum.modes.length;
    this.figure = (this.figure + delta + count) % count;
    this.soundMode(this.figure);
  }

  // -------------------------------------------------------------------- loading

  async loadPreset(id) {
    this.shapeId = id;
    const preset = PRESETS_BY_ID.get(id);
    const { polygon, align } = normalizeShape(preset.polygon, preset.latticePitch || 0);
    await this.solveShape(id, polygon, align, preset.exact);
    this.buildTray();
  }

  async solveShape(cacheKey, polygon, align, exact) {
    const gen = ++this.generation;
    this.showSolving(
      true,
      `${TARGET_NODES} unknowns; ${exact ? 'this outline also has a closed-form spectrum' : 'no formula exists for this outline'}`,
    );
    const reply = await requestDrum({
      shapeId: cacheKey,
      polygon,
      align,
      mallet: malletRadius(DEFAULT_MALLET),
      targetNodes: TARGET_NODES,
      modeCount: MODE_COUNT,
    });
    if (gen !== this.generation) return false;
    this.showSolving(false);
    if (!reply.ok) {
      this.els.brief.textContent = `That outline would not solve: ${reply.error}`;
      return false;
    }
    this.drum = { mesh: reply.mesh, modes: reply.modes, eigenvalues: reply.eigenvalues };
    this.freqs = frequencies(reply.eigenvalues, this.baseHz);
    this.weights = nodeWeights(reply.mesh);
    this.strike = null;
    this.amps = null;
    this.ringing = false;
    this.plate.setDrum(this.drum);
    // At rest a drum shows its deepest standing wave, which is a still figure and is
    // genuinely what the shape looks like when only mode one is present.
    this.showField();
    if (!this.sand) this.plate.setField(modeField(reply.modes, 0), 1);
    this.plate.resize();
    hud.enableStripPicking(this.els.strip, this.freqs, (k) => this.soundMode(k));
    hud.clearStrip(this.els.strip, []);
    this.describe();
    this.els.drumNote.textContent = 'tap to strike, or hold and release to hit harder';
    this.render();
    return true;
  }

  /** What this shape sounds like, in words and numbers the shape actually produced. */
  describe() {
    if (!this.freqs) return;
    const f0 = this.freqs[0];
    const second = this.freqs[1] / f0;
    const h = harmonicity(Array.from(this.freqs));
    const verdict =
      h > 0.85 ? 'close to a harmonic series, so it reads as a pitch' : 'inharmonic, so it reads as a thud';
    this.els.brief.textContent =
      `Lowest mode ${f0.toFixed(1)} Hz (${freqToNote(f0).label}). ` +
      `The second sits at ${second.toFixed(3)} times the first: ${verdict}.`;
  }

  // ------------------------------------------------------------------- striking

  strikeAt(x, y, force) {
    if (!this.drum || !this.plate.board.containsShapePoint(x, y)) return;
    const amps = strikeAmplitudes(
      this.drum.mesh,
      this.drum.modes,
      x,
      y,
      malletRadius(this.mallet),
      this.weights,
    );
    // Force scales every mode by the same factor, which is the whole truth about
    // force: it is loudness, not timbre.
    const scaled = new Float64Array(amps.length);
    for (let k = 0; k < amps.length; k++) scaled[k] = amps[k] * force;

    this.amps = scaled;
    this.taus = decayTimes(this.freqs, this.decay, 0.55);
    // One fixed reference for the whole ring-out. Normalising each frame to its own
    // peak holds the maximum at 1.0 and the animation stops reading as movement.
    this.refAmp = this.peakAt(1 / (4 * this.freqs[0])) || 1;
    this.showField();
    this.strike = { x, y, ok: true };
    this.t0 = performance.now();
    this.ringing = true;

    let peak = 0;
    for (let k = 0; k < scaled.length; k++) peak = Math.max(peak, Math.abs(scaled[k]));
    hud.paintStrip(this.els.strip, scaled, [], peak, this.freqs);
    audio.playStrike(this.freqs, scaled, { taus: this.taus });
    const pct = Math.round(force * 100);
    this.els.drumNote.textContent =
      force < 0.99
        ? `struck at ${pct}% force - hold before releasing to hit harder`
        : 'struck at full force';
  }

  /**
   * Sounds one mode on its own, and shows its figure.
   *
   * No mallet can do this: a real strike always wakes a mixture. It exists because a
   * single mode is where the sand view earns its keep, since the envelope of one mode
   * is exactly the classic Chladni figure. A mixture's envelope is mostly just the rim.
   */
  soundMode(k) {
    if (!this.drum || k >= this.drum.modes.length) return;
    this.figure = k;
    if (this.els.figName) this.els.figName.textContent = `mode ${k + 1}`;
    const amps = unitAmps(this.drum.modes.length, k);
    this.amps = amps;
    this.taus = decayTimes(this.freqs, this.decay, 0.55);
    this.refAmp = this.peakAt(1 / (4 * this.freqs[0])) || 1;
    this.strike = null;
    this.t0 = performance.now();
    this.ringing = true;
    this.showField();
    hud.paintStrip(this.els.strip, amps, [k], 1, this.freqs);
    // A lone sinusoid needs far less gain to reach the same level, and staying clear
    // of the soft limiter leaves it a pure tone rather than a limiter-coloured one.
    audio.playStrike(this.freqs, amps, { taus: this.taus, gain: 0.45 });
    this.els.drumNote.textContent = `mode ${k + 1} alone - no mallet can do this`;
    this.render();
  }

  // -------------------------------------------------------------------- drawing

  beginStroke(p) {
    if (this.kind !== 'draw' || this.drum) return false;
    this.drawing = true;
    this.stroke = [p];
    return true;
  }

  extendStroke(p) {
    if (!this.drawing) return;
    this.stroke.push(p);
    this.render();
  }

  async endStroke() {
    if (!this.drawing) return;
    this.drawing = false;
    const result = strokeToPolygon(this.stroke);
    if (!result.ok) {
      this.els.drumNote.textContent = result.error || 'that outline will not work, try again';
      this.stroke = [];
      this.render();
      return;
    }
    this.stroke = [];
    const { polygon, align } = normalizeShape(result.polygon, 0);
    this.customCount += 1;
    const ok = await this.solveShape(`custom-${this.customCount}`, polygon, align, null);
    if (ok) {
      this.els.drumTitle.textContent = 'your drum';
      this.els.drumVerb.textContent = 'strike it';
      this.buildTray();
    }
  }

  // --------------------------------------------------------------------- render

  frame(now, reducedMotion) {
    // Sand does not oscillate: a Chladni figure is a time-average over many cycles.
    // What it does do is *settle*, so the only motion here is the grains gathering.
    if (this.sand) {
      if (!this.drum || this.settle >= 1) return;
      this.settle = reducedMotion ? 1 : Math.min(1, (now - this.settleT0) / 700);
      this.render();
      return;
    }
    if (!this.ringing || !this.amps) return;
    const elapsed = (now - this.t0) / 1000;
    const maxTau = Math.max(...this.taus);
    if (elapsed > maxTau * 3.2) {
      this.ringing = false;
      this.plate.setField(modeField(this.drum.modes, 0), 1);
      this.render();
      return;
    }
    const t = reducedMotion ? Math.min(elapsed, 1 / (4 * this.freqs[0])) : elapsed;
    this.plate.setField(this.fieldAt(t), 1 / this.refAmp);
    this.render();
  }

  fieldAt(t) {
    const out = new Float64Array(this.drum.mesh.nodeCount);
    fieldAtTime(this.drum.modes, this.amps, this.freqs, this.taus, t, out);
    return out;
  }

  peakAt(t) {
    const out = this.fieldAt(t);
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    return peak;
  }

  render(charge = null) {
    this.plate.draw({
      strike: this.ringing ? this.strike : null,
      sand: this.sand,
      settle: this.settle,
      charge,
      stroke: this.stroke.length > 1 ? this.stroke : null,
    });
  }
}
