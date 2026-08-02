/**
 * Built-in shapes.
 *
 * Coordinates are stored in whatever frame is natural for each shape. The app
 * normalises every drum to unit area before solving, because Laplacian
 * eigenvalues scale like 1/area - without normalising, comparing two shapes
 * would mostly be comparing their sizes, and "hear the shape" would be a lie.
 *
 * `latticePitch` declares that a shape's vertices sit on a grid of that spacing.
 * The mesher uses it to choose a cell size that divides the pitch exactly, so
 * those shapes are meshed with zero geometric error.
 */

import { area, centroid } from '../geom/polygon.js';

const P = (x, y) => ({ x, y });

function circle(n, r = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push(P(r * Math.cos(a), r * Math.sin(a)));
  }
  return pts;
}

function regular(n, r = 1, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (2 * Math.PI * i) / n;
    pts.push(P(r * Math.cos(a), r * Math.sin(a)));
  }
  return pts;
}

/** Bunimovich stadium: a rectangle capped with two semicircles. */
function stadium(straight = 1.6, radius = 0.6, seg = 48) {
  const pts = [];
  const hx = straight / 2;
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / seg;
    pts.push(P(hx + radius * Math.cos(a), radius * Math.sin(a)));
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / seg;
    pts.push(P(-hx + radius * Math.cos(a), radius * Math.sin(a)));
  }
  return pts;
}

function star(points = 5, outer = 1, inner = 0.42) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (Math.PI * i) / points;
    pts.push(P(r * Math.cos(a), r * Math.sin(a)));
  }
  return pts;
}

/**
 * The Gordon-Webb-Wolpert isospectral pair, in the form given by Driscoll and
 * reproduced in the COMSOL model library. Each is a polyabolo made of seven
 * congruent right isosceles triangles with legs of length 2, so each encloses
 * area 14 and has perimeter 12 + 6*sqrt(2). Same area, same perimeter, different
 * shape, identical spectrum.
 */
export const GWW_A = [
  P(-3, -3),
  P(-3, -1),
  P(1, 3),
  P(1, 1),
  P(3, 1),
  P(1, -1),
  P(-1, -1),
  P(-1, -3),
];

export const GWW_B = [
  P(-3, 1),
  P(1, 1),
  P(1, 3),
  P(3, 1),
  P(1, -1),
  P(-1, -1),
  P(-1, -3),
  P(-3, -1),
];

export const PRESETS = [
  {
    id: 'circle',
    name: 'Circle',
    blurb:
      'The only shape whose sound we can write down exactly. Its overtones are ratios of Bessel function zeros - famously not whole-number multiples, which is why a drum has no clear pitch.',
    polygon: circle(256),
    exact: 'disk',
  },
  {
    id: 'square',
    name: 'Square',
    blurb:
      'Overtones follow sqrt(m^2 + n^2). Modes 2 and 3 land on exactly the same frequency by symmetry, so the square rings with genuine degeneracies.',
    polygon: [P(0, 0), P(1, 0), P(1, 1), P(0, 1)],
    latticePitch: 1,
    exact: 'square',
  },
  {
    id: 'rectangle',
    name: 'Rectangle',
    blurb:
      'Stretching the square splits every degenerate pair in two. You can hear symmetry breaking directly.',
    polygon: [P(0, 0), P(1.618, 0), P(1.618, 1), P(0, 1)],
    exact: null,
  },
  {
    id: 'triangle',
    name: 'Equilateral triangle',
    blurb: 'Three-fold symmetry, and one of the few polygons with a known closed-form spectrum.',
    polygon: regular(3),
  },
  {
    id: 'righttriangle',
    name: 'Right triangle',
    blurb:
      'Half a square, and its modes are exactly the square modes that vanish along the diagonal.',
    polygon: [P(0, 0), P(1, 0), P(0, 1)],
    latticePitch: 1,
    exact: 'righttriangle',
  },
  {
    id: 'lshape',
    name: 'L-shape',
    blurb:
      'The re-entrant corner is a genuine singularity: the true eigenfunctions have unbounded gradient there. This is the standard torture test for numerical methods.',
    polygon: [P(0, 0), P(2, 0), P(2, 1), P(1, 1), P(1, 2), P(0, 2)],
    latticePitch: 1,
  },
  {
    id: 'stadium',
    name: 'Stadium',
    blurb:
      'The Bunimovich stadium: classically chaotic. Its high modes look scarred and irregular rather than neatly striped, and the frequencies repel each other instead of clustering. This is quantum chaos you can see.',
    polygon: stadium(),
  },
  {
    id: 'star',
    name: 'Star',
    blurb: 'Five sharp spikes. Energy gets trapped in the points, giving oddly localised modes.',
    polygon: star(5),
  },
  {
    id: 'pentagon',
    name: 'Pentagon',
    blurb: 'Five-fold symmetry produces paired modes that rotate into one another.',
    polygon: regular(5),
  },
  {
    id: 'gww-a',
    name: 'Kac drum I',
    blurb:
      'One half of the Gordon-Webb-Wolpert pair (1992), which answered Kac\u2019s 1966 question "can one hear the shape of a drum?" with a definite no. Compare it with Kac drum II.',
    polygon: GWW_A,
    latticePitch: 1,
    pairedWith: 'gww-b',
  },
  {
    id: 'gww-b',
    name: 'Kac drum II',
    blurb:
      'The other half of the pair. Seven identical triangles, rearranged. Same area, same perimeter, completely different outline - and every single frequency is the same. Two drums that sound alike but are not alike.',
    polygon: GWW_B,
    latticePitch: 1,
    pairedWith: 'gww-a',
  },
];

export const PRESETS_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

/**
 * Centres a polygon on the origin and scales it to unit area. Returns the scaled
 * lattice pitch too, so a preset's exactness survives normalisation.
 */
export function normalizeShape(polygon, latticePitch = 0) {
  const a = area(polygon);
  if (!(a > 0)) return { polygon: polygon.slice(), align: 0 };
  const c = centroid(polygon);
  const s = 1 / Math.sqrt(a);
  return {
    polygon: polygon.map((p) => P((p.x - c.x) * s, (p.y - c.y) * s)),
    align: latticePitch > 0 ? latticePitch * s : 0,
  };
}
