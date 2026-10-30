/**
 * Timer and route-share levers (plan 2 Task 6). A timer stretches or shrinks a stage's fitted
 * cumulative-incidence curve in time while keeping its eventual exit shares from month 0 exact
 * (ruling 3, "Rescale construction"): the spec's "spread kept, exit shares unchanged". Route
 * shares replace `pathwayForNew`. Both are `PolicyOp`s; the parcels pass through. Worker-safe.
 */
import { exp, log } from '$lib/timelapse/math';
import { cumulativeTotal, eventualProbabilities, tailRate } from '$lib/timelapse/model';
import {
  EXIT_ORDER,
  PATHWAYS,
  pathwayStages,
  type Calibration,
  type ExitReason,
  type Pathway,
  type Provenance,
  type Stage,
  type Transition
} from '$lib/timelapse/types';
import type { PolicyOp } from '../scenario/policy';
import { MAX_SCALE, MIN_SCALE, type TimedStage, type TimerEdit } from './types';

/** Per pathway and stage, the time scale; absent = 1. */
export type StageScale = Record<Pathway, Partial<Record<TimedStage, number>>>;

/** `parseCalibration`'s table limits: K <= 240 months and C(K) <= 1 - 1e-6. */
const MAX_MONTHS = 240;
const MAX_TABLE_MASS = 1 - 1e-6;

type Kind = 'advance' | ExitReason;

/**
 * The stage scales one cohort sees. `'inFlight'` (projects already filed at `calibration.asOf`)
 * multiplies the `'all'` edits; `'new'` multiplies every edit (ruling 3, "Policy start date").
 * A product is clamped to [MIN_SCALE, MAX_SCALE], the range the rescale is checked on.
 */
export function scaleTable(edits: readonly TimerEdit[], who: 'inFlight' | 'new'): StageScale {
  const out: StageScale = { discretionary: {}, streamlined: {}, permitOnly: {} };
  for (const e of edits) {
    if (who === 'inFlight' && e.reach !== 'all') continue;
    const row = out[e.pathway];
    row[e.stage] = (row[e.stage] ?? 1) * e.scale;
  }
  for (const p of PATHWAYS) {
    const row = out[p];
    for (const s of Object.keys(row) as TimedStage[]) {
      row[s] = Math.min(MAX_SCALE, Math.max(MIN_SCALE, row[s]!));
    }
  }
  return out;
}

export function isIdentity(s: StageScale): boolean {
  return PATHWAYS.every((p) => Object.values(s[p]).every((x) => x === 1));
}

function rescaledProvenance(p: Provenance, s: number): Provenance {
  return { ...p, method: `${p.method}; time-rescaled ×${s} (policy lever)` };
}

/**
 * `t` stretched in time by `s` (s > 1 slower, s < 1 faster), eventual shares from month 0 kept.
 * With C_j(x) the column j curve at real x months (linear between table months, the model's
 * beyond-table form past K):
 *
 *   K' = the largest k <= min(240, max(1, round(K s))) with C(k / s) <= 1 - 1e-6
 *   table'_j[k - 1] = C_j(k / s), k = 1..K'
 *   rho' = 1 - (1 - rho)^(1 / s)
 *   tail'_j = rho' * max(0, P_j - C_j(K' / s)) / (1 - C(K' / s)), P_j = eventual share of t
 *
 * Throws a RangeError when even k = 1 exceeds the table mass limit. `s === 1` returns `t`.
 */
