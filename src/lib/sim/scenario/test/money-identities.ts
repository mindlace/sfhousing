/**
 * Test harness: finance-score's identities I1 to I6 (spec 4.4) on the per-pool money series, every
 * pool, every month. I2 and I3 need the ledger: they are checked against the ledger's own monthly
 * sums, computed here apart from `poolSeries`. Every failure is collected, then asserted at once.
 */
import { expect } from 'vitest';
import type { Day } from '$lib/timelapse/time';
import type { Pool } from '$lib/timelapse/types';
import type { Money } from '../finance-score';
import type { LedgerEvent } from '../money';
import { monthIndexer } from '../score';
import type { SimInput } from '../types';

type Finance = NonNullable<SimInput['finance']>;

/** Floating-point tolerance of I4 (a `bank` pool's leverage is not whole). */
const TOL = 1e-6;

const CUMULATIVE = ['received', 'spent', 'repaid', 'lost', 'lostCredit'] as const;

/** Per pool, per month: the cumulative C, R, S (all), S_loan, P, L_loan of the ledger. */
function ledgerSums(
  events: readonly LedgerEvent[],
  finance: Finance,
  months: Day[],
  horizon: Day
): { C: number; R: number; S: number; Sl: number; P: number; Ll: number }[][] {
  const n = months.length;
  const idx = monthIndexer(months, horizon);
  const poolIx = new Map(finance.pools.map((p, q) => [p.id, q]));
  const instr = new Map(finance.programmes.map((g) => [g.id, g.instrument.kind]));
  const zero = () => ({ C: 0, R: 0, S: 0, Sl: 0, P: 0, Ll: 0 });
  const by = finance.pools.map(() => Array.from({ length: n }, zero));
  for (const e of events) {
    if (e.day > horizon || e.kind === 'in') continue;
    const t = by[poolIx.get(e.pool)!][e.day < months[0] ? 0 : idx(e.day)];
    const ins = instr.get(e.programme!);
    if (e.kind === 'commit') t.C += e.dollars;
    else if (e.kind === 'release') t.R += e.dollars;
    else if (e.kind === 'spend') {
      t.S += e.dollars;
      if (ins === 'loan') t.Sl += e.dollars;
    } else if (e.kind === 'repay') t.P += e.dollars;
    else if (e.kind === 'loss' && ins === 'loan') t.Ll += e.dollars;
  }
  for (const pool of by) {
    for (let i = 1; i < n; i++) {
      for (const k of ['C', 'R', 'S', 'Sl', 'P', 'Ll'] as const) pool[i][k] += pool[i - 1][k];
    }
  }
  return by;
}

/**
 * Asserts I1, I4, I5 and I6 on `money.pools` (matched to `pools` by position, ids equal) every
 * month and, when `ledger` is given, I2 (`C = R + S + committed`) and I3
 * (`S_loan = out + repaid + L_loan`) from the ledger's own monthly sums.
 */
export function checkMoneyIdentities(
  money: Pick<Money, 'pools'>,
  pools: readonly Pool[],
  ledger?: {
    events: readonly LedgerEvent[];
    finance: Finance;
    months: Day[];
    horizon: Day;
  }
): void {
  expect(
    money.pools.map((p) => p.id),
    'one entry per pool, in order'
  ).toEqual(pools.map((p) => p.id));
  const sums = ledger
    ? ledgerSums(ledger.events, ledger.finance, ledger.months, ledger.horizon)
    : null;
  const bad: string[] = [];
  money.pools.forEach((s, q) => {
    const pool = pools[q];
    const n = s.received.length;
    for (let i = 0; i < n; i++) {
      const at = `pool ${pool.id} month ${i}`;
      // I1
      for (const k of CUMULATIVE) {
        if (i > 0 && s[k][i] < s[k][i - 1]) {
          bad.push(`${at}: I1 ${k} falls ${s[k][i - 1]} -> ${s[k][i]}`);
        }
      }
      if (s.committed[i] < 0) bad.push(`${at}: I1 committed ${s.committed[i]}`);
      if (s.out[i] < 0) bad.push(`${at}: I1 out ${s.out[i]}`);
      // I4
      if (!pool.uncapped) {
        const avail =
          pool.leverage * s.received[i] - s.committed[i] - s.spent[i] - s.out[i] - s.lostCredit[i];
        if (avail < -TOL) bad.push(`${at}: I4 available ${avail}`);
      }
      // I5: lost = lostCredit + L_grant, L_grant <= spent
      if (s.lost[i] < s.lostCredit[i]) {
        bad.push(`${at}: I5 lost ${s.lost[i]} < lostCredit ${s.lostCredit[i]}`);
      }
      if (s.lost[i] - s.lostCredit[i] > s.spent[i]) {
        bad.push(`${at}: I5 grant loss ${s.lost[i] - s.lostCredit[i]} > spent ${s.spent[i]}`);
      }
      // I6
      if (pool.uncapped && s.received[i] !== 0) {
        bad.push(`${at}: I6 uncapped received ${s.received[i]}`);
      }
      if (sums) {
        const t = sums[q][i];
        if (t.C !== t.R + t.S + s.committed[i]) {
          bad.push(`${at}: I2 C ${t.C} != R ${t.R} + S ${t.S} + committed ${s.committed[i]}`);
        }
        if (t.Sl !== s.out[i] + s.repaid[i] + t.Ll) {
          bad.push(
            `${at}: I3 S_loan ${t.Sl} != out ${s.out[i]} + repaid ${s.repaid[i]} + L_loan ${t.Ll}`
          );
        }
      }
    }
  });
  // the first failures in the message, so a failing case names its pool, month and numbers
  expect(bad.length, `money identities:\n${bad.slice(0, 20).join('\n')}`).toBe(0);
}
