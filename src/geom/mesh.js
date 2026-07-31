/**
 * Triangulating an arbitrary drawn shape.
 *
 * Approach: overlay a uniform lattice of right-isosceles triangles, keep the
 * triangles whose centroid falls inside the polygon, then project the resulting
 * mesh's boundary nodes onto the true polygon outline.
 *
 * Why not Delaunay: we do not need it. The interior is already a perfectly good
 * structured mesh, and a lattice has two properties we actively want.
 *
 *   1. Axis-aligned and 45-degree edges are represented *exactly*. That covers
 *      squares, rectangles, L-shapes, and — importantly — the
 *      Gordon-Webb-Wolpert isospectral drums, which are built from right
 *      isosceles triangles. Their equal spectra therefore come out equal for
 *      real geometric reasons rather than by luck.
 *   2. Node numbering is naturally banded, which keeps the Cholesky cheap.
 *
 * Curved boundaries get the snapped polyline, an O(h^2) approximation of the
 * true outline. `stats` reports enough for the UI to be honest about that.
 */

import {
  area,
  bbox,
  dedupe,
  ensureCCW,
  pointInPolygon,
  projectToBoundary,
} from './polygon.js';

function triangleArea(nodes, a, b, c) {
  return (
    ((nodes[b].x - nodes[a].x) * (nodes[c].y - nodes[a].y) -
      (nodes[c].x - nodes[a].x) * (nodes[b].y - nodes[a].y)) /
    2
  );
}

/** Drops unused nodes and renumbers triangles. */
function compact(nodes, tris) {
  const used = new Int32Array(nodes.length).fill(-1);
  for (const t of tris) for (const v of t) used[v] = 0;
  const outNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    if (used[i] === 0) {
      used[i] = outNodes.length;
      outNodes.push(nodes[i]);
    }
  }
  const outTris = tris.map((t) => [used[t[0]], used[t[1]], used[t[2]]]);
  return { nodes: outNodes, tris: outTris };
}

