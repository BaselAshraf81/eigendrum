/**
 * The whole pipeline: polygon -> mesh -> FEM -> eigenpairs -> mode fields.
 *
 * Everything downstream (the sound, the spectrum, the animated modes) is derived
 * from what this returns. Nothing else in the app is allowed to invent a
 * frequency.
 */

import { buildMesh } from '../geom/mesh.js';
import { BandedCholesky } from '../math/banded.js';
import { smallestEigenpairs } from '../math/eigen.js';
import { assemble } from './assemble.js';

/**
 * @param {{x:number,y:number}[]} polygon
 * @param {object} [opts]
 * @param {number} [opts.modes]       how many modes to compute
 * @param {number} [opts.targetNodes] interior node budget (accuracy vs speed)
 * @param {(p: object) => void} [opts.onProgress]
 */
export function solveDrum(
  polygon,
  { modes = 20, targetNodes = 2600, align = 0, onProgress = null } = {},
) {
  const t0 = Date.now();
  const report = (stage, detail) => onProgress && onProgress({ stage, ...detail });

  report('meshing');
  const mesh = buildMesh(polygon, { targetNodes, align });

  report('assembling', { nodes: mesh.interiorCount });
  const { K, M, n } = assemble(mesh);

  report('factorising', { unknowns: n });
  const chol = new BandedCholesky(K);

  report('solving', { unknowns: n, bandwidth: chol.b });
  const want = Math.min(modes, Math.max(1, n - 1));
  const result = smallestEigenpairs({
    n,
    want,
    applyK: (x) => K.matvec(x, new Float64Array(n)),
    applyM: (x) => M.matvec(x, new Float64Array(n)),
    solveK: (rhs) => chol.solve(rhs, new Float64Array(n)),
    onProgress: (p) => report('solving', p),
  });

  // Scatter each interior eigenvector back onto the full node set (boundary
  // nodes are identically zero) and normalise to a peak amplitude of 1 so the
  // renderer and the synthesiser get a predictable range.
  const { interiorIndex, nodeCount } = mesh;
  const fields = result.vectors.map((vec) => {
    const full = new Float64Array(nodeCount);
    let peak = 0;
    for (let i = 0; i < nodeCount; i++) {
      const u = interiorIndex[i];
      if (u >= 0) {
        const v = vec[u];
        full[i] = v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
    }
    if (peak > 0) {
      // Fix the sign convention so the largest excursion is positive; otherwise
      // the colour map would flip arbitrarily between runs.
      let signAt = 0;
      for (let i = 0; i < nodeCount; i++) {
        if (Math.abs(full[i]) === peak) {
          signAt = full[i];
          break;
        }
      }
      const s = (signAt < 0 ? -1 : 1) / peak;
      for (let i = 0; i < nodeCount; i++) full[i] *= s;
    }
    return full;
  });

  return {
    mesh,
    eigenvalues: result.values,
    modes: fields,
    diagnostics: {
      ...mesh.stats,
      unknowns: n,
      bandwidth: chol.b,
      nnz: K.nnz,
      iterations: result.iterations,
      maxResidual: result.residuals.length ? Math.max(...result.residuals) : 0,
      solveMs: Date.now() - t0,
    },
  };
}
