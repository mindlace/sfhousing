/**
 * `RevisionModel` (T4c; stage-calibration spec §4.9): how often a project resizes before
 * construction, and by how much. A pure function over the qualifying, normalised histories; the
 * ratio clamp is the registered rule `sc.revision.ratio-clamp` (§4.4a), and a pair whose count was
 * carried back from a later record is left out (`sc.revision.carried-excluded`, partner ruling).
 */
import { isoOf } from '../../project-records/parse';
import { isoToDay } from '../../project-records/multiphase';
import { PR } from '../quality-rules/pr';
import { binIndex } from '../../../src/lib/timelapse/model';
import {
  STAGE_ORDER,
  type Day,
  type RevisionModel,
  type Stage
} from '../../../src/lib/timelapse/types';
import { datasf } from './provenance';
import { round6, roundShares } from './round';
import type { CalProfile, NormHistory, RuleTally } from './types';
import { PLANNING_START } from './window';

/** Ratio histogram edges (tier 4); they include 1 so shrink and grow shares are separable. */
export const REVISION_EDGES = [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3];
const RATIO_MIN = REVISION_EDGES[0];
const RATIO_MAX = REVISION_EDGES[REVISION_EDGES.length - 1];
const BINS = REVISION_EDGES.length - 1;

type AtStage = 'permitFiled' | 'permitIssued';

/**
 * project-records' Ruling U1 (pipeline/project-records/derive.ts `history`): a history carrying
 * either rule has its `unitsAt.filed` copied from its next recorded count, not observed. Partner
 * ruling ("Exclude from resize estimate"): a pair that reads that count is left out.
 */
const CARRY_RULES: readonly string[] = [PR.unitsFiledZero, PR.unitsSplitFiled];
const CARRIED_STAGE: Stage = 'filed';

const carriedPair = (h: NormHistory, t: { previous: Stage; next: Stage }): boolean =>
  (t.previous === CARRIED_STAGE || t.next === CARRIED_STAGE) &&
  h.src.quality.some((q) => CARRY_RULES.includes(q));

/** The two revision entries, in output order (T4d records units for three stages only). */
const PAIR_TYPES: {
  at: AtStage;
  previous: Stage;
  next: Stage;
  completedOnly: boolean;
}[] = [
  { at: 'permitFiled', previous: 'filed', next: 'permitFiled', completedOnly: false },
  { at: 'permitIssued', previous: 'permitFiled', next: 'complete', completedOnly: true }
];

interface Pair {
  at: AtStage;
  revised: boolean;
  /** clamped new ÷ previous; meaningful only when `revised` */
  ratio: number;
}

/** A history's earliest stage entered, in `STAGE_ORDER`. */
function firstStage(h: NormHistory): Stage | null {
  return STAGE_ORDER.find((s) => h.eff[s] !== undefined) ?? null;
}

const bin = (ratio: number) => Math.min(binIndex(REVISION_EDGES, ratio), BINS - 1);

