/**
 * Simple-polygon helpers. A polygon is an array of `{ x, y }` vertices,
 * implicitly closed (no repeated last point).
 */

export function signedArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  }
  return s / 2;
}

export const area = (poly) => Math.abs(signedArea(poly));

/** Returns the polygon wound counter-clockwise (positive signed area). */
export function ensureCCW(poly) {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
}

export function perimeter(poly) {
  let p = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    p += Math.hypot(poly[i].x - poly[j].x, poly[i].y - poly[j].y);
  }
  return p;
}

export function bbox(poly) {
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
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function centroid(poly) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += cross;
    cx += (poly[j].x + poly[i].x) * cross;
    cy += (poly[j].y + poly[i].y) * cross;
  }
  if (Math.abs(a) < 1e-300) return { x: poly[0].x, y: poly[0].y };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Crossing-number point-in-polygon test. Boundary cases are not guaranteed. */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Closest point to (x, y) on segment ab, plus the squared distance to it. */
function closestOnSegment(x, y, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : ((x - ax) * vx + (y - ay) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + t * vx;
  const py = ay + t * vy;
  const dx = x - px;
  const dy = y - py;
  return { x: px, y: py, d2: dx * dx + dy * dy };
}

/** Nearest point on the polygon's boundary. */
export function projectToBoundary(x, y, poly) {
  let best = null;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const c = closestOnSegment(x, y, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
    if (!best || c.d2 < best.d2) best = c;
  }
  return best;
}

export function distanceToBoundary(x, y, poly) {
  return Math.sqrt(projectToBoundary(x, y, poly).d2);
}

/** Resamples the closed boundary at roughly `spacing` apart. */
export function resampleClosed(poly, spacing) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.round(len / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/**
 * Ramer-Douglas-Peucker simplification, for turning a noisy freehand stroke
 * into a polygon with a manageable vertex count.
 */
export function simplify(points, epsilon) {
  if (points.length < 3) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    const a = points[first];
    const b = points[last];
    let worst = -1;
    let worstIdx = -1;
    for (let i = first + 1; i < last; i++) {
      const c = closestOnSegment(points[i].x, points[i].y, a.x, a.y, b.x, b.y);
      if (c.d2 > worst) {
        worst = c.d2;
        worstIdx = i;
      }
    }
    if (Math.sqrt(worst) > epsilon) {
      keep[worstIdx] = 1;
      stack.push([first, worstIdx], [worstIdx, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Normalises a polygon into a canonical frame: centred on the origin and scaled
 * so the enclosed area is 1. This makes spectra comparable between shapes,
 * because Laplacian eigenvalues scale like 1/area — without it, "hear the
 * shape" would mostly be hearing the size.
 */
export function normalizeToUnitArea(poly) {
  const c = centroid(poly);
  const a = area(poly);
  if (a <= 0) return poly.slice();
  const s = 1 / Math.sqrt(a);
  return poly.map((p) => ({ x: (p.x - c.x) * s, y: (p.y - c.y) * s }));
}

/** Removes consecutive duplicate/near-duplicate vertices. */
export function dedupe(poly, eps = 1e-9) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) out.push(p);
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= eps
  ) {
    out.pop();
  }
  return out;
}

/** True when segments ab and cd cross at a point interior to both. */
function properCross(a, b, c, d) {
  const o = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  const eps = 1e-12;
  if (Math.abs(d1) < eps || Math.abs(d2) < eps || Math.abs(d3) < eps || Math.abs(d4) < eps) {
    return false;
  }
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * True when no two non-adjacent edges cross. The mesher assumes a simple
 * polygon, so freehand strokes have to be checked before they are accepted.
 */
export function isSimple(poly) {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      if (j === i + 1) continue; // adjacent
      const c = poly[j];
      const d = poly[(j + 1) % n];
      if (properCross(a, b, c, d)) return false;
    }
  }
  return true;
}

/**
 * Douglas-Peucker for a *closed* curve.
 *
 * Running the open-polyline version on a loop is subtly wrong: it always keeps
 * the first and last points, which privileges wherever the stroke happened to
 * start and preserves any wobble there as a permanent corner. Splitting the loop
 * into two chains at two well-separated points removes that bias — the retained
 * split points are genuine extremes of the shape rather than an artefact of when
 * the pointer went down.
 */
export function simplifyClosed(points, epsilon) {
  const n = points.length;
  if (n < 4) return points.slice();

  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  // Farthest point from the centroid, then farthest point from that.
  let iA = 0;
  let bestA = -1;
  for (let i = 0; i < n; i++) {
    const d = (points[i].x - cx) ** 2 + (points[i].y - cy) ** 2;
    if (d > bestA) {
      bestA = d;
      iA = i;
    }
  }
  let iB = iA;
  let bestB = -1;
  for (let i = 0; i < n; i++) {
    const d = (points[i].x - points[iA].x) ** 2 + (points[i].y - points[iA].y) ** 2;
    if (d > bestB) {
      bestB = d;
      iB = i;
    }
  }
  if (iA === iB) return simplify(points, epsilon);

  const chain = (from, to) => {
    const out = [];
    let i = from;
    for (;;) {
      out.push(points[i]);
      if (i === to) break;
      i = (i + 1) % n;
    }
    return out;
  };

  const first = simplify(chain(iA, iB), epsilon);
  const second = simplify(chain(iB, iA), epsilon);
  // Both chains include their shared endpoints, so drop the duplicates.
  return first.concat(second.slice(1, -1));
}
