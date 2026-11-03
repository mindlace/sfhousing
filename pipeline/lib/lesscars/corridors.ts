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
// 3. The path is the shortest positive-length one from any FROM node to any TO node
//    (multi-source Dijkstra), so of a divided street's two carriageways it walks one, and of a
//    name used in two places it walks the stretch between the named crossings. A node that is both
//    a FROM and a TO node is not a path.
// 4. The corridor is the path's segments plus every candidate lying alongside the path: every
//    vertex within `bandM` of the path polyline, and none beyond a path end. A vertex is beyond an
//    end when its nearest path point is that end and it lies outward along the chord of the
//    path's last `bandM`, unless it is within `snapM` of the end node or of a line of that end's
//    cross street (for COUNTY LINE, of a county-line dead end). A candidate whose f_st and t_st
//    both name an end's cross street (the piece through a divided cross street's median) needs
//    only the band. This keeps the other carriageway and shared-centreline twins, and drops a
//    short block before FROM, a stub past TO and a fork at either end.
// CORRIDOR values are tier 4 (builder's).

export interface StreetSeg {
  cnn: string;
  streetname: string;
  fSt: string | null;
  tSt: string | null;
  /** Vertices in EPSG:7131 metres; one entry per LineString part. */
  lines: [number, number][][];
}

/**
 * A cross-street override: the resolver uses `as.from` / `as.to` in place of `from` / `to`, which
 * stay the verbatim Appendix A strings. `reason` says why (carried into corridors.resolved.json).
 */
export interface CorridorAs {
  from?: string;
  to?: string;
  reason: string;
}

export interface CorridorSelector {
  owner: string;
  street: string;
  from: string;
  to: string;
  as?: CorridorAs;
}

export interface ResolvedCorridor extends CorridorSelector {
  cnn: string[];
  lengthM: number;
}

export const COUNTY_LINE = 'COUNTY LINE';

export const CORRIDOR = { snapM: 0.5, crossM: 25, bandM: 40 } as const;

/**
 * Selector spellings mapped to DataSF's (after upper-casing, trimming and ordinal unpadding).
 * DataSF names La Playa's own segments `LA PLAYA` while its neighbours' f_st/t_st say `LA PLAYA ST`.
 */
export const STREET_ALIASES: Readonly<Record<string, string>> = { 'LA PLAYA ST': 'LA PLAYA' };

/**
 * The name every comparison uses, for selector strings and data names alike: upper-cased,
 * trimmed, ordinals unpadded (DataSF writes `09TH AVE`), then STREET_ALIASES.
 */
export function canonicalStreet(name: string): string {
  const n = name
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\b0+(\d+(?:ST|ND|RD|TH))\b/g, '$1');
  return STREET_ALIASES[n] ?? n;
}

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

const label = (sel: CorridorSelector) => {
  const end = (v: string, o: string | undefined) => (o === undefined ? v : `${v} (as ${o})`);
  return `${sel.owner}: ${sel.street}, ${end(sel.from, sel.as?.from)} → ${end(sel.to, sel.as?.to)}`;
};

