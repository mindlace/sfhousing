/**
 * `pathwayForNew`, `ppaShare` and the Local Program proxy provenance (stage-calibration spec
 * §4.7). Pure functions over the qualifying, normalised histories.
 */
import { isoOf } from '../../project-records/parse';
import { isoToDay } from '../../project-records/multiphase';
import {
  PATHWAYS,
  type Calibration,
  type Day,
  type Pathway,
  type Provenance
} from '../../../src/lib/timelapse/types';
import { PLANNING_DIRECTOR_BULLETIN_11, datasf } from './provenance';
import type { CalProfile, NormHistory } from './types';
import { LOCAL_PROGRAM_START, PLANNING_START, PPA_SERIES_END } from './window';

const MICRO = 1_000_000;

/** First day of the `ppaShare` window: the day after the PPA record series ended. */
const PPA_WINDOW_START = isoToDay(PPA_SERIES_END) + 1;

/** A history's earliest entered day, any stage. */
function firstRecord(h: NormHistory): Day | null {
  let first: Day | null = null;
  for (const day of Object.values(h.eff)) {
    if (day !== undefined && (first === null || day < first)) first = day;
  }
  return first;
}

/** A history's earliest entered day excluding `preApplication`. */
function firstNonPpa(h: NormHistory): Day | null {
  let first: Day | null = null;
  for (const [stage, day] of Object.entries(h.eff)) {
    if (stage === 'preApplication' || day === undefined) continue;
    if (first === null || day < first) first = day;
  }
  return first;
}

function emptyCounts(): Record<Pathway, number> {
  return { discretionary: 0, streamlined: 0, permitOnly: 0 };
}

/**
 * Shares of `counts`, rounded to 6 decimals, the rounding residual added to the largest share
 * (the first of equals in `PATHWAYS` order) so the shares sum to 1. `total` must be > 0.
 */
function roundedShares(counts: Record<Pathway, number>, total: number): Record<Pathway, number> {
  const micro = PATHWAYS.map((p) => Math.round((counts[p] / total) * MICRO));
  let largest = 0;
  for (let i = 1; i < micro.length; i++) if (micro[i] > micro[largest]) largest = i;
  micro[largest] += MICRO - micro.reduce((a, b) => a + b, 0);
  return {
    discretionary: micro[0] / MICRO,
    streamlined: micro[1] / MICRO,
    permitOnly: micro[2] / MICRO
  };
}

function countsText(c: Record<Pathway, number>): string {
  return PATHWAYS.map((p) => `${p} ${c[p]}`).join(', ');
}

/**
 * The pathway mix of new projects (spec §4.7): shares among qualifying, non-null-pathway
 * histories whose first record is in [2015-01-01, asOf]. Fewer than `nSpellsMin` of them: the
 * pathway mix of the in-flight projects (tier 0).
 */
export function pathwayForNew(
  norm: NormHistory[],
  inFlight: { pathway: Pathway }[],
  asOf: Day,
  cal: CalProfile
): Calibration['pathwayForNew'] {
  const from = isoToDay(PLANNING_START);
  const counts = emptyCounts();
  let n = 0;
  for (const h of norm) {
    if (h.pathway === null) continue;
    const first = firstRecord(h);
    if (first === null || first < from || first > asOf) continue;
    counts[h.pathway]++;
    n++;
  }
  const sources = [datasf('planningProjects'), datasf('permits')];
  const window: [string, string] = [PLANNING_START, isoOf(asOf)];

  if (n >= cal.nSpellsMin) {
    return {
      ...roundedShares(counts, n),
      provenance: {
        tier: 0,
        label: 'SF permit & Planning records 2015–2026: pathway of new projects (tier 0)',
        sources,
        method: `Pathway shares among ${n} qualifying histories with a known pathway whose first record falls in ${window[0]} to ${window[1]} (Planning-reliable: the pathway is known only from then); ${countsText(counts)}; shares rounded to 6 decimals, the residual to the largest`,
        n,
        window
      }
    };
  }

  const flight = emptyCounts();
  for (const f of inFlight) flight[f.pathway]++;
  if (inFlight.length > 0) {
    const day = isoOf(asOf);
    return {
      ...roundedShares(flight, inFlight.length),
      provenance: {
        tier: 0,
        label: 'Pathway mix of in-flight projects at the as-of day (tier 0)',
        sources,
        method: `Only ${n} qualifying histories with a known pathway have a first record in ${window[0]} to ${window[1]} (fewer than N_SPELLS_MIN = ${cal.nSpellsMin}), so the pathway mix of the ${inFlight.length} in-flight projects is used; ${countsText(flight)}; shares rounded to 6 decimals, the residual to the largest`,
        n: inFlight.length,
        window: [day, day]
      }
    };
  }
  if (n > 0) {
    return {
      ...roundedShares(counts, n),
      provenance: {
        tier: 0,
        label: 'SF permit & Planning records 2015–2026: pathway of new projects (tier 0)',
        sources,
        method: `Only ${n} qualifying histories with a known pathway have a first record in ${window[0]} to ${window[1]} (fewer than N_SPELLS_MIN = ${cal.nSpellsMin}) and there are no in-flight projects to fall back on; ${countsText(counts)}; shares rounded to 6 decimals, the residual to the largest`,
        n,
        window
      }
    };
  }
  return {
    ...roundedShares({ discretionary: 1, streamlined: 1, permitOnly: 1 }, 3),
    provenance: {
      tier: 4,
      label: 'Pathway mix of new projects (tier 4, made up)',
      sources,
      method:
        'made up: no qualifying history and no in-flight project to measure the pathway mix from; an even split'
    }
  };
}

