import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG, project, type BBox } from '$lib/plan/geometry';

/** Raster grid in plan metres. (x0, y0) is the SW corner; cell (c, r) is at index r * cols + c. */
export interface RasterFrame {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
}

export const EMPTY = 0;
export const BLOCK = 0xffffffff;

export function frameFor(bbox: BBox, cell: number, padM: number): RasterFrame {
  const [x0, y0] = project(bbox[0], bbox[1]);
  const [x1, y1] = project(bbox[2], bbox[3]);
  const sx = x0 - padM;
  const sy = y0 - padM;
  return {
    x0: sx,
    y0: sy,
    cell,
    cols: Math.max(1, Math.ceil((x1 + padM - sx - 1e-9) / cell)),
    rows: Math.max(1, Math.ceil((y1 + padM - sy - 1e-9) / cell))
  };
}

/** Grid-vertex units (vertex 0,0 is the SW corner) to lng/lat. */
export function vertexToLngLat(f: RasterFrame, gx: number, gy: number): [number, number] {
  return [LNG0 + (f.x0 + gx * f.cell) / M_PER_DEG_LNG, LAT0 + (f.y0 + gy * f.cell) / M_PER_DEG_LAT];
}

/** Even-odd scanline fill of lng/lat rings at cell centres. Returns the cells written. */
export function rasterizeRings(
  f: RasterFrame,
  rings: readonly (readonly [number, number])[][],
  label: number,
  out: Uint32Array
): number {
  const pr = rings.map((ring) => ring.map(([lng, lat]) => project(lng, lat)));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of pr)
    for (const p of ring) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  if (!(minY <= maxY)) return 0;
  const r0 = Math.max(0, Math.ceil((minY - f.y0) / f.cell - 0.5));
  const r1 = Math.min(f.rows - 1, Math.floor((maxY - f.y0) / f.cell - 0.5));
  let written = 0;
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const y = f.y0 + (r + 0.5) * f.cell;
    xs.length = 0;
    for (const ring of pr) {
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = ring[j];
        const b = ring[i];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - f.x0) / f.cell - 0.5));
      const c1 = Math.min(f.cols - 1, Math.ceil((xs[k + 1] - f.x0) / f.cell - 0.5) - 1);
      for (let c = c0; c <= c1; c++) {
        out[r * f.cols + c] = label;
        written++;
      }
    }
  }
  return written;
}

/** Line directions for gap closing: E, N, NE, NW. */
export type GapDir = 0 | 1 | 2 | 3;

export function lineCount(f: RasterFrame, d: GapDir): number {
  return d === 0 ? f.rows : d === 1 ? f.cols : f.cols + f.rows - 1;
}

/**
 * Fill runs of EMPTY cells (and cells filled by an earlier direction) that sit between two lot
 * cells on one raster line and are at most maxGapM long. bridge(a, b) gives the fill label, or
 * EMPTY for none. BLOCK, lot cells, and runs touching the raster edge are never filled. A cell
 * contested by an earlier fill goes to the higher rank, then the lower label. `filled` is a
 * caller-owned mask (one byte per cell, allocate it fresh per build and share it across all
 * directions of that build) marking cells already filled by a bridge.
 */
export function closeGapLines(
  labels: Uint32Array,
  f: RasterFrame,
  d: GapDir,
  from: number,
  to: number,
  maxGapM: number,
  bridge: (a: number, b: number) => number,
  rank: (label: number) => number,
  filled: Uint8Array
): void {
  const dc = d === 1 ? 0 : d === 3 ? -1 : 1;
  const dr = d === 0 ? 0 : 1;
  const step = d >= 2 ? Math.SQRT2 * f.cell : f.cell;
  const maxRun = Math.floor(maxGapM / step + 1e-9);
  const run = new Int32Array(maxRun + 1);
  for (let line = from; line < to; line++) {
    let c: number;
    let r: number;
    if (d === 0) {
      c = 0;
      r = line;
    } else if (d === 1) {
      c = line;
      r = 0;
    } else if (d === 2) {
      // c - r = const, start on the left column or the bottom row
      c = Math.max(0, line - (f.rows - 1));
      r = Math.max(0, f.rows - 1 - line);
    } else {
      // c + r = const, start at the highest column reachable on row 0 or the right column
      c = Math.min(line, f.cols - 1);
      r = line - c;
    }
    let endIdx = -1; // index of the last lot cell on this line
    let endLab = 0;
    // the open run since the last lot cell; only its first maxRun + 1 cells are kept, since a
    // longer run is never filled
    let runLen = 0;
    for (; c >= 0 && c < f.cols && r >= 0 && r < f.rows; c += dc, r += dr) {
      const i = r * f.cols + c;
      const v = labels[i];
      if (v === BLOCK) {
        endIdx = -1;
        runLen = 0;
        continue;
      }
      if (v === EMPTY || filled[i]) {
        if (endIdx >= 0) {
          if (runLen <= maxRun) run[runLen] = i;
          runLen++;
        }
        continue;
      }
      // a lot cell
      if (endIdx >= 0 && runLen > 0 && runLen <= maxRun) {
        const fill = bridge(endLab, v);
        if (fill !== EMPTY) {
          for (let q = 0; q < runLen; q++) {
            const k = run[q];
            if (labels[k] === EMPTY) {
              labels[k] = fill;
              filled[k] = 1;
            } else {
              const cur = labels[k];
              const rf = rank(fill);
              const rc = rank(cur);
              if (rf > rc || (rf === rc && fill < cur)) labels[k] = fill;
            }
          }
        }
      }
      endIdx = i;
      endLab = v;
      runLen = 0;
    }
  }
}

