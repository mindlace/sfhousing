/**
 * Seeded valid ledgers for finance-score's identity property tests (spec 6 test 17). A case is a
 * pure function of the seed (mulberry32). The ledger follows the engine's event table and its order
 * within a day (`docs/dev/finance-engine.md`, "The pool state, availability and the events" and
 * "Order within a day"), and every generated ledger passes the engine's own `checkLedger`.
 *
 * Awards ignore `off` on purpose: a partly covered application can commit from a pool inside its
 * `off` span (M1, open with the partner), so the cases include commits inside an off span.
 */
import type { Day } from '$lib/timelapse/time';
import type { Instrument, Pool, Programme } from '$lib/timelapse/types';
import { dayOf } from '../dates';
import { inflowArrivals } from '../funding';
import type { LedgerEvent } from '../money';
import { monthsOf } from '../score';
import type { SimInput } from '../types';
import { TEST_TERMS } from './finance-score-cases';

type Finance = NonNullable<SimInput['finance']>;
type Instr = Instrument['kind'];

export interface LedgerCase {
  finance: Finance;
  ledger: LedgerEvent[];
  asOf: Day;
  horizon: Day;
  months: Day[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOLS: readonly Pool[] = [
  {
    id: 'gr',
    kind: 'generalRevenue',
    label: 'General revenue',
    inflows: [],
    uncapped: false,
    debt: null,
    leverage: 1
  },
  {
    id: 'bank',
    kind: 'bank',
    label: 'Bank',
    inflows: [],
    uncapped: false,
    debt: null,
    leverage: 0.7
  },
  {
    id: 'go',
    kind: 'goBond',
    label: 'GO bond',
    inflows: [],
    uncapped: false,
    debt: { rate: 0.06, termYears: 20 },
    leverage: 1
  },
  {
    id: 'fed',
    kind: 'federal',
    label: 'Federal',
    inflows: [],
    uncapped: true,
    debt: null,
    leverage: 1
  }
];

/** Test instruments; a guarantee reserve of half its loan, so λ = 0.25 loses less than H. */
const INSTRUMENTS: Record<Instr, Instrument> = {
  grant: { kind: 'grant', share: 0.3 },
  loan: { kind: 'loan', costShare: 0.5, rate: 0.03, requiredReturn: null },
  guarantee: { kind: 'guarantee', costShare: 0.5, reserve: 0.5 }
};

type Outcome = 'exitBefore' | 'complete' | 'exitAfter' | 'open';
const OUTCOMES: readonly Outcome[] = ['exitBefore', 'complete', 'exitAfter', 'open'];

/** Within-day order of a project's later events, as `money.ts` sorts them. */
const ORDER = { spend: 0, repay: 1, loss: 2, release: 3 } as const;

interface Due {
  project: number;
  order: number;
  prog: number;
  /** a release (0) before a loss (1) within one order and programme */
  sub: number;
  pool: number;
  kind: 'spend' | 'repay' | 'loss' | 'release';
  instr: Instr;
  dollars: number;
}

interface State {
  received: number;
  committed: number;
  spentGrant: number;
  outLoan: number;
  lostLoan: number;
  lostGuarantee: number;
}

/** One seeded case: pools, programmes, terms, one off span, and the ledger of a day loop. */
export function ledgerModel(seed: number): LedgerCase {
  const r = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const asOf = dayOf(2027, 1, 1) + int(0, 364);
  const horizon = asOf + int(2 * 365, 6 * 365);
  const months = monthsOf(asOf, horizon);

  // 1-4 pools, each capped pool with an opening sum on asOf and a yearly inflow
  const pools: Pool[] = shuffle(POOLS)
    .slice(0, int(1, 4))
    .map((t) => ({
      ...t,
      inflows: t.uncapped
        ? []
        : [
            { kind: 'once', day: asOf, dollars: int(1, 5) * 1_000_000 },
            {
              kind: 'yearly',
              from: asOf + int(30, 365),
              to: null,
              dollarsPerYear: int(1, 8) * 1_000_000
            }
          ]
    }));

  // one to three programmes per pool, of distinct instruments, in a shuffled global order
  const programmes: Programme[] = shuffle(
    pools.flatMap((p) =>
      shuffle(['grant', 'loan', 'guarantee'] as const)
        .slice(0, int(1, 3))
        .map((kind): Programme => ({
          id: `${p.id}-${kind}`,
          label: `${p.label} ${kind}`,
          pool: p.id,
          reach: 'market',
          instrument: INSTRUMENTS[kind],
          from: asOf,
          to: null,
          minHomes: 0,
          tiers: null
        }))
    )
  );

  const capped = pools.flatMap((p, q) => (p.uncapped ? [] : [q]));
  const off: Finance['off'] = [];
  if (capped.length > 0) {
    const from = asOf + int(0, Math.floor((horizon - asOf) / 2));
    off.push({ pool: pools[pick(capped)].id, from, to: r() < 0.25 ? null : from + int(30, 400) });
  }
  const isOff = (q: number, d: Day) =>
    off.some((o) => o.pool === pools[q].id && o.from <= d && (o.to === null || d <= o.to));

  const lambda = pick([1, 0.5, 0.25]);
  const finance: Finance = {
    pools,
    programmes,
    off,
    slope: 1,
    terms: { ...TEST_TERMS, lossOnExit: lambda }
  };

  // arrivals by day, by pool order then arrival order
  const arrivals = new Map<Day, { q: number; dollars: number }[]>();
  pools.forEach((p, q) => {
    if (p.uncapped) return;
    for (const fl of p.inflows) {
      const dollars = fl.kind === 'once' ? fl.dollars : fl.dollarsPerYear;
      for (const day of inflowArrivals(fl, asOf, horizon)) {
        const list = arrivals.get(day) ?? [];
        list.push({ q, dollars });
        arrivals.set(day, list);
      }
    }
  });
  for (const list of arrivals.values()) list.sort((a, b) => a.q - b.q);

  const poolOf = programmes.map((g) => pools.findIndex((p) => p.id === g.pool));
  const state: State[] = pools.map(() => ({
    received: 0,
    committed: 0,
    spentGrant: 0,
    outLoan: 0,
    lostLoan: 0,
    lostGuarantee: 0
  }));
  const available = (q: number) => {
    const s = state[q];
    return (
      pools[q].leverage * s.received -
      s.committed -
      s.spentGrant -
      s.outLoan -
      s.lostLoan -
      s.lostGuarantee
    );
  };
  const ledger: LedgerEvent[] = [];
  const emit = (day: Day, q: number, prog: number | null, kind: LedgerEvent['kind'], d: number) =>
    ledger.push({
      day,
      pool: pools[q].id,
      programme: prog === null ? null : programmes[prog].id,
      kind,
      dollars: d
    });

  const due = new Map<Day, Due[]>();
  let projects = 0;

  for (let day = asOf; day <= horizon; day++) {
    // 1. inflows, skipping a pool's arrival on a day it is off
    for (const a of arrivals.get(day) ?? []) {
      if (isOff(a.q, day) || a.dollars === 0) continue;
      state[a.q].received += a.dollars;
      emit(day, a.q, null, 'in', a.dollars);
    }

    // 2. money events of projects awarded before today, in the engine's order
    const list = due.get(day) ?? [];
    list.sort(
      (x, y) => x.project - y.project || x.order - y.order || x.prog - y.prog || x.sub - y.sub
    );
    for (const e of list) {
      const s = state[e.pool];
      switch (e.kind) {
        case 'spend':
          s.committed -= e.dollars;
          if (e.instr === 'grant') s.spentGrant += e.dollars;
          else s.outLoan += e.dollars;
          break;
        case 'repay':
          s.outLoan -= e.dollars;
          break;
        case 'loss':
          if (e.instr === 'loan') {
            s.outLoan -= e.dollars;
            s.lostLoan += e.dollars;
          } else if (e.instr === 'guarantee') s.lostGuarantee += e.dollars;
          break;
        case 'release':
          s.committed -= e.dollars;
          break;
      }
      emit(day, e.pool, e.prog, e.kind, e.dollars);
    }

    // 3. awards: off is ignored on purpose (M1); every capped pool asked must cover its ask
    const tries = r() < 0.05 ? int(1, 2) : 0;
    for (let t = 0; t < tries && programmes.length > 0; t++) {
      const set = shuffle(programmes.map((_, k) => k))
        .slice(0, int(1, Math.min(3, programmes.length)))
        .sort((a, b) => a - b);
      const items = set.map((prog) => {
        const instr = programmes[prog].instrument.kind;
        const Q = int(10, 400) * 10_000;
        const amount = instr === 'guarantee' ? Math.round(Q * 0.5) : int(5, 200) * 10_000;
        return { prog, pool: poolOf[prog], instr, amount, Q };
      });
      const asks = new Map<number, number>();
      for (const it of items) asks.set(it.pool, (asks.get(it.pool) ?? 0) + it.amount);
      const ok = [...asks].every(([q, ask]) => pools[q].uncapped || available(q) >= ask);
      if (!ok) continue;

      const project = projects++;
      const outcome = pick(OUTCOMES);
      const construction =
        outcome === 'exitBefore' || (outcome === 'open' && r() < 0.5) ? null : day + int(1, 400);
      const end =
        outcome === 'open'
          ? null
          : outcome === 'exitBefore'
            ? day + int(1, 400)
            : construction! + int(0, 600);
      const put = (
        at: Day | null,
        it: (typeof items)[number],
        kind: Due['kind'],
        dollars: number,
        order: number = ORDER[kind]
      ) => {
        if (at === null || at > horizon || dollars === 0) return;
        const list = due.get(at) ?? [];
        list.push({
          project,
          order,
          prog: it.prog,
          sub: kind === 'loss' ? 1 : 0,
          pool: it.pool,
          kind,
          instr: it.instr,
          dollars
        });
        due.set(at, list);
      };
      for (const it of items) {
        state[it.pool].committed += it.amount;
        emit(day, it.pool, it.prog, 'commit', it.amount);
        if (it.instr === 'grant') {
          put(construction, it, 'spend', it.amount);
          if (outcome === 'exitAfter') put(end, it, 'loss', Math.round(lambda * it.amount));
          else if (outcome === 'exitBefore') put(end, it, 'release', it.amount);
        } else if (it.instr === 'loan') {
          put(construction, it, 'spend', it.amount);
          if (outcome === 'complete') put(end, it, 'repay', it.amount);
          else if (outcome === 'exitAfter') {
            const L = Math.round(lambda * it.amount);
            put(end, it, 'repay', it.amount - L);
            put(end, it, 'loss', L);
          } else if (outcome === 'exitBefore') put(end, it, 'release', it.amount);
        } else if (outcome === 'complete' || outcome === 'exitBefore') {
          put(end, it, 'release', it.amount);
        } else if (outcome === 'exitAfter') {
          // the guarantee's exit release sorts with the loss, ahead of it (release H, loss X)
          put(end, it, 'release', it.amount, ORDER.loss);
          put(end, it, 'loss', Math.min(Math.round(lambda * it.Q), it.amount));
        }
      }
    }
  }

  return { finance, ledger, asOf, horizon, months };
}
