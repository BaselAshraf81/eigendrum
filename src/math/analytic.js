/**
 * Closed-form Dirichlet Laplacian spectra for the handful of shapes where one
 * exists. Two uses:
 *
 *   1. Tests. These are ground truth for the finite element solver.
 *   2. The UI. For preset shapes we can show computed against exact, which is a
 *      far more useful statement about accuracy than any hand-waving.
 */

import { besselJZero } from './bessel.js';

/**
 * Rectangle a x b with clamped edges:  lambda = pi^2 (m^2/a^2 + n^2/b^2).
 * Separable, so this is exact rather than asymptotic.
 */
export function rectangleSpectrum(count, a = 1, b = 1, maxIndex = 60) {
  const out = [];
  const pi2 = Math.PI * Math.PI;
  for (let m = 1; m <= maxIndex; m++) {
    for (let n = 1; n <= maxIndex; n++) {
      out.push(pi2 * ((m * m) / (a * a) + (n * n) / (b * b)));
    }
  }
  out.sort((p, q) => p - q);
  return out.slice(0, count);
}

/**
 * Disk of radius R:  lambda = (j_{m,k} / R)^2, where j_{m,k} is the k-th zero of
 * the Bessel function J_m. Modes with m >= 1 come in pairs (the cos and sin
 * angular dependencies are independent), so they enter the list twice.
 */
export function diskSpectrum(count, R = 1, maxOrder = 30, maxZero = 30) {
  const out = [];
  for (let m = 0; m <= maxOrder; m++) {
    for (let k = 1; k <= maxZero; k++) {
      const lam = (besselJZero(m, k) / R) ** 2;
      out.push(lam);
      if (m >= 1) out.push(lam);
    }
  }
  out.sort((p, q) => p - q);
  return out.slice(0, count);
}

/**
 * Right isosceles triangle with legs of length L along the axes. Its spectrum is
 * the subset of the L x L square's modes that are antisymmetric about the
 * diagonal, i.e. m != n.
 */
export function rightIsoscelesTriangleSpectrum(count, L = 1, maxIndex = 60) {
  const out = [];
  const pi2 = Math.PI * Math.PI;
  for (let m = 1; m <= maxIndex; m++) {
    for (let n = m + 1; n <= maxIndex; n++) {
      out.push((pi2 * (m * m + n * n)) / (L * L));
    }
  }
  out.sort((p, q) => p - q);
  return out.slice(0, count);
}

/** Regular polygon with `sides` vertices, inscribed in `radius`. */
export function regularPolygon(sides, radius = 1, rotation = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (2 * Math.PI * i) / sides;
    pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return pts;
}
