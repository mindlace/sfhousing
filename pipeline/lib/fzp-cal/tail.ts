/**
 * Constant competing-hazards tail beyond the table, and the cell rejection rule
 * (stage-calibration spec §4.4 Tail, Rounding, Rejection).
 */
import { exp } from '../../../src/lib/timelapse/math';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import { EXIT_ORDER, type ExitReason, type Transition } from '../../../src/lib/timelapse/types';
import { OUTCOMES, type Outcome } from './aalen-johansen';
import type { CalProfile, Spell } from './types';

/** Rounds to 6 significant digits (ECMAScript `toPrecision` is exactly specified). */
export const sig6 = (v: number): number => (v === 0 ? 0 : Number(v.toPrecision(6)));

/** Events (any outcome but censored) with x >= `from`, the start of the span in days. */
function spanEvents(spells: Spell[], from: number): number {
  let n = 0;
  for (const s of spells) if (s.outcome !== 'censored' && s.x >= from) n++;
  return n;
}

/**
 * Occurrence/exposure over months k0 onward, to the end of observation. k0 starts at
 * max(1, months - TAIL_SPAN + 1) and moves earlier (down to 1) until the span holds
 * >= TAIL_MIN_EVENTS events. Person-months E = sum max(0, x - max(a, (k0 - 1) M)) / M;
 * lambda_j = scale_j * events_j / E; p_j = (lambda_j / lambda)(1 - exp(-lambda)), 6 significant
 * digits. All four exit reasons are returned (dropping reasons with no events is the caller's).
 * With no exposure or no events the tail is all zeros, which `rejects` turns down.
 */
export function tailFit(
  spells: Spell[],
  months: number,
  cal: CalProfile,
  scale: Partial<Record<Outcome, number>> = {}
): {
  k0: number;
  events: number;
  personMonths: number;
  lambda: Record<Outcome, number>;
  tail: Transition['tail'];
} {
  let k0 = Math.max(1, months - cal.tailSpan + 1);
  let events = spanEvents(spells, (k0 - 1) * MONTH_DAYS);
  while (events < cal.tailMinEvents && k0 > 1) {
    k0--;
    events = spanEvents(spells, (k0 - 1) * MONTH_DAYS);
  }
  const from = (k0 - 1) * MONTH_DAYS;

  let exposure = 0;
  const count = {} as Record<Outcome, number>;
  for (const j of OUTCOMES) count[j] = 0;
  for (const s of spells) {
    const start = s.a > from ? s.a : from;
    if (s.x > start) exposure += s.x - start;
    if (s.outcome !== 'censored' && s.x >= from) count[s.outcome]++;
  }
  const personMonths = exposure / MONTH_DAYS;

  const lambda = {} as Record<Outcome, number>;
  let total = 0;
  for (const j of OUTCOMES) {
    lambda[j] = personMonths > 0 ? ((scale[j] ?? 1) * count[j]) / personMonths : 0;
    total += lambda[j];
  }
  const leave = total > 0 ? 1 - exp(-total) : 0;
  const p = (j: Outcome): number => (total > 0 ? sig6((lambda[j] / total) * leave) : 0);
  const exit: Partial<Record<ExitReason, number>> = {};
  for (const r of EXIT_ORDER) exit[r] = p(r);
  return { k0, events, personMonths, lambda, tail: { advance: p('advance'), exit } };
}

/**
 * A cell is rejected (and goes to the §4.5 fallback) unless C(K) <= 1 - 1e-6 and 0 < rho <= 1
 * (the 6-significant-digit rounding of the p_j can push their sum above 1).
 * An empty table (months 0) is rejected too: `parseCalibration` requires 1 <= months.
 */
export function rejects(
  advance: number[],
  exit: Partial<Record<ExitReason, number[]>>,
  tail: Transition['tail']
): boolean {
  const K = advance.length;
  if (K === 0) return true;
  let c = advance[K - 1];
  for (const r of EXIT_ORDER) c += exit[r]?.[K - 1] ?? 0;
  let rho = tail.advance;
  for (const r of EXIT_ORDER) rho += tail.exit[r] ?? 0;
  return !(c <= 1 - 1e-6 && rho > 0 && rho <= 1);
}
