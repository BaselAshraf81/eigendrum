/**
 * Small dense linear algebra.
 *
 * These operate on m x m matrices where m is the eigensolver's block size
 * (typically 24-40), so straightforward O(m^3) algorithms are entirely fine.
 * Matrices are flat Float64Array in row-major order: A[i * n + j].
 */

/**
 * Eigen-decomposition of a real symmetric matrix by the cyclic Jacobi method.
 *
 * Jacobi is slow for large matrices but is unconditionally stable, needs no
 * balancing or shifts, and delivers eigenvectors to full accuracy. At our block
 * sizes that trade is free.
 *
 * Returns eigenvalues ascending, with `vectors[k]` the unit eigenvector for
 * `values[k]`.
 */
export function jacobiEigenSymmetric(Ain, n, maxSweeps = 60) {
  const A = Float64Array.from(Ain);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    }
    if (off <= 1e-30) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;

        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        // A <- A * J  (columns p, q)
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p];
          const akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        // A <- J^T * A  (rows p, q)
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k];
          const aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        // V <- V * J
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p];
          const vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const idx = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => A[a * n + a] - A[b * n + b],
  );
  const values = new Float64Array(n);
  const vectors = [];
  for (let k = 0; k < n; k++) {
    const src = idx[k];
    values[k] = A[src * n + src];
    const vec = new Float64Array(n);
    for (let i = 0; i < n; i++) vec[i] = V[i * n + src];
    vectors.push(vec);
  }
  return { values, vectors };
}

/**
 * Cholesky factorisation of a small symmetric positive definite matrix.
 * Returns the lower triangle L with A = L * L^T, or null if not positive
 * definite (which the eigensolver uses as a signal to regularise).
 */
export function choleskyDense(Ain, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = Ain[i * n + j];
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (sum <= 0) return null;
        L[i * n + i] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j];
      }
    }
  }
  return L;
}

/** Inverse of a lower-triangular matrix, by forward substitution per column. */
export function invertLowerTriangular(L, n) {
  const X = new Float64Array(n * n);
  for (let col = 0; col < n; col++) {
    X[col * n + col] = 1 / L[col * n + col];
    for (let i = col + 1; i < n; i++) {
      let sum = 0;
      for (let k = col; k < i; k++) sum += L[i * n + k] * X[k * n + col];
      X[i * n + col] = -sum / L[i * n + i];
    }
  }
  return X;
}

/** Dot product of two equal-length vectors. */
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
