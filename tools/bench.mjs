/**
 * Accuracy and timing report for the solver, against every shape whose spectrum
 * is known in closed form. Run with `npm run bench`.
 */

import { solveDrum } from '../src/fem/solve.js';
import {
  diskSpectrum,
  rectangleSpectrum,
  regularPolygon,
  rightIsoscelesTriangleSpectrum,
} from '../src/math/analytic.js';

const MODES = 8;

function report(name, polygon, exact, targetNodes) {
  const t0 = performance.now();
  const { eigenvalues, diagnostics } = solveDrum(polygon, { modes: MODES, targetNodes });
  const ms = performance.now() - t0;

  console.log(`\n${name}`);
  console.log(
    `  nodes=${diagnostics.unknowns}  tris=${diagnostics.triangleCount}  ` +
      `h=${diagnostics.h.toFixed(5)}  band=${diagnostics.bandwidth}  ` +
      `iters=${diagnostics.iterations}  minAngle=${diagnostics.minAngleDeg.toFixed(1)}deg`,
  );
  console.log(
    `  areaErr=${(diagnostics.areaError * 100).toFixed(4)}%  ` +
      `maxResidual=${diagnostics.maxResidual.toExponential(2)}  time=${ms.toFixed(0)}ms`,
  );
  let worst = 0;
  for (let k = 0; k < Math.min(MODES, eigenvalues.length); k++) {
    const err = (eigenvalues[k] - exact[k]) / exact[k];
    worst = Math.max(worst, Math.abs(err));
    const flag = err < -1e-9 ? '  <-- BELOW exact (should not happen)' : '';
    console.log(
      `  lambda${String(k + 1).padStart(2)}  computed=${eigenvalues[k].toFixed(5).padStart(12)}` +
        `  exact=${exact[k].toFixed(5).padStart(12)}  err=${(err * 100).toFixed(3)}%${flag}`,
    );
  }
  console.log(`  worst error: ${(worst * 100).toFixed(3)}%`);
  return worst;
}

const square = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const rect = [
  { x: 0, y: 0 },
  { x: 1.5, y: 0 },
  { x: 1.5, y: 0.8 },
  { x: 0, y: 0.8 },
];

const tri = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

for (const targetNodes of [1200, 2600, 6000]) {
  console.log(`\n================ targetNodes = ${targetNodes} ================`);
  report('Unit square', square, rectangleSpectrum(MODES, 1, 1), targetNodes);
  report('Rectangle 1.5 x 0.8', rect, rectangleSpectrum(MODES, 1.5, 0.8), targetNodes);
  report('Right isosceles triangle (legs 1)', tri, rightIsoscelesTriangleSpectrum(MODES, 1), targetNodes);
  report('Unit disk (512-gon)', regularPolygon(512, 1), diskSpectrum(MODES, 1), targetNodes);
}
