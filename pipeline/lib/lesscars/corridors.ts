// /lesscars corridor resolver: a plan street selector (`STREET, FROM → TO`, plan-v1 Appendix A) to
// the DataSF Streets CNNs of that stretch. Pure: the `lesscars-cnns` step feeds it src_streets.
//
// Rule (builder's calls, docs/dev/lesscars.md "Streets and freed land"):
// 1. Candidates are the segments named `street`. Graph nodes are their line-part endpoints,
//    clustered within `snapM` (real centrelines carry sub-metre noise); each part is an edge
//    weighted by its length.
// 2. FROM (TO) nodes are the candidate nodes within `crossM` of any line of a segment named
//    `from` (`to`): a divided cross street gives a node at each carriageway. `COUNTY LINE` instead
//    takes the degree-1 nodes ending a candidate whose f_st or t_st is `COUNTY LINE`.
// 3. The path is the shortest from any FROM node to any TO node (multi-source Dijkstra), so of a
//    divided street's two carriageways it walks one, and of a name used in two places it walks
//    the stretch between the named crossings.
// 4. The corridor is the path's segments plus every candidate whose every vertex lies within
//    `bandM` of the path polyline: the other carriageway, shared-centreline twins and the short
//    piece through a divided cross street's median. A next block (longer than `bandM`) is not.
// CORRIDOR values are tier 4 (builder's).

export interface StreetSeg {
  cnn: string;
  streetname: string;
  fSt: string | null;
  tSt: string | null;
  /** Vertices in EPSG:7131 metres; one entry per LineString part. */
  lines: [number, number][][];
}

export interface CorridorSelector {
  owner: string;
  street: string;
  from: string;
  to: string;
}

export interface ResolvedCorridor extends CorridorSelector {
  cnn: string[];
  lengthM: number;
}

export const COUNTY_LINE = 'COUNTY LINE';

export const CORRIDOR = { snapM: 0.5, crossM: 25, bandM: 40 } as const;

export class CorridorError extends Error {}

type Pt = [number, number];

interface Edge {
  seg: number;
  part: Pt[];
  a: number;
  b: number;
  w: number;
}

const partLength = (pts: readonly Pt[]): number => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return s;
};

const segLength = (s: StreetSeg): number => s.lines.reduce((t, l) => t + partLength(l), 0);

/** Distance from p to the segment ab. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Distance from p to the nearest of `lines` (each a polyline). */
function distToLines(p: Pt, lines: readonly (readonly Pt[])[]): number {
  let best = Infinity;
  for (const l of lines) {
    if (l.length === 1) best = Math.min(best, Math.hypot(p[0] - l[0][0], p[1] - l[0][1]));
    for (let i = 1; i < l.length; i++) best = Math.min(best, distToSegment(p, l[i - 1], l[i]));
  }
  return best;
}

/** Cluster points within `tol` (union-find over a grid of cell `tol`); returns a node id per point. */
function clusterPoints(pts: readonly Pt[], tol: number): { ids: number[]; nodes: Pt[] } {
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const cells = new Map<string, number[]>();
  const cell = (p: Pt) => [Math.floor(p[0] / tol), Math.floor(p[1] / tol)];
  pts.forEach((p, i) => {
    const [cx, cy] = cell(p);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]) <= tol) parent[find(i)] = find(j);
        }
      }
    }
    const k = `${cx},${cy}`;
    cells.set(k, [...(cells.get(k) ?? []), i]);
  });
  const index = new Map<number, number>();
  const nodes: Pt[] = [];
  const ids = pts.map((p, i) => {
    const r = find(i);
    if (!index.has(r)) {
      index.set(r, nodes.length);
      nodes.push(pts[r]);
    }
    return index.get(r)!;
  });
  return { ids, nodes };
}

const label = (sel: CorridorSelector) => `${sel.owner}: ${sel.street}, ${sel.from} → ${sel.to}`;

