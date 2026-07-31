/**
 * The tests that license the central claim: that the sound is real.
 *
 * If these pass, the solver reproduces the known spectra of the shapes where the
 * answer is provable. Do not loosen a tolerance to make a change pass — a
 * regression here means the physics went wrong, which is the one thing this
 * project is not allowed to get away with.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { besselJ, besselJ0, besselJ1, besselJZero } from '../src/math/bessel.js';
import {
  diskSpectrum,
  rectangleSpectrum,
  regularPolygon,
  rightIsoscelesTriangleSpectrum,
} from '../src/math/analytic.js';
import { solveDrum } from '../src/fem/solve.js';
import { jacobiEigenSymmetric } from '../src/math/linalg.js';
import { SparseBuilder } from '../src/math/sparse.js';
import { BandedCholesky } from '../src/math/banded.js';

const UNIT_SQUARE = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const RIGHT_TRIANGLE = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

// ---------------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------------

test('Bessel J0 and J1 match reference values in both branches', () => {
  const cases = [
    [besselJ0(1), 0.7651976866],
    [besselJ0(2), 0.2238907791],
    [besselJ0(10), -0.2459357645],
    [besselJ1(1), 0.4400505857],
    [besselJ1(2), 0.5767248078],
    [besselJ1(10), 0.0434727462],
  ];
  for (const [got, want] of cases) {
    assert.ok(Math.abs(got - want) < 1e-7, `got ${got}, want ${want}`);
  }
});

test('Bessel J_n satisfies its own three-term recurrence', () => {
  // An internal consistency check that needs no external constants:
  //   J_{n+1}(x) = (2n/x) J_n(x) - J_{n-1}(x)
  for (const x of [0.5, 1, 3.7, 12, 25]) {
    for (let n = 1; n <= 8; n++) {
      const lhs = besselJ(n + 1, x);
      const rhs = ((2 * n) / x) * besselJ(n, x) - besselJ(n - 1, x);
      assert.ok(
        Math.abs(lhs - rhs) < 1e-7,
        `recurrence broke at n=${n}, x=${x}: ${lhs} vs ${rhs}`,
      );
    }
  }
});

test('Bessel zeros match published values', () => {
  const cases = [
    [0, 1, 2.4048255577],
    [0, 2, 5.5200781103],
    [0, 3, 8.6537279129],
    [0, 4, 11.7915344391],
    [1, 1, 3.8317059702],
    [1, 2, 7.0155866698],
    [2, 1, 5.1356223018],
    [3, 1, 6.3801618959],
    [4, 1, 7.5883424345],
    [5, 1, 8.7714838159],
  ];
  for (const [m, k, want] of cases) {
    const got = besselJZero(m, k);
    assert.ok(Math.abs(got - want) < 1e-6, `j_{${m},${k}}: got ${got}, want ${want}`);
  }
});

test('every Bessel zero is actually a zero, and they ascend', () => {
  for (const m of [0, 1, 2, 5, 11, 30]) {
    let prev = 0;
    for (let k = 1; k <= 6; k++) {
      const z = besselJZero(m, k);
      assert.ok(z > prev, `j_{${m},${k}} = ${z} did not exceed ${prev}`);
      assert.ok(Math.abs(besselJ(m, z)) < 1e-7, `J_${m}(${z}) = ${besselJ(m, z)}`);
      prev = z;
    }
    // All positive zeros of J_m lie above m.
    assert.ok(besselJZero(m, 1) > m - 1e-9);
  }
});

// ---------------------------------------------------------------------------
// Linear algebra building blocks
// ---------------------------------------------------------------------------

test('Jacobi eigensolver reproduces a known symmetric spectrum', () => {
  // [[2,-1,0],[-1,2,-1],[0,-1,2]] has eigenvalues 2 - sqrt2, 2, 2 + sqrt2.
  const A = [2, -1, 0, -1, 2, -1, 0, -1, 2];
  const { values, vectors } = jacobiEigenSymmetric(A, 3);
  const want = [2 - Math.SQRT2, 2, 2 + Math.SQRT2];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(values[i] - want[i]) < 1e-12, `${values[i]} vs ${want[i]}`);
  }
  // Check A v = lambda v.
  for (let k = 0; k < 3; k++) {
    const v = vectors[k];
    for (let i = 0; i < 3; i++) {
      let av = 0;
      for (let j = 0; j < 3; j++) av += A[i * 3 + j] * v[j];
      assert.ok(Math.abs(av - values[k] * v[i]) < 1e-12);
    }
  }
});

test('banded Cholesky solves a sparse SPD system exactly', () => {
  // 1D Laplacian, whose solution for a constant right-hand side is a parabola.
  const n = 40;
  const b = new SparseBuilder(n);
  for (let i = 0; i < n; i++) {
    b.add(i, i, 2);
    if (i > 0) b.add(i, i - 1, -1);
    if (i < n - 1) b.add(i, i + 1, -1);
  }
  const A = b.build();
  const chol = new BandedCholesky(A);

  const rhs = new Float64Array(n).fill(1);
  const x = chol.solve(rhs);
  const check = A.matvec(x);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(check[i] - rhs[i]) < 1e-9, `residual at ${i}: ${check[i] - 1}`);
  }
  // Exact solution of the discrete problem: x_i = (i+1)(n-i)/2.
  for (let i = 0; i < n; i++) {
    const want = ((i + 1) * (n - i)) / 2;
    assert.ok(Math.abs(x[i] - want) < 1e-8, `x[${i}] = ${x[i]}, want ${want}`);
  }
});

// ---------------------------------------------------------------------------
// The real thing: computed spectra against closed form
// ---------------------------------------------------------------------------

/** Relative error of each computed eigenvalue against the exact one. */
function spectrumErrors(polygon, exact, targetNodes, modes) {
  const { eigenvalues, mesh, diagnostics } = solveDrum(polygon, { modes, targetNodes });
  const errors = [];
  for (let k = 0; k < modes; k++) {
    errors.push((eigenvalues[k] - exact[k]) / exact[k]);
  }
  return { errors, eigenvalues, mesh, diagnostics };
}

