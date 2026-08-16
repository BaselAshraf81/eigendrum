/**
 * Outlines from equations.
 *
 * Two notations, chosen because between them they cover almost everything people
 * actually want and neither needs contour tracing:
 *
 *   polar        r(t),  t sweeping 0 to tau. Rose curves, cardioids, superellipse
 *                lookalikes, anything star-shaped about the origin.
 *   parametric   x(t), y(t) over the same sweep. Lissajous figures, epicycloids,
 *                and every closed curve polar cannot reach because it doubles back
 *                on a ray.
 *
 * An implicit form F(x, y) = 0 is the obvious third, and it is deliberately absent:
 * it needs marching squares plus contour tracing plus a rule for which contour you
 * meant, which is a different job from parsing an expression.
 *
 * `t` is in radians and the sweep is one full turn in both notations, so `cos(t)`
 * behaves the way it does on paper. Absolute scale is irrelevant - the app
 * normalises every outline to unit area before solving, since what you hear is the
 * shape and not the size - so the sampler normalises here too and scale can never
 * be the reason a formula is rejected.
 */

import { compileExpression } from '../math/expr.js';
import { area, cleanClosedOutline, normalizeToUnitArea, perimeter } from './polygon.js';

const TAU = 2 * Math.PI;
const SAMPLES = 1440; // a quarter of a degree, then simplified down to the budget
export const CURVE_VARIABLES = ['t'];

/**
 * How round a shape is: 1 for a disk, falling towards 0 as it becomes a sliver or
 * grows hair-thin spikes. This is not a taste judgement. A P1 mesh on a domain
 * this thin has no interior nodes across the narrow direction, so the eigenvalues
 * it returns would be badly wrong while still looking like numbers - and this
 * project's whole licence to claim the sound is correct rests on not doing that.
 */
function roundness(poly) {
  const p = perimeter(poly);
  if (!(p > 0)) return 0;
  return (4 * Math.PI * area(poly)) / (p * p);
}

const MIN_ROUNDNESS = 0.02;

function finishCurve(points, { closingGap = 0 } = {}) {
  if (points.length < 8) {
    return { ok: false, error: 'That formula does not trace enough of a curve to be a drum.' };
  }

  // Normalise before validating so that r = 0.01 and r = 100 are the same drum,
  // which they are: only the shape is audible.
  const scaled = normalizeToUnitArea(points);
  if (!(area(scaled) > 0) || !Number.isFinite(scaled[0].x)) {
    return { ok: false, error: "That formula doesn't enclose any area, so there's no membrane to solve." };
  }

  const cleaned = cleanClosedOutline(scaled, { tolerance: 0.004, minArea: 1e-4 });
  if (!cleaned.ok) {
    if (cleaned.reason === 'crossing') {
      return {
        ok: false,
        error:
          "That curve crosses itself, so there's no single inside to solve for. " +
          'Usually a negative or looping radius is the cause.',
      };
    }
    if (cleaned.reason === 'area') {
      return {
        ok: false,
        error: "That formula doesn't enclose any area, so there's no membrane to solve.",
      };
    }
    return { ok: false, error: "That formula doesn't trace a usable outline." };
  }

  // Normalise again after simplifying. Cutting corners with chords removes a little
  // area, so the first normalisation no longer holds exactly, and this function's
  // contract is that what it returns has unit area. `normalizeShape` in the app
  // would do this anyway; doing it here means the polygon is already in the state
  // the tests and the mesher assume.
  const outline = normalizeToUnitArea(cleaned.polygon);

  if (roundness(outline) < MIN_ROUNDNESS) {
    return {
      ok: false,
      error:
        "That shape is too thin to mesh accurately - it would give back numbers " +
        "that look fine but aren't.",
    };
  }

  if (closingGap > 0.08) {
    return {
      ok: false,
      error:
        "That curve doesn't come back to where it started, so closing it would need a " +
        'straight jump across the shape. Check the periods in x and y.',
    };
  }

  return { ok: true, polygon: outline };
}

/** r(t) over one full turn. */
export function polarToPolygon(source) {
  const compiled = compileExpression(source, CURVE_VARIABLES);
  if (!compiled.ok) return { ok: false, error: compiled.error };

  const scope = { t: 0 };
  const points = [];
  let negative = -1;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (TAU * i) / SAMPLES;
    scope.t = t;
    const r = compiled.fn(scope);
    if (!Number.isFinite(r)) {
      return {
        ok: false,
        error: `That formula has no value at t = ${t.toFixed(2)}, so the outline breaks there.`,
      };
    }
    if (r < 0 && negative < 0) negative = t;
    points.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }

  // A negative radius reflects that part of the curve through the origin. It is
  // meaningful notation - it is what gives rose curves their extra petals - but the
  // result overlaps itself, and an outline that overlaps has no interior. Say which
  // it is rather than letting the crossing check report a vaguer symptom.
  if (negative >= 0) {
    return {
      ok: false,
      error:
        `r goes negative near t = ${negative.toFixed(2)}, which folds the curve ` +
        'back through the middle and makes it overlap itself. Try adding a constant, or wrap it in abs().',
    };
  }

  return finishCurve(points);
}

/** x(t), y(t) over one full turn. */
export function parametricToPolygon(sourceX, sourceY) {
  const cx = compileExpression(sourceX, CURVE_VARIABLES);
  if (!cx.ok) return { ok: false, error: `x: ${cx.error}` };
  const cy = compileExpression(sourceY, CURVE_VARIABLES);
  if (!cy.ok) return { ok: false, error: `y: ${cy.error}` };

  const scope = { t: 0 };
  const points = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (TAU * i) / SAMPLES;
    scope.t = t;
    const x = cx.fn(scope);
    const y = cy.fn(scope);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return {
        ok: false,
        error: `That formula has no value at t = ${t.toFixed(2)}, so the outline breaks there.`,
      };
    }
    points.push({ x, y });
  }

  // How far the curve is from meeting itself again after one turn, as a fraction of
  // the shape's own size. Closing a real gap means drawing a straight chord across
  // the drum, which is almost never what was meant.
  scope.t = TAU;
  const endX = cx.fn(scope);
  const endY = cy.fn(scope);
  let spanX = 0;
  let spanY = 0;
  for (const p of points) {
    spanX = Math.max(spanX, Math.abs(p.x - points[0].x));
    spanY = Math.max(spanY, Math.abs(p.y - points[0].y));
  }
  const span = Math.hypot(spanX, spanY) || 1;
  const gap = Number.isFinite(endX) && Number.isFinite(endY)
    ? Math.hypot(endX - points[0].x, endY - points[0].y) / span
    : 0;

  return finishCurve(points, { closingGap: gap });
}

/**
 * One entry point, so callers do not branch on notation.
 * @param {{kind: 'polar'|'parametric', r?: string, x?: string, y?: string}} formula
 */
export function formulaToPolygon(formula) {
  if (!formula) return { ok: false, error: 'No formula given.' };
  if (formula.kind === 'polar') return polarToPolygon(formula.r);
  if (formula.kind === 'parametric') return parametricToPolygon(formula.x, formula.y);
  return { ok: false, error: 'Unknown formula type.' };
}
