/**
 * finance-score: homes by income tier and public money in the results (spec
 * docs/superpowers/specs/2026-11-09-finance-score-design.md). Pure; worker-safe.
 *
 * Tiers first (spec 4.1): `tierContext` builds a run's `TierCtx` once per loaded input, and
 * `tiersOf` splits one schedule's final units by income tier; `tierSeries` (spec 4.2) sums them
 * by month with the month rules of `addNet`.
 *
 * Money (spec 4.4): `poolSeries` turns the engine's ledger into each pool's monthly series.
 */
import { RHNA_TIER_TARGETS } from '$lib/scoreboard';
import type { ProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import {
  INCOME_TIERS,
  type IncomeTier,
  type Provenance,
  type ResolvedTerms,
  type TierUnits
} from '$lib/timelapse/types';
import {
  ASSUMED_TENURE,
  INCLUSIONARY,
  fundBundle,
  inclusionaryUnits,
  prototypeFor,
  type BundleItem
} from '../finance';
import { isoOf } from './dates';
import { monthIndexer } from './score';
import type { LedgerEvent } from './money';
import type { Schedule, SimInput, TimelineScore } from './types';

export type { LedgerEvent } from './money';

/** `TimelineScore.money` (F14). */
export type Money = NonNullable<TimelineScore['money']>;

/** Exact (unrounded) shares of a funded affordable project's homes, summing to 1 within 1e-9. */
export type TierShares = Record<IncomeTier | 'unrecorded', number>;

/** The `ctx` of F13's `tiersOf(sc, ctx)` (spec 2, "Internal types"). */
export interface TierCtx {
  /** a pipeline schedule's (or phase's) `projectId` → its recorded affordable homes */
  affordable: Map<string, number>;
  /** each programme id of `finance.programmes` → its pricing item and its `tiers` */
  programmes: Map<string, { item: BundleItem; tiers: Record<IncomeTier, number> | null }>;
  /** the run's `finance.terms`; null without `finance` */
  terms: ResolvedTerms | null;
  /** internal memo of spec 4.1 case 1, keyed by the sorted, comma-joined paying programmes */
  weights: Map<string, TierShares>;
}

/** The five `TierUnits` fields in tie order: earlier wins a tie (F13). */
export const TIER_FIELDS = [
  'veryLow',
  'low',
  'moderate',
  'aboveModerate',
  'unrecorded'
] as const satisfies readonly (keyof TierUnits)[];

/** Floating-point tolerance of the floors and of a remainder tie; not a model number. */
const EPS = 1e-9;

/**
 * Whole parts of `exact` summing to `n`: each `floor(x + 1e-9)`, then the homes left over one each
 * to the largest remainders, remainders within 1e-9 a tie, ties to the lower index.
 */
function largestRemainder(n: number, exact: readonly number[]): number[] {
  const out = exact.map((x) => Math.floor(x + EPS));
  const rem = exact.map((x, i) => x - out[i]);
  const taken = exact.map(() => false);
  let left = n - out.reduce((s, x) => s + x, 0);
  while (left > 0 && exact.length > 0) {
    let best = -1;
    for (let i = 0; i < exact.length; i++) {
      if (taken[i]) continue;
      if (best < 0 || rem[i] > rem[best] + EPS) best = i;
    }
    if (best < 0) {
      // every field has had one: a second round (unreachable with shares summing to 1)
      taken.fill(false);
      continue;
    }
    taken[best] = true;
    out[best] += 1;
    left--;
  }
  return out;
}

/** `n` homes split by `shares` (spec 4.1, "Splitting by shares"); sums exactly to `n`. */
export function splitByShares(n: number, shares: TierShares): TierUnits {
  const parts = largestRemainder(
    n,
    TIER_FIELDS.map((f) => n * shares[f])
  );
  return {
    veryLow: parts[0],
    low: parts[1],
    moderate: parts[2],
    aboveModerate: parts[3],
    unrecorded: parts[4]
  };
}

/**
 * A master's `total` recorded affordable homes over its phases in proportion to `phaseUnits`, by
 * largest remainder, ties to the lower phase index (spec 4.1 case 3, "Phases"). Phases of no
 * homes in all get nothing.
 */
export function allocatePhases(total: number, phaseUnits: readonly number[]): number[] {
  const all = phaseUnits.reduce((s, u) => s + u, 0);
  if (!(all > 0)) return phaseUnits.map(() => 0);
  return largestRemainder(
    total,
    phaseUnits.map((u) => (total * u) / all)
  );
}

/**
 * A run's `TierCtx` (spec 2): `affordable` from `projects` (phases allocated, an unenriched
 * multi-phase row whole, rows of 0 omitted), `programmes` and `terms` from `finance`, `weights`
 * empty. Reads only `projects` and `finance`.
 */
export function tierContext(input: Pick<SimInput, 'projects' | 'finance'>): TierCtx {
  const affordable = new Map<string, number>();
  for (const row of input.projects) {
    const a = row.affordableHomes ?? 0;
    if (a === 0) continue;
    if (row.phases) {
      const shares = allocatePhases(
        a,
        row.phases.map((p) => p.units)
      );
      // engine.ts:195: a phase's projectId is '<id>:phase:<j + 1>' (1-based)
      shares.forEach((s, j) => {
        if (s > 0) affordable.set(`${row.id}:phase:${j + 1}`, s);
      });
    } else {
      affordable.set(row.id, a);
    }
  }
  const programmes: TierCtx['programmes'] = new Map();
  const fin = input.finance;
  if (fin) {
    const kinds = new Map(fin.pools.map((p) => [p.id, p.kind]));
    for (const g of fin.programmes) {
      const poolKind = kinds.get(g.pool);
      if (poolKind === undefined) {
        throw new Error(`tierContext: programme ${g.id} names unknown pool ${g.pool}`);
      }
      programmes.set(g.id, { item: { instrument: g.instrument, poolKind }, tiers: g.tiers });
    }
  }
  return { affordable, programmes, terms: fin?.terms ?? null, weights: new Map() };
}

/** Spec 4.1 case 1, steps 2-5: the five shares of a funded affordable project. */
function affordableShares(sc: Schedule, ids: readonly string[], ctx: TierCtx): TierShares {
  const progs = ids.map((id) => {
    const p = ctx.programmes.get(id);
    if (!p) throw new Error(`tiersOf: unknown programme ${id}`);
    return p;
  });
  const key = [...ids].sort().join(',');
  const hit = ctx.weights.get(key);
  if (hit) return hit;

  let w: number[];
  if (progs.length === 1) {
    w = [1];
  } else {
    if (!ctx.terms) throw new Error('tiersOf: a funded schedule on a context without terms');
    const r0 = sc.revisions[0];
    const b = fundBundle(
      progs.map((p) => p.item),
      'affordable',
      prototypeFor(r0.stories ?? 0, r0.units),
      ctx.terms
    );
    // all weights zero: the paying programmes count equally (tier 4 convention, spec 4.1 step 4)
    w =
      b.grantEquivalent > 0
        ? b.items.map((it) => it.grantEquivalent / b.grantEquivalent)
        : progs.map(() => 1 / progs.length);
  }
  const shares: TierShares = { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0, unrecorded: 0 };
  progs.forEach((p, k) => {
    if (p.tiers === null) {
      shares.unrecorded += w[k];
      return;
    }
    for (const t of INCOME_TIERS) shares[t] += w[k] * p.tiers[t];
  });
  ctx.weights.set(key, shares);
  return shares;
}

/**
 * One schedule's final units by income tier (F13, spec 4.1), summing exactly to them. Gross:
 * existing homes are netted in the series, never here.
 */
export function tiersOf(sc: Schedule, ctx: TierCtx): TierUnits {
  const u = sc.revisions[sc.revisions.length - 1].units;
  if (sc.kind === 'affordable') {
    const ids = sc.funding?.programmes ?? [];
    if (ids.length === 0) {
      return { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0, unrecorded: u };
    }
    return splitByShares(u, affordableShares(sc, ids, ctx));
  }
  if (sc.origin === 'simulated') {
    const inc = inclusionaryUnits(u);
    const onSite = inc.veryLow + inc.low + inc.moderate + inc.aboveModerate;
    return { ...inc, aboveModerate: inc.aboveModerate + u - onSite, unrecorded: 0 };
  }
  const unrecorded = Math.min(ctx.affordable.get(sc.projectId) ?? 0, u);
  return { veryLow: 0, low: 0, moderate: 0, aboveModerate: u - unrecorded, unrecorded };
}

/**
 * The cumulative homes by income tier at the end of each month (spec 4.2), with exactly the month
 * rules of `addNet` (`score.ts`): at a construction start after `asOf`, `-existingUnits` from
 * `aboveModerate`; at completion, `tiersOf(sc, ctx)`. Both at `idx(day)`, no clamp. The five
 * fields of month `i` sum to `shownSeries(...)[i].completedNet`.
 */
export function tierSeries(
  schedules: Schedule[],
  ctx: TierCtx,
  asOf: Day,
  horizon: Day,
  months: Day[]
): TierUnits[] {
  const n = months.length;
  const idx = monthIndexer(months, horizon);
  const delta = TIER_FIELDS.map(() => new Int32Array(n));
  const AM = TIER_FIELDS.indexOf('aboveModerate');
  for (const sc of schedules) {
    const c = sc.entered.construction;
    if (c !== undefined && c > asOf) delta[AM][idx(c)] -= sc.existingUnits;
    if (sc.end.kind === 'complete') {
      const t = tiersOf(sc, ctx);
      const i = idx(sc.end.day);
      TIER_FIELDS.forEach((f, k) => {
        delta[k][i] += t[f];
      });
    }
  }
  const run = TIER_FIELDS.map(() => 0);
  const out: TierUnits[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < run.length; k++) run[k] += delta[k][i];
    out.push({
      veryLow: run[0],
      low: run[1],
      moderate: run[2],
      aboveModerate: run[3],
      unrecorded: run[4]
    });
  }
  return out;
}

