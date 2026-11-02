import { BLOCK, EMPTY } from './raster';

/**
 * Boundary chains of a label raster, in grid-vertex units (vertex (0, 0) is the SW corner, y grows
 * north). Chain i is vertices starts[i] .. starts[i + 1] - 1 of xy (x, y pairs). left[i] and
 * right[i] are the labels on each side in walking order. A closed chain (no junction on it)
 * repeats vertex 0 as its last vertex and runs counter-clockwise, so left is the enclosed label.
 */
export interface Chains {
  starts: Uint32Array;
  xy: Float64Array;
  left: Uint32Array;
  right: Uint32Array;
  closed: Uint8Array;
}

export interface Face {
  outer: Float64Array;
  holes: Float64Array[];
}

// Directions: 0 E, 1 N, 2 W, 3 S
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Boundary edges lie between 4-adjacent cells with different labels. BLOCK reads as EMPTY and
 * everything outside the raster is EMPTY. A vertex is a junction when its four cells hold three
 * or more labels, or two in a checkerboard. Each chain is a maximal run of edges between
 * junctions, or a closed loop with none.
 */
export function traceChains(labels: Uint32Array, cols: number, rows: number): Chains {
  const t = createChainTrace(labels, cols, rows);
  t.junctions(0, rows + 1);
  t.loops(0, rows + 1);
  return t.result();
}

/**
 * traceChains in resumable pieces. Vertex rows run 0..rows inclusive. Run `junctions` over every
 * vertex row in ascending bands, then `loops` likewise, then `result`: the chains are the same as
 * traceChains gives. A band's walks may run outside the band; edges are visited once overall.
 */
export interface ChainTrace {
  /** Chains that start at a junction on vertex rows [y0, y1). */
  junctions(y0: number, y1: number): void;
  /** Closed loops whose lowest-leftmost vertex is on vertex rows [y0, y1). */
  loops(y0: number, y1: number): void;
  result(): Chains;
}

