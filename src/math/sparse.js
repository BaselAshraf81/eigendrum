/**
 * Compressed sparse row matrices, plus a builder that accumulates duplicate
 * entries (which is exactly what finite element assembly produces: every
 * element contributes to the same node pairs as its neighbours).
 */

export class SparseBuilder {
  constructor(n) {
    this.n = n;
    this.rows = Array.from({ length: n }, () => new Map());
  }

  /** Accumulates `v` into entry (i, j). */
  add(i, j, v) {
    if (v === 0) return;
    const row = this.rows[i];
    row.set(j, (row.get(j) || 0) + v);
  }

  build() {
    const n = this.n;
    const rowPtr = new Int32Array(n + 1);
    let nnz = 0;
    for (let i = 0; i < n; i++) {
      rowPtr[i] = nnz;
      nnz += this.rows[i].size;
    }
    rowPtr[n] = nnz;

    const colIdx = new Int32Array(nnz);
    const values = new Float64Array(nnz);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const cols = [...this.rows[i].keys()].sort((a, b) => a - b);
      for (const j of cols) {
        colIdx[k] = j;
        values[k] = this.rows[i].get(j);
        k++;
      }
    }
    return new CSR(n, rowPtr, colIdx, values);
  }
}

export class CSR {
  constructor(n, rowPtr, colIdx, values) {
    this.n = n;
    this.rowPtr = rowPtr;
    this.colIdx = colIdx;
    this.values = values;
  }

  get nnz() {
    return this.values.length;
  }

  /** out = A * x. Allocates `out` when not supplied. */
  matvec(x, out = new Float64Array(this.n)) {
    const { n, rowPtr, colIdx, values } = this;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const end = rowPtr[i + 1];
      for (let k = rowPtr[i]; k < end; k++) sum += values[k] * x[colIdx[k]];
      out[i] = sum;
    }
    return out;
  }

  /** x^T A x, used for Rayleigh quotients. */
  quadForm(x) {
    const tmp = this.matvec(x);
    let s = 0;
    for (let i = 0; i < this.n; i++) s += x[i] * tmp[i];
    return s;
  }

  /** Adjacency lists (excluding the diagonal), for reordering algorithms. */
  adjacency() {
    const { n, rowPtr, colIdx } = this;
    const adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
        const j = colIdx[k];
        if (j !== i) adj[i].push(j);
      }
    }
    return adj;
  }
}