/** The ratio histogram of `pairs`' revised members; no revised pair: a point mass at "no change". */
function ratioProbs(pairs: Pair[]): number[] {
  const counts = new Array<number>(BINS).fill(0);
  let revised = 0;
  for (const p of pairs) {
    if (!p.revised) continue;
    counts[bin(p.ratio)]++;
    revised++;
  }
  if (revised === 0) counts[bin(1)] = 1;
  return roundShares(counts);
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The revision model (spec §4.9), the `sc.revision.ratio-clamp` tally (`fired` clamped pairs, `of`
 * revised pairs) and the `sc.revision.carried-excluded` tally (`fired` pairs left out because
 * their earlier count was carried back, `of` the windowed pairs before that exclusion); both
 * `sample` `<id>:<stage>`.
 */
export function revisionModel(
  norm: NormHistory[],
  asOf: Day,
  cal: CalProfile
): { revision: RevisionModel; clamp: RuleTally; carried: RuleTally } {
  const from = isoToDay(PLANNING_START);
  const window: [string, string] = [PLANNING_START, isoOf(asOf)];
  const pairs: Pair[] = [];
  const clamped: string[] = [];
  const excluded: string[] = [];
  let revisedPairs = 0;
  let windowedPairs = 0;

  for (const h of [...norm].sort((a, b) => compare(a.id, b.id))) {
    for (const t of PAIR_TYPES) {
      if (t.completedOnly && h.end.kind !== 'complete') continue;
      const previous = h.src.unitsAt[t.previous];
      const next = h.src.unitsAt[t.next];
      if (previous === undefined || next === undefined || !(previous >= 1 && next >= 1)) continue;
      // the later stage's entry day; a completed history's end day stands in for `complete`
      const day =
        h.eff[t.next] ??
        (h.end.kind === 'complete' && t.next === 'complete' ? h.end.day : undefined);
      if (day === undefined || day < from || day > asOf) continue;
      // a project's first stage is never revised (its proposal is revisions[0])
      if (firstStage(h) === t.at) continue;
      windowedPairs++;
      if (carriedPair(h, t)) {
        excluded.push(`${h.id}:${t.at}`);
        continue;
      }
      if (previous === next) {
        pairs.push({ at: t.at, revised: false, ratio: 1 });
        continue;
      }
      const raw = next / previous;
      const ratio = Math.min(Math.max(raw, RATIO_MIN), RATIO_MAX);
      revisedPairs++;
      if (ratio !== raw) clamped.push(`${h.id}:${t.at}`);
      pairs.push({ at: t.at, revised: true, ratio });
    }
  }
  clamped.sort(compare);
  const clamp: RuleTally = { fired: clamped.length, of: revisedPairs, sample: clamped };
  excluded.sort(compare);
  const carried: RuleTally = { fired: excluded.length, of: windowedPairs, sample: excluded };

  const pooledOk = pairs.length >= cal.revMinN;
  const rungs: string[] = [];
  let evidence = false;
  const at: RevisionModel['at'] = PAIR_TYPES.map((t) => {
    const own = pairs.filter((p) => p.at === t.at);
    let use: Pair[] | null = null;
    let rung: string;
    if (own.length >= cal.revMinN) {
      use = own;
      rung = `${own.length} pairs, own`;
    } else if (pooledOk) {
      use = pairs;
      rung = `${own.length} pairs, fewer than REV_MIN_N = ${cal.revMinN}, so all ${pairs.length} pairs pooled`;
    } else {
      rung = `${own.length} pairs and ${pairs.length} pooled, fewer than REV_MIN_N = ${cal.revMinN}: no revision evidence, probability 0 (tier 4)`;
    }
    rungs.push(`${t.at} ${rung}`);
    if (use === null) {
      return {
        stage: t.at,
        probability: 0,
        ratio: { edges: [...REVISION_EDGES], probs: ratioProbs([]) }
      };
    }
    evidence = true;
    const revised = use.filter((p) => p.revised).length;
    return {
      stage: t.at,
      probability: round6(revised / use.length),
      ratio: { edges: [...REVISION_EDGES], probs: ratioProbs(use) }
    };
  });

  const sources = [datasf('planningProjects'), datasf('permits'), datasf('unitCompletions')];
  const clampText = `${clamp.fired} of ${clamp.of} revised pairs clamped to ${RATIO_MIN}x to ${RATIO_MAX}x (sc.revision.ratio-clamp, tier 4)`;
  const carriedText = `${carried.fired} pairs with a carried-back earlier home count excluded (partner ruling; rule sc.revision.carried-excluded)`;
  const common = `pairs: ${rungs.join('; ')}; permitFiled compares the PRJ units with the permit's units; permitIssued compares the permit's units with the completed units, completed projects only, and T4c allows no revision on or after construction, so that permit-to-completion change is placed on entering permitIssued (tier 2 attribution); a pair counts when both counts are at least 1 and the later stage was entered in ${window[0]} to ${window[1]}; a project's first stage is never revised; ${carriedText}; revised means the counts differ; ratio bins ${REVISION_EDGES.join(', ')} (tier 4), a ratio of exactly ${RATIO_MAX} in the last bin; ${clampText}; probs rounded to 6 decimals, the residual to the largest; units are cross-record (T4d)`;
  return {
    revision: {
      at,
      provenance: evidence
        ? {
            tier: 2,
            label: `SF Planning & permit records ${window[0].slice(0, 4)}–${window[1].slice(0, 4)}: resizing before construction (tier 2)`,
            sources,
            method: common,
            n: pairs.length,
            window
          }
        : {
            tier: 4,
            label: 'Resizing before construction: no revision evidence (tier 4)',
            sources,
            method: `no revision evidence: ${common}`,
            n: pairs.length,
            window
          }
    },
    clamp,
    carried
  };
}
