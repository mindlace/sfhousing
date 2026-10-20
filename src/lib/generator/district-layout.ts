import {
  booleanOpDWithPolyTree,
  ClipType,
  FillRule,
  PolyTreeD,
  type PathD,
  type PathsD,
  type PolyPathD
} from 'clipper2-ts';
import {
  BLOCK_MIN_M2,
  BLOCK_U_M,
  BLOCK_V_M,
  CLIPPER_PRECISION,
  DISTRICT_MIN_M2,
  LOT_DEPTH_MIN_M,
  LOT_FRONTAGE_M,
  LOT_MIN_M2,
  MIN_WIDTH_INSET_M,
  OPEN_SPACE_SHARE,
  STREET_M
} from './constants';
import { domainArea } from './domain';
import {
  canonicalRing,
  centroid,
  inset,
  orientedRect,
  principalAxis,
  project,
  type Vec
} from './poly';
import { fnv1a32, mulberry32 } from './seed';

export interface DistrictLot {
  /** `${piece}:${i}:${j}:${side}:${k}`, stable for a given site and seed. */
  key: string;
  /** Anchor-frame local metres, outer ring first (CCW), holes after (CW). */
  polygon: [number, number][][];
  areaM2: number;
}

export interface DistrictLayout {
  /** Summed domain area over all pieces. */
  areaM2: number;
  /** In fill order (spec §4.2 step 5). */
  lots: DistrictLot[];
  /** The open-space blocks, for tests and debugging. */
  openSpace: [number, number][][][];
}

/** One polygon: a canonical CCW outer ring, then its CW holes. */
type Poly = PathsD;

interface Block {
  piece: number;
  i: number;
  j: number;
  n: number;
  poly: Poly;
  area: number;
}

function toPaths(polygon: [number, number][][]): PathsD {
  const out: PathsD = [];
  for (const ring of polygon) {
    if (!Array.isArray(ring)) continue;
    const r: PathD = [];
    for (const pt of ring) {
      if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
      r.push({ x: pt[0], y: pt[1] });
    }
    if (r.length >= 3) out.push(r);
  }
  return out;
}

/** Each outer of a PolyTree (at any depth) with its holes, canonical and in a stable order. */
function treePolys(tree: PolyPathD): Poly[] {
  const out: Poly[] = [];
  const visit = (node: PolyPathD) => {
    for (let a = 0; a < node.count; a++) {
      const outer = node.child(a);
      if (!outer.poly || outer.poly.length < 3) continue;
      const holes: PathsD = [];
      for (let b = 0; b < outer.count; b++) {
        const hole = outer.child(b);
        if (hole.poly && hole.poly.length >= 3) holes.push(canonicalRing(hole.poly).reverse());
        visit(hole); // islands inside a hole are polygons of their own
      }
      holes.sort((p, q) => p[0].x - q[0].x || p[0].y - q[0].y);
      out.push([canonicalRing(outer.poly), ...holes]);
    }
  };
  visit(tree);
  return out
    .filter((p) => domainArea(p) > 0)
    .sort(
      (p, q) => domainArea(q) - domainArea(p) || p[0][0].x - q[0][0].x || p[0][0].y - q[0][0].y
    );
}

function boolean(op: ClipType, subject: PathsD, clip: PathsD | null, rule: FillRule): Poly[] {
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(op, subject, clip, tree, rule, CLIPPER_PRECISION);
  return treePolys(tree);
}

/** The site's pieces: the rings unioned even-odd (as `normaliseSite` does), largest first. */
function pieces(polygon: [number, number][][]): Poly[] {
  const rings = toPaths(polygon);
  return rings.length ? boolean(ClipType.Union, rings, null, FillRule.EvenOdd) : [];
}

/**
 * Cheap upper bound on `districtArea`: the sum over rings of the unsigned fan-triangle areas
 * (≥ |shoelace| per ring, and ≥ the even-odd area even for self-intersecting rings). Callers test
 * this first so an ordinary lot never pays for a Clipper union (controller ruling R3).
 */
