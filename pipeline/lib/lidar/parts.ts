// Boxes from mapped building parts (spec "Mapped parts"): one box per counted part from min_height
// to height, tiered roofs drawn as inset tiers, and the footprint area no part covers (handed to the
// LiDAR derivation as its `area`). Parts are curated, so they may poke outside the footprint, and
// registration never shifts them.
import { BOXES } from '../../boxes-config.js';
import { area, difference, intersect, union, type MultiPoly } from '../../geom.js';
import type { RenderBox } from './derive.js';

export interface Part {
  id: string;
  buildingId: string;
  shape: MultiPoly;
  heightM: number | null;
  minHeightM: number | null;
  roofShape: string | null;
  roofHeightM: number | null;
}

/** Uncovered pieces under this area (m2) are dropped. */
const MIN_PIECE_M2 = 2;

const round1 = (v: number): number => Math.round(v * 10) / 10 + 0;

// Height is clamped to heightRangeM; base only to [0, heightM) (ruling F6).
const clampH = (v: number): number =>
  Math.min(Math.max(round1(v), BOXES.heightRangeM[0]), BOXES.heightRangeM[1]);

const clampBase = (base: number, h: number): number =>
  Math.max(0, Math.min(round1(base), round1(h - 0.1)));

/** Parts that carry a height, ordered by id. */
export function countedParts(parts: Part[]): Part[] {
  return parts
    .filter((p) => p.heightM !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function centroid(p: MultiPoly): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (const poly of p)
    poly.forEach((ring, k) => {
      let s = 0;
      let rx = 0;
      let ry = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const w = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        s += w;
        rx += (ring[j][0] + ring[i][0]) * w;
        ry += (ring[j][1] + ring[i][1]) * w;
      }
      if (Math.abs(s) < 1e-12) return;
      const w = (k === 0 ? 1 : -1) * Math.abs(s / 2);
      a += w;
      cx += w * (rx / (3 * s));
      cy += w * (ry / (3 * s));
    });
  if (Math.abs(a) < 1e-9) return p[0]?.[0]?.[0] ?? [0, 0];
  return [cx / a, cy / a];
}

function scaled(p: MultiPoly, f: number, c: [number, number]): MultiPoly {
  return p.map((poly) =>
    poly.map((ring) =>
      ring.map(([x, y]): [number, number] => [c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f])
    )
  );
}

const tierScale = (shape: string, t: number): number =>
  shape === 'pyramidal' || shape === 'cone' ? 1 - t : Math.sqrt(1 - t * t);

/** One part's boxes: a plain box, or a block under `partTiers` inset roof tiers. */
export function partBoxes(bid: string, counted: Part[], kStart: number): RenderBox[] {
  const out: RenderBox[] = [];
  let k = kStart;
  const push = (shape: MultiPoly, base: number, top: number): void => {
    if (shape.length === 0 || area(shape) <= 0) return;
    const heightM = clampH(top);
    out.push({ bid, k: k++, src: 'part', shape, baseM: clampBase(base, heightM), heightM });
  };
  for (const p of counted) {
    if (p.heightM === null) continue;
    const base = p.minHeightM ?? 0;
    const rh = p.roofHeightM !== null && p.roofHeightM > 0 ? p.roofHeightM : null;
    const tiered =
      p.roofShape !== null && (BOXES.partTierShapes as readonly string[]).includes(p.roofShape);
    if (rh === null) {
      push(p.shape, base, p.heightM);
    } else if (!tiered) {
      push(p.shape, base, p.heightM - rh / 2);
    } else {
      const eave = p.heightM - rh;
      const n = BOXES.partTiers;
      const c = centroid(p.shape);
      if (clampH(eave) > base) push(p.shape, base, eave);
      for (let i = 0; i < n; i++) {
        const f = tierScale(p.roofShape as string, i / n);
        const shape = i === 0 ? p.shape : intersect(scaled(p.shape, f, c), p.shape);
        push(shape, eave + (i * rh) / n, eave + ((i + 1) * rh) / n);
      }
    }
  }
  return out;
}

function unionOfParts(counted: Part[]): MultiPoly {
  return union(counted.map((p) => p.shape));
}

/** fp minus the union of counted parts; pieces under 2 m2 dropped. */
export function uncoveredArea(fp: MultiPoly, counted: Part[]): MultiPoly {
  return difference(fp, unionOfParts(counted)).filter((poly) => area([poly]) >= MIN_PIECE_M2);
}

/** area(fp ∩ ∪parts) / area(fp). */
export function partCoverage(fp: MultiPoly, counted: Part[]): number {
  const a = area(fp);
  if (a <= 0) return 0;
  return area(intersect(fp, unionOfParts(counted))) / a;
}
