/**
 * Smallest eigenpairs of the generalised symmetric problem
 *
 *     K phi = lambda M phi        (K, M symmetric positive definite)
 *
 * by block inverse iteration with a Rayleigh-Ritz projection.
 *
 * Why this method: we want the *lowest* 20-30 modes. Plain Lanczos converges to
 * the extremes of the spectrum, and for a stiffness matrix the top end converges
 * first, which is the wrong end. Applying K^-1 inverts the spectrum so the modes
 * we care about become dominant, and because we already have a Cholesky
 * factorisation each application is cheap.
 *
 * Guard vectors matter: convergence for eigenvalue i is governed by the gap to
 * eigenvalue m+1 where m is the block size, so we iterate on more vectors than
 * we intend to keep and discard the tail.
 */

import { jacobiEigenSymmetric, dot } from './linalg.js';

/** Deterministic PRNG so runs (and tests) are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = ((t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

/**
 * M-orthonormalises `cols` in place using modified Gram-Schmidt with one
 * re-orthogonalisation pass. Degenerate columns are replaced with fresh random
 * vectors rather than being allowed to poison the basis.
 */
function mOrthonormalize(cols, applyM, rand) {
  const m = cols.length;
  const n = cols[0].length;
  const Mcols = [];

  for (let j = 0; j < m; j++) {
    let v = cols[j];
    let norm = 0;

    for (let attempt = 0; attempt < 3; attempt++) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < j; i++) {
          const c = dot(v, Mcols[i]);
          if (c === 0) continue;
          const ci = cols[i];
          for (let k = 0; k < n; k++) v[k] -= c * ci[k];
        }
      }
      const Mv = applyM(v);
      const q = dot(v, Mv);
      norm = q > 0 ? Math.sqrt(q) : 0;
      if (norm > 1e-11) {
        for (let k = 0; k < n; k++) v[k] /= norm;
        Mcols[j] = applyM(v);
        break;
      }
      // Linearly dependent: try again from a fresh direction.
      for (let k = 0; k < n; k++) v[k] = rand();
      norm = 0;
    }

    if (!Mcols[j]) Mcols[j] = applyM(v);
    cols[j] = v;
  }
  return Mcols;
}

/**
 * @param {object} opts
 * @param {number} opts.n            problem size
 * @param {number} opts.want         how many of the lowest modes to return
 * @param {(x: Float64Array) => Float64Array} opts.applyK   x -> K x
 * @param {(x: Float64Array) => Float64Array} opts.applyM   x -> M x
 * @param {(b: Float64Array) => Float64Array} opts.solveK   b -> K^-1 b
 * @returns {{values: Float64Array, vectors: Float64Array[], iterations: number,
 *            residuals: Float64Array}}
 */
export function smallestEigenpairs({
  n,
  want,
  applyK,
  applyM,
  solveK,
  guard = null,
  maxIter = 300,
  // Chasing eigenvalues to machine precision is wasted effort: the answer is
  // limited by the mesh to a few parts in a thousand, so converging the
  // *algebraic* problem far past that only costs iterations.
  tol = 1e-8,
  seed = 0x5eed,
  onProgress = null,
}) {
  const target = Math.min(want, n);
  const extra = guard === null ? Math.max(8, Math.ceil(target * 0.6)) : guard;
  const m = Math.min(n, target + extra);
  const rand = mulberry32(seed);

  // Start with a constant vector (huge overlap with the fundamental mode, which
  // has no interior sign changes) plus random directions for the rest.
  const X = [];
  for (let j = 0; j < m; j++) {
    const v = new Float64Array(n);
    if (j === 0) v.fill(1);
    else for (let k = 0; k < n; k++) v[k] = rand();
    X.push(v);
  }
  mOrthonormalize(X, applyM, rand);

  let prev = null;
  let values = new Float64Array(m);
  let iterations = 0;

  for (let iter = 1; iter <= maxIter; iter++) {
    iterations = iter;

    // Y = K^-1 M X
    const Y = X.map((x) => solveK(applyM(x)));
    mOrthonormalize(Y, applyM, rand);

    // Project: A = Y^T K Y in the M-orthonormal basis Y.
    const KY = Y.map((y) => applyK(y));
    const A = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
      for (let j = i; j < m; j++) {
        const v = dot(Y[i], KY[j]);
        A[i * m + j] = v;
        A[j * m + i] = v;
      }
    }

    const { values: theta, vectors } = jacobiEigenSymmetric(A, m);
    values = theta;

    // Rotate the basis into the Ritz directions.
    const next = [];
    for (let j = 0; j < m; j++) {
      const col = new Float64Array(n);
      const vj = vectors[j];
      for (let k = 0; k < m; k++) {
        const c = vj[k];
        if (c === 0) continue;
        const yk = Y[k];
        for (let i = 0; i < n; i++) col[i] += c * yk[i];
      }
      next.push(col);
    }
    for (let j = 0; j < m; j++) X[j] = next[j];

    if (onProgress && iter % 5 === 0) onProgress({ iteration: iter, values: theta });

    if (prev) {
      let worst = 0;
      for (let k = 0; k < target; k++) {
        const denom = Math.max(1e-300, Math.abs(theta[k]));
        worst = Math.max(worst, Math.abs(theta[k] - prev[k]) / denom);
      }
      if (worst < tol) break;
    }
    prev = Float64Array.from(theta.subarray(0, target));
  }

  // Relative residuals, so callers can report honest accuracy.
  const residuals = new Float64Array(target);
  for (let k = 0; k < target; k++) {
    const x = X[k];
    const Kx = applyK(x);
    const Mx = applyM(x);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const r = Kx[i] - values[k] * Mx[i];
      num += r * r;
      const d = values[k] * Mx[i];
      den += d * d;
    }
    residuals[k] = den > 0 ? Math.sqrt(num / den) : 0;
  }

  return {
    values: Float64Array.from(values.subarray(0, target)),
    vectors: X.slice(0, target),
    iterations,
    residuals,
  };
}
