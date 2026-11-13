// Test harness: the ledger identities E1 to E7 of the finance-engine spec (4.7) after a world's
// step, as `scenario/test/finance-harness.ts` checks them after every event of today's engine, and
// the world's pool columns against the ledger. Every failure is collected, then asserted at once.
import { expect } from 'vitest';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { FinanceFrame } from '../../policy/frame';
import type { World } from '../../types';
import { fundOf } from '../columns';
import { availableOf } from '../pools';

/** Floating-point tolerance of E4 (a `bank` pool's leverage is not whole). */
const TOL = 1e-6;

interface Sums {
  C: number;
  R: number;
  Sg: number;
  Sl: number;
  P: number;
  Lg: number;
  Ll: number;
  Lh: number;
  received: number;
}

const KEYS = ['C', 'R', 'Sg', 'Sl', 'P', 'Lg', 'Ll', 'Lh', 'received'] as const;
const zero = (): Sums => ({ C: 0, R: 0, Sg: 0, Sl: 0, P: 0, Lg: 0, Ll: 0, Lh: 0, received: 0 });

/** The ledger's cumulative sums after a step: per pool id and per programme id. */
export interface StepSums {
  /** Ledger events already summed. */
  n: number;
  pools: Map<string, Sums>;
  progs: Map<string, Sums>;
}

const copy = (m: Map<string, Sums>): Map<string, Sums> =>
  new Map([...m].map(([k, v]) => [k, { ...v }]));

/**
 * E1 to E7 on the ledger so far (`events`, cumulative; only those after `prev.n` are new), and
 * the world's six counters and available money equal to the ledger's. Call after every step;
 * returns the sums for the next call. Days need not ascend: a month's events come in system order.
 */
