/**
 * Equations to outlines.
 *
 * Three things are being defended here. That the parser cannot execute anything,
 * because expressions arrive from shared links. That a formula which reaches the
 * mesher really is a drum, since the accuracy claims this project makes are void on
 * a degenerate domain. And that the shapes people can name - a circle, a square -
 * come out with the spectra the closed-form answers say they should, which is the
 * only way to show the equation path is wired to the same physics as everything
 * else.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileExpression, CONSTANT_NAMES, FUNCTION_NAMES } from '../src/math/expr.js';
import { formulaToPolygon, parametricToPolygon, polarToPolygon } from '../src/geom/curve.js';
import { area, isSimple, perimeter } from '../src/geom/polygon.js';
import { FORMULA_EXAMPLES } from '../src/app/formulas.js';
import { solveDrum } from '../src/fem/solve.js';
import { normalizeShape } from '../src/app/presets.js';
import { diskSpectrum, rectangleSpectrum } from '../src/math/analytic.js';

const at = (source, t, vars = ['t']) => {
  const c = compileExpression(source, vars);
  assert.equal(c.ok, true, `expected "${source}" to compile: ${c.error}`);
  return c.fn({ t });
};

const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} to be within ${eps} of ${b}`);

test('arithmetic, precedence and associativity follow ordinary algebra', () => {
  close(at('1 + 2 * 3', 0), 7);
  close(at('(1 + 2) * 3', 0), 9);
  close(at('2 - 3 - 4', 0), -5); // left associative
  close(at('2 ^ 3 ^ 2', 0), 512); // right associative
  close(at('-2 ^ 2', 0), -4); // unary binds looser than the power
  close(at('2 ^ -1', 0), 0.5); // a signed exponent is allowed
  close(at('7 % 3', 0), 1);
  close(at('|0 - 3| + |2|', 0), 5);
});

test('implicit multiplication is accepted, and binds like an explicit one', () => {
  close(at('2t', 3), 6);
  close(at('3cos(0)', 0), 3);
  close(at('2(1 + 3)', 0), 8);
  close(at('2pi', 0), 2 * Math.PI);
  // The case that would be a real trap if it bound tighter than division.
  close(at('1/2t', 4), 2);
});

test('a number is a number, not the start of an accidental exponent', () => {
  close(at('1e3', 0), 1000);
  close(at('1e-2', 0), 0.01);
  close(at('2e', 0), 2 * Math.E, 1e-12); // no digits after e, so this is 2 times e
});

test('every declared function and constant is reachable', () => {
  for (const name of CONSTANT_NAMES) {
    const c = compileExpression(name, []);
    assert.equal(c.ok, true, `${name} should compile`);
    assert.ok(Number.isFinite(c.fn({})), `${name} should be finite`);
  }
  for (const name of FUNCTION_NAMES) {
    // Arity is discoverable only by trying, so try each in turn and require that
    // exactly one of them works. That also proves the arity error fires.
    const attempts = ['(0.5)', '(0.5, 0.5)', '(0.5, 0, 1)'].map(
      (args) => compileExpression(`${name}${args}`, []).ok,
    );
    assert.equal(
      attempts.filter(Boolean).length,
      1,
      `${name} should accept exactly one arity`,
    );
  }
});

test('the parser cannot execute anything, whatever a link contains', () => {
  // The whole reason this is not eval. Each of these is valid JavaScript and must
  // be a parse error here rather than a running program.
  const hostile = [
    'globalThis',
    'process.exit(1)',
    'this',
    'constructor',
    'fetch("http://x")',
    '(function(){return 1})()',
    'x=>x',
    '[].map(alert)',
    '`${1}`',
    'import("x")',
    't; alert(1)',
    'new Date()',
  ];
  for (const source of hostile) {
    const c = compileExpression(source, ['t']);
    assert.equal(c.ok, false, `"${source}" must not compile`);
    assert.equal(typeof c.error, 'string');
    assert.ok(c.error.length > 0);
  }
});

test('mistakes people actually make are named rather than reported generically', () => {
  const cases = [
    ['', /Nothing to read/],
    ['1 +', /stops in the middle|missing/i],
    ['(1 + 2', /never closed/],
    ['1 + 2)', /no "\("/],
    ['sin', /needs brackets/],
    ['cos(1, 2)', /takes 1 value/],
    ['atan2(1)', /takes 2 values/],
    ['wobble(t)', /no function called "wobble"/],
    ['q', /not a name this knows/],
    ['t(2)', /a value, not a function/],
    ['r = 1 + t', /Drop the "="/],
    ['2 \u00d7 t', /Use "\*"/],
    ['[1 + t]', /round brackets/],
  ];
  for (const [source, pattern] of cases) {
    const c = compileExpression(source, ['t']);
    assert.equal(c.ok, false, `"${source}" must fail`);
    assert.match(c.error, pattern, `"${source}" gave: ${c.error}`);
  }
});

test('only declared variables resolve, and use is reported', () => {
  const c = compileExpression('2t + 1', ['t']);
  assert.deepEqual([...c.references], ['t']);
  assert.equal(compileExpression('2u', ['t']).ok, false);
  // A constant expression is legal, and reports using nothing.
  assert.deepEqual([...compileExpression('1', ['t']).references], []);
});

test('a constant radius gives a circle, and the mesher would accept it', () => {
  const out = polarToPolygon('1');
  assert.equal(out.ok, true, out.error);
  assert.ok(isSimple(out.polygon));
  // Unit area is part of the contract, so scale can never be why a formula fails.
  close(area(out.polygon), 1, 1e-9);
  // Roundness of a circle is 1, and a sampled polygon approaches it from below.
  const round = (4 * Math.PI * area(out.polygon)) / perimeter(out.polygon) ** 2;
  assert.ok(round > 0.99 && round <= 1.0000001, `roundness ${round}`);
});

test('scale is irrelevant: r = 0.001 and r = 5000 give the same drum', () => {
  const small = polarToPolygon('0.001');
  const large = polarToPolygon('5000');
  assert.equal(small.ok, true, small.error);
  assert.equal(large.ok, true, large.error);

  // Compared as shapes rather than vertex by vertex, and on purpose. Simplifying a
  // sampled circle is tie-heavy - every candidate vertex deviates by the same
  // amount - so which of two equally good vertices survives is decided at the last
  // bit of the scaling arithmetic. That makes the vertex list scale dependent while
  // the shape is not, and the shape is what gets solved.
  const shapeOf = (poly) => ({
    area: area(poly),
    round: (4 * Math.PI * area(poly)) / perimeter(poly) ** 2,
  });
  const a = shapeOf(small.polygon);
  const b = shapeOf(large.polygon);
  close(a.area, 1, 1e-9);
  close(b.area, 1, 1e-9);
  close(a.round, b.round, 1e-6);
});

test('a negative radius is refused, and says why rather than reporting a symptom', () => {
  // A rose curve. The classic case: the negative lobes overlap the positive ones.
  const out = polarToPolygon('cos(2t)');
  assert.equal(out.ok, false);
  assert.match(out.error, /negative/);
  assert.match(out.error, /abs\(\)/); // and offers the fix
});

test('a formula with no value somewhere is refused rather than meshed', () => {
  const out = polarToPolygon('1/0 * t');
  assert.equal(out.ok, false);
  assert.match(out.error, /no value at t =/);
});

test('shapes too thin to mesh honestly are refused, not silently mismeasured', () => {
  // A hair-thin ellipse. It has area and it does not cross itself, so nothing but
  // the roundness check stands between it and a plausible-looking wrong answer.
  const out = parametricToPolygon('cos(t)', '0.0004sin(t)');
  assert.equal(out.ok, false);
  assert.match(out.error, /too thin/);
});

test('a curve that does not close is refused, with the reason', () => {
  // A spiral: after one turn it is nowhere near where it started, so closing it
  // means a straight chord across the middle.
  const out = parametricToPolygon('(1 + t)cos(t)', '(1 + t)sin(t)');
  assert.equal(out.ok, false);
  assert.match(out.error, /come back to where it started/);
});

test('a self-crossing parametric curve is refused', () => {
  const out = parametricToPolygon('sin(2t)', 'sin(3t)');
  assert.equal(out.ok, false);
  assert.match(out.error, /crosses itself|come back/);
});

test('every gallery example produces a valid, simple, well-shaped outline', () => {
  assert.ok(FORMULA_EXAMPLES.length >= 5);
  for (const example of FORMULA_EXAMPLES) {
    const out = formulaToPolygon(example.formula);
    assert.equal(out.ok, true, `${example.id}: ${out.error}`);
    assert.ok(isSimple(out.polygon), `${example.id} crosses itself`);
    assert.ok(out.polygon.length >= 8, `${example.id} is too coarse`);
    assert.ok(out.polygon.length <= 220, `${example.id} has too many vertices`);
    const round = (4 * Math.PI * area(out.polygon)) / perimeter(out.polygon) ** 2;
    assert.ok(round >= 0.02, `${example.id} roundness ${round}`);
  }
});

test('every gallery example carries a note, since a blank box is a wall', () => {
  for (const example of FORMULA_EXAMPLES) {
    assert.ok(example.note && example.note.length > 8, `${example.id} has no note`);
    assert.ok(example.name && example.name === example.name.toLowerCase());
  }
});

test('a formula survives a round trip through a URL, and stays readable', async () => {
  // share.js reads `location` only inside the functions that build a URL, so a stub
  // is enough and no DOM is needed.
  globalThis.location = { origin: 'https://x.dev', pathname: '/', search: '', hash: '' };
  const { readHash, shareUrl } = await import('../src/app/share.js');

  const cases = [
    { kind: 'polar', r: '1 + 0.3cos(5t)' },
    { kind: 'polar', r: '(|cos(t)|^4 + |sin(t)|^4)^(-1/4)' },
    { kind: 'parametric', x: 'cos(t)', y: 'sin(t)(1 + 0.35cos(t))' },
    { kind: 'polar', r: '1+2-3*4/5^6' },
  ];

  for (const formula of cases) {
    const url = shareUrl({ kind: 'formula', formula });
    const back = readHash(url.slice(url.indexOf('#')));
    assert.equal(back.kind, 'formula');
    assert.deepEqual(back.formula, formula, `round trip failed for ${JSON.stringify(formula)}`);
  }

  // Readability is the whole point of storing the recipe instead of the polygon, so
  // it is worth asserting rather than assuming. URLSearchParams used to turn this
  // into f=p%3A1+%2B+0.3cos%285t%29.
  const url = shareUrl({ kind: 'formula', formula: cases[0] });
  assert.ok(url.includes('#f=p:1'), url);
  assert.ok(url.includes('0.3cos(5t)'), url);

  // A plus sign must survive as a plus. Decoding it as a space would silently turn
  // `1 + t` into the implicit product `1 * t`, which is a different shape.
  assert.deepEqual(readHash('#f=p:1+t').formula, { kind: 'polar', r: '1+t' });

  // Nonsense must be refused rather than half-read.
  assert.equal(readHash('#f=z:1'), null);
  assert.equal(readHash('#f=q:cos(t)'), null); // parametric needs both halves
  assert.equal(readHash('#f=%E0%A4%A'), null); // malformed escape
  assert.equal(readHash(`#f=p:${'1'.repeat(600)}`), null);

  delete globalThis.location;
});

/**
 * The one that matters: an equation goes through the same solver as everything
 * else, so a shape with a known spectrum must come back with that spectrum. If
 * this passes, the formula path is not a separate, unverified pipeline.
 */