export function mayBeDistrict(polygon: [number, number][][]): boolean {
  let bound = 0;
  for (const ring of polygon) {
    if (!Array.isArray(ring)) continue;
    // the vertices `toPaths` keeps, so malformed input is bounded rather than thrown on
    const r = ring.filter((pt) => Array.isArray(pt) && Number.isFinite(pt[0] + pt[1]));
    if (r.length < 3) continue;
    const [ox, oy] = r[0];
    for (let a = 1; a + 1 < r.length; a++) {
      const p = r[a];
      const q = r[a + 1];
      bound += Math.abs((p[0] - ox) * (q[1] - oy) - (q[0] - ox) * (p[1] - oy)) / 2;
    }
  }
  return bound >= DISTRICT_MIN_M2;
}

/** Domain area summed over every piece: outers minus holes (spec §4.1 dispatch test). */
export function districtArea(polygon: [number, number][][]): number {
  return pieces(polygon).reduce((s, p) => s + domainArea(p), 0);
}

const out = (p: Poly): [number, number][][] => p.map((r) => r.map((q) => [q.x + 0, q.y + 0]));

/** Drop blocks too small or too thin to build on (§4.2 step 2). */
function buildable(p: Poly): boolean {
  return domainArea(p) >= BLOCK_MIN_M2 && inset(p, MIN_WIDTH_INSET_M).length > 0;
}

/** §4.2 steps 1–2 for one piece: the street grid's blocks, or the piece itself if ≤ one block. */
function blocksOf(piece: Poly, pi: number, c: Vec, u: Vec, v: Vec, offU: number, offV: number) {
  const blocks: Block[] = [];
  const keep = (i: number, j: number, n: number, poly: Poly) => {
    if (buildable(poly)) blocks.push({ piece: pi, i, j, n, poly, area: domainArea(poly) });
  };
  if (domainArea(piece) <= BLOCK_U_M * BLOCK_V_M) {
    keep(0, 0, 0, piece);
    return blocks;
  }
  const pitchU = BLOCK_U_M + STREET_M;
  const pitchV = BLOCK_V_M + STREET_M;
  const o = {
    x: c.x + offU * pitchU * u.x + offV * pitchV * v.x,
    y: c.y + offU * pitchU * u.y + offV * pitchV * v.y
  };
  const ru = project([piece[0]], o, u);
  const rv = project([piece[0]], o, v);
  const h = STREET_M / 2;
  for (let i = Math.floor(ru.min / pitchU); i <= Math.floor(ru.max / pitchU); i++) {
    for (let j = Math.floor(rv.min / pitchV); j <= Math.floor(rv.max / pitchV); j++) {
      const cell = orientedRect(
        o,
        u,
        v,
        i * pitchU + h,
        (i + 1) * pitchU - h,
        j * pitchV + h,
        (j + 1) * pitchV - h
      );
      boolean(ClipType.Intersection, piece, [cell], FillRule.NonZero).forEach((poly, n) =>
        keep(i, j, n, poly)
      );
    }
  }
  return blocks;
}

/** Union `a` and `b`; null unless the result is a single polygon (they touch). */
function merge(a: Poly, b: Poly): Poly | null {
  const u = boolean(ClipType.Union, [...a, ...b], null, FillRule.NonZero);
  return u.length === 1 ? u[0] : null;
}

/**
 * §4.2 step 4 for one block: back-to-back sides across `v`, frontage cuts along `u`. Returns
 * each side's lots in `u` order.
 */
function lotsOf(block: Block, c: Vec, u: Vec, v: Vec): Poly[][] {
  const rv = project([block.poly[0]], c, v);
  const ru = project([block.poly[0]], c, u);
  const mid = (rv.min + rv.max) / 2;
  const sides: [number, number][] =
    rv.max - rv.min >= 2 * LOT_DEPTH_MIN_M
      ? [
          [rv.min - 1, mid],
          [mid, rv.max + 1]
        ]
      : [[rv.min - 1, rv.max + 1]];
  return sides.map(([v0, v1]) => {
    const strip = orientedRect(c, u, v, ru.min - 1, ru.max + 1, v0, v1);
    const sidePolys = boolean(ClipType.Intersection, block.poly, [strip], FillRule.NonZero);
    if (sidePolys.length === 0) return [];
    const su = project(
      sidePolys.map((p) => p[0]),
      c,
      u
    );
    const len = su.max - su.min;
    const n = Math.ceil(len / LOT_FRONTAGE_M);
    let items: Poly[] = [];
    for (let k = 0; k < n; k++) {
      const a = k === 0 ? su.min - 1 : su.min + (k * len) / n;
      const b = k === n - 1 ? su.max + 1 : su.min + ((k + 1) * len) / n;
      const cut = orientedRect(c, u, v, a, b, v0, v1);
      const got = boolean(ClipType.Intersection, block.poly, [cut], FillRule.NonZero);
      got.sort((p, q) => project([p[0]], c, u).min - project([q[0]], c, u).min);
      items.push(...got);
    }
    // a cut under LOT_MIN_M2 joins its u-neighbour (previous, else next), or is left unbuilt
    for (;;) {
      const at = items.findIndex((p) => domainArea(p) < LOT_MIN_M2);
      if (at < 0) break;
      const prev = at > 0 ? merge(items[at - 1], items[at]) : null;
      if (prev) {
        items = [...items.slice(0, at - 1), prev, ...items.slice(at + 1)];
        continue;
      }
      const next = at + 1 < items.length ? merge(items[at], items[at + 1]) : null;
      if (next) {
        items = [...items.slice(0, at), next, ...items.slice(at + 2)];
        continue;
      }
      items = [...items.slice(0, at), ...items.slice(at + 1)];
    }
    return items;
  });
}

