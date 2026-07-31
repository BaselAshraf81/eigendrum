/**
 * Runs the mesher and the eigensolver off the main thread.
 *
 * A few thousand unknowns takes a few hundred milliseconds, which is far too
 * long to spend on the thread that has to keep the drawing responsive.
 */

import { solveDrum } from '../fem/solve.js';

self.onmessage = (event) => {
  const { id, polygon, modes = 20, targetNodes = 2600, align = 0 } = event.data;

  try {
    const result = solveDrum(polygon, {
      modes,
      targetNodes,
      align,
      onProgress: (p) => self.postMessage({ id, type: 'progress', ...p }),
    });

    self.postMessage({
      id,
      type: 'done',
      eigenvalues: result.eigenvalues,
      modes: result.modes,
      mesh: {
        polygon: result.mesh.polygon,
        nodes: result.mesh.nodes,
        nodeCount: result.mesh.nodeCount,
        triangles: result.mesh.triangles,
        triangleCount: result.mesh.triangleCount,
        isBoundary: result.mesh.isBoundary,
      },
      diagnostics: result.diagnostics,
    });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || String(error) });
  }
};