/** City-wide nearest label point within each point's reach, by two-pass vector propagation. */
export class NearestField {
  private readonly best: Int32Array;
  private readonly dist: Float32Array;
  private readonly px: Float64Array;
  private readonly py: Float64Array;

  constructor(
    private readonly f: RasterFrame,
    seedsLngLat: Float64Array,
    private readonly reachM: Float32Array
  ) {
    const n = seedsLngLat.length / 2;
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.best = new Int32Array(f.cols * f.rows).fill(-1);
    this.dist = new Float32Array(f.cols * f.rows).fill(Infinity);
    for (let s = 0; s < n; s++) {
      const [x, y] = project(seedsLngLat[2 * s], seedsLngLat[2 * s + 1]);
      this.px[s] = x;
      this.py[s] = y;
      const c = Math.floor((x - f.x0) / f.cell);
      const r = Math.floor((y - f.y0) / f.cell);
      if (c >= 0 && c < f.cols && r >= 0 && r < f.rows) this.offer(r * f.cols + c, c, r, s);
    }
  }

  private offer(i: number, c: number, r: number, s: number): void {
    if (s < 0) return;
    const dx = this.f.x0 + (c + 0.5) * this.f.cell - this.px[s];
    const dy = this.f.y0 + (r + 0.5) * this.f.cell - this.py[s];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= this.reachM[s] && d < this.dist[i]) {
      this.dist[i] = d;
      this.best[i] = s;
    }
  }

  private pull(c: number, r: number, nc: number, nr: number): void {
    const { cols, rows } = this.f;
    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) return;
    this.offer(r * cols + c, c, r, this.best[nr * cols + nc]);
  }

  /** Rows [r0, r1) ascending; row r0 - 1 must already have been processed. */
  forward(r0: number, r1: number): void {
    for (let r = r0; r < r1; r++)
      for (let c = 0; c < this.f.cols; c++) {
        this.pull(c, r, c - 1, r);
        this.pull(c, r, c - 1, r - 1);
        this.pull(c, r, c, r - 1);
        this.pull(c, r, c + 1, r - 1);
      }
  }

  /** Rows [r0, r1) descending; row r1 must already have been processed. */
  backward(r0: number, r1: number): void {
    for (let r = r1 - 1; r >= r0; r--)
      for (let c = this.f.cols - 1; c >= 0; c--) {
        this.pull(c, r, c + 1, r);
        this.pull(c, r, c + 1, r + 1);
        this.pull(c, r, c, r + 1);
        this.pull(c, r, c - 1, r + 1);
      }
  }

  result(): Int32Array {
    return this.best;
  }
}

/**
 * Metres from each cell to the nearest cell of another group (3-4 chamfer, edge cells start at
 * half a cell). Run 'forward' then 'backward' over the same rows; the forward pass initializes.
 */
export function insideDistance(
  group: Uint32Array,
  f: RasterFrame,
  r0: number,
  r1: number,
  out: Float32Array,
  pass: 'forward' | 'backward'
): void {
  const { cols, rows, cell } = f;
  const o = cell / 3;
  const a = 3 * o;
  const b = 4 * o;
  const half = cell / 2;
  const lastC = cols - 1;
  // Neighbours outside the raster read as Infinity, so they are skipped.
  if (pass === 'forward') {
    for (let r = r0; r < r1; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const g = group[i];
        const edge =
          (c > 0 && group[i - 1] !== g) ||
          (c < lastC && group[i + 1] !== g) ||
          (r > 0 && group[i - cols] !== g) ||
          (r < rows - 1 && group[i + cols] !== g);
        let v = edge ? half : Infinity;
        let t: number;
        if (c > 0 && (t = out[i - 1] + a) < v) v = t;
        if (r > 0) {
          const u = i - cols;
          if ((t = out[u] + a) < v) v = t;
          if (c > 0 && (t = out[u - 1] + b) < v) v = t;
          if (c < lastC && (t = out[u + 1] + b) < v) v = t;
        }
        out[i] = v;
      }
  } else {
    for (let r = r1 - 1; r >= r0; r--)
      for (let c = lastC; c >= 0; c--) {
        const i = r * cols + c;
        let v = out[i];
        let t: number;
        if (c < lastC && (t = out[i + 1] + a) < v) v = t;
        if (r < rows - 1) {
          const d = i + cols;
          if ((t = out[d] + a) < v) v = t;
          if (c < lastC && (t = out[d + 1] + b) < v) v = t;
          if (c > 0 && (t = out[d - 1] + b) < v) v = t;
        }
        out[i] = v;
      }
  }
}
