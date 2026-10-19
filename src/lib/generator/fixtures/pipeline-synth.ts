// Seeded pipeline-project mix for the generateForUnits perf budget (§4.7, §6). Test-only. No
// transcendental Math (AC4 covers this directory); lng/lat comes from geo.ts's localFrame.
import type { ParcelRecord } from '../../data/parcel';
import { assembleSite, frameOffset } from '../assemble';
import { localFrame } from '../geo';
import { fnv1a32, mulberry32 } from '../seed';
import { normaliseSite } from '../site';
import { massingCandidates } from '../units';
import { drawVariety } from '../variety';
import { rectRing, ringArea, rotateRing, type Ring } from './geom';
import { synthParcels } from './synth';

export interface PipelineCase {
  parcels: ParcelRecord | ParcelRecord[];
  units: number;
  maxStories: number;
  stories?: number;
  seed: number;
}

const SINGLE_LOTS = 1800;
const ASSEMBLIES = 200;
const W = 7.62; // 25 ft
const D = 30.48; // 100 ft
const MAX_S = 80;

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
const cm = (v: number) => Math.round(v * 100) / 100 + 0;

const vacant = (p: ParcelRecord): ParcelRecord => ({
  ...p,
  existingUnits: 0,
  existingFloorAreaM2: 0,
  existingHeightM: 0,
  landUse: 'VACANT'
});

/**
 * The §6 target split for one project: 60% known stories, 30% unknown stories inside the
 * candidate capacity range, 10% undershoot. A mode with no candidate (or an empty capacity
 * range) skips to the next; with none at all the project gets an arbitrary target.
 */
function target(
  parcels: ParcelRecord[],
  seed: number,
  r: () => number
): Omit<PipelineCase, 'parcels' | 'seed'> {
  const draws = drawVariety(seed);
  const assembled = assembleSite(parcels);
  const site = assembled && normaliseSite(assembled.polygon, draws.edgeInsetM);
  const m = r();
  if (site && m < 0.6) {
    const S = 1 + Math.floor(r() * 40);
    const c = massingCandidates(site, 1, draws, { stories: S });
    if (c.length) {
      const U = Math.max(1, Math.round((0.4 + 0.6 * r()) * c[0].cap));
      return { units: U, maxStories: MAX_S, stories: S };
    }
  }
  const c = site ? massingCandidates(site, 5, draws, { maxStories: MAX_S }) : [];
  const caps = c.map((x) => x.cap);
  const cMin = caps.length ? Math.min(...caps) : 0;
  const cMax = caps.length ? Math.max(...caps) : 0;
  if (m < 0.9) {
    const lo = Math.max(1, cMin);
    if (cMax >= lo) return { units: lo + Math.floor(r() * (cMax - lo + 1)), maxStories: MAX_S };
  }
  return { units: cMax + 1 + Math.floor(r() * 100), maxStories: MAX_S };
}

/**
 * 2-4 adjacent 25 × 100 ft lots in a row, stored as the pipeline stores parcels: each lot has its
 * own label point (1e-7°) and a cm-quantised ring in that label point's local frame.
 */
function assembly(i: number, r: () => number): ParcelRecord[] {
  const n = 2 + Math.floor(r() * 3);
  const anchorLabel: [number, number] = [r7(-122.51 + 0.14 * r()), r7(37.71 + 0.1 * r())];
  const frame = localFrame(anchorLabel);
  const t = 2 * r() - 1;
  const flip = r() < 0.5;
  const out: ParcelRecord[] = [];
  for (let j = 0; j < n; j++) {
    const cx = (j - (n - 1) / 2) * W;
    // the absolute lot in the anchor's frame, and its centre
    const abs = rotateRing(rectRing(W, D, cx, 0), t, flip);
    const [centre] = rotateRing([[cx, 0]], t, flip);
    const labelPoint = frame.to(centre[0], centre[1]);
    const [dx, dy] = frameOffset(anchorLabel, labelPoint);
    const ring: Ring = abs.map(([x, y]) => [cm(x - dx), cm(y - dy)]);
    out.push({
      id: String(8000000 + 10 * i + j),
      polygon: [ring],
      labelPoint,
      areaM2: ringArea(ring),
      existingUnits: 0,
      existingFloorAreaM2: 0,
      existingHeightM: 0,
      landUse: 'VACANT',
      eligible: true,
      neighborhood: 'Synthetic'
    });
  }
  return out;
}

/**
 * §6 perf/property mix: 1,800 vacant single lots from `synthParcels(1800, seed)` and 200
 * assemblies of 2-4 adjacent lots, 2,000 cases in all. Project `i` has id `'proj-' + i` and
 * seed `fnv1a32('proj-' + i)`, which also seeds the draws the targets are measured with.
 */
export function pipelineSynth(seed: number): PipelineCase[] {
  const r = mulberry32(seed);
  const out: PipelineCase[] = [];
  for (const { parcel } of synthParcels(SINGLE_LOTS, seed)) {
    const s = fnv1a32('proj-' + out.length);
    const p = vacant(parcel);
    out.push({ parcels: p, seed: s, ...target([p], s, r) });
  }
  for (let i = 0; i < ASSEMBLIES; i++) {
    const s = fnv1a32('proj-' + out.length);
    const parcels = assembly(i, r);
    out.push({ parcels, seed: s, ...target(parcels, s, r) });
  }
  return out;
}
