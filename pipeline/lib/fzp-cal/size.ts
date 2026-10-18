/**
 * `SizeModel` (T4b; stage-calibration spec §4.8): the distribution of a new project's height as a
 * fraction of the parcel's envelope, by the envelope's height. A pure function over the
 * qualifying, normalised histories.
 */
import { isoOf } from '../../project-records/parse';
import { isoToDay } from '../../project-records/multiphase';
import type { Day, SizeModel } from '../../../src/lib/timelapse/types';
import { HOUSING_ELEMENT_APPENDIX_B, datasf } from './provenance';
import { roundShares } from './round';
import type { CalProfile, NormHistory } from './types';
import { PLANNING_START } from './window';

/** Bucket edges on the base stories at filing (tier 4); 999 stands for any. */
export const SIZE_EDGES = [4, 6, 8, 12, 999];
/** Tolerance for treating r as exactly halfway between two fill levels. */
const TIE_TOL = 1e-9;

/** A history's earliest entered day, any stage. */
function firstRecord(h: NormHistory): Day | null {
  let first: Day | null = null;
  for (const day of Object.values(h.eff)) {
    if (day !== undefined && (first === null || day < first)) first = day;
  }
  return first;
}

/** Index of the fill level nearest `r`; a tie goes to the higher level. */
function snap(r: number, levels: readonly number[]): number {
  for (let i = 0; i + 1 < levels.length; i++) {
    const mid = (levels[i] + levels[i + 1]) / 2;
    if (r < mid - TIE_TOL) return i;
  }
  return levels.length - 1;
}

/**
 * The size model (spec §4.8). `overEnvelope` is `calibration.method.sizeOverEnvelope`: measured
 * histories with r > 1, mapped to fill 1. It is reported over the measured histories even when
 * the model falls back, since it describes the measurement, not the model.
 */
export function sizeModel(
  norm: NormHistory[],
  asOf: Day,
  cal: CalProfile,
  fillLevels: readonly number[]
): { size: SizeModel; overEnvelope: { fired: number; of: number } } {
  const from = isoToDay(PLANNING_START);
  const levels = [...fillLevels];
  const top = levels.length - 1;
  const window: [string, string] = [PLANNING_START, isoOf(asOf)];

  // Per edge bucket, the count at each fill level.
  const perBucket = SIZE_EDGES.map(() => levels.map(() => 0));
  let n = 0;
  let over = 0;
  for (const h of norm) {
    const first = firstRecord(h);
    if (first === null || first < from || first > asOf) continue;
    const stories = h.src.storiesProposed;
    const base = h.src.baseStoriesAtFiling;
    if (stories === null || base === null || stories < 1 || base < 1) continue;
    const r = stories / base;
    let level: number;
    if (r > 1) {
      level = top;
      over++;
    } else {
      level = snap(r, levels);
    }
    // 999 means any: a base above every edge belongs to the last bucket
    const found = SIZE_EDGES.findIndex((edge) => base <= edge);
    const bucket = found === -1 ? SIZE_EDGES.length - 1 : found;
    perBucket[bucket][level]++;
    n++;
  }
  const overEnvelope = { fired: over, of: n };
  const sources = [datasf('planningProjects'), datasf('permits')];
  const overText = `r > 1, mostly density-bonus projects, counted as fill 1: ${over} of ${n}`;

  if (n < cal.sizeMinN) {
    return {
      size: {
        fillLevels: levels,
        byEnvelope: [
          {
            maxStoriesUpTo: SIZE_EDGES[SIZE_EDGES.length - 1],
            probs: levels.map((_, i) => (i === top ? 1 : 0))
          }
        ],
        provenance: {
          tier: 3,
          label: 'New-project size: all at the full envelope (tier 3, Housing Element method)',
          sources: [HOUSING_ELEMENT_APPENDIX_B, ...sources],
          method: `fallback: only ${n} qualifying histories have a first record in ${window[0]} to ${window[1]} with proposed and base stories of at least 1 (fewer than SIZE_MIN_N = ${cal.sizeMinN}), so every new project is a point mass at fill 1, the Housing Element site-yield method (tier 3); ${overText}`,
          n,
          window
        }
      },
      overEnvelope
    };
  }

  // Merge thin buckets: into the lower neighbour, or, while no group exists yet, forward.
  const groups: { upTo: number; counts: number[] }[] = [];
  let carry: number[] | null = null;
  const merged: string[] = [];
  for (let b = 0; b < SIZE_EDGES.length; b++) {
    const edge = SIZE_EDGES[b];
    const counts = perBucket[b].map((c, i) => c + (carry === null ? 0 : carry[i]));
    const total = counts.reduce((a, c) => a + c, 0);
    const own = perBucket[b].some((c) => c > 0);
    if (total >= cal.sizeMinN) {
      groups.push({ upTo: edge, counts });
      carry = null;
    } else if (groups.length > 0) {
      const last = groups[groups.length - 1];
      last.upTo = edge;
      for (let i = 0; i < counts.length; i++) last.counts[i] += counts[i];
      if (own) merged.push(`${edge} into the bucket below`);
    } else {
      carry = counts;
      if (own) merged.push(`${edge} into the bucket above`);
    }
  }
  const mergedText =
    merged.length > 0 ? `thin buckets merged (${merged.join('; ')})` : 'no thin buckets';

  return {
    size: {
      fillLevels: levels,
      byEnvelope: groups.map((g) => ({ maxStoriesUpTo: g.upTo, probs: roundShares(g.counts) })),
      provenance: {
        tier: 2,
        label: 'SF Planning & permit records 2015–2026: new-project size (tier 2)',
        sources,
        method: `ratio r = proposed stories ÷ base stories at filing over ${n} qualifying histories with a first record in ${window[0]} to ${window[1]}, snapped to the nearest fill level of the envelope (ties up); ${overText} (a model choice, not a data-quality rule); buckets on base stories at filing with edges ${SIZE_EDGES.join(', ')} (tier 4, 999 = any); a bucket with fewer than SIZE_MIN_N = ${cal.sizeMinN} histories merges into its lower neighbour, the first into its upper one; ${mergedText}; probs rounded to 6 decimals, the residual to the largest; base stories at filing is a tier-3 proxy (the current base height, no pre-FZP height map exists)`,
        n,
        window
      }
    },
    overEnvelope
  };
}
