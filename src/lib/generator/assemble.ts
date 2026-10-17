import { FillRule, unionD, type PathD, type PathsD } from 'clipper2-ts';
import type { ParcelRecord } from '../data/parcel';
import { CLIPPER_PRECISION, SIMPLIFY_EPS_M } from './constants';
import { inset } from './poly';

// Same constants as geo.ts. This module must not call transcendental Math (AC4), so the
// trigonometry below is a series expansion about SF's reference latitude.
const D2R = Math.PI / 180;
const A_GRS80 = 6378137;
const E2_GRS80 = 0.0066943800229;
const LON0 = -122.45;
const LAT0 = 37.75;
// sin and cos of 37.75 degrees, computed once offline in node and pasted at full double precision.
// They are literals because the AC4 guard bans the transcendental Math calls in this file.
const S0 = 0.6122172800344492;
const C0 = 0.7906895737438434;

/**
 * The EPSG:7131 grid position of `to` in the local frame whose origin is `from`, in metres.
 * Evaluates the same tangent-plane formula as `localFrame(from).from(...to)` (geo.ts) with only
 * + - * / and Math.sqrt, so it is bit-identical in every engine (§4.2). Within 1e-6 m of
 * `localFrame`, and within 0.02 m (200 m) / 0.05 m (500 m) of exact EPSG:7131.
 */
export function frameOffset(
  from: readonly [number, number],
  to: readonly [number, number]
): [x: number, y: number] {
  // sin and cos of from.lat: third-order expansion about LAT0 (|delta| <= 0.0016 rad in SF)
  const d = (from[1] - LAT0) * D2R;
  const d2 = d * d;
  const sinD = d - (d2 * d) / 6;
  const cosD = 1 - d2 / 2;
  const sinP = S0 * cosD + C0 * sinD;
  const cosP = C0 * cosD - S0 * sinD;
  // grid convergence (|gamma| <= 0.0013 rad)
  const g = (from[0] - LON0) * sinP * D2R;
  const cg = 1 - (g * g) / 2;
  const sg = g - (g * g * g) / 6;
  const W = 1 - E2_GRS80 * sinP * sinP;
  const sqrtW = Math.sqrt(W);
  const M = (A_GRS80 * (1 - E2_GRS80)) / (W * sqrtW);
  const N = A_GRS80 / sqrtW;
  const e = (to[0] - from[0]) * N * cosP * D2R;
  const n = (to[1] - from[1]) * M * D2R;
  return [e * cg - n * sg, e * sg + n * cg];
}

export interface AssembledSite {
  anchor: ParcelRecord;
  /** The cleaned records: valid label points, unique ids, sorted by id ascending. */
  records: ParcelRecord[];
  /** The site polygon in the anchor's local frame; [] when no record has usable rings. */
  polygon: [number, number][][];
}

const validLabelPoint = (r: ParcelRecord): boolean => {
  const lp = r?.labelPoint;
  return Array.isArray(lp) && lp.length === 2 && Number.isFinite(lp[0]) && Number.isFinite(lp[1]);
};

/** A ring with >= 3 finite points, shifted by (dx, dy); null if it has fewer or a bad point. */
function shiftedRing(ring: unknown, dx: number, dy: number): PathD | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out: PathD = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return null;
    out.push({ x: pt[0] + dx, y: pt[1] + dy });
  }
  return out;
}

/**
 * §4.2 steps 4-6: cleans and orders the records, picks the anchor, and merges the parcels into
 * one site polygon in the anchor's local frame. Null when no record has a usable label point.
 */
export function assembleSite(parcels: readonly ParcelRecord[]): AssembledSite | null {
  const sorted = parcels
    .filter(validLabelPoint)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const records = sorted.filter((r, i) => i === 0 || r.id !== sorted[i - 1].id);
  if (records.length === 0) return null;

  // largest areaM2; sorted by id, so a strict '>' keeps the smallest id on a tie
  let anchor = records[0];
  for (const r of records) {
    if (r.areaM2 > anchor.areaM2) anchor = r;
  }
  if (records.length === 1) return { anchor, records, polygon: anchor.polygon };

  const resolved: PathsD = [];
  for (const r of records) {
    const [dx, dy] = r === anchor ? [0, 0] : frameOffset(anchor.labelPoint, r.labelPoint);
    const rings: PathsD = [];
    for (const ring of Array.isArray(r.polygon) ? r.polygon : []) {
      const path = shiftedRing(ring, dx, dy);
      if (path) rings.push(path);
    }
    if (rings.length) resolved.push(...unionD(rings, FillRule.EvenOdd));
  }
  if (resolved.length === 0) return { anchor, records, polygon: [] };

  const merged = unionD(resolved, [], FillRule.NonZero, CLIPPER_PRECISION);
  // morphological closing heals the sub-centimetre seams between quantised neighbours
  const closed = inset(inset(merged, -SIMPLIFY_EPS_M), SIMPLIFY_EPS_M);
  const polygon = closed
    .filter((p) => p.length >= 3)
    .map((p) => p.map((pt): [number, number] => [pt.x, pt.y]));
  return { anchor, records, polygon };
}
