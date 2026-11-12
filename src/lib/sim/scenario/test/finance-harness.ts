/**
 * Test harness: the ledger identities E1 to E7 of spec 4.7, checked after every event, and
 * `runCollect`, one engine run with everything it reports.
 */
import { expect } from 'vitest';
import type { Day } from '$lib/timelapse/time';
import { runEngineWith, type EngineOpts } from '../engine';
import type { Schedule, SimInput } from '../types';
import type { LedgerEvent } from '../money';

type Finance = NonNullable<SimInput['finance']>;

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

const zero = (): Sums => ({ C: 0, R: 0, Sg: 0, Sl: 0, P: 0, Lg: 0, Ll: 0, Lh: 0, received: 0 });

export function checkLedger(
  events: LedgerEvent[],
  finance: Finance,
  probe?: { after: number; available: number[] }[]
): void {
  const poolIx = new Map(finance.pools.map((p, i) => [p.id, i]));
  const progs = new Map(finance.programmes.map((g) => [g.id, g]));
  const sums = finance.pools.map(zero);
  const perProg = new Map<string, Sums>();
  const probes = new Map((probe ?? []).map((p) => [p.after, p.available]));
  let prevDay = -Infinity;
  events.forEach((e, n) => {
    const at = `event ${n} (${e.kind} ${e.pool} ${e.programme} ${e.dollars})`;
    expect(e.day, `${at}: day order`).toBeGreaterThanOrEqual(prevDay);
    prevDay = e.day;
    expect(e.dollars, `${at}: dollars`).toBeGreaterThan(0);
    const q = poolIx.get(e.pool)!;
    const pool = finance.pools[q];
    const s = sums[q];
    let pp: Sums | null = null;
    let instr: string | null = null;
    if (e.kind === 'in') {
      expect(e.programme, `${at}: in has no programme`).toBeNull();
      // E6
      expect(pool.uncapped, `${at}: E6 uncapped pool has an in`).toBe(false);
      s.received += e.dollars;
    } else {
      const g = progs.get(e.programme!)!;
      instr = g.instrument.kind;
      pp = perProg.get(g.id) ?? zero();
      perProg.set(g.id, pp);
      const add = (t: Sums) => {
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
      };
      add(s);
      add(pp);
    }
    const committed = s.C - s.R - s.Sg - s.Sl;
    const outLoan = s.Sl - s.P - s.Ll;
    // E1, E2 and E3 (the committed and outLoan above are the identities' remainders)
    expect(committed, `${at}: E1/E2 committed`).toBeGreaterThanOrEqual(0);
    expect(outLoan, `${at}: E1/E3 outLoan`).toBeGreaterThanOrEqual(0);
    // E5
    expect(s.Lg, `${at}: E5 grant loss within spend`).toBeLessThanOrEqual(s.Sg);
    // E7 (per programme, as the ledger carries no project id)
    if (pp) {
      expect(pp.C - pp.R - pp.Sg - pp.Sl, `${at}: E7 committed`).toBeGreaterThanOrEqual(0);
      expect(pp.Sl - pp.P - pp.Ll, `${at}: E7 loan out`).toBeGreaterThanOrEqual(0);
      if (instr === 'guarantee') {
        expect(pp.R, `${at}: E7 release within commit`).toBeLessThanOrEqual(pp.C);
        expect(pp.Lh, `${at}: E5 guarantee loss within commit`).toBeLessThanOrEqual(pp.C);
      }
    }
    // E4
    if (!pool.uncapped) {
      const avail = pool.leverage * s.received - committed - s.Sg - outLoan - s.Ll - s.Lh;
      expect(avail, `${at}: E4 available`).toBeGreaterThanOrEqual(-1e-6);
      const pr = probes.get(n);
      if (pr) expect(pr[q], `${at}: E4 engine value`).toBeCloseTo(avail, 6);
    }
  });
}

export interface Collected {
  /** every Schedule, sorted by `projectId` */
  schedules: Schedule[];
  /** the `projectId`s in the order the sink received them (funded ones in award order) */
  order: string[];
  ledger: LedgerEvent[];
  /** `sink.reservation` by row; a row reported twice throws */
  reservations: Map<number, boolean>;
  /** after each ledger event (by index): every pool's available money as the engine holds it */
  probes: { after: number; available: number[] }[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One run of `runEngineWith`, collecting schedules, ledger, reservations and probes. */
export function runCollect(
  input: SimInput,
  seed: number,
  horizon: Day,
  opts: Pick<EngineOpts, 'serving' | 'lineProbe' | 'noShortcuts'> = {}
): Collected {
  const schedules: Schedule[] = [];
  const ledger: LedgerEvent[] = [];
  const reservations = new Map<number, boolean>();
  const probes: Collected['probes'] = [];
  runEngineWith(
    input,
    seed,
    horizon,
    {
      schedule(s) {
        schedules.push(s);
      },
      master() {},
      reservation(row, kept) {
        if (reservations.has(row)) throw new Error(`row ${row} reported twice`);
        reservations.set(row, kept);
      },
      ledger(e) {
        ledger.push(e);
      }
    },
    {
      serving: opts.serving,
      lineProbe: opts.lineProbe,
      noShortcuts: opts.noShortcuts,
      probe(_e, available) {
        probes.push({ after: ledger.length - 1, available: [...available] });
      }
    }
  );
  const order = schedules.map((s) => s.projectId);
  schedules.sort((a, b) => cmp(a.projectId, b.projectId));
  return { schedules, order, ledger, reservations, probes };
}
