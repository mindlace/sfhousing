/**
 * Calibration model (design doc T12): pure, zod-free and worker-safe. Functions still marked
 * `not implemented` are signature stubs so every consumer compiles against the final API; their
 * bodies land in later stage-calibration steps. Only `./types`, `./time` and `./math` are
 * imported, and `exp`/`log` come from `./math` so results are bit-reproducible.
 */
import { exp, log } from './math';
import {
  EXIT_ORDER,
  type Calibration,
  type ExitReason,
  type FeatureId,
  type InitiationModel,
  type Pathway,
  type Stage,
  type Transition
} from './types';

type Incidence = { advance: number; exit: Partial<Record<ExitReason, number>> };

/** (number of edges <= x) - 1, clamped to [0, edges.length - 1]. */
export function binIndex(edges: number[], x: number): number {
  let n = 0;
  while (n < edges.length && edges[n] <= x) n++;
  const i = n - 1;
  return i < 0 ? 0 : i > edges.length - 1 ? edges.length - 1 : i;
}

/** The exit reasons a transition mentions, table or tail, in `EXIT_ORDER`. */
function reasonsOf(t: Transition): ExitReason[] {
  return EXIT_ORDER.filter((r) => t.exit[r] !== undefined || t.tail.exit[r] !== undefined);
}

/** rho: the tail's total monthly hazard, summed advance first, then `EXIT_ORDER`. */
function tailRate(t: Transition): number {
  let rho = t.tail.advance;
  for (const r of EXIT_ORDER) rho += t.tail.exit[r] ?? 0;
  return rho;
}

function checkMonths(k: number): void {
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`months must be a non-negative integer, got ${k}`);
  }
}

/** C(K): the table's total cumulative incidence at its last month. */
function tableTotal(t: Transition): number {
  let c = t.advance[t.months - 1];
  for (const r of EXIT_ORDER) c += t.exit[r]?.[t.months - 1] ?? 0;
  return c;
}

/** C(k): advance plus all exits by month k; closed-form beyond the table. */
export function cumulativeTotal(t: Transition, k: number): number {
  checkMonths(k);
  if (k === 0) return 0;
  if (k <= t.months) {
    let c = t.advance[k - 1];
    for (const r of EXIT_ORDER) c += t.exit[r]?.[k - 1] ?? 0;
    return c;
  }
  const rho = tailRate(t);
  return 1 - (1 - tableTotal(t)) * exp((k - t.months) * log(1 - rho));
}

/** F_j(k) for advance and each exit reason: cumulative probability of leaving by month k. */
export function cumulativeIncidence(t: Transition, k: number): Incidence {
  checkMonths(k);
  const reasons = reasonsOf(t);
  const exit: Partial<Record<ExitReason, number>> = {};
  if (k <= t.months) {
    const advance = k === 0 ? 0 : t.advance[k - 1];
    for (const r of reasons) exit[r] = k === 0 ? 0 : (t.exit[r]?.[k - 1] ?? 0);
    return { advance, exit };
  }
  const K = t.months;
  const rho = tailRate(t);
  const survive = 1 - tableTotal(t);
  const decay = 1 - exp((k - K) * log(1 - rho));
  const advance = t.advance[K - 1] + survive * (t.tail.advance / rho) * decay;
  for (const r of reasons) {
    exit[r] = (t.exit[r]?.[K - 1] ?? 0) + survive * ((t.tail.exit[r] ?? 0) / rho) * decay;
  }
  return { advance, exit };
}

/** P(eventually j) given survival to `monthsElapsed` months; memoryless from K onward. */
export function eventualProbabilities(t: Transition, monthsElapsed: number): Incidence {
  checkMonths(monthsElapsed);
  const reasons = reasonsOf(t);
  const K = t.months;
  const rho = tailRate(t);
  const exit: Partial<Record<ExitReason, number>> = {};
  if (monthsElapsed >= K) {
    for (const r of reasons) exit[r] = (t.tail.exit[r] ?? 0) / rho;
    return { advance: t.tail.advance / rho, exit };
  }
  const survive = 1 - tableTotal(t);
  const at = cumulativeIncidence(t, monthsElapsed);
  const denom = 1 - cumulativeTotal(t, monthsElapsed);
  const advance = (t.advance[K - 1] + survive * (t.tail.advance / rho) - at.advance) / denom;
  for (const r of reasons) {
    const inf = (t.exit[r]?.[K - 1] ?? 0) + survive * ((t.tail.exit[r] ?? 0) / rho);
    exit[r] = (inf - (at.exit[r] ?? 0)) / denom;
  }
  return { advance, exit };
}

export function sampleTransition(
  _t: Transition,
  _u: number,
  _monthsElapsed: number
): { kind: 'advance' | ExitReason; days: number } {
  throw new Error('not implemented');
}

/** Monthly initiation probability: logistic of the intercept plus the binned coefficients. */
export function initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number {
  let z = m.intercept;
  for (const term of m.terms) z += term.coef[binIndex(term.bins, f[term.feature])];
  return 1 / (1 + exp(-z));
}

export function chanceTable(
  _cal: Calibration
): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>> {
  throw new Error('not implemented');
}

export function typicalMonths(
  _cal: Calibration
): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>> {
  throw new Error('not implemented');
}

export function parseCalibration(_json: unknown): Calibration {
  throw new Error('not implemented');
}
