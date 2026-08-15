/**
 * Drawing the drum: its outline, its mesh, and the interpolated displacement
 * field of a vibration mode.
 *
 * The field is rasterised properly - barycentric interpolation across every
 * triangle - rather than flat-shaded per element, because the whole point is to
 * see smooth standing waves and the curves where they vanish. Those curves are
 * the nodal lines, the modern descendants of Chladni's sand figures, and the
 * colour ramp is built to make them read as dark bands without needing a
 * separate contouring pass.
 */

import { pointInPolygon } from '../geom/polygon.js';

const RAMP_SIZE = 512;

/**
 * These mirror four custom properties in styles/app.css and must be kept in step
 * with them by hand. There is no build step to share them, and the canvas needs
 * numeric channels rather than CSS strings because the ramp is interpolated.
 *
 *   PLATE -> --plate            INK -> --ink
 *   POS   -> --vermilion-bright NEG -> --ultramarine
 */
export const PLATE = [232, 227, 214];
export const INK = [20, 18, 15];
const POS = [216, 50, 28];
const NEG = [27, 57, 168];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Displacement posterised into contour bands rather than a smooth gradient.
 *
 * Two reasons, and the second is the better one. The world is flat colour, so a
 * gradient would be foreign to it. And banding is simply better information
 * design: discrete steps put the amplitude levels and the zero crossing exactly
 * where the eye can read them, instead of smearing them into a wash.
 *
 * The zero band is left as bare plaster, which is also how the real thing looks:
 * Chladni's figures are sand collecting along the lines that do not move, so the
 * nodal lines read light against the vibrating field. Magnitude then darkens
 * monotonically outward, so the pattern survives being seen in greyscale or by
 * someone who cannot separate red from blue.
 */
function buildRamp() {
  const ramp = new Uint8ClampedArray(RAMP_SIZE * 4);
  // Deliberately narrow first band: the zero crossing should read as a drawn
  // line, not a zone.
  const EDGES = [0.05, 0.28, 0.55, 0.8];
  for (let i = 0; i < RAMP_SIZE; i++) {
    const v = (i / (RAMP_SIZE - 1)) * 2 - 1; // -1 .. 1
    const a = Math.abs(v);
    const base = v >= 0 ? POS : NEG;
    let c;
    if (a < EDGES[0]) c = PLATE;
    else if (a < EDGES[1]) c = mix(PLATE, base, 0.42);
    else if (a < EDGES[2]) c = mix(PLATE, base, 0.71);
    else if (a < EDGES[3]) c = base;
    else c = mix(base, INK, 0.24);
    ramp[i * 4] = c[0];
    ramp[i * 4 + 1] = c[1];
    ramp[i * 4 + 2] = c[2];
    ramp[i * 4 + 3] = 255;
  }
  return ramp;
}

const RAMP = buildRamp();

const clampUnit = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);

export class Board {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drum = null;
    this.transform = { scale: 1, ox: 0, oy: 0 };
    this.showMesh = false;

    // Field rasterisation happens at a capped resolution and is then scaled up.
    // Interpolating a smooth function does not need a pixel-for-pixel buffer, and
    // the saving is what keeps the ring-out animation comfortably at 60fps.
    this.fieldCanvas = document.createElement('canvas');
    this.fieldCtx = this.fieldCanvas.getContext('2d');
    this.fieldMax = 460;

