/**
 * Turning a freehand stroke into a drum outline the mesher will accept.
 *
 * Raw pointer traces are far too dense (a hundred points per second, many of
 * them a fraction of a pixel apart) and they never close cleanly. This
 * simplifies, closes, and then *validates* — a self-crossing outline has no
 * well-defined interior, so there is nothing sensible to solve on and we say so
 * rather than producing nonsense.
 */

import { area, dedupe, ensureCCW, isSimple, simplify } from '../geom/polygon.js';

const MAX_VERTICES = 220;

export function strokeToPolygon(points, { tolerance = 0.006, minArea = 0.004 } = {}) {
  if (!points || points.length < 8) {
    return { ok: false, error: 'That stroke is too short to be a drum.' };
  }

  let poly = dedupe(points, 1e-6);
  poly = simplify(poly, tolerance);

  // Simplification keeps the endpoints, which for a closed loop leaves two
  // nearly coincident vertices at the join.
  poly = dedupe(poly, tolerance * 0.9);

  if (poly.length < 3) {
    return { ok: false, error: 'That stroke is too simple to be a drum.' };
  }

  // Progressively coarsen rather than refuse, if the outline is still huge.
  let tol = tolerance;
  while (poly.length > MAX_VERTICES && tol < 0.2) {
    tol *= 1.6;
    poly = dedupe(simplify(poly, tol), tol * 0.9);
  }

  if (area(poly) < minArea) {
    return { ok: false, error: 'That outline encloses almost no area. Try a rounder shape.' };
  }

  if (!isSimple(poly)) {
    return {
      ok: false,
      error: 'That outline crosses itself, so it has no inside. Try again without overlapping.',
    };
  }

  return { ok: true, polygon: ensureCCW(poly) };
}