/** Throws CorridorError naming the selector when it does not resolve. */
export function resolveCorridor(
  segs: readonly StreetSeg[],
  sel: CorridorSelector
): ResolvedCorridor {
  const fail = (why: string): never => {
    throw new CorridorError(`${label(sel)}: ${why}`);
  };
  const cands = segs
    .filter((s) => s.streetname === sel.street)
    .sort((x, y) => (x.cnn < y.cnn ? -1 : x.cnn > y.cnn ? 1 : 0));
  if (cands.length === 0) fail(`no segment named ${sel.street}`);

  // 1. Graph: one edge per line part, endpoints clustered within snapM.
  const parts: { seg: number; part: Pt[] }[] = [];
  cands.forEach((s, i) => {
    for (const l of s.lines) if (l.length >= 2) parts.push({ seg: i, part: l });
  });
  const ends: Pt[] = parts.flatMap((p) => [p.part[0], p.part[p.part.length - 1]]);
  const { ids, nodes } = clusterPoints(ends, CORRIDOR.snapM);
  const edges: Edge[] = parts.map((p, k) => ({
    ...p,
    a: ids[2 * k],
    b: ids[2 * k + 1],
    w: partLength(p.part)
  }));
  const degree = new Array<number>(nodes.length).fill(0);
  const adj: number[][] = nodes.map(() => []);
  edges.forEach((e, k) => {
    degree[e.a]++;
    degree[e.b]++;
    adj[e.a].push(k);
    if (e.b !== e.a) adj[e.b].push(k);
  });

  // 2. FROM / TO nodes.
  const endsOf = (name: string): Set<number> => {
    const out = new Set<number>();
    if (name === COUNTY_LINE) {
      for (const e of edges) {
        const s = cands[e.seg];
        if (s.fSt !== COUNTY_LINE && s.tSt !== COUNTY_LINE) continue;
        for (const n of [e.a, e.b]) if (degree[n] === 1) out.add(n);
      }
      return out;
    }
    const lines = segs.filter((s) => s.streetname === name).flatMap((s) => s.lines);
    nodes.forEach((p, n) => {
      if (distToLines(p, lines) <= CORRIDOR.crossM) out.add(n);
    });
    return out;
  };
  const from = endsOf(sel.from);
  if (from.size === 0) fail(`no crossing with ${sel.from}`);
  const to = endsOf(sel.to);
  if (to.size === 0) fail(`no crossing with ${sel.to}`);

  // 3. Multi-source Dijkstra to the nearest TO node.
  const dist = new Array<number>(nodes.length).fill(Infinity);
  const via = new Array<number>(nodes.length).fill(-1);
  const done = new Array<boolean>(nodes.length).fill(false);
  for (const n of from) dist[n] = 0;
  let reached = -1;
  for (;;) {
    let u = -1;
    for (let n = 0; n < nodes.length; n++) {
      if (!done[n] && dist[n] < Infinity && (u < 0 || dist[n] < dist[u])) u = n;
    }
    if (u < 0) break;
    if (to.has(u)) {
      reached = u;
      break;
    }
    done[u] = true;
    for (const k of adj[u]) {
      const e = edges[k];
      const v = e.a === u ? e.b : e.a;
      if (!done[v] && dist[u] + e.w < dist[v]) {
        dist[v] = dist[u] + e.w;
        via[v] = k;
      }
    }
  }
  if (reached < 0) fail('no path');
  const pathEdges: Edge[] = [];
  for (let n = reached; via[n] >= 0;) {
    const e = edges[via[n]];
    pathEdges.push(e);
    n = e.a === n ? e.b : e.a;
  }
  if (pathEdges.length === 0) fail(`no path (${sel.from} and ${sel.to} meet at one node)`);

  // 4. The path's segments plus every candidate lying wholly within bandM of the path.
  const keep = new Set(pathEdges.map((e) => e.seg));
  const polyline = pathEdges.map((e) => e.part);
  cands.forEach((s, i) => {
    if (keep.has(i)) return;
    const inside = s.lines.every((l) => l.every((p) => distToLines(p, polyline) <= CORRIDOR.bandM));
    if (inside) keep.add(i);
  });
  const chosen = [...keep].map((i) => cands[i]);
  const cnn = [...new Set(chosen.map((s) => s.cnn))].sort();
  const lengthM = Math.round(chosen.reduce((t, s) => t + segLength(s), 0) * 10) / 10;
  return { owner: sel.owner, street: sel.street, from: sel.from, to: sel.to, cnn, lengthM };
}

/** Resolves every selector; throws one CorridorError listing every failure. */
export function resolveCorridors(
  segs: readonly StreetSeg[],
  sels: readonly CorridorSelector[]
): ResolvedCorridor[] {
  const out: ResolvedCorridor[] = [];
  const failures: string[] = [];
  for (const sel of sels) {
    try {
      out.push(resolveCorridor(segs, sel));
    } catch (e) {
      if (!(e instanceof CorridorError)) throw e;
      failures.push(e.message);
    }
  }
  if (failures.length > 0) {
    throw new CorridorError(
      `${failures.length} corridor selector(s) did not resolve:\n${failures.join('\n')}`
    );
  }
  return out;
}