/** Throws CorridorError naming the selector when it does not resolve. */
export function resolveCorridor(
  segs: readonly StreetSeg[],
  sel: CorridorSelector
): ResolvedCorridor {
  const fail = (why: string): never => {
    throw new CorridorError(`${label(sel)}: ${why}`);
  };
  const street = canonicalStreet(sel.street);
  const fromName = sel.as?.from ?? sel.from;
  const toName = sel.as?.to ?? sel.to;
  const named = (s: StreetSeg, name: string) => canonicalStreet(s.streetname) === name;
  const cands = segs
    .filter((s) => named(s, street))
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
    const want = canonicalStreet(name);
    if (want === COUNTY_LINE) {
      const isCounty = (v: string | null) => v !== null && canonicalStreet(v) === COUNTY_LINE;
      for (const e of edges) {
        const s = cands[e.seg];
        if (!isCounty(s.fSt) && !isCounty(s.tSt)) continue;
        for (const n of [e.a, e.b]) if (degree[n] === 1) out.add(n);
      }
      return out;
    }
    const lines = crossLines(want);
    nodes.forEach((p, n) => {
      if (distToLines(p, lines) <= CORRIDOR.crossM) out.add(n);
    });
    return out;
  };
  const crossLines = (want: string) => segs.filter((s) => named(s, want)).flatMap((s) => s.lines);
  const from = endsOf(fromName);
  if (from.size === 0) fail(`no crossing with ${fromName}`);
  const to = endsOf(toName);
  if (to.size === 0) fail(`no crossing with ${toName}`);

  // 3. Multi-source Dijkstra to the nearest TO node reached by a positive-length path (a node in
  // both FROM and TO sits at distance 0 and is passed over, not taken as the answer).
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
    if (to.has(u) && dist[u] > 0) {
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
  if (reached < 0) {
    const meet = [...from].some((n) => to.has(n));
    fail(meet ? `no path (${fromName} and ${toName} meet at one node)` : 'no path');
  }
  // The path as one ordered polyline, from the TO end (P[0]) back to the FROM end.
  const pathEdges: Edge[] = [];
  const P: Pt[] = [];
  for (let n = reached; via[n] >= 0;) {
    const e = edges[via[n]];
    pathEdges.push(e);
    const forward = e.a === n;
    const pts = forward ? e.part : [...e.part].reverse();
    P.push(...(P.length === 0 ? pts : pts.slice(1)));
    n = forward ? e.b : e.a;
  }

  // 4. The path's segments plus every candidate lying alongside the path.
  const keep = new Set(pathEdges.map((e) => e.seg));
  const polyline = pathEdges.map((e) => e.part);
  /**
   * One path end: `out` is the outward direction of the chord from the point `bandM` back along
   * the path (or the far end of a shorter path) to the end, so a short, angled last piece (two
   * carriageways splaying from a shared node) does not skew it.
   */
  const endOf = (path: Pt[], name: string, set: Set<number>) => {
    const atEnd = path[0];
    let back = path[path.length - 1];
    for (let i = 1, s = 0; i < path.length; i++) {
      const step = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      if (s + step >= CORRIDOR.bandM) {
        const t = (CORRIDOR.bandM - s) / step;
        back = [
          path[i - 1][0] + t * (path[i][0] - path[i - 1][0]),
          path[i - 1][1] + t * (path[i][1] - path[i - 1][1])
        ];
        break;
      }
      s += step;
    }
    const len = Math.hypot(atEnd[0] - back[0], atEnd[1] - back[1]) || 1;
    const out: Pt = [(atEnd[0] - back[0]) / len, (atEnd[1] - back[1]) / len];
    const want = canonicalStreet(name);
    const county = want === COUNTY_LINE;
    const anchors: Pt[] = county ? [...set].map((n) => nodes[n]) : [];
    const lines = county ? [] : crossLines(want);
    return { at: atEnd, out, anchors, lines, name: county ? null : want };
  };
  const pathEnds = [endOf(P, toName, to), endOf([...P].reverse(), fromName, from)];
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= CORRIDOR.snapM;
  const alongside = (p: Pt): boolean => {
    const d = distToLines(p, polyline);
    if (d > CORRIDOR.bandM) return false;
    for (const end of pathEnds) {
      const toEnd = Math.hypot(p[0] - end.at[0], p[1] - end.at[1]);
      const outward = (p[0] - end.at[0]) * end.out[0] + (p[1] - end.at[1]) * end.out[1];
      if (toEnd > d + 1e-6 || outward <= 1e-6) continue;
      const anchored =
        near(p, end.at) ||
        end.anchors.some((q) => near(p, q)) ||
        (end.lines.length > 0 && distToLines(p, end.lines) <= CORRIDOR.snapM);
      if (!anchored) return false;
    }
    return true;
  };
  // A piece through a divided cross street's median runs from one of its carriageways to the
  // other: DataSF names that cross street at both ends (f_st = t_st), and its inner vertices
  // lie between the carriageways, on neither line.
  const isMedian = (s: StreetSeg) =>
    s.fSt !== null &&
    s.tSt !== null &&
    pathEnds.some(
      (end) =>
        end.name !== null &&
        canonicalStreet(s.fSt!) === end.name &&
        canonicalStreet(s.tSt!) === end.name
    );
  const inBand = (p: Pt) => distToLines(p, polyline) <= CORRIDOR.bandM;
  cands.forEach((s, i) => {
    if (keep.has(i)) return;
    const fits = isMedian(s)
      ? s.lines.every((l) => l.every(inBand))
      : s.lines.every((l) => l.every(alongside));
    if (fits) keep.add(i);
  });
  const chosen = [...keep].map((i) => cands[i]);
  const cnn = [...new Set(chosen.map((s) => s.cnn))].sort();
  const lengthM = Math.round(chosen.reduce((t, s) => t + segLength(s), 0) * 10) / 10;
  const { owner, from: f, to: t } = sel;
  return {
    owner,
    street: sel.street,
    from: f,
    to: t,
    ...(sel.as ? { as: sel.as } : {}),
    cnn,
    lengthM
  };
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
