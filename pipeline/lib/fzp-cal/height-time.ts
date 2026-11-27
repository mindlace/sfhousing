/**
 * Stage time by height band (building-choice spec, "Construction time by height band"; ruling F8):
 * per band of proposed stories, the median completed spell of the model's own permit-side stages,
 * `permitIssued` (issued to first construction document) and `construction` (first construction
 * document to completion), over the pooled median of the same stage. A pure function over the
 * spells the transition tables are fitted on, joined to their histories on the project id.
 */
import type { HeightTimeModel } from '../../../src/lib/sim/choice/types';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import type { Day, Provenance, Stage } from '../../../src/lib/timelapse/types';
import { isoOf } from '../../project-records/parse';
import { median } from '../../project-records/multiphase';
import { datasf } from './provenance';
import type { CalProfile, NormHistory, Spell } from './types';

/** Band edges in proposed stories (builder's call, the raw pull's bands); 999 is any. */
export const HEIGHT_BANDS = [4, 7, 12, 20, 999] as const;

/** The index of the first edge at or above `stories`. */
export function bandIndex(edges: readonly number[], stories: number): number {
  const i = edges.findIndex((edge) => stories <= edge);
  return i < 0 ? edges.length - 1 : i;
}

/** A history's proposed stories and its stage entry days as recorded (before imputation). */
export interface StoriedHistory {
  stories: number;
  entered: Partial<Record<Stage, Day>>;
}

/** By history id, the histories that record at least 1 proposed story. */
export function storiedById(histories: readonly NormHistory[]): Map<string, StoriedHistory> {
  const m = new Map<string, StoriedHistory>();
  for (const h of histories) {
    const s = h.src.storiesProposed;
    if (s !== null && s >= 1) m.set(h.id, { stories: s, entered: h.src.entered });
  }
  return m;
}

/** The stage a timed stage ends in. */
const NEXT = {
  permitFiled: 'permitIssued',
  permitIssued: 'construction',
  construction: 'complete'
} as const satisfies Record<string, Stage>;

/**
 * Durations in days of the completed (`advance`) spells of `stage` entered in `[from, to]` whose
 * history records its stories, per band of `edges`. Censored spells and exits are left out, and so
 * is a spell whose start or end day the records do not hold (a gap the normalisation imputed,
 * which would time it at 0 days).
 */
export function completedByBand(
  spells: readonly Spell[],
  histories: ReadonlyMap<string, StoriedHistory>,
  stage: keyof typeof NEXT,
  edges: readonly number[],
  [from, to]: readonly [Day, Day]
): number[][] {
  const out = edges.map((): number[] => []);
  for (const s of spells) {
    if (s.stage !== stage || s.outcome !== 'advance' || s.e < from || s.e > to) continue;
    const h = histories.get(s.projectId);
    if (h === undefined) continue;
    if (h.entered[stage] === undefined || h.entered[NEXT[stage]] === undefined) continue;
    out[bandIndex(edges, h.stories)].push(s.x);
  }
  return out;
}

const SCALE: Record<number, number> = { 2: 1e2, 4: 1e4, 6: 1e6 };
const round = (x: number, places: 2 | 4 | 6): number =>
  Math.round(x * SCALE[places]) / SCALE[places];

/**
 * The height-band model with one step from `asOf`. A band with fewer than `cal.sizeMinN`
 * completed spells in either stage merges into the band below; the first band, while no band
 * below exists, merges into the one above (the size model's rule). With no completed spell at
 * all, one band at multiplier 1 and 0 months (tier 4, invented). `filedToIssued` reports the
 * median months of `permitFiled` spells (filing to issue) on the same bands; it is not modelled.
 */
