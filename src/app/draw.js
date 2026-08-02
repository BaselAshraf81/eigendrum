/**
 * Turning a freehand stroke into a drum outline the mesher will accept.
 *
 * Raw pointer traces are far too dense (a hundred points per second, many of
 * them a fraction of a pixel apart) and they never close cleanly. The geometry of
 * cleaning and validating a candidate outline lives in `cleanClosedOutline`,
 * because a sampled formula curve needs exactly the same checks; all this adds is
 * the wording, which is genuinely stroke-specific advice.
 */

import { cleanClosedOutline } from '../geom/polygon.js';

const MESSAGES = {
  short: 'That stroke is too short to be a drum.',
  degenerate: 'That stroke is too simple to be a drum.',
  area: 'That outline encloses almost no area. Try a rounder shape.',
  crossing: 'That outline crosses itself, so it has no inside. Try again without overlapping.',
};

export function strokeToPolygon(points, { tolerance = 0.006, minArea = 0.004 } = {}) {
  const result = cleanClosedOutline(points, { tolerance, minArea });
  if (result.ok) return { ok: true, polygon: result.polygon };
  return { ok: false, error: MESSAGES[result.reason] || MESSAGES.degenerate };
}