/**
 * Lay out a district (spec §4.2): a street grid per piece along its principal axes, blocks,
 * seeded whole-block open space, and lots in fill order. Pure: the only randomness is the
 * `${seed}|district` stream (the frozen `drawVariety` stream is untouched) and seeded hashes.
 */
export function layoutDistrict(
  polygon: [number, number][][],
  seed: number,
  openSpaceShare = OPEN_SPACE_SHARE
): DistrictLayout {
  const s = seed >>> 0;
  const draw = mulberry32(fnv1a32(`${s}|district`));
  const ps = pieces(polygon);
  const frames = ps.map((piece) => {
    const c = centroid(piece[0]);
    const u = principalAxis(piece[0], c);
    const v = { x: -u.y + 0, y: u.x + 0 };
    // three draws per piece, always, so one piece's size never shifts another's stream
    const offU = draw();
    const offV = draw();
    const reverse = draw() < 0.5;
    return { c, u, v, offU, offV, reverse };
  });
  const blocks = ps.flatMap((piece, pi) => {
    const f = frames[pi];
    return blocksOf(piece, pi, f.c, f.u, f.v, f.offU, f.offV);
  });

  // §4.2 step 3: whole blocks, in seeded-hash order, until the open-space target is reached
  const target = openSpaceShare * blocks.reduce((t, b) => t + b.area, 0);
  const ranked = blocks
    .map((b) => ({ b, h: fnv1a32(`${s}|os|${b.piece}|${b.i}|${b.j}|${b.n}`) }))
    .sort((x, y) => x.h - y.h || x.b.piece - y.b.piece || x.b.i - y.b.i || x.b.j - y.b.j);
  const open = new Set<Block>();
  let openArea = 0;
  for (const { b } of ranked) {
    if (!(openArea < target)) break;
    open.add(b);
    openArea += b.area;
  }

  // §4.2 steps 4–5: lots, swept along u per piece from a seeded end; pieces largest first
  const lots: DistrictLot[] = [];
  ps.forEach((_, pi) => {
    const f = frames[pi];
    // a cell cut in two by the boundary or a hole numbers `k` on through both of its blocks
    const next = new Map<string, number>();
    const mine: DistrictLot[] = [];
    for (const b of blocks) {
      if (b.piece !== pi || open.has(b)) continue;
      lotsOf(b, f.c, f.u, f.v).forEach((items, side) => {
        const at = `${b.i}:${b.j}:${side}`;
        let k = next.get(at) ?? 0;
        for (const p of items) {
          mine.push({ key: `${pi}:${at}:${k++}`, polygon: out(p), areaM2: domainArea(p) });
        }
        next.set(at, k);
      });
    }
    const idx = (l: DistrictLot) => l.key.split(':').map(Number);
    mine.sort((a, b) => {
      const x = idx(a);
      const y = idx(b);
      for (let n = 1; n < x.length; n++) if (x[n] !== y[n]) return x[n] - y[n];
      return 0;
    });
    if (f.reverse) mine.reverse();
    lots.push(...mine);
  });

  return {
    areaM2: ps.reduce((t, p) => t + domainArea(p), 0),
    lots,
    openSpace: blocks.filter((b) => open.has(b)).map((b) => out(b.poly))
  };
}
