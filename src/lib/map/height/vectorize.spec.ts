import { describe, expect, it } from 'vitest';
import { BLOCK, EMPTY } from './raster';
import {
  assembleFaces,
  chainsFromPoints,
  createChainTrace,
  simplifyChainRange,
  simplifyChains,
  smoothChainRange,
  smoothChains,
  traceChains,
  type Chains
} from './vectorize';

function grid(cols: number, rows: number, at: (c: number, r: number) => number): Uint32Array {
  const g = new Uint32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g[r * cols + c] = at(c, r);
  return g;
}

function chainCount(c: Chains): number {
  return c.starts.length - 1;
}

function chainXY(c: Chains, i: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = c.starts[i]; k < c.starts[i + 1]; k++) out.push([c.xy[2 * k], c.xy[2 * k + 1]]);
  return out;
}

/** Label pairs, EMPTY last, otherwise ascending. */
function pairsOf(c: Chains): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < chainCount(c); i++) {
    const a = c.left[i];
    const b = c.right[i];
    const [p, q] = a === EMPTY ? [b, a] : b === EMPTY ? [a, b] : a < b ? [a, b] : [b, a];
    s.add(`${p}|${q}`);
  }
  return s;
}

function ringArea(r: Float64Array): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
  return a / 2;
}

function areaOf(polys: { outer: Float64Array; holes: Float64Array[] }[]): number {
  let a = 0;
  for (const p of polys) {
    a += ringArea(p.outer);
    for (const h of p.holes) a += ringArea(h);
  }
  return a;
}

function cellsNonEmpty(g: Uint32Array): number {
  let n = 0;
  for (const v of g) if (v !== EMPTY && v !== BLOCK) n++;
  return n;
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Largest distance from an original vertex to the simplified polyline of the same chain. */
function maxDeviation(simplified: Chains, original: Chains): number {
  let worst = 0;
  for (let i = 0; i < chainCount(original); i++) {
    const s = chainXY(simplified, i);
    for (const p of chainXY(original, i)) {
      let d = Infinity;
      for (let k = 0; k + 1 < s.length; k++) d = Math.min(d, segDist(p, s[k], s[k + 1]));
      worst = Math.max(worst, d);
    }
  }
  return worst;
}

function endpoints(c: Chains): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < chainCount(c); i++) {
    if (c.closed[i]) continue;
    const p = chainXY(c, i);
    out.push([...p[0], ...p[p.length - 1]]);
  }
  return out;
}

// 4x4, label 1 in cells c 1..2, r 1..2
const grid4x4with2x2 = grid(4, 4, (c, r) => (c >= 1 && c <= 2 && r >= 1 && r <= 2 ? 1 : EMPTY));
// 6x4: rows 0-1 are 1 | 2 split at c = 3, rows 2-3 are all 3
const tJunction = grid(6, 4, (c, r) => (r >= 2 ? 3 : c < 3 ? 1 : 2));
// 40x20: a 30x10 rectangle (300 cells) split by a staircase into 1 and 2
const two = grid(40, 20, (c, r) =>
  c >= 5 && c < 35 && r >= 5 && r < 15 ? (c - 5 < 3 * (r - 5) ? 1 : 2) : EMPTY
);
// 10x10: label 1 fills 2..7, label 2 is a 2x2 exception lot inside it
const withHole = grid(10, 10, (c, r) =>
  c >= 4 && c <= 5 && r >= 4 && r <= 5 ? 2 : c >= 2 && c <= 7 && r >= 2 && r <= 7 ? 1 : EMPTY
);
// 20x20 diagonal staircase: 1 below the diagonal, 2 on and above it
const stairs = grid(20, 20, (c, r) => (c > r ? 1 : 2));

describe('traceChains', () => {
  it('a 2×2 block of label 1 in an empty 4×4 grid: one closed chain, left 1, right EMPTY', () => {
    const c = traceChains(grid4x4with2x2, 4, 4);
    expect(c.starts.length - 1).toBe(1);
    expect([c.left[0], c.right[0], c.closed[0]]).toEqual([1, EMPTY, 1]);
    // closed chains repeat vertex 0 at the end
    expect(chainXY(c, 0)).toHaveLength(9);
    expect(chainXY(c, 0)[0]).toEqual(chainXY(c, 0)[8]);
  });

  it('three labels meeting make junctions; each chain has one label pair', () => {
    const c = traceChains(tJunction, 6, 4);
    expect(pairsOf(c)).toEqual(new Set(['1|2', '1|0', '2|0', '3|0', '1|3', '2|3']));
    expect(chainCount(c)).toBe(6);
    expect([...c.closed].every((v) => v === 0)).toBe(true);
  });

  it('reads BLOCK as EMPTY', () => {
    const g = grid(4, 4, (c, r) => (c >= 1 && c <= 2 && r >= 1 && r <= 2 ? 1 : BLOCK));
    const c = traceChains(g, 4, 4);
    expect([chainCount(c), c.left[0], c.right[0]]).toEqual([1, 1, EMPTY]);
  });

  it('a label that fills the raster is bounded by the outside', () => {
    const c = traceChains(
      grid(3, 2, () => 5),
      3,
      2
    );
    expect([chainCount(c), c.left[0], c.right[0], c.closed[0]]).toEqual([1, 5, EMPTY, 1]);
  });
});

