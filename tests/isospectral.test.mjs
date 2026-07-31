/**
 * Verifies the Gordon-Webb-Wolpert claim with our own solver, so the app's
 * headline demonstration rests on a measurement rather than a citation.
 *
 * Both drums are polyaboloes: seven congruent right isosceles triangles with
 * legs of length 2. Every edge is axis-aligned or at exactly 45 degrees on
 * integer coordinates, and the union-jack lattice reproduces all of those
 * directions exactly, so with `align: 1` each domain is meshed with zero
 * geometric error. The discrete problems are then isospectral in exact
 * arithmetic too, and the agreement should be at floating-point level rather
 * than merely within discretisation error.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { solveDrum } from '../src/fem/solve.js';
import { area, perimeter } from '../src/geom/polygon.js';
import { GWW_A, GWW_B } from '../src/app/presets.js';

test('the two Kac drums have equal area and equal perimeter', () => {
  // Necessary conditions for isospectrality: area and perimeter are both
  // recoverable from the spectrum via the heat-kernel expansion.
  assert.ok(Math.abs(area(GWW_A) - 14) < 1e-12, `area A = ${area(GWW_A)}`);
  assert.ok(Math.abs(area(GWW_B) - 14) < 1e-12, `area B = ${area(GWW_B)}`);

  const expected = 12 + 6 * Math.SQRT2;
  assert.ok(Math.abs(perimeter(GWW_A) - expected) < 1e-12);
  assert.ok(Math.abs(perimeter(GWW_B) - expected) < 1e-12);
});

test('the two Kac drums are not congruent', () => {
  const lengths = (poly) =>
    poly
      .map((p, i) => {
        const q = poly[(i + 1) % poly.length];
        return Math.hypot(q.x - p.x, q.y - p.y);
      })
      .sort((a, b) => a - b)
      .map((v) => v.toFixed(6))
      .join(',');
  assert.notEqual(lengths(GWW_A), lengths(GWW_B), 'edge multisets should differ');
});

test('the two Kac drums have identical spectra', () => {
  const modes = 12;
  const opts = { modes, targetNodes: 3000, align: 1 };
  const a = solveDrum(GWW_A, opts);
  const b = solveDrum(GWW_B, opts);

  // Both domains must be represented exactly for this to be a fair comparison.
  // "Exactly" here means to double precision, not to the last bit of a sum of
  // several thousand triangle areas.
  assert.ok(a.diagnostics.areaError < 1e-12, `drum A area error ${a.diagnostics.areaError}`);
  assert.ok(b.diagnostics.areaError < 1e-12, `drum B area error ${b.diagnostics.areaError}`);
  assert.equal(a.diagnostics.unknowns, b.diagnostics.unknowns);

  for (let k = 0; k < modes; k++) {
    const va = a.eigenvalues[k];
    const vb = b.eigenvalues[k];
    const rel = Math.abs(va - vb) / ((va + vb) / 2);
    assert.ok(rel < 1e-8, `mode ${k + 1}: ${va} vs ${vb} (rel ${rel})`);
  }
});

test('a shape that is NOT isospectral to the Kac drums is distinguishable', () => {
  // Control: the test above would be vacuous if the solver could not tell any
  // two equal-area shapes apart. A square of area 14 must differ clearly.
  const s = Math.sqrt(14);
  const square = [
    { x: 0, y: 0 },
    { x: s, y: 0 },
    { x: s, y: s },
    { x: 0, y: s },
  ];
  const a = solveDrum(GWW_A, { modes: 4, targetNodes: 3000, align: 1 });
  const q = solveDrum(square, { modes: 4, targetNodes: 3000 });

  let maxRel = 0;
  for (let k = 0; k < 4; k++) {
    maxRel = Math.max(
      maxRel,
      Math.abs(a.eigenvalues[k] - q.eigenvalues[k]) / a.eigenvalues[k],
    );
  }
  assert.ok(maxRel > 0.05, `expected a clear difference, got ${maxRel}`);
});
