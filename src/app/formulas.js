/**
 * A short gallery of worked equations.
 *
 * These are not decoration. A blank text box asking for `r(t)` is a wall unless you
 * already know the notation, so each of these is a legible starting point that you
 * can then edit by one number and hear what changed. That editing loop is the whole
 * reason the formula input is worth having: it reaches shapes a mouse cannot draw,
 * and it makes a shape a thing you can vary rather than a thing you traced once.
 *
 * `tests/formula.test.mjs` solves every entry here, so a broken example cannot ship.
 */

export const FORMULA_EXAMPLES = [
  {
    id: 'flower',
    name: 'flower',
    formula: { kind: 'polar', r: '1 + 0.3cos(5t)' },
    note: 'Change 5 for a different number of lobes.',
  },
  {
    id: 'squircle',
    name: 'squircle',
    formula: { kind: 'polar', r: '(|cos(t)|^4 + |sin(t)|^4)^(-1/4)' },
    note: 'The exponent runs a circle into a square. Try 2, 4, 12.',
  },
  {
    id: 'cardioid',
    name: 'cardioid',
    formula: { kind: 'polar', r: '1 + cos(t)' },
    note: 'A cusp, where the boundary comes to a point.',
  },
  {
    id: 'gear',
    name: 'gear',
    formula: { kind: 'polar', r: '1 + 0.09square(14t)' },
    note: 'square() is a square wave of period tau, so 14 gives 14 teeth.',
  },
  {
    id: 'nephroid',
    name: 'nephroid',
    formula: { kind: 'parametric', x: '3cos(t) - cos(3t)', y: '3sin(t) - sin(3t)' },
    note: 'The curve a rolling circle traces.',
  },
  {
    id: 'egg',
    name: 'egg',
    formula: { kind: 'parametric', x: 'cos(t)', y: 'sin(t)(1 + 0.35cos(t))' },
    note: 'Fat at one end. Nothing symmetric sounds quite like it.',
  },
];

/** A short human label for a formula, for the readout and the share status. */
export function formulaLabel(formula) {
  if (!formula) return '';
  if (formula.kind === 'polar') return `r = ${formula.r}`;
  return `x = ${formula.x}, y = ${formula.y}`;
}