/** Nodes lying on an edge that belongs to only one triangle. */
function findBoundaryNodes(nodeCount, tris) {
  const counts = new Map();
  const bump = (a, b) => {
    const key = a < b ? a * nodeCount + b : b * nodeCount + a;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (const [a, b, c] of tris) {
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }
  const flags = new Uint8Array(nodeCount);
  for (const [key, count] of counts) {
    if (count !== 1) continue;
    const a = Math.floor(key / nodeCount);
    const b = key % nodeCount;
    flags[a] = 1;
    flags[b] = 1;
  }
  return flags;
}

/** The `[a, b]` edges that belong to exactly one triangle, i.e. the outline. */
function findBoundaryEdges(nodeCount, tris) {
  const counts = new Map();
  const bump = (a, b) => {
    const key = a < b ? a * nodeCount + b : b * nodeCount + a;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (const [a, b, c] of tris) {
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }
  const edges = [];
  for (const [key, count] of counts) {
    if (count !== 1) continue;
    edges.push([Math.floor(key / nodeCount), key % nodeCount]);
  }
  return edges;
}

function nodeAdjacency(nodeCount, tris) {
  const adj = Array.from({ length: nodeCount }, () => new Set());
  for (const [a, b, c] of tris) {
    adj[a].add(b).add(c);
    adj[b].add(a).add(c);
    adj[c].add(a).add(b);
  }
  return adj.map((s) => [...s]);
}

/** Keeps only the largest connected component, so the spectrum is one drum. */
function largestComponent(nodes, tris) {
  const adj = nodeAdjacency(nodes.length, tris);
  const comp = new Int32Array(nodes.length).fill(-1);
  let best = -1;
  let bestSize = 0;
  let next = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] !== -1) continue;
    const id = next++;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const v = stack.pop();
      size++;
      for (const w of adj[v]) {
        if (comp[w] === -1) {
          comp[w] = id;
          stack.push(w);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }
  if (next <= 1) return { tris, dropped: 0 };
  const kept = tris.filter((t) => comp[t[0]] === best);
  return { tris: kept, dropped: tris.length - kept.length };
}

/**
 * @param {{x:number,y:number}[]} polygonIn simple closed polygon
 * @param {object} [opts]
 * @param {number} [opts.targetNodes] rough interior node budget
 * @returns mesh with nodes, triangles, Dirichlet flags and an interior index map
 */
export function buildMesh(polygonIn, { targetNodes = 2600, smoothPasses = 4, align = 0 } = {}) {
  const poly = ensureCCW(dedupe(polygonIn));
  if (poly.length < 3) throw new Error('A drum needs at least three corners.');
  const polyArea = area(poly);
  if (!(polyArea > 0)) throw new Error('That shape has no area.');

  const box = bbox(poly);
  if (!(box.width > 0) || !(box.height > 0)) throw new Error('That shape is flat.');

  // Pick the cell size from the area budget, then nudge it so that the bounding
  // box is spanned by a whole number of cells and the grid starts exactly on the
  // box corner. For axis-aligned shapes (square, rectangle, L-shape) this makes
  // the mesh land precisely on the true boundary, so no snapping is needed and
  // the geometry is represented without error.
  // Each cell contributes roughly two nodes (its corner plus its centre), so aim
  // the cell size at half the node budget.
  const h0 = Math.sqrt((2 * polyArea) / Math.max(64, targetNodes));
  let h;
  if (align > 0) {
    // The caller knows its geometry sits on a grid of pitch `align` (integer
    // coordinates, say). Choosing h to divide that pitch exactly puts every
    // polygon vertex on a lattice node, so nothing needs snapping and the domain
    // is represented with zero geometric error. This is what makes the
    // isospectral demonstration airtight rather than merely approximate.
    h = align / Math.max(1, Math.round(align / h0));
  } else {
    // Otherwise span the bounding box with a whole number of cells, which makes
    // axis-aligned outlines exact.
    h = box.width / Math.max(2, Math.round(box.width / h0));
  }
  const cellsX = Math.max(2, Math.ceil(box.width / h - 1e-9));
  const cellsY = Math.max(2, Math.ceil(box.height / h - 1e-9));

  const originX = box.minX;
  const originY = box.minY;
  const nx = cellsX + 1;
  const ny = cellsY + 1;

  if (nx * ny > 2_000_000) throw new Error('Shape is too elongated to mesh at this resolution.');

  // Lattice corner nodes, then one extra node at the centre of every cell.
  let nodes = new Array(nx * ny + cellsX * cellsY);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      nodes[j * nx + i] = { x: originX + i * h, y: originY + j * h };
    }
  }
  const centreBase = nx * ny;
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      nodes[centreBase + j * cellsX + i] = {
        x: originX + (i + 0.5) * h,
        y: originY + (j + 0.5) * h,
      };
    }
  }

  // Split each cell into four triangles around its centre ("union jack"). Using
  // both diagonals rather than one is what lets edges at +45 AND -45 degrees be
  // represented exactly — the single-diagonal lattice silently staircases one of
  // those directions, which showed up as a real error on the second Kac drum.
  // It also removes the directional bias of a one-way lattice.
  let tris = [];
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const v00 = j * nx + i;
      const v10 = j * nx + i + 1;
      const v01 = (j + 1) * nx + i;
      const v11 = (j + 1) * nx + i + 1;
      const c = centreBase + j * cellsX + i;
      for (const t of [
        [v00, v10, c],
        [v10, v11, c],
        [v11, v01, c],
        [v01, v00, c],
      ]) {
        const cx = (nodes[t[0]].x + nodes[t[1]].x + nodes[t[2]].x) / 3;
        const cy = (nodes[t[0]].y + nodes[t[1]].y + nodes[t[2]].y) / 3;
        if (pointInPolygon(cx, cy, poly)) tris.push(t);
      }
    }
  }
  if (tris.length === 0) throw new Error('Shape is too small or too thin to mesh.');

  // Snap the mesh boundary onto the real outline, discarding anything that
  // collapses or flips in the process.
  const minArea = 1e-3 * h * h;
  for (let pass = 0; pass < 4; pass++) {
    ({ nodes, tris } = compact(nodes, tris));
    const boundary = findBoundaryNodes(nodes.length, tris);
    for (let i = 0; i < nodes.length; i++) {
      if (!boundary[i]) continue;
      const p = projectToBoundary(nodes[i].x, nodes[i].y, poly);
      if (Math.hypot(p.x - nodes[i].x, p.y - nodes[i].y) <= 1.5 * h) {
        nodes[i] = { x: p.x, y: p.y };
      }
    }
    const kept = tris.filter((t) => Math.abs(triangleArea(nodes, t[0], t[1], t[2])) > minArea);
    const dropped = tris.length - kept.length;
    tris = kept;
    if (dropped === 0) break;
  }

  // Snapping a lattice onto a curve leaves degenerate "ear" triangles: all three
  // nodes end up on the boundary and the element collapses to a splinter. They
  // carry almost no area but ruin the minimum angle and the conditioning.
  // Removing them is safe precisely because they touch nothing but the boundary.
  for (let pass = 0; pass < 6; pass++) {
    const bflags = findBoundaryNodes(nodes.length, tris);
    const before = tris.length;
    tris = tris.filter((t) => {
      if (!(bflags[t[0]] && bflags[t[1]] && bflags[t[2]])) return true;
      // A healthy element here has area h^2/4; drop splinters below ~15% of that.
      return Math.abs(triangleArea(nodes, t[0], t[1], t[2])) >= 0.04 * h * h;
    });
    if (tris.length === before) break;
  }

  ({ tris } = largestComponent(nodes, tris));
  ({ nodes, tris } = compact(nodes, tris));
  if (tris.length === 0) throw new Error('Shape is too small or too thin to mesh.');

  // Consistent winding.
  for (const t of tris) {
    if (triangleArea(nodes, t[0], t[1], t[2]) < 0) {
      const tmp = t[1];
      t[1] = t[2];
      t[2] = tmp;
    }
  }

  let isBoundary = findBoundaryNodes(nodes.length, tris);

  // Laplacian smoothing of interior nodes improves element quality where the
  // lattice met the boundary. Reject any move that would invert a triangle.
  const adj = nodeAdjacency(nodes.length, tris);
  const incident = Array.from({ length: nodes.length }, () => []);
  tris.forEach((t, ti) => {
    incident[t[0]].push(ti);
    incident[t[1]].push(ti);
    incident[t[2]].push(ti);
  });
  // Boundary nodes get to slide *along* the outline. Projecting the lattice onto
  // a curve leaves them unevenly spaced, and uneven boundary spacing is what
  // produces the near-zero-angle slivers that wreck accuracy. Sliding evens them
  // out while every node stays exactly on the true boundary.
  const bEdges = findBoundaryEdges(nodes.length, tris);
  const bNbr = Array.from({ length: nodes.length }, () => []);
  for (const [a, b] of bEdges) {
    bNbr[a].push(b);
    bNbr[b].push(a);
  }
  // Pin nodes sitting on a genuine corner, or sliding would round it off. A
  // vertex only counts as a corner if the outline actually turns sharply there:
  // a finely tessellated circle has hundreds of vertices that each turn by a
  // fraction of a degree, and treating those as corners would pin the entire
  // boundary and defeat the smoothing.
  const sharp = [];
  for (let v = 0; v < poly.length; v++) {
    const prev = poly[(v - 1 + poly.length) % poly.length];
    const cur = poly[v];
    const next = poly[(v + 1) % poly.length];
    const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
    const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 0.44) sharp.push(cur); // ~25 degrees
  }
  const nearCorner = new Uint8Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    if (!isBoundary[i]) continue;
    for (const v of sharp) {
      if (Math.hypot(nodes[i].x - v.x, nodes[i].y - v.y) < 0.34 * h) {
        nearCorner[i] = 1;
        break;
      }
    }
  }

  const tryMove = (i, target) => {
    const old = nodes[i];
    nodes[i] = target;
    for (const ti of incident[i]) {
      const t = tris[ti];
      if (triangleArea(nodes, t[0], t[1], t[2]) <= minArea * 0.1) {
        nodes[i] = old;
        return false;
      }
    }
    return true;
  };

  const relax = 0.4;
  for (let pass = 0; pass < smoothPasses; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      if (!isBoundary[i] || nearCorner[i] || bNbr[i].length !== 2) continue;
      const a = nodes[bNbr[i][0]];
      const b = nodes[bNbr[i][1]];
      const mx = nodes[i].x + relax * ((a.x + b.x) / 2 - nodes[i].x);
      const my = nodes[i].y + relax * ((a.y + b.y) / 2 - nodes[i].y);
      const p = projectToBoundary(mx, my, poly);
      tryMove(i, { x: p.x, y: p.y });
    }
    for (let i = 0; i < nodes.length; i++) {
      if (isBoundary[i] || adj[i].length === 0) continue;
      let sx = 0;
      let sy = 0;
      for (const w of adj[i]) {
        sx += nodes[w].x;
        sy += nodes[w].y;
      }
      tryMove(i, {
        x: nodes[i].x + relax * (sx / adj[i].length - nodes[i].x),
        y: nodes[i].y + relax * (sy / adj[i].length - nodes[i].y),
      });
    }
  }

  isBoundary = findBoundaryNodes(nodes.length, tris);

  // Map node index -> unknown index (boundary nodes are not unknowns).
  const interiorIndex = new Int32Array(nodes.length).fill(-1);
  let interiorCount = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (!isBoundary[i]) interiorIndex[i] = interiorCount++;
  }
  if (interiorCount === 0) {
    throw new Error('Shape is too thin at this resolution — every node is on the edge.');
  }

  // Quality report.
  let minAngle = Infinity;
  let meshArea = 0;
  for (const [a, b, c] of tris) {
    meshArea += Math.abs(triangleArea(nodes, a, b, c));
    const pts = [nodes[a], nodes[b], nodes[c]];
    for (let k = 0; k < 3; k++) {
      const p0 = pts[k];
      const p1 = pts[(k + 1) % 3];
      const p2 = pts[(k + 2) % 3];
      const v1x = p1.x - p0.x;
      const v1y = p1.y - p0.y;
      const v2x = p2.x - p0.x;
      const v2y = p2.y - p0.y;
      const ang = Math.abs(
        Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y),
      );
      if (ang < minAngle) minAngle = ang;
    }
  }

  const xy = new Float64Array(nodes.length * 2);
  nodes.forEach((p, i) => {
    xy[i * 2] = p.x;
    xy[i * 2 + 1] = p.y;
  });
  const triIdx = new Int32Array(tris.length * 3);
  tris.forEach((t, i) => {
    triIdx[i * 3] = t[0];
    triIdx[i * 3 + 1] = t[1];
    triIdx[i * 3 + 2] = t[2];
  });

  return {
    polygon: poly,
    nodes: xy,
    nodeCount: nodes.length,
    triangles: triIdx,
    triangleCount: tris.length,
    isBoundary,
    interiorIndex,
    interiorCount,
    h,
    stats: {
      h,
      nodeCount: nodes.length,
      interiorCount,
      triangleCount: tris.length,
      minAngleDeg: (minAngle * 180) / Math.PI,
      polygonArea: polyArea,
      meshArea,
      areaError: Math.abs(meshArea - polyArea) / polyArea,
    },
  };
}