describe('assembleFaces', () => {
  it('faces share simplified chains: two adjacent pieces tile their cells with no gap or overlap', () => {
    const faces = assembleFaces(simplifyChains(traceChains(two, 40, 20), 0.6));
    expect(areaOf(faces.get(1)!) + areaOf(faces.get(2)!)).toBeCloseTo(cellsNonEmpty(two), 0);
  });

  it('a hole (an exception lot) is its own face and a hole in its surroundings', () => {
    const f = assembleFaces(traceChains(withHole, 10, 10));
    expect(f.get(1)![0].holes).toHaveLength(1);
    expect(f.get(2)![0].holes).toHaveLength(0);
    expect(areaOf(f.get(1)!)).toBeCloseTo(32);
    expect(areaOf(f.get(2)!)).toBeCloseTo(4);
    expect(f.has(EMPTY)).toBe(false);
  });

  it('a checkerboard keeps diagonal cells as separate faces', () => {
    const g = grid(2, 2, (c, r) => ((c + r) % 2 === 0 ? 1 : 2));
    const f = assembleFaces(traceChains(g, 2, 2));
    expect(f.get(1)!.map((p) => ringArea(p.outer))).toEqual([1, 1]);
    expect(f.get(2)!.map((p) => ringArea(p.outer))).toEqual([1, 1]);
  });

  it('nested islands put each hole in its nearest outer', () => {
    // 1 ring, EMPTY moat, 1 island holding a 2 lot
    const g = grid(11, 11, (c, r) => {
      const d = Math.max(Math.abs(c - 5), Math.abs(r - 5));
      return d === 0 ? 2 : d <= 2 ? 1 : d === 3 ? EMPTY : d <= 4 ? 1 : EMPTY;
    });
    const f = assembleFaces(traceChains(g, 11, 11));
    const ones = f.get(1)!.sort((a, b) => ringArea(a.outer) - ringArea(b.outer));
    expect(ones.map((p) => [ringArea(p.outer), p.holes.length])).toEqual([
      [25, 1],
      [81, 1]
    ]);
    expect(areaOf(f.get(1)!)).toBeCloseTo(24 + 32);
  });
});

describe('simplifyChains and smoothChains', () => {
  it('simplify keeps a straight staircase within tolerance and keeps endpoints', () => {
    const original = traceChains(stairs, 20, 20);
    const simplified = simplifyChains(original, 0.6);
    expect(maxDeviation(simplified, original)).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(endpoints(simplified)).toEqual(endpoints(original));
    expect(simplified.xy.length).toBeLessThan(original.xy.length);
  });

  it('simplify never collapses a closed loop below a triangle', () => {
    const c = simplifyChains(traceChains(grid4x4with2x2, 4, 4), 10);
    expect(chainXY(c, 0).length).toBeGreaterThanOrEqual(4);
  });

  it('smooth keeps endpoints and adds vertices', () => {
    const c = simplifyChains(traceChains(tJunction, 6, 4), 0.6);
    const s = smoothChains(c, 2);
    expect(endpoints(s)).toEqual(endpoints(c));
    expect(s.xy.length).toBeGreaterThan(c.xy.length);
    expect([...s.left, ...s.right, ...s.closed]).toEqual([...c.left, ...c.right, ...c.closed]);
  });

  it('smoothed closed loops stay closed', () => {
    const s = smoothChains(traceChains(grid4x4with2x2, 4, 4), 1);
    const p = chainXY(s, 0);
    expect(p[0]).toEqual(p[p.length - 1]);
    expect(ringArea(new Float64Array(p.slice(0, -1).flat()))).toBeGreaterThan(0);
  });
});

describe('range variants', () => {
  // Blobs of four labels with a hole, a checkerboard patch and BLOCK cells: junctions and loops.
  const cols = 41;
  const rows = 37;
  const blobs = grid(cols, rows, (c, r) => {
    if ((c * 7 + r * 13) % 29 === 0) return BLOCK;
    if (c > 30 && r > 28) return (c + r) % 2 ? 4 : 0;
    const d1 = Math.hypot(c - 12, r - 12);
    const d2 = Math.hypot(c - 26, r - 20);
    if (d1 < 3) return 3;
    if (d1 < 9) return 1;
    if (d2 < 10) return 2;
    return r > 32 ? 1 : 0;
  });

  const same = (a: Chains, b: Chains) => {
    expect([...a.starts]).toEqual([...b.starts]);
    expect([...a.xy]).toEqual([...b.xy]);
    expect([...a.left]).toEqual([...b.left]);
    expect([...a.right]).toEqual([...b.right]);
    expect([...a.closed]).toEqual([...b.closed]);
  };

  it('tracing by row bands equals the single-shot trace', () => {
    const t = createChainTrace(blobs, cols, rows);
    for (let y = 0; y <= rows; y += 5) t.junctions(y, Math.min(rows + 1, y + 5));
    for (let y = 0; y <= rows; y += 3) t.loops(y, Math.min(rows + 1, y + 3));
    const once = traceChains(blobs, cols, rows);
    expect(chainCount(once)).toBeGreaterThan(5);
    expect(once.closed).toContain(1);
    same(t.result(), once);
  });

  it('simplifying and smoothing by chain ranges equal the single-shot results', () => {
    const c = traceChains(blobs, cols, rows);
    const n = chainCount(c);
    const simp: Float64Array[] = [];
    // out of order on purpose: ranges write by index
    for (let i = n - (n % 4 || 4); i >= 0; i -= 4)
      simplifyChainRange(c, 0.6, i, Math.min(n, i + 4), simp);
    const s = chainsFromPoints(c, simp);
    same(s, simplifyChains(c, 0.6));
    const smooth: Float64Array[] = [];
    for (let i = 0; i < n; i += 3) smoothChainRange(s, 2, i, Math.min(n, i + 3), smooth);
    same(chainsFromPoints(s, smooth), smoothChains(s, 2));
  });
});