test('a formula circle lands on the Bessel spectrum of a disk', () => {
  const traced = polarToPolygon('1');
  assert.equal(traced.ok, true);
  const shape = normalizeShape(traced.polygon, 0);
  const drum = solveDrum(shape.polygon, { targetNodes: 2600, modes: 8 });

  // The disk here has unit area, so radius = 1/sqrt(pi).
  const exact = diskSpectrum(8, 1 / Math.sqrt(Math.PI));
  for (let k = 0; k < 8; k++) {
    const rel = (drum.eigenvalues[k] - exact[k]) / exact[k];
    // Galerkin gives upper bounds, so the error must be positive as well as small.
    assert.ok(rel > -1e-6, `mode ${k + 1} fell below the true eigenvalue (${rel})`);
    assert.ok(rel < 0.02, `mode ${k + 1} off by ${(rel * 100).toFixed(2)}%`);
  }
});

test('a formula square lands on the closed-form spectrum of a square', () => {
  // A superellipse with a large exponent is a square with slightly eased corners,
  // which is the honest way to get one out of polar notation. The tolerance is
  // looser than the disk's because those eased corners are a real difference in
  // the domain, not solver error.
  const traced = polarToPolygon('(|cos(t)|^40 + |sin(t)|^40)^(-1/40)');
  assert.equal(traced.ok, true, traced.error);
  const shape = normalizeShape(traced.polygon, 0);
  const drum = solveDrum(shape.polygon, { targetNodes: 2600, modes: 6 });

  const exact = rectangleSpectrum(6, 1, 1);
  for (let k = 0; k < 6; k++) {
    const rel = Math.abs(drum.eigenvalues[k] - exact[k]) / exact[k];
    assert.ok(rel < 0.03, `mode ${k + 1} off by ${(rel * 100).toFixed(2)}%`);
  }
});