test('unit square spectrum matches pi^2 (m^2 + n^2)', () => {
  const modes = 8;
  const exact = rectangleSpectrum(modes, 1, 1);
  const { errors } = spectrumErrors(UNIT_SQUARE, exact, 2600, modes);
  for (let k = 0; k < modes; k++) {
    assert.ok(Math.abs(errors[k]) < 0.01, `mode ${k + 1} off by ${(errors[k] * 100).toFixed(3)}%`);
  }
});

test('rectangle spectrum matches the separable solution', () => {
  const modes = 6;
  const rect = [
    { x: 0, y: 0 },
    { x: 1.5, y: 0 },
    { x: 1.5, y: 0.8 },
    { x: 0, y: 0.8 },
  ];
  const exact = rectangleSpectrum(modes, 1.5, 0.8);
  const { errors } = spectrumErrors(rect, exact, 2600, modes);
  for (let k = 0; k < modes; k++) {
    assert.ok(Math.abs(errors[k]) < 0.01, `mode ${k + 1} off by ${(errors[k] * 100).toFixed(3)}%`);
  }
});

test('disk spectrum matches squared Bessel zeros', () => {
  const modes = 6;
  const exact = diskSpectrum(modes, 1);
  const { errors } = spectrumErrors(regularPolygon(512, 1), exact, 2600, modes);
  for (let k = 0; k < modes; k++) {
    assert.ok(Math.abs(errors[k]) < 0.01, `mode ${k + 1} off by ${(errors[k] * 100).toFixed(3)}%`);
  }
});

