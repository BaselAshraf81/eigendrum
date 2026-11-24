/**
 * The drum field as an Erae LED image. Point location is done once per
 * (drum, zone size); each frame is then three multiply-adds per LED.
 *
 * LED (i, j) has its centre at (i + 0.5, j + 0.5) in zone units, j = 0 the
 * bottom row, which is also the orientation of the drum's own y axis.
 */
import { pointInPolygon } from '../../geom/polygon.js';

const OUT = 0;
const IN = 1;
const EDGE = 2;

// Light on black, following the canvas palette (canvas.js buildRamp): the same
// band edges, with the zero band widened a little so a nodal line survives
// sampling at 42 x 24. Brightness rises monotonically with |u|.
const EDGES = [0.08, 0.28, 0.55, 0.8];
const ZERO = [34, 26, 18]; // dim warm white: the drum face and its nodal lines
const RIM = [70, 66, 60];
const BLACK = [0, 0, 0]; // the clamped boundary, so the shape reads at rest
const POS = [[70, 14, 6], [140, 30, 12], [216, 50, 28], [255, 120, 70]];
const NEG = [[8, 16, 70], [18, 38, 140], [30, 70, 230], [110, 150, 255]];

function colour(v) {
  const a = Math.abs(v);
  if (a < EDGES[0]) return ZERO;
  const set = v > 0 ? POS : NEG;
  if (a < EDGES[1]) return set[0];
  if (a < EDGES[2]) return set[1];
  if (a < EDGES[3]) return set[2];
  return set[3];
}

export class EraeRaster {
  constructor() {
    this.key = null;
  }
  /** True once prepare() has fitted a drum, so toDrum() and blank() have something to use. */
  get ready() {
    return this.key !== null;
  }
  /** Forgets the fit, so nothing maps against a drum or zone size that is gone. */
  reset() {
    this.key = null;
  }

  /** Rebuilds the fit and point location only when the drum or zone changes. */
  prepare(drum, width, height) {
    if (this.key && this.key.drum === drum && this.key.width === width && this.key.height === height) return;
    this.key = { drum, width, height };
    const { nodes, triangles, triangleCount, polygon } = drum.mesh;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // Square LED pitch, aspect preserved, centred, half an LED clear at the tightest side.
    const scale = Math.min((width - 1) / Math.max(1e-9, maxX - minX), (height - 1) / Math.max(1e-9, maxY - minY));
    this.fit = { scale, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width, height };

    const n = width * height;
    this.kind = new Uint8Array(n);
    this.idx = new Int32Array(n * 3);
    this.wts = new Float32Array(n * 3);
    this.rgb = new Uint8Array(n * 3);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const { x, y } = this.toDrum(i + 0.5, j + 0.5);
        const k = j * width + i;
        if (!pointInPolygon(x, y, polygon)) continue;
        this.kind[k] = IN;
        // An LED inside the outline but between the mesh and the rim keeps weights
        // of 0, so it reads u = 0.
        for (let t = 0; t < triangleCount; t++) {
          const a = triangles[t * 3], b = triangles[t * 3 + 1], c = triangles[t * 3 + 2];
          const ax = nodes[a * 2], ay = nodes[a * 2 + 1];
          const bx = nodes[b * 2], by = nodes[b * 2 + 1];
          const qx = nodes[c * 2], qy = nodes[c * 2 + 1];
          const den = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy);
          if (Math.abs(den) < 1e-15) continue;
          const l0 = ((by - qy) * (x - qx) + (qx - bx) * (y - qy)) / den;
          if (l0 < -1e-9) continue;
          const l1 = ((qy - ay) * (x - qx) + (ax - qx) * (y - qy)) / den;
          if (l1 < -1e-9 || 1 - l0 - l1 < -1e-9) continue;
          this.idx.set([a, b, c], k * 3);
          this.wts.set([l0, l1, 1 - l0 - l1], k * 3);
          break;
        }
      }
    }
    // Inside LEDs touching the outside (or the zone edge) are the rim.
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const k = j * width + i;
        if (this.kind[k] !== IN) continue;
        const out = (ii, jj) => ii < 0 || jj < 0 || ii >= width || jj >= height || this.kind[jj * width + ii] === OUT;
        if (out(i - 1, j) || out(i + 1, j) || out(i, j - 1) || out(i, j + 1)) this.kind[k] = EDGE;
      }
    }
  }

  toDrum(zx, zy) {
    const { scale, cx, cy, width, height } = this.fit;
    return { x: cx + (zx - width / 2) / scale, y: cy + (zy - height / 2) / scale };
  }

  /** values: one per mesh node; amplitude: the value drawn at full colour. Returns the shared buffer. */
  render(values, amplitude = 1) {
    const { kind, idx, wts, rgb } = this;
    const inv = amplitude > 1e-12 ? 1 / amplitude : 0;
    for (let k = 0; k < kind.length; k++) {
      let c = BLACK;
      if (kind[k] !== OUT) {
        const o = k * 3;
        const v = (wts[o] * values[idx[o]] + wts[o + 1] * values[idx[o + 1]] + wts[o + 2] * values[idx[o + 2]]) * inv;
        c = colour(v);
        if (kind[k] === EDGE && Math.abs(v) < EDGES[1]) c = RIM;
      }
      rgb[k * 3] = c[0];
      rgb[k * 3 + 1] = c[1];
      rgb[k * 3 + 2] = c[2];
    }
    return rgb;
  }

  /** An all-off image of the same size, for when there is no drum to show. */
  blank() {
    this.rgb.fill(0);
    return this.rgb;
  }
}
