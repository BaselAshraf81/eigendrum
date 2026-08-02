/**
 * P1 (linear triangle) finite element assembly for the Dirichlet eigenproblem
 *
 *     -laplacian(u) = lambda u   in Omega,      u = 0 on the boundary
 *
 * whose weak form discretises to `K phi = lambda M phi`.
 *
 * On a triangle with vertices p0, p1, p2 the barycentric hat functions are
 * linear, so their gradients are constant:
 *
 *     grad(N_i) = (b_i, c_i) / (2A)
 *     b = (y1-y2, y2-y0, y0-y1),  c = (x2-x1, x0-x2, x1-x0)
 *
 * giving the element stiffness
 *
 *     K_ij = integral(grad Ni . grad Nj) = (b_i b_j + c_i c_j) / (4A)
 *
 * and, integrating the hat function products exactly, the consistent element
 * mass matrix
 *
 *     M = (A / 12) * [[2,1,1],[1,2,1],[1,1,2]]
 *
 * The consistent (rather than lumped) mass matrix is used because lumping biases
 * the eigenvalues downward, and we would rather keep the Galerkin guarantee that
 * every computed eigenvalue is an upper bound on the true one.
 *
 * Homogeneous Dirichlet conditions are imposed by simply never assembling rows
 * or columns for boundary nodes, which yields the correct reduced system.
 */

import { SparseBuilder } from '../math/sparse.js';

export function assemble(mesh) {
  const { nodes, triangles, triangleCount, interiorIndex, interiorCount } = mesh;
  const K = new SparseBuilder(interiorCount);
  const M = new SparseBuilder(interiorCount);

  const b = new Float64Array(3);
  const c = new Float64Array(3);
  const gi = new Int32Array(3);

  for (let t = 0; t < triangleCount; t++) {
    const i0 = triangles[t * 3];
    const i1 = triangles[t * 3 + 1];
    const i2 = triangles[t * 3 + 2];

    const x0 = nodes[i0 * 2];
    const y0 = nodes[i0 * 2 + 1];
    const x1 = nodes[i1 * 2];
    const y1 = nodes[i1 * 2 + 1];
    const x2 = nodes[i2 * 2];
    const y2 = nodes[i2 * 2 + 1];

    b[0] = y1 - y2;
    b[1] = y2 - y0;
    b[2] = y0 - y1;
    c[0] = x2 - x1;
    c[1] = x0 - x2;
    c[2] = x1 - x0;

    const twoA = x0 * b[0] + x1 * b[1] + x2 * b[2];
    const A = Math.abs(twoA) / 2;
    if (A <= 0) continue;

    gi[0] = interiorIndex[i0];
    gi[1] = interiorIndex[i1];
    gi[2] = interiorIndex[i2];

    const kScale = 1 / (4 * A);
    const mDiag = A / 6;
    const mOff = A / 12;

    for (let a = 0; a < 3; a++) {
      const ra = gi[a];
      if (ra < 0) continue; // boundary node: row eliminated
      for (let d = 0; d < 3; d++) {
        const cb = gi[d];
        if (cb < 0) continue; // boundary node: column eliminated
        K.add(ra, cb, (b[a] * b[d] + c[a] * c[d]) * kScale);
        M.add(ra, cb, a === d ? mDiag : mOff);
      }
    }
  }

  return { K: K.build(), M: M.build(), n: interiorCount };
}