/** `rhnaCompletedNet.byTier` as given; all zeros when a projects file has none (spec 4.3). */
export function tierBaselineOf(rhna: ProjectsFile['rhnaCompletedNet']): TierUnits {
  return rhna.byTier ?? { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0, unrecorded: 0 };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

/** `completed since 30 June 2022 (net)`: the day without a leading zero, the month in English. */
export function tierBaselineLabel(since: Day): string {
  const [y, m, d] = isoOf(since).split('-').map(Number);
  return `completed since ${d} ${MONTH_NAMES[m - 1]} ${y} (net)`;
}

/**
 * The sources of "Homes by income level" (spec 4.3), in the spec's order. Entry 6 is constant:
 * the dataset's own `rhnaCompletedNet.provenance` is run data, shown beside it with
 * `tierBaselineLabel`.
 */
export const TIER_SOURCES: readonly Provenance[] = [
  {
    tier: 1,
    label: 'RHNA 2023-2031 targets by income tier',
    sources: [{ ...RHNA_TIER_TARGETS[0].source }],
    method:
      "San Francisco's allocation by income tier in the Final RHNA Plan 2023-2031, Table 4 " +
      '(82,069 homes in all); the Budget Analyst, Exhibit D, carries the same split.'
  },
  {
    tier: 2,
    label: 'Funded affordable homes',
    sources: [],
    method:
      "A funded affordable project's homes are counted in the income tiers of the programmes " +
      'that pay it, in proportion to what each pays (its grant-equivalent), rounded to whole ' +
      'homes. If none of them pays anything, the programmes count equally. The proportions are ' +
      "a rule applied to the programmes' recorded tiers (the MOHCD pipeline); counting " +
      'the programmes equally when none pays anything is a tier 4 convention.'
  },
  {
    tier: 1,
    label: 'Private projects',
    sources: [...INCLUSIONARY.provenance.sources, ...ASSUMED_TENURE.provenance.sources],
    method: `${INCLUSIONARY.provenance.method} ${ASSUMED_TENURE.provenance.method}`
  },
  {
    tier: 0,
    label: 'Pipeline projects',
    sources: [{ label: 'DataSF Planning Projects', url: 'https://data.sf.gov/d/qvu5-m3a2' }],
    method:
      'A project already in the pipeline counts the affordable homes its Planning record ' +
      'proposes, with their income tier not recorded, and the rest as above moderate. The ' +
      'Planning field is never blank, so a recorded 0 may mean the affordable homes were not ' +
      'stated rather than that there are none.'
  },
  {
    tier: 2,
    label: 'Existing homes',
    sources: [],
    method:
      'Homes demolished for a new project are taken off above moderate: the records do not ' +
      'say whether any were income-restricted.'
  },
  {
    tier: 0,
    label: 'Homes completed since the start of the RHNA period, by income tier (net)',
    sources: [],
    method:
      "The dataset's rhnaCompletedNet.byTier; its provenance is the dataset's own " +
      'rhnaCompletedNet.provenance, shown beside this entry with the label of tierBaselineLabel.'
  }
];

// The delta series of one pool, by event kind and (for spend and loss) instrument.
const IN = 0;
const COMMIT = 1;
const RELEASE = 2;
const SPEND_GRANT = 3;
const SPEND_LOAN = 4;
const REPAY = 5;
const LOSS_GRANT = 6;
const LOSS_LOAN = 7;
const LOSS_GUARANTEE = 8;
const DELTAS = 9;

/**
 * Each pool's monthly money series (spec 4.4): one entry per `finance.pools` pool in that order.
 * An event lands in month `idx(day)`, month 0 before `months[0]`; an event after `horizon` is
 * dropped. The instrument of an event is that of its programme in `finance.programmes`. An unknown
 * pool or programme id is a defect: it throws.
 */
export function poolSeries(
  ledger: readonly LedgerEvent[],
  finance: NonNullable<SimInput['finance']>,
  months: Day[],
  horizon: Day
): Money['pools'] {
  const n = months.length;
  const m0 = months[0];
  const idx = monthIndexer(months, horizon);
  const poolIx = new Map(finance.pools.map((p, q) => [p.id, q]));
  const instr = new Map(finance.programmes.map((g) => [g.id, g.instrument.kind]));
  const delta = finance.pools.map(() => Array.from({ length: DELTAS }, () => new Float64Array(n)));
  for (const e of ledger) {
    const q = poolIx.get(e.pool);
    if (q === undefined) throw new Error(`moneyOf: unknown pool ${e.pool}`);
    let k: number;
    if (e.kind === 'in') k = IN;
    else {
      const ins = e.programme === null ? undefined : instr.get(e.programme);
      if (ins === undefined) throw new Error(`moneyOf: unknown programme ${e.programme}`);
      switch (e.kind) {
        case 'commit':
          k = COMMIT;
          break;
        case 'release':
          k = RELEASE;
          break;
        case 'spend':
          k = ins === 'grant' ? SPEND_GRANT : SPEND_LOAN;
          break;
        case 'repay':
          k = REPAY;
          break;
        case 'loss':
          k = ins === 'grant' ? LOSS_GRANT : ins === 'loan' ? LOSS_LOAN : LOSS_GUARANTEE;
          break;
      }
    }
    if (e.day > horizon) continue;
    delta[q][k][e.day < m0 ? 0 : idx(e.day)] += e.dollars;
  }
  return finance.pools.map((p, q) => {
    const d = delta[q];
    const run = new Float64Array(DELTAS);
    const s = {
      received: new Array<number>(n),
      committed: new Array<number>(n),
      out: new Array<number>(n),
      spent: new Array<number>(n),
      repaid: new Array<number>(n),
      lost: new Array<number>(n),
      lostCredit: new Array<number>(n)
    };
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < DELTAS; k++) run[k] += d[k][i];
      s.received[i] = run[IN];
      s.committed[i] = run[COMMIT] - run[RELEASE] - run[SPEND_GRANT] - run[SPEND_LOAN];
      s.out[i] = run[SPEND_LOAN] - run[REPAY] - run[LOSS_LOAN];
      s.spent[i] = run[SPEND_GRANT];
      s.repaid[i] = run[REPAY];
      s.lost[i] = run[LOSS_GRANT] + run[LOSS_LOAN] + run[LOSS_GUARANTEE];
      s.lostCredit[i] = run[LOSS_LOAN] + run[LOSS_GUARANTEE];
    }
    return { id: p.id, label: p.label, kind: p.kind, ...s };
  });
}
