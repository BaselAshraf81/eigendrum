/**
 * Verifies the headline claim of the isospectral demo, rather than taking it on
 * faith from a citation.
 *
 * The two polygons are Driscoll's rendering of the Gordon-Webb-Wolpert pair, as
 * published in the COMSOL model library. Each is a polyabolo: seven congruent
 * right isosceles triangles with legs of length 2, so both enclose area 14.
 *
 * If they really are isospectral, our solver must produce the same eigenvalues
 * for both, to within its own accuracy. Both shapes have only axis-aligned and
 * 45-degree edges on integer coordinates, so with `align: 1` the mesh represents
 * them with zero geometric error and the comparison is as sharp as the solver.
 */

import { solveDrum } from '../src/fem/solve.js';
import { area, perimeter } from '../src/geom/polygon.js';
import { GWW_A, GWW_B } from '../src/app/presets.js';

const MODES = 12;
const TARGET = 5000;

function signature(poly) {
  const lens = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    lens.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return lens;
}

console.log('Area A      :', area(GWW_A).toFixed(6));
console.log('Area B      :', area(GWW_B).toFixed(6));
console.log('Perimeter A :', perimeter(GWW_A).toFixed(6));
console.log('Perimeter B :', perimeter(GWW_B).toFixed(6));
console.log('Edge lengths A:', signature(GWW_A).map((v) => v.toFixed(3)).join(' '));
console.log('Edge lengths B:', signature(GWW_B).map((v) => v.toFixed(3)).join(' '));

const a = solveDrum(GWW_A, { modes: MODES, targetNodes: TARGET, align: 1 });
const b = solveDrum(GWW_B, { modes: MODES, targetNodes: TARGET, align: 1 });

console.log(
  `\nMesh A: ${a.diagnostics.unknowns} unknowns, h=${a.diagnostics.h.toFixed(5)}, ` +
    `areaErr=${(a.diagnostics.areaError * 100).toFixed(6)}%, minAngle=${a.diagnostics.minAngleDeg.toFixed(1)}deg`,
);
console.log(
  `Mesh B: ${b.diagnostics.unknowns} unknowns, h=${b.diagnostics.h.toFixed(5)}, ` +
    `areaErr=${(b.diagnostics.areaError * 100).toFixed(6)}%, minAngle=${b.diagnostics.minAngleDeg.toFixed(1)}deg`,
);

console.log('\n  k        drum A         drum B     rel.diff');
let worst = 0;
for (let k = 0; k < MODES; k++) {
  const va = a.eigenvalues[k];
  const vb = b.eigenvalues[k];
  const rel = Math.abs(va - vb) / ((va + vb) / 2);
  worst = Math.max(worst, rel);
  console.log(
    `${String(k + 1).padStart(3)}  ${va.toFixed(8).padStart(13)}  ${vb
      .toFixed(8)
      .padStart(13)}  ${(rel * 100).toFixed(5)}%`,
  );
}
console.log(`\nWorst relative difference across ${MODES} modes: ${(worst * 100).toFixed(5)}%`);
console.log(
  worst < 2e-4
    ? 'VERDICT: isospectral to solver precision. The demo is honest.'
    : 'VERDICT: spectra differ. Do NOT ship the isospectral claim with these shapes.',
);