export function createChainTrace(labels: Uint32Array, cols: number, rows: number): ChainTrace {
  const lab = (c: number, r: number): number => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return EMPTY;
    const v = labels[r * cols + c];
    return v === BLOCK ? EMPTY : v;
  };
  const nH = cols * (rows + 1);
  const visited = new Uint8Array(nH + (cols + 1) * rows);

  /** Edge id leaving vertex (x, y) in direction d, or -1 when it is not a boundary edge. */
  const edge = (x: number, y: number, d: number): number => {
    switch (d) {
      case 0:
        return x >= 0 && x < cols && y >= 0 && y <= rows && lab(x, y - 1) !== lab(x, y)
          ? x + cols * y
          : -1;
      case 1:
        return y >= 0 && y < rows && x >= 0 && x <= cols && lab(x - 1, y) !== lab(x, y)
          ? nH + x + (cols + 1) * y
          : -1;
      case 2:
        return edge(x - 1, y, 0);
      default:
        return edge(x, y - 1, 1);
    }
  };
  const leftOf = (x: number, y: number, d: number): number =>
    d === 0 ? lab(x, y) : d === 1 ? lab(x - 1, y) : d === 2 ? lab(x - 1, y - 1) : lab(x, y - 1);
  const rightOf = (x: number, y: number, d: number): number =>
    d === 0 ? lab(x, y - 1) : d === 1 ? lab(x, y) : d === 2 ? lab(x - 1, y) : lab(x - 1, y - 1);
  const junction = (x: number, y: number): boolean => {
    const ne = lab(x, y);
    const nw = lab(x - 1, y);
    const sw = lab(x - 1, y - 1);
    const se = lab(x, y - 1);
    if (ne === sw && nw === se) return ne !== nw;
    // not a checkerboard: two labels or fewer means some pair among the four repeats twice
    let distinct = 1;
    if (nw !== ne) distinct++;
    if (sw !== ne && sw !== nw) distinct++;
    if (se !== ne && se !== nw && se !== sw) distinct++;
    return distinct >= 3;
  };

  const starts: number[] = [0];
  const xy: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const closed: number[] = [];

  const walk = (x0: number, y0: number, d0: number, isClosed: boolean): void => {
    left.push(leftOf(x0, y0, d0));
    right.push(rightOf(x0, y0, d0));
    closed.push(isClosed ? 1 : 0);
    xy.push(x0, y0);
    let x = x0;
    let y = y0;
    let d = d0;
    for (;;) {
      visited[edge(x, y, d)] = 1;
      x += DX[d];
      y += DY[d];
      xy.push(x, y);
      if ((x === x0 && y === y0) || (!isClosed && junction(x, y))) break;
      // a non-junction vertex has exactly one other boundary edge: straight, left or right
      const straight = d;
      const turnL = (d + 1) % 4;
      const turnR = (d + 3) % 4;
      d = edge(x, y, straight) >= 0 ? straight : edge(x, y, turnL) >= 0 ? turnL : turnR;
    }
    starts.push(xy.length / 2);
  };

  return {
    junctions(y0, y1) {
      for (let y = Math.max(0, y0); y < Math.min(rows + 1, y1); y++)
        for (let x = 0; x <= cols; x++) {
          // fast path: an inner vertex whose four cells hold one raw label is no junction
          if (x > 0 && x < cols && y > 0 && y < rows) {
            const i = y * cols + x;
            const v = labels[i];
            if (labels[i - 1] === v && labels[i - cols] === v && labels[i - cols - 1] === v)
              continue;
          }
          if (!junction(x, y)) continue;
          for (let d = 0; d < 4; d++) {
            const e = edge(x, y, d);
            if (e >= 0 && !visited[e]) walk(x, y, d, false);
          }
        }
    },
    // What is left are closed loops. The first unvisited horizontal edge in row-major order starts
    // at the loop's lowest-leftmost vertex, so walking east from it runs counter-clockwise.
    loops(y0, y1) {
      for (let y = Math.max(0, y0); y < Math.min(rows + 1, y1); y++)
        for (let x = 0; x < cols; x++) {
          // fast path: equal raw labels above and below mean no boundary edge
          if (y > 0 && y < rows && labels[y * cols + x] === labels[(y - 1) * cols + x]) continue;
          const e = edge(x, y, 0);
          if (e >= 0 && !visited[e]) walk(x, y, 0, true);
        }
    },
    result() {
      return {
        starts: Uint32Array.from(starts),
        xy: Float64Array.from(xy),
        left: Uint32Array.from(left),
        right: Uint32Array.from(right),
        closed: Uint8Array.from(closed)
      };
    }
  };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Douglas–Peucker on xy vertices [a, b] (inclusive); sets keep[k] for kept interior vertices. */
function douglasPeucker(xy: Float64Array, a: number, b: number, tol: number, keep: Uint8Array) {
  const stack = [a, b];
  while (stack.length) {
    const j = stack.pop()!;
    const i = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(
        xy[2 * k],
        xy[2 * k + 1],
        xy[2 * i],
        xy[2 * i + 1],
        xy[2 * j],
        xy[2 * j + 1]
      );
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = 1;
      stack.push(i, at, at, j);
    }
  }
}

/**
 * Chains with new vertices per chain (pts[i] is chain i's x, y pairs) and c's labels. The output
 * shares c's left, right and closed arrays.
 */
export function chainsFromPoints(c: Chains, pts: ArrayLike<number>[]): Chains {
  const starts = new Uint32Array(pts.length + 1);
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    n += pts[i].length / 2;
    starts[i + 1] = n;
  }
  const xy = new Float64Array(2 * n);
  for (let i = 0; i < pts.length; i++) xy.set(pts[i], 2 * starts[i]);
  return { starts, xy, left: c.left, right: c.right, closed: c.closed };
}

/**
 * Douglas–Peucker with tolerance in cells. Open chains keep their endpoints, so chains still meet
 * at junctions. Closed loops keep vertex 0 and the vertex farthest from it, and never drop below
 * a triangle.
 */
