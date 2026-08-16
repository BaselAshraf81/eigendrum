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
  short: "That's too short to work as a drum. Try a longer stroke.",
  degenerate: "That's too simple a shape to work as a drum. Try adding more of an outline.",
  area: "That outline has almost no area. Try drawing it a bit rounder or bigger.",
  crossing: "That outline crosses itself, so there's no clear inside to solve for. Try drawing it without the overlap.",
};

export function strokeToPolygon(points, { tolerance = 0.006, minArea = 0.004 } = {}) {
  const result = cleanClosedOutline(points, { tolerance, minArea });
  if (result.ok) return { ok: true, polygon: result.polygon };
  return { ok: false, error: MESSAGES[result.reason] || MESSAGES.degenerate };
}