export function rescaleTransition(t: Transition, s: number): Transition {
  if (s === 1) return t;
  if (!(Number.isFinite(s) && s > 0)) throw new RangeError(`scale must be positive, got ${s}`);
  const K = t.months;
  const rho = tailRate(t);
  const logSurvive = log(1 - rho);
  const survive = 1 - cumulativeTotal(t, K);
  const P = eventualProbabilities(t, 0);
  // The model's reasons (table or tail), in EXIT_ORDER; the advance column first.
  const reasons = EXIT_ORDER.filter((r) => t.exit[r] !== undefined || t.tail.exit[r] !== undefined);
  const kinds: Kind[] = ['advance', ...reasons];

  const table = (kind: Kind, k: number): number =>
    k === 0 ? 0 : kind === 'advance' ? t.advance[k - 1] : (t.exit[kind]?.[k - 1] ?? 0);
  const tailShare = (kind: Kind): number =>
    (kind === 'advance' ? t.tail.advance : (t.tail.exit[kind] ?? 0)) / rho;
  const curve = (kind: Kind, x: number): number => {
    if (x > K) {
      return table(kind, K) + survive * tailShare(kind) * (1 - exp((x - K) * logSurvive));
    }
    const k0 = Math.floor(x);
    const f = x - k0;
    if (f === 0) return table(kind, k0);
    const a = table(kind, k0);
    const b = table(kind, k0 + 1);
    return Math.min(b, a + (b - a) * f); // min: rounding never overshoots the next month
  };

  const kMax = Math.min(MAX_MONTHS, Math.max(1, Math.round(K * s)));
  const cols = kinds.map(() => [] as number[]);
  const sums: number[] = [];
  for (let k = 1; k <= kMax; k++) {
    let c = 0;
    for (let j = 0; j < kinds.length; j++) {
      // A running max guards the non-decreasing check against rounding in exp.
      const v = Math.max(curve(kinds[j], k / s), k > 1 ? cols[j][k - 2] : 0);
      cols[j].push(v);
      c += v; // advance, then EXIT_ORDER: the order `parseCalibration` and the model sum in
    }
    sums.push(c);
  }
  let K2 = kMax;
  while (K2 >= 1 && !(sums[K2 - 1] <= MAX_TABLE_MASS)) K2--;
  if (K2 < 1) {
    throw new RangeError(`scale ${s} leaves C(1 / s) = ${sums[0]} > 1 - 1e-6 (K = ${K})`);
  }

  const beyond = K2 / s > K;
  const mass = 1 - sums[K2 - 1];
  const rho2 = 1 - exp(logSurvive / s);
  const pi = (j: number): number => {
    const kind = kinds[j];
    const eventual = kind === 'advance' ? P.advance : (P.exit[kind] ?? 0);
    return Math.max(0, eventual - cols[j][K2 - 1]) / mass;
  };

  const exit: Partial<Record<ExitReason, number[]>> = {};
  const tailExit: Partial<Record<ExitReason, number>> = {};
  for (let j = 1; j < kinds.length; j++) {
    const r = kinds[j] as ExitReason;
    if (t.exit[r] !== undefined || (beyond && tailShare(r) > 0)) exit[r] = cols[j].slice(0, K2);
    // A table-only reason still needs a tail key when the shortened table leaves it share.
    if (t.tail.exit[r] !== undefined || pi(j) > 0) tailExit[r] = rho2 * pi(j);
  }
  return {
    months: K2,
    advance: cols[0].slice(0, K2),
    exit,
    tail: { advance: rho2 * pi(0), exit: tailExit },
    provenance: rescaledProvenance(t.provenance, s),
    tailProvenance: rescaledProvenance(t.tailProvenance, s)
  };
}

/**
 * Rescales each scaled transition. A stage the pathway never visits (permitOnly + filed) has no
 * transition and is a no-op. With nothing to rescale the calibration is returned as-is.
 */
export function timersOp(scale: StageScale): PolicyOp {
  return (cal, parcels) => {
    let transitions: typeof cal.transitions | null = null;
    for (const p of PATHWAYS) {
      for (const [stage, s] of Object.entries(scale[p]) as [TimedStage, number][]) {
        const t = cal.transitions[p][stage];
        if (t === undefined || s === 1) continue;
        transitions ??= { ...cal.transitions };
        transitions[p] = { ...transitions[p], [stage]: rescaleTransition(t, s) };
      }
    }
    return { cal: transitions === null ? cal : { ...cal, transitions }, parcels };
  };
}

/** New projects' pathway shares, normalised to sum to 1; the provenance is kept. Null = identity. */
export function routeSharesOp(shares: Record<Pathway, number> | null): PolicyOp {
  return (cal, parcels) => {
    if (shares === null) return { cal, parcels };
    let sum = 0;
    for (const p of PATHWAYS) sum += shares[p];
    if (!(sum > 0)) throw new RangeError(`route shares must sum to more than 0, got ${sum}`);
    const pathwayForNew = { ...cal.pathwayForNew };
    for (const p of PATHWAYS) pathwayForNew[p] = shares[p] / sum;
    return { cal: { ...cal, pathwayForNew }, parcels };
  };
}

/**
 * Ruling 3, "Disapproval-zero threshold": the spec's disapproval exception is negligible when
 * every pathway's eventual disapproved share of new projects is below this (1%, below the
 * run-to-run spread of the band). Tier 4: a judgement call, not a sourced value.
 */
export const DISAPPROVAL_NEGLIGIBLE = 0.01;

/**
 * Per pathway, the share of new projects that eventually end disapproved. Reach starts at 1 at
 * the first stage after `preApplication`; each stage adds reach x P(disapproved from month 0),
 * then reach is multiplied by P(advance). The terminal stage has no table and is skipped.
 */
export function disapprovedShare(cal: Calibration): Record<Pathway, number> {
  const out = { discretionary: 0, streamlined: 0, permitOnly: 0 };
  for (const p of PATHWAYS) {
    let reach = 1;
    for (const stage of pathwayStages(p)) {
      if (stage === 'preApplication') continue;
      const t = cal.transitions[p][stage as Exclude<Stage, 'complete'>];
      if (!t) continue;
      const e = eventualProbabilities(t, 0);
      out[p] += reach * (e.exit.disapproved ?? 0);
      reach *= e.advance;
    }
  }
  return out;
}