export function simplifyChains(c: Chains, tolCells: number): Chains {
  const out: Float64Array[] = [];
  simplifyChainRange(c, tolCells, 0, c.starts.length - 1, out);
  return chainsFromPoints(c, out);
}

/** simplifyChains for chains [from, to): writes out[i] for each; chainsFromPoints assembles them. */
export function simplifyChainRange(
  c: Chains,
  tolCells: number,
  from: number,
  to: number,
  out: Float64Array[]
): void {
  for (let i = from; i < to; i++) {
    const s = c.starts[i];
    const e = c.starts[i + 1] - 1;
    const keep = new Uint8Array(e - s + 1);
    keep[0] = 1;
    keep[e - s] = 1;
    const pts = c.xy.subarray(2 * s, 2 * e + 2);
    if (c.closed[i]) {
      let far = 0;
      let farD = -1;
      for (let k = 1; k < e - s; k++) {
        const d = Math.hypot(pts[2 * k] - pts[0], pts[2 * k + 1] - pts[1]);
        if (d > farD) {
          farD = d;
          far = k;
        }
      }
      if (far > 0) {
        keep[far] = 1;
        douglasPeucker(pts, 0, far, tolCells, keep);
        douglasPeucker(pts, far, e - s, tolCells, keep);
        let kept = 0;
        for (let k = 1; k < e - s; k++) kept += keep[k];
        if (kept < 2) {
          // keep the vertex farthest from the line 0 - far so the loop keeps an area
          let best = -1;
          let bestD = -1;
          for (let k = 1; k < e - s; k++) {
            if (k === far) continue;
            const d = segDist(
              pts[2 * k],
              pts[2 * k + 1],
              pts[0],
              pts[1],
              pts[2 * far],
              pts[2 * far + 1]
            );
            if (d > bestD) {
              bestD = d;
              best = k;
            }
          }
          if (best >= 0) keep[best] = 1;
        }
      }
    } else {
      douglasPeucker(pts, 0, e - s, tolCells, keep);
    }
    const kept: number[] = [];
    for (let k = 0; k <= e - s; k++) if (keep[k]) kept.push(pts[2 * k], pts[2 * k + 1]);
    out[i] = Float64Array.from(kept);
  }
}

/** Chaikin corner cutting. Open chains keep their endpoints; closed loops are smoothed all round. */
export function smoothChains(c: Chains, iterations: number): Chains {
  const out: Float64Array[] = [];
  smoothChainRange(c, iterations, 0, c.starts.length - 1, out);
  return chainsFromPoints(c, out);
}

/** smoothChains for chains [from, to): writes out[i] for each; chainsFromPoints assembles them. */
export function smoothChainRange(
  c: Chains,
  iterations: number,
  from: number,
  to: number,
  out: Float64Array[]
): void {
  for (let i = from; i < to; i++) {
    let pts: Float64Array = c.xy.slice(2 * c.starts[i], 2 * c.starts[i + 1]);
    for (let it = 0; it < iterations; it++) {
      const n = pts.length / 2;
      if (n < 3) break;
      const next: number[] = [];
      if (!c.closed[i]) next.push(pts[0], pts[1]);
      for (let k = 0; k + 1 < n; k++) {
        const ax = pts[2 * k];
        const ay = pts[2 * k + 1];
        const bx = pts[2 * k + 2];
        const by = pts[2 * k + 3];
        next.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by);
        next.push(0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
      }
      if (c.closed[i]) next.push(next[0], next[1]);
      else next.push(pts[2 * n - 2], pts[2 * n - 1]);
      pts = Float64Array.from(next);
    }
    out[i] = pts;
  }
}

function signedArea(r: Float64Array): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
  return a / 2;
}

function contains(ring: Float64Array, px: number, py: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i];
    const yi = ring[2 * i + 1];
    const xj = ring[2 * j];
    const yj = ring[2 * j + 1];
    if (yi > py !== yj > py && px < xj + ((py - yj) / (yi - yj)) * (xi - xj)) inside = !inside;
  }
  return inside;
}

const vkey = (x: number, y: number): number => x * 4194304 + y;