export function fitHeightTime(
  spells: readonly Spell[],
  histories: readonly NormHistory[],
  cal: CalProfile,
  window: readonly [Day, Day],
  asOf: Day
): {
  model: HeightTimeModel;
  filedToIssued: { upTo: number; median: number; n: number }[];
} {
  const storied = storiedById(histories);
  const by = (stage: keyof typeof NEXT) =>
    completedByBand(spells, storied, stage, HEIGHT_BANDS, window);
  const issued = by('permitIssued');
  const built = by('construction');
  const filed = by('permitFiled');
  const isoWindow: [string, string] = [isoOf(window[0]), isoOf(window[1])];
  const sources = [datasf('permits'), datasf('planningProjects')];

  // Merge thin bands (size.ts's rule) on the thinner of the two modelled stages.
  const groups: { upTo: number; bands: number[] }[] = [];
  let carry: number[] = [];
  const merged: string[] = [];
  for (let b = 0; b < HEIGHT_BANDS.length; b++) {
    const members = [...carry, b];
    const count = (xs: number[][]) => members.reduce((a, i) => a + xs[i].length, 0);
    const own = issued[b].length + built[b].length > 0;
    if (Math.min(count(issued), count(built)) >= cal.sizeMinN) {
      groups.push({ upTo: HEIGHT_BANDS[b], bands: members });
      carry = [];
    } else if (groups.length > 0) {
      const last = groups[groups.length - 1];
      last.upTo = HEIGHT_BANDS[b];
      last.bands.push(...members);
      if (own) merged.push(`${HEIGHT_BANDS[b]} into the band below`);
    } else {
      carry = members;
      if (own) merged.push(`${HEIGHT_BANDS[b]} into the band above`);
    }
  }

  const n = [...issued, ...built].reduce((a, xs) => a + xs.length, 0);
  if (groups.length === 0) {
    // Too few records for even one band: everything in one band, its multiplier 1 by definition.
    const pooledBuilt = median(built.flat());
    const months = pooledBuilt === null ? 0 : round(pooledBuilt / MONTH_DAYS, 4);
    const fallback: Provenance =
      pooledBuilt === null
        ? {
            tier: 4,
            label: 'Stage time by height: one band, multiplier 1 (invented: no records)',
            sources,
            method: `no completed permitIssued or construction spell with recorded stories entered in ${isoWindow[0]} to ${isoWindow[1]}, so one band at multiplier 1 and 0 construction months (invented)`
          }
        : {
            tier: 0,
            label: `SF building permits ${isoWindow[0].slice(0, 4)}–${isoWindow[1].slice(0, 4)}: stage time, one band (tier 0)`,
            sources,
            method: `fewer than SIZE_MIN_N = ${cal.sizeMinN} completed spells in every band, so one band: multiplier 1 by definition, construction months the pooled median of ${built.flat().length} completed construction spells`,
            n,
            window: isoWindow
          };
    const filedAll = filed.flat();
    const fm = median(filedAll);
    return {
      model: {
        upTo: [999],
        steps: [
          {
            from: asOf,
            value: { permitIssued: [1], construction: [1], constructionMonths: [months] }
          }
        ],
        provenance: fallback
      },
      filedToIssued:
        fm === null ? [] : [{ upTo: 999, median: round(fm / MONTH_DAYS, 2), n: filedAll.length }]
    };
  }

  const of = (xs: number[][], g: { bands: number[] }) => g.bands.flatMap((i) => xs[i]);
  const pooledIssued = median(issued.flat()) as number;
  const pooledBuilt = median(built.flat()) as number;
  // A pooled median of 0 days (every interval recorded on one day) scales nothing: multiplier 1.
  const ratio = (xs: number[], pooled: number) =>
    pooled > 0 ? round((median(xs) as number) / pooled, 6) : 1;
  const permitIssued = groups.map((g) => ratio(of(issued, g), pooledIssued));
  const construction = groups.map((g) => ratio(of(built, g), pooledBuilt));
  const constructionMonths = groups.map((g) =>
    round((median(of(built, g)) as number) / MONTH_DAYS, 4)
  );
  const filedToIssued = groups.flatMap((g) => {
    const xs = of(filed, g);
    const m = median(xs);
    return m === null ? [] : [{ upTo: g.upTo, median: round(m / MONTH_DAYS, 2), n: xs.length }];
  });
  const mergedText =
    merged.length > 0 ? `thin bands merged (${merged.join('; ')})` : 'no thin bands';

  return {
    model: {
      upTo: groups.map((g) => g.upTo),
      steps: [{ from: asOf, value: { permitIssued, construction, constructionMonths } }],
      provenance: {
        tier: 0,
        label: `SF building permits ${isoWindow[0].slice(0, 4)}–${isoWindow[1].slice(0, 4)}: stage time by height band (tier 0)`,
        sources,
        method: `per band of proposed stories (edges ${HEIGHT_BANDS.join(', ')}, the raw pull's bands, builder's call; 999 = any), the median completed spell of each stage over that stage's pooled median: permitIssued (issued to first construction document) on ${issued.flat().length} spells, construction (first construction document to completion) on ${built.flat().length}; spells entered in ${isoWindow[0]} to ${isoWindow[1]}, censored spells, exits and histories without proposed stories left out, no-FCD completions have no spell (ruling P1); a band with fewer than SIZE_MIN_N = ${cal.sizeMinN} completed spells in either stage merges into its lower neighbour, the first into its upper one; ${mergedText}; constructionMonths is the band's construction median in months`,
        n,
        window: isoWindow
      }
    },
    filedToIssued
  };
}