export function checkStep(
  events: readonly LedgerEvent[],
  world: World,
  fin: FinanceFrame,
  prev: StepSums | null
): StepSums {
  const pools = prev ? copy(prev.pools) : new Map<string, Sums>();
  const progs = prev ? copy(prev.progs) : new Map<string, Sums>();
  const defs = new Map(fin.pools.map((p) => [p.id, p]));
  const instrOf = new Map(fin.programmes.map((g) => [g.id, g.instrument.kind]));
  const bad: string[] = [];
  const sumsOf = (m: Map<string, Sums>, id: string): Sums => {
    let s = m.get(id);
    if (!s) m.set(id, (s = zero()));
    return s;
  };
  for (let i = prev ? prev.n : 0; i < events.length; i++) {
    const e = events[i];
    const at = `event ${i} (${e.kind} ${e.pool} ${e.programme} ${e.dollars} day ${e.day})`;
    if (!(e.dollars > 0)) bad.push(`${at}: dollars not positive`);
    const def = defs.get(e.pool);
    if (!def) {
      bad.push(`${at}: unknown pool`);
      continue;
    }
    const s = sumsOf(pools, e.pool);
    if (e.kind === 'in') {
      if (e.programme !== null) bad.push(`${at}: an 'in' names a programme`);
      // E6
      if (def.uncapped) bad.push(`${at}: E6 'in' on an uncapped pool`);
      s.received += e.dollars;
      continue;
    }
    const instr = e.programme === null ? undefined : instrOf.get(e.programme);
    if (instr === undefined) {
      bad.push(`${at}: unknown programme`);
      continue;
    }
    const pp = sumsOf(progs, e.programme!);
    for (const t of [s, pp]) {
      if (e.kind === 'commit') t.C += e.dollars;
      else if (e.kind === 'release') t.R += e.dollars;
      else if (e.kind === 'spend') {
        if (instr === 'grant') t.Sg += e.dollars;
        else t.Sl += e.dollars;
      } else if (e.kind === 'repay') t.P += e.dollars;
      else if (e.kind === 'loss') {
        if (instr === 'grant') t.Lg += e.dollars;
        else if (instr === 'loan') t.Ll += e.dollars;
        else t.Lh += e.dollars;
      }
    }
  }

  // E1: cumulative sums never fall from the last step.
  if (prev) {
    for (const [tag, now, was] of [
      ['pool', pools, prev.pools],
      ['programme', progs, prev.progs]
    ] as const) {
      for (const [id, w] of was) {
        const s = now.get(id)!;
        for (const k of KEYS) if (s[k] < w[k]) bad.push(`${tag} ${id}: E1 ${k} falls`);
      }
    }
  }

  const { pools: cols } = fundOf(world);
  for (let q = 0; q < cols.n; q++) {
    const id = cols.id[q];
    const def = defs.get(id);
    if (!def) {
      bad.push(`world pool ${id}: not in the frame`);
      continue;
    }
    const s = pools.get(id) ?? zero();
    const at = `pool ${id} month ${world.month}`;
    const committed = s.C - s.R - s.Sg - s.Sl;
    const outLoan = s.Sl - s.P - s.Ll;
    // E1, E2 (C = R + Sg + Sl + committed) and E3 (Sl = outLoan + P + Ll): committed and
    // outLoan are the identities' remainders, and must equal the world's own counters.
    if (committed < 0) bad.push(`${at}: E1/E2 committed ${committed}`);
    if (outLoan < 0) bad.push(`${at}: E1/E3 outLoan ${outLoan}`);
    if (cols.committed[q] !== committed)
      bad.push(`${at}: E2 world committed ${cols.committed[q]} != ledger ${committed}`);
    if (cols.outLoan[q] !== outLoan)
      bad.push(`${at}: E3 world outLoan ${cols.outLoan[q]} != ledger ${outLoan}`);
    // The other four counters.
    if (cols.received[q] !== s.received)
      bad.push(`${at}: world received ${cols.received[q]} != ledger ${s.received}`);
    if (cols.spentGrant[q] !== s.Sg)
      bad.push(`${at}: world spentGrant ${cols.spentGrant[q]} != ledger ${s.Sg}`);
    if (cols.lostLoan[q] !== s.Ll)
      bad.push(`${at}: world lostLoan ${cols.lostLoan[q]} != ledger ${s.Ll}`);
    if (cols.lostGuarantee[q] !== s.Lh)
      bad.push(`${at}: world lostGuarantee ${cols.lostGuarantee[q]} != ledger ${s.Lh}`);
    // E4: available money never below zero, and the world's own value is the ledger's.
    if (!def.uncapped) {
      const avail = def.leverage * s.received - committed - s.Sg - outLoan - s.Ll - s.Lh;
      if (avail < -TOL) bad.push(`${at}: E4 available ${avail}`);
      const got = availableOf(cols, q, def);
      if (!(Math.abs(got - avail) <= TOL)) bad.push(`${at}: E4 world ${got} != ledger ${avail}`);
    }
    // E5: grant losses within grant spend.
    if (s.Lg > s.Sg) bad.push(`${at}: E5 grant loss ${s.Lg} > spent ${s.Sg}`);
  }
  // Every pool the ledger names is a world pool row.
  for (const id of pools.keys())
    if (!cols.id.slice(0, cols.n).includes(id)) bad.push(`ledger pool ${id}: no world row`);

  // E7, per programme (the ledger carries no project id).
  for (const [id, pp] of progs) {
    const at = `programme ${id} month ${world.month}`;
    if (pp.C - pp.R - pp.Sg - pp.Sl < 0) bad.push(`${at}: E7 committed`);
    if (pp.Sl - pp.P - pp.Ll < 0) bad.push(`${at}: E7 loan out`);
    if (instrOf.get(id) === 'guarantee') {
      if (pp.R > pp.C) bad.push(`${at}: E7 release beyond commit`);
      if (pp.Lh > pp.C) bad.push(`${at}: E5 guarantee loss beyond commit`);
    }
  }

  expect(bad.length, `ledger identities:\n${bad.slice(0, 20).join('\n')}`).toBe(0);
  return { n: events.length, pools, progs };
}