/**
 * Faces per label (EMPTY excluded). Each label's chains are walked with the label on the left and
 * linked end to start into rings; where a label meets itself diagonally at a vertex the tightest
 * turn is taken, so faces are 4-connected. Rings with positive area are outers, negative ones
 * holes; a hole goes to the smallest outer containing the midpoint of its first segment. Rings
 * are open (the first vertex is not repeated).
 */
export function assembleFaces(c: Chains): Map<number, Face[]> {
  const n = c.starts.length - 1;
  // oriented chain refs: 2 * i is chain i forward (label left[i]), 2 * i + 1 reversed (right[i])
  const byLabel = new Map<number, number[]>();
  const add = (label: number, ref: number) => {
    if (label === EMPTY) return;
    const list = byLabel.get(label);
    if (list) list.push(ref);
    else byLabel.set(label, [ref]);
  };
  for (let i = 0; i < n; i++) {
    add(c.left[i], 2 * i);
    add(c.right[i], 2 * i + 1);
  }
  /** Vertex k (0-based) of oriented ref, counting from its start. */
  const vx = (ref: number, k: number): [number, number] => {
    const i = ref >> 1;
    const s = c.starts[i];
    const m = c.starts[i + 1] - s;
    const at = ref & 1 ? s + m - 1 - k : s + k;
    return [c.xy[2 * at], c.xy[2 * at + 1]];
  };
  const len = (ref: number): number => c.starts[(ref >> 1) + 1] - c.starts[ref >> 1];

  const result = new Map<number, Face[]>();
  for (const [label, refs] of byLabel) {
    const rings: Float64Array[] = [];
    const outgoing = new Map<number, number[]>();
    for (const ref of refs) {
      if (c.closed[ref >> 1]) continue;
      const [x, y] = vx(ref, 0);
      const k = vkey(x, y);
      const list = outgoing.get(k);
      if (list) list.push(ref);
      else outgoing.set(k, [ref]);
    }
    const used = new Set<number>();
    for (const first of refs) {
      if (used.has(first)) continue;
      const ring: number[] = [];
      let ref = first;
      for (;;) {
        used.add(ref);
        const m = len(ref);
        for (let k = 0; k < m - 1; k++) ring.push(...vx(ref, k));
        if (c.closed[ref >> 1]) break;
        const [ex, ey] = vx(ref, m - 1);
        const cands = outgoing.get(vkey(ex, ey)) ?? [];
        let next = -1;
        if (cands.length === 1) next = cands[0];
        else if (cands.length > 1) {
          // tightest turn: the outgoing direction first met turning clockwise from the way back
          const [px, py] = vx(ref, m - 2);
          const back = Math.atan2(py - ey, px - ex);
          let best = Infinity;
          for (const cand of cands) {
            const [qx, qy] = vx(cand, 1);
            let a = back - Math.atan2(qy - ey, qx - ex);
            while (a <= 0) a += 2 * Math.PI;
            while (a > 2 * Math.PI) a -= 2 * Math.PI;
            if (a < best) {
              best = a;
              next = cand;
            }
          }
        }
        if (next < 0 || next === first || used.has(next)) break;
        ref = next;
      }
      rings.push(Float64Array.from(ring));
    }

    const outers: { ring: Float64Array; area: number; face: Face }[] = [];
    const holes: Float64Array[] = [];
    for (const ring of rings) {
      const a = signedArea(ring);
      if (a > 0) outers.push({ ring, area: a, face: { outer: ring, holes: [] } });
      else if (a < 0) holes.push(ring);
    }
    for (const h of holes) {
      const mx = (h[0] + h[2]) / 2;
      const my = (h[1] + h[3]) / 2;
      let home: (typeof outers)[number] | undefined;
      for (const o of outers)
        if ((!home || o.area < home.area) && contains(o.ring, mx, my)) home = o;
      home?.face.holes.push(h);
    }
    if (outers.length)
      result.set(
        label,
        outers.map((o) => o.face)
      );
  }
  return result;
}
