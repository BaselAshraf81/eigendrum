/**
 * Banded Cholesky with Reverse Cuthill-McKee reordering.
 *
 * The eigensolver needs to solve `K y = b` a few hundred times. Iterative
 * solvers are painful here because the FEM stiffness matrix is ill-conditioned
 * (condition number grows like 1/h^2), so conjugate gradients would need many
 * hundreds of iterations per solve.
 *
 * Instead we factorise once. A 2D FEM mesh reordered by RCM has bandwidth of
 * roughly sqrt(n), so banded Cholesky costs about n * b^2 which, at a few
 * thousand nodes, is milliseconds. After that each solve is two banded
 * triangular sweeps.
 */

/**
 * Reverse Cuthill-McKee permutation. Returns `perm`, where `perm[newIndex] =
 * oldIndex`. Handles disconnected components.
 */
export function reverseCuthillMcKee(adj) {
  const n = adj.length;
  const degree = adj.map((a) => a.length);
  const visited = new Uint8Array(n);
  const order = [];

  /** Pseudo-peripheral start node: walk to the far side via BFS twice. */
  const pickStart = (component) => {
    let start = component[0];
    for (const v of component) if (degree[v] < degree[start]) start = v;
    for (let pass = 0; pass < 2; pass++) {
      const dist = new Int32Array(n).fill(-1);
      dist[start] = 0;
      const queue = [start];
      let last = start;
      for (let qi = 0; qi < queue.length; qi++) {
        const v = queue[qi];
        last = v;
        for (const w of adj[v]) {
          if (dist[w] === -1) {
            dist[w] = dist[v] + 1;
            queue.push(w);
          }
        }
      }
      start = last;
    }
    return start;
  };

  for (let seed = 0; seed < n; seed++) {
    if (visited[seed]) continue;

    // Collect this connected component first, so we can pick a good start.
    const component = [];
    {
      const stack = [seed];
      const seen = new Uint8Array(n);
      seen[seed] = 1;
      while (stack.length) {
        const v = stack.pop();
        component.push(v);
        for (const w of adj[v]) {
          if (!seen[w]) {
            seen[w] = 1;
            stack.push(w);
          }
        }
      }
    }

    const start = pickStart(component);
    const queue = [start];
    visited[start] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      order.push(v);
      const nbrs = adj[v].filter((w) => !visited[w]).sort((a, b) => degree[a] - degree[b]);
      for (const w of nbrs) {
        visited[w] = 1;
        queue.push(w);
      }
    }
  }

  order.reverse();
  return Int32Array.from(order);
}

/** Half-bandwidth of a CSR matrix under the permutation `invPerm`. */
export function bandwidthUnder(csr, invPerm) {
  const { n, rowPtr, colIdx } = csr;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const pi = invPerm[i];
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
      const d = Math.abs(pi - invPerm[colIdx[k]]);
      if (d > b) b = d;
    }
  }
  return b;
}

/**
 * Symmetric positive definite banded solver.
 *
 * Band storage holds the lower triangle as `data[i * (b + 1) + (i - j)]` for
 * `i - b <= j <= i`, which keeps each row's band contiguous.
 */
export class BandedCholesky {
  /**
   * Builds and factorises from a CSR matrix, applying RCM internally. The
   * permutation is hidden: `solve` takes and returns vectors in the original
   * ordering.
   */
  constructor(csr) {
    const n = csr.n;
    this.n = n;
    const perm = reverseCuthillMcKee(csr.adjacency());
    const invPerm = new Int32Array(n);
    for (let newI = 0; newI < n; newI++) invPerm[perm[newI]] = newI;
    this.perm = perm;
    this.invPerm = invPerm;

    const b = bandwidthUnder(csr, invPerm);
    this.b = b;
    const stride = b + 1;
    this.stride = stride;
    const data = new Float64Array(n * stride);

    // Scatter the lower triangle of the permuted matrix into band storage.
    const { rowPtr, colIdx, values } = csr;
    for (let i = 0; i < n; i++) {
      const pi = invPerm[i];
      for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
        const pj = invPerm[colIdx[k]];
        if (pj > pi) continue;
        data[pi * stride + (pi - pj)] = values[k];
      }
    }

    // In-place banded Cholesky.
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - b);
      for (let j = lo; j <= i; j++) {
        let sum = data[i * stride + (i - j)];
        const kLo = Math.max(lo, j - b);
        for (let k = kLo; k < j; k++) {
          sum -= data[i * stride + (i - k)] * data[j * stride + (j - k)];
        }
        if (i === j) {
          if (sum <= 0) {
            throw new Error(
              'Matrix is not positive definite — the mesh is probably degenerate.',
            );
          }
          data[i * stride + 0] = Math.sqrt(sum);
        } else {
          data[i * stride + (i - j)] = sum / data[j * stride + 0];
        }
      }
    }

    this.data = data;
    this.scratch = new Float64Array(n);
  }

  /** Solves `A x = rhs`. Both vectors use the original ordering. */
  solve(rhs, out = new Float64Array(this.n)) {
    const { n, b, stride, data, perm, invPerm, scratch } = this;

    for (let i = 0; i < n; i++) scratch[i] = rhs[perm[i]];

    // Forward: L z = P rhs
    for (let i = 0; i < n; i++) {
      let sum = scratch[i];
      const lo = Math.max(0, i - b);
      for (let j = lo; j < i; j++) sum -= data[i * stride + (i - j)] * scratch[j];
      scratch[i] = sum / data[i * stride];
    }

    // Backward: L^T x = z
    for (let i = n - 1; i >= 0; i--) {
      let sum = scratch[i];
      const hi = Math.min(n - 1, i + b);
      for (let j = i + 1; j <= hi; j++) sum -= data[j * stride + (j - i)] * scratch[j];
      scratch[i] = sum / data[i * stride];
    }

    for (let i = 0; i < n; i++) out[i] = scratch[invPerm[i]];
    return out;
  }
}