/**
 * `ppaShare[p]` (spec §4.7): among pathway-p qualifying filings (first non-PPA entry in
 * [2023-07-08, asOf]), the share with a preApplication entry. No filings: 0, tier 4.
 */
export function ppaShare(norm: NormHistory[], asOf: Day): Calibration['ppaShare'] {
  const filings = emptyCounts();
  const withPpa = emptyCounts();
  let n = 0;
  for (const h of norm) {
    if (h.pathway === null) continue;
    const first = firstNonPpa(h);
    if (first === null || first < PPA_WINDOW_START || first > asOf) continue;
    filings[h.pathway]++;
    if (h.eff.preApplication !== undefined) withPpa[h.pathway]++;
    n++;
  }
  const window: [string, string] = [isoOf(PPA_WINDOW_START), isoOf(asOf)];
  const sources = [datasf('planningRecords'), datasf('planningProjects')];
  if (n === 0) {
    return {
      discretionary: 0,
      streamlined: 0,
      permitOnly: 0,
      provenance: {
        tier: 4,
        label: 'Share of new projects that start at preApplication (tier 4, not measured)',
        sources,
        method: `not measured: no qualifying filing with a first non-PPA entry in ${window[0]} to ${window[1]}, after the PPA record series ended (${PPA_SERIES_END}); every share set to 0`,
        n: 0,
        window
      }
    };
  }
  const share = (p: Pathway) => (filings[p] === 0 ? 0 : withPpa[p] / filings[p]);
  return {
    discretionary: share('discretionary'),
    streamlined: share('streamlined'),
    permitOnly: share('permitOnly'),
    provenance: {
      tier: 0,
      label: 'Share of new projects that start at preApplication (tier 0)',
      sources,
      method: `measured after the PPA record series ended (${PPA_SERIES_END}): ${n} qualifying filings with a first non-PPA entry in ${window[0]} to ${window[1]} (${countsText(filings)}), of which a preApplication entry (${countsText(withPpa)}); a pathway with no filings has share 0`,
      n,
      window
    }
  };
}

/**
 * The provenance of "Local Program projects use the streamlined tables" (spec §4.7, tier 2).
 * `_lpDiag` is the report's diagnostic against the 180-day clock; nothing in the provenance uses it.
 */
export function streamlinedForLocalProgram(
  streamlinedSpells: number,
  asOf: Day,
  _lpDiag: { filings: number; medianFiledToEntitled: number | null }
): Provenance {
  return {
    tier: 2,
    label: 'Local Program projects use streamlined-pathway rates (tier 2 proxy)',
    sources: [PLANNING_DIRECTOR_BULLETIN_11, datasf('planningProjects'), datasf('planningReview')],
    method: `Local Program = administrative approval, 180-day clock, no DR or appeal (rule, tier 1: Planning Director Bulletin 11); durations and attrition taken from the streamlined tables, n = ${streamlinedSpells}`,
    n: streamlinedSpells,
    window: [PLANNING_START, isoOf(asOf)]
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Report diagnostic (spec §4.7): filings since the Local Program began (2026-01-12), and their
 * median days from `filed` to `entitled`, null if none has been entitled. Nothing uses it.
 */
export function localProgramDiagnostic(norm: NormHistory[]): {
  filings: number;
  medianFiledToEntitled: number | null;
} {
  const start = isoToDay(LOCAL_PROGRAM_START);
  let filings = 0;
  const days: number[] = [];
  for (const h of norm) {
    const first = firstNonPpa(h);
    if (first === null || first < start) continue;
    filings++;
    const { filed, entitled } = h.eff;
    if (filed !== undefined && entitled !== undefined) days.push(entitled - filed);
  }
  return { filings, medianFiledToEntitled: days.length === 0 ? null : median(days) };
}