    // How far a fully-displaced point is pushed on screen, as a fraction of the
    // canvas. Offsetting screen-y by the displacement is an oblique projection of
    // the real 3D surface (x, y, u) -> (x, y - k*u), so it is a faithful view
    // rather than a decoration. The rim is clamped at u = 0, so the outline stays
    // exactly where it is and you watch the membrane move inside a fixed edge.
    this.displaceFactor = 0.075;
  }

  displacePixels(enabled) {
    if (!enabled) return 0;
    return this.displaceFactor * Math.min(this.canvas.width, this.canvas.height);
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.dpr = dpr;
    this.recomputeTransform();
  }

  setDrum(drum) {
    this.drum = drum;
    this.recomputeTransform();
  }

  recomputeTransform() {
    if (!this.drum) return;
    const poly = this.drum.mesh.polygon;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pad = 0.09 * Math.min(w, h);
    const sx = (w - 2 * pad) / Math.max(1e-9, maxX - minX);
    const sy = (h - 2 * pad) / Math.max(1e-9, maxY - minY);
    const scale = Math.min(sx, sy);
    this.transform = {
      scale,
      // Flip y so positive y is up, the way the maths is written.
      ox: w / 2 - ((minX + maxX) / 2) * scale,
      oy: h / 2 + ((minY + maxY) / 2) * scale,
      minX,
      minY,
      maxX,
      maxY,
    };
  }

  /** Shape coordinates -> device pixels. */
  toPixel(x, y) {
    const { scale, ox, oy } = this.transform;
    return { x: x * scale + ox, y: oy - y * scale };
  }

  /** CSS pixels (from a pointer event) -> shape coordinates. */
  fromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * this.dpr;
    const py = (clientY - rect.top) * this.dpr;
    const { scale, ox, oy } = this.transform;
    return { x: (px - ox) / scale, y: (oy - py) / scale };
  }

  containsShapePoint(x, y) {
    return this.drum ? pointInPolygon(x, y, this.drum.mesh.polygon) : false;
  }

  clear() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Rasterises `values` (one per mesh node) into the offscreen buffer using
   * barycentric interpolation, then blits it scaled to the visible canvas.
   */
  /**
   * The colour field is drawn flat, deliberately. Displacing the raster as well
   * as the mesh made triangles overlap in projection with no depth order, which
   * showed up as spurious line crossings and hard blue/amber seams on shapes with
   * spikes or re-entrant corners. Colour already encodes displacement; geometry
   * on top of it bought artefacts and no information.
   */
  drawField(values, amplitude = 1) {
    const { drum } = this;
    if (!drum) return;
    const { nodes, triangles, triangleCount } = drum.mesh;
    const t = this.transform;

    // Offscreen buffer covering the same region, at reduced resolution.
    const full = Math.max(this.canvas.width, this.canvas.height);
    const q = Math.min(1, this.fieldMax / Math.max(1, full));
    const fw = Math.max(1, Math.round(this.canvas.width * q));
    const fh = Math.max(1, Math.round(this.canvas.height * q));
    if (this.fieldCanvas.width !== fw || this.fieldCanvas.height !== fh) {
      this.fieldCanvas.width = fw;
      this.fieldCanvas.height = fh;
    }
    const img = this.fieldCtx.createImageData(fw, fh);
    const data = img.data;

    const scale = t.scale * q;
    const ox = t.ox * q;
    const oy = t.oy * q;

    const inv = amplitude > 1e-12 ? 1 / amplitude : 0;

    for (let tri = 0; tri < triangleCount; tri++) {
      const ia = triangles[tri * 3];
      const ib = triangles[tri * 3 + 1];
      const ic = triangles[tri * 3 + 2];

      const va = values[ia];
      const vb = values[ib];
      const vc = values[ic];

      const ax = nodes[ia * 2] * scale + ox;
      const ay = oy - nodes[ia * 2 + 1] * scale;
      const bx = nodes[ib * 2] * scale + ox;
      const by = oy - nodes[ib * 2 + 1] * scale;
      const cx = nodes[ic * 2] * scale + ox;
      const cy = oy - nodes[ic * 2 + 1] * scale;

      const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(denom) < 1e-12) continue;
      const invDen = 1 / denom;

      let x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      let x1 = Math.min(fw - 1, Math.ceil(Math.max(ax, bx, cx)));
      let y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      let y1 = Math.min(fh - 1, Math.ceil(Math.max(ay, by, cy)));

      for (let py = y0; py <= y1; py++) {
        const fy = py + 0.5;
        for (let px = x0; px <= x1; px++) {
          const fx = px + 0.5;
          const l0 = ((by - cy) * (fx - cx) + (cx - bx) * (fy - cy)) * invDen;
          if (l0 < -0.002) continue;
          const l1 = ((cy - ay) * (fx - cx) + (ax - cx) * (fy - cy)) * invDen;
          if (l1 < -0.002) continue;
          const l2 = 1 - l0 - l1;
          if (l2 < -0.002) continue;

          let v = (l0 * va + l1 * vb + l2 * vc) * inv;
          if (v > 1) v = 1;
          else if (v < -1) v = -1;

          const idx = (((v + 1) * 0.5 * (RAMP_SIZE - 1)) | 0) * 4;
          const o = (py * fw + px) * 4;
          data[o] = RAMP[idx];
          data[o + 1] = RAMP[idx + 1];
          data[o + 2] = RAMP[idx + 2];
          data[o + 3] = 255;
        }
      }
    }

    this.fieldCtx.putImageData(img, 0, 0);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.fieldCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  tracePolygon(poly) {
    const ctx = this.ctx;
    poly.forEach((p, i) => {
      const q = this.toPixel(p.x, p.y);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
  }

  drawOutline(color = '#14120f', width = 2) {
    const { ctx, drum } = this;
    if (!drum) return;
    ctx.beginPath();
    this.tracePolygon(drum.mesh.polygon);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * this.dpr;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  /**
   * The finite element mesh. When `values` are supplied the nodes ride the
   * displacement field, so you watch the actual elements flex - and because
   * boundary nodes are clamped to zero, the rim stays still on its own.
   */
  drawMesh(color = 'rgba(20,18,15,0.24)', values = null, amplitude = 1, displace = false) {
    const { ctx, drum } = this;
    if (!drum) return;
    const { nodes, triangles, triangleCount } = drum.mesh;
    const dScale = values ? this.displacePixels(displace) : 0;
    const inv = amplitude > 1e-12 ? 1 / amplitude : 0;

    const py = (i) => {
      const base = this.transform.oy - nodes[i * 2 + 1] * this.transform.scale;
      return dScale ? base - clampUnit(values[i] * inv) * dScale : base;
    };
    const px = (i) => nodes[i * 2] * this.transform.scale + this.transform.ox;

    ctx.beginPath();
    for (let tri = 0; tri < triangleCount; tri++) {
      for (let e = 0; e < 3; e++) {
        const i = triangles[tri * 3 + e];
        const j = triangles[tri * 3 + ((e + 1) % 3)];
        ctx.moveTo(px(i), py(i));
        ctx.lineTo(px(j), py(j));
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.5, 0.6 * this.dpr);
    ctx.stroke();
  }

  /** Expanding ring at the strike point. */
  drawStrikeMarker(x, y, age) {
    const { ctx } = this;
    const p = this.toPixel(x, y);
    const r = (5 + age * 95) * this.dpr;
    const alpha = Math.max(0, 1 - age * 2.4);
    if (alpha <= 0) return;
    // arc() throws IndexSizeError on a negative radius, and a throw here used to
    // take the whole render loop with it. The caller clamps the age, so this is
    // the backstop rather than the fix.
    if (!(r > 0)) return;
    // A hard-edged ring, no glow: this world has no soft light in it.
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(20,18,15,${alpha * 0.8})`;
    ctx.lineWidth = 2 * this.dpr;
    ctx.stroke();
  }

  /**
   * Drawing happens in its own coordinate space, independent of whichever drum
   * is currently loaded: the shorter canvas dimension spans -1 to 1. The stroke
   * gets rescaled to unit area afterwards anyway, so only internal consistency
   * matters.
   */
  drawSpaceScale() {
    return (Math.min(this.canvas.width, this.canvas.height) / 2) * 0.92;
  }

  drawSpaceToPixel(x, y) {
    const s = this.drawSpaceScale();
    return { x: this.canvas.width / 2 + x * s, y: this.canvas.height / 2 - y * s };
  }

  fromClientDraw(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * this.dpr;
    const py = (clientY - rect.top) * this.dpr;
    const s = this.drawSpaceScale();
    return { x: (px - this.canvas.width / 2) / s, y: (this.canvas.height / 2 - py) / s };
  }

  /**
   * A dashed boundary marking the region `fromClientDraw` actually maps to
   * -1..1 in. Drawing mode used to leave whatever drum was on screen fully
   * rendered underneath the plate, so people had no idea the whole plate was
   * now a blank sheet waiting for a stroke. This says so.
   */
  drawDrawGuide() {
    const ctx = this.ctx;
    const half = this.drawSpaceScale();
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    ctx.save();
    ctx.setLineDash([6 * this.dpr, 6 * this.dpr]);
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.strokeStyle = 'rgba(20, 18, 15, 0.38)';
    ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
    ctx.restore();
  }

  /** In-progress freehand stroke, in draw space. */
  drawStroke(points, closed) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((p, i) => {
      const q = this.drawSpaceToPixel(p.x, p.y);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    if (closed) ctx.closePath();
    ctx.strokeStyle = '#c62d1a';
    ctx.lineWidth = 2.5 * this.dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}
