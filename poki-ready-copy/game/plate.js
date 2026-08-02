/**
 * The two plates.
 *
 * Both are the engine's `Board`, so the posterised field ramp, the barycentric
 * rasteriser and the nodal-line treatment have exactly one definition in this
 * repo and cannot drift between the instrument and the game. Everything here is
 * an overlay drawn afterwards, in the same flat, hard-edged language: no glow, no
 * blur, no soft light, because this world does not have any.
 */

import { Board } from '../engine/app/canvas.js';

const INK = '#14120f';
const CHROME = '#f2c300';
const PLASTER = '#f0ede6';

export class Plate {
  constructor(canvas) {
    this.board = new Board(canvas);
    this.canvas = canvas;
    this.values = null;
    this.amplitude = 1;
    this.hidden = false;
  }

  resize() {
    this.board.resize();
  }

  setDrum(drum) {
    this.board.setDrum(drum);
  }

  /** `values` is one number per mesh node, already normalised to -1..1. */
  setField(values, amplitude = 1) {
    this.values = values;
    this.amplitude = amplitude;
  }

  /** Blank plate for the by-ear chapter, where the diagram is withheld. */
  setHidden(hidden) {
    this.hidden = hidden;
  }

  draw({ crosshair = null, marks = null, strike = null } = {}) {
    const { board } = this;
    board.clear();
    if (!board.drum) return;

    if (this.hidden) {
      this.fillShape(PLASTER);
    } else if (this.values) {
      board.drawField(this.values, this.amplitude);
    } else {
      this.fillShape('#e8e3d6');
    }
    board.drawOutline(INK, 2);

    if (this.hidden) this.drawWithheld();
    if (marks) this.drawMarks(marks);
    if (strike) this.drawStrike(strike);
    if (crosshair) this.drawCrosshair(crosshair);
  }

  fillShape(color) {
    const { ctx } = this.board;
    ctx.save();
    this.board.tracePolygon(this.board.drum.mesh.polygon);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /**
   * The withheld diagram is drawn as an explicit absence rather than left empty,
   * so a blank plate reads as "this is being kept from you" instead of "this is
   * broken". Hairline rules, because the plate is still the quiet half here.
   */
  drawWithheld() {
    const { ctx } = this.board;
    const t = this.board.transform;
    const step = 0.055 * t.scale;
    ctx.save();
    this.board.tracePolygon(this.board.drum.mesh.polygon);
    ctx.clip();
    ctx.strokeStyle = 'rgba(20,18,15,0.16)';
    ctx.lineWidth = Math.max(1, this.board.dpr || 1);
    const { minX, minY, maxX, maxY } = t;
    const a = this.board.toPixel(minX, maxY);
    const b = this.board.toPixel(maxX, minY);
    for (let x = a.x - (b.y - a.y); x < b.x + (b.y - a.y); x += step) {
      ctx.beginPath();
      ctx.moveTo(x, a.y);
      ctx.lineTo(x + (b.y - a.y), b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Hint marks: real winning territory, taken from the computed solution set. Drawn
   * as small chrome squares with an ink keyline, the same way selection is drawn
   * everywhere else in this world.
   */
  drawMarks(points) {
    const { ctx } = this.board;
    const size = Math.max(5, 0.016 * Math.min(this.canvas.width, this.canvas.height));
    ctx.save();
    ctx.lineWidth = Math.max(1, (this.board.dpr || 1) * 1.2);
    for (const p of points) {
      const q = this.board.toPixel(p.x, p.y);
      ctx.fillStyle = CHROME;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.rect(q.x - size / 2, q.y - size / 2, size, size);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Where the last strike landed, and whether it counted. */
  drawStrike({ x, y, ok }) {
    const { ctx } = this.board;
    const p = this.board.toPixel(x, y);
    const r = Math.max(6, 0.022 * Math.min(this.canvas.width, this.canvas.height));
    ctx.save();
    ctx.lineWidth = Math.max(2, (this.board.dpr || 1) * 1.6);
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (ok) {
      ctx.fillStyle = CHROME;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The keyboard aim point. Cross of two hairlines plus a square, never a dot. */
  drawCrosshair({ x, y }) {
    const { ctx } = this.board;
    const p = this.board.toPixel(x, y);
    const arm = Math.max(8, 0.03 * Math.min(this.canvas.width, this.canvas.height));
    ctx.save();
    ctx.lineWidth = Math.max(2, (this.board.dpr || 1) * 1.5);
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(p.x - arm, p.y);
    ctx.lineTo(p.x + arm, p.y);
    ctx.moveTo(p.x, p.y - arm);
    ctx.lineTo(p.x, p.y + arm);
    ctx.stroke();
    ctx.strokeRect(p.x - arm * 0.28, p.y - arm * 0.28, arm * 0.56, arm * 0.56);
    ctx.restore();
  }
}

/** Signed mode field, normalised so the ramp uses its full range. */
export function modeField(modes, k) {
  const phi = modes[k];
  let peak = 0;
  for (let i = 0; i < phi.length; i++) peak = Math.max(peak, Math.abs(phi[i]));
  const out = new Float64Array(phi.length);
  const s = peak > 0 ? 1 / peak : 0;
  for (let i = 0; i < phi.length; i++) out[i] = phi[i] * s;
  return out;
}

/**
 * max(|phi_j|, |phi_k|), normalised.
 *
 * Its near-zero set is exactly the set of points where *both* modes are still, so
 * the pale region of this field is the winning territory for a double-silence
 * level. That is the honest way to draw two nodal families in one figure: not two
 * overlaid line sets, but the one field whose zeros are their intersection.
 */
export function bothQuietField(modes, ks) {
  const n = modes[ks[0]].length;
  const out = new Float64Array(n);
  const peaks = ks.map((k) => {
    let p = 0;
    for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(modes[k][i]));
    return p || 1;
  });
  for (let i = 0; i < n; i++) {
    let worst = 0;
    for (let j = 0; j < ks.length; j++) {
      worst = Math.max(worst, Math.abs(modes[ks[j]][i]) / peaks[j]);
    }
    out[i] = worst;
  }
  return out;
}