test('right isosceles triangle spectrum matches the antisymmetric square modes', () => {
  const modes = 6;
  const exact = rightIsoscelesTriangleSpectrum(modes, 1);
  const { errors } = spectrumErrors(RIGHT_TRIANGLE, exact, 2600, modes);
  for (let k = 0; k < modes; k++) {
    assert.ok(Math.abs(errors[k]) < 0.015, `mode ${k + 1} off by ${(errors[k] * 100).toFixed(3)}%`);
  }
});

test('computed eigenvalues are upper bounds, as Galerkin requires', () => {
  // A conforming finite element method minimises the Rayleigh quotient over a
  // subspace of the true space, so it can never undershoot. An eigenvalue below
  // the exact one means a genuine bug, not a bad mesh.
  const modes = 8;
  for (const [name, poly, exact] of [
    ['square', UNIT_SQUARE, rectangleSpectrum(modes, 1, 1)],
    ['disk', regularPolygon(512, 1), diskSpectrum(modes, 1)],
    ['triangle', RIGHT_TRIANGLE, rightIsoscelesTriangleSpectrum(modes, 1)],
  ]) {
    const { errors } = spectrumErrors(poly, exact, 2600, modes);
    for (let k = 0; k < modes; k++) {
      // Allow a whisker of slack for the polygonal approximation of the disk.
      assert.ok(errors[k] > -2e-3, `${name} mode ${k + 1} fell below exact: ${errors[k]}`);
    }
  }
});

test('refining the mesh converges at the expected second-order rate', () => {
  const exact = rectangleSpectrum(1, 1, 1)[0];
  const coarse = spectrumErrors(UNIT_SQUARE, [exact], 1200, 1).errors[0];
  const fine = spectrumErrors(UNIT_SQUARE, [exact], 6000, 1).errors[0];
  // Node budget x5 means h^2 shrinks by about 5; demand at least a factor of 3.
  assert.ok(fine > 0 && coarse > 0, 'both errors should be positive');
  assert.ok(
    fine < coarse / 3,
    `expected second-order convergence, got ${coarse} -> ${fine}`,
  );
});

test('mesh quality and solver health are acceptable on every reference shape', () => {
  for (const [name, poly] of [
    ['square', UNIT_SQUARE],
    ['disk', regularPolygon(256, 1)],
    ['triangle', RIGHT_TRIANGLE],
  ]) {
    const { eigenvalues, diagnostics } = solveDrum(poly, { modes: 8, targetNodes: 2600 });

    assert.ok(diagnostics.minAngleDeg > 15, `${name}: min angle ${diagnostics.minAngleDeg}`);
    assert.ok(diagnostics.areaError < 5e-3, `${name}: area error ${diagnostics.areaError}`);
    assert.ok(diagnostics.maxResidual < 1e-4, `${name}: residual ${diagnostics.maxResidual}`);

    for (let k = 0; k < eigenvalues.length; k++) {
      assert.ok(eigenvalues[k] > 0, `${name}: non-positive eigenvalue`);
      if (k > 0) {
        assert.ok(
          eigenvalues[k] >= eigenvalues[k - 1] - 1e-9,
          `${name}: eigenvalues not ascending at ${k}`,
        );
      }
    }
  }
});

test('the fundamental mode has no interior nodal line', () => {
  // Courant: the first eigenfunction of a connected domain does not change sign.
  // A sign flip in the interior would mean the solver returned the wrong mode.
  const { modes, mesh } = solveDrum(regularPolygon(128, 1), { modes: 3, targetNodes: 1600 });
  const first = modes[0];
  let positive = 0;
  let negative = 0;
  for (let i = 0; i < mesh.nodeCount; i++) {
    if (mesh.isBoundary[i]) continue;
    if (first[i] > 1e-6) positive++;
    else if (first[i] < -1e-6) negative++;
  }
  assert.ok(positive > 0, 'fundamental mode is empty');
  assert.equal(negative, 0, `fundamental mode changed sign at ${negative} nodes`);
});
