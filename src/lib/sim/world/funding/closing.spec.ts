import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { miniFinance, withFederalYearly } from '$lib/sim/world/fixtures/mini-finance';
import type { LedgerEvent } from '$lib/sim/world/types';
import type { SimInput } from '$lib/sim/world/input/types';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Pool, Programme } from '$lib/timelapse/types';
import { emptyWorld } from '../columns';
import { monthFirstDay, monthLastDay, monthOfDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { miniDoc, span } from '../policy/test/fixtures';
import { staticsOf } from '../statics';
import { miniInput } from '../test/mini';
import { frameOf, oneFrame } from '../test/timeline';
import { NO_DAY, type FundingSystem, type StepSink, type World } from '../types';
import { withFunding } from '../world';
import {
  INSTR_GUARANTEE,
  INSTR_LOAN,
  addShutRow,
  fundOf,
  initFunding,
  reopenPool
} from './columns';
import { closeSpent, closedTimeline, lastArrivalOf, spentAmong } from './closing';
import { frameMoney } from './frame-money';
import { availableOf } from './pools';
import { serveLine } from './serve';
import { createFundingSystem } from './system';
import {
  CLOSE_GRANT,
  CLOSE_POOL,
  closePool,
  closingPolicy,
  fundedMini,
  moneyTimeline,
  oneMoneyTimeline,
  replanAt,
  runFunded,
  type MonthEvent
} from './test/fixtures';

const asOf = fundedMini().asOf;

const pool = (inflows: Inflow[]): Pool => ({
  id: 'p',
  kind: 'generalRevenue',
  label: 'p',
  inflows,
  debt: null,
  leverage: 1
});

describe('lastArrivalOf', () => {
  const y = (from: Day, to: Day | null, d = 1e6): Inflow => ({
    kind: 'yearly',
    from,
    to,
    dollarsPerYear: d
  });
  const once = (day: Day, d = 1e6): Inflow => ({ kind: 'once', day, dollars: d });
  it('reads each inflow kind', () => {
    expect(lastArrivalOf(pool([once(asOf + 100)]), asOf)).toBe(asOf + 100);
    expect(lastArrivalOf(pool([y(dayFromUtc(2027, 3, 15), dayFromUtc(2030, 6, 1))]), asOf)).toBe(
      dayFromUtc(2030, 3, 15)
    );
    expect(lastArrivalOf(pool([y(dayFromUtc(2027, 3, 15), dayFromUtc(2090, 1, 1))]), asOf)).toBe(
      dayFromUtc(2089, 3, 15)
    );
    expect(lastArrivalOf(pool([y(asOf, null)]), asOf)).toBeNull();
    expect(lastArrivalOf(pool([y(asOf, null, 0), once(asOf + 50)]), asOf)).toBe(asOf + 50);
    expect(lastArrivalOf(pool([y(dayFromUtc(2028, 2, 29), dayFromUtc(2031, 12, 31))]), asOf)).toBe(
      dayFromUtc(2031, 2, 28)
    );
    expect(lastArrivalOf(pool([once(asOf - 1)]), asOf)).toBe(NO_DAY);
    expect(lastArrivalOf(pool([]), asOf)).toBe(NO_DAY);
    expect(lastArrivalOf(pool([once(asOf + 10, 0)]), asOf)).toBe(NO_DAY);
    expect(
      lastArrivalOf(pool([once(asOf + 900), once(asOf + 300), y(asOf, asOf + 400)]), asOf)
    ).toBe(asOf + 900);
  });
  it('is memoised per pool and start', () => {
    const p = pool([once(asOf + 5)]);
    expect(lastArrivalOf(p, asOf)).toBe(asOf + 5);
    expect(lastArrivalOf(p, asOf + 10)).toBe(NO_DAY);
    expect(lastArrivalOf(p, asOf)).toBe(asOf + 5);
    p.inflows.push(once(asOf + 99)); // a change the memo does not see
    expect(lastArrivalOf(p, asOf)).toBe(asOf + 5);
  });
});

describe('closedTimeline', () => {
  const prog = (id: string, poolId: string): Programme => ({
    ...miniFinance(asOf).programmes[0],
    id,
    pool: poolId
  });
  const input = fundedMini({
    ...miniFinance(asOf),
    pools: ['a', 'b'].map((id) => ({
      ...pool([{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 1e6 }]),
      id
    })),
    programmes: [prog('a-1', 'a'), prog('a-2', 'a'), prog('b-1', 'b')],
    off: []
  });
  const base = oneMoneyTimeline(input, input.finance!);
  const fundOf2 = (ids: string[]) => {
    const w = emptyWorld(0);
    initFunding(w, ids);
    return fundOf(w).pools;
  };
  const offeredIds = (f: PolicyFrame): string[] =>
    f.finance!.programmes.filter((_, i) => f.finance!.offered[i] === 1).map((g) => g.id);

  it('is the base itself with no closing', () => {
    expect(closedTimeline(base, fundOf2(['a', 'b']), asOf)).toBe(base);
  });
  it('drops the closed pool from month 5 and only it', () => {
    const pools = fundOf2(['a', 'b']);
    addShutRow(pools, 0, monthFirstDay(asOf, 5));
    const v = closedTimeline(base, pools, asOf);
    expect(v.frameAt(4)).toBe(base.frameAt(4));
    const f = v.frameAt(5);
    expect(f.id).not.toBe(base.frameAt(5).id);
    expect(offeredIds(f)).toEqual(['b-1']);
    expect(f.finance!.pools).toBe(base.frameAt(5).finance!.pools);
    expect(f.finance!.arrivals).toBe(base.frameAt(5).finance!.arrivals);
    expect(v.frameAt(6).id).toBe(f.id);
    expect(v.changes()).toEqual([...new Set([...base.changes(), 5])].sort((x, y) => x - y));
    expect(v.touched(5)).toEqual(new Int32Array(0));
    expect(closedTimeline(base, pools, asOf)).toBe(v);
  });
  it('changes() is stable over a base that hands out a new array each call', () => {
    const fresh: PolicyTimeline = { ...base, changes: () => [...base.changes()] };
    const pools = fundOf2(['a', 'b']);
    addShutRow(pools, 0, monthFirstDay(asOf, 5));
    const v = closedTimeline(fresh, pools, asOf);
    const first = v.changes();
    expect(first).toEqual([5]);
    expect(v.changes()).toBe(first);
    v.touched(5);
    expect(v.changes()).toBe(first);
  });
  it('holds the opening month in changes()', () => {
    const pools = fundOf2(['a', 'b']);
    addShutRow(pools, 0, monthFirstDay(asOf, 5));
    reopenPool(pools, 0, monthFirstDay(asOf, 9));
    const v = closedTimeline(base, pools, asOf);
    expect(v.frameAt(9)).toBe(base.frameAt(9));
    expect(v.changes()).toEqual(expect.arrayContaining([5, 9]));
  });
  it('a view is a snapshot', () => {
    const pools = fundOf2(['a', 'b']);
    addShutRow(pools, 0, monthFirstDay(asOf, 5));
    const v = closedTimeline(base, pools, asOf);
    const at7 = v.frameAt(7);
    addShutRow(pools, 1, monthFirstDay(asOf, 7));
    expect(v.frameAt(7)).toBe(at7);
    const w = closedTimeline(base, pools, asOf);
    expect(w).not.toBe(v);
    expect(offeredIds(w.frameAt(7))).toEqual([]);
  });
  it('two histories over one base', () => {
    const p1 = fundOf2(['a', 'b']);
    const p2 = fundOf2(['a', 'b']);
    addShutRow(p1, 0, monthFirstDay(asOf, 5));
    addShutRow(p2, 1, monthFirstDay(asOf, 5));
    const v1 = closedTimeline(base, p1, asOf);
    const v2 = closedTimeline(base, p2, asOf);
    expect(offeredIds(v1.frameAt(5))).toEqual(['b-1']);
    expect(offeredIds(v2.frameAt(5))).toEqual(['a-1', 'a-2']);
    expect(closedTimeline(base, p1, asOf)).toBe(v1);
    expect(closedTimeline(base, p2, asOf)).toBe(v2);
  });
  it('a closed pool the frame does not hold is skipped and not listed', () => {
    const p = fundOf2(['a', 'b', 'gone']);
    addShutRow(p, 2, monthFirstDay(asOf, 5));
    addShutRow(p, 0, monthFirstDay(asOf, 6));
    const v = closedTimeline(base, p, asOf);
    expect(v.frameAt(5)).toBe(base.frameAt(5));
    expect(offeredIds(v.frameAt(6))).toEqual(['b-1']);
    expect(v.changes()).toEqual([6]);
  });
  it('keeps only the last eight views of a base', () => {
    const first = fundOf2(['a', 'b']);
    addShutRow(first, 0, monthFirstDay(asOf, 2));
    const v0 = closedTimeline(base, first, asOf);
    for (let k = 3; k < 12; k++) {
      const p = fundOf2(['a', 'b']);
      addShutRow(p, 0, monthFirstDay(asOf, k));
      closedTimeline(base, p, asOf);
    }
    expect(closedTimeline(base, first, asOf)).not.toBe(v0);
  });
});

describe('withFunding and the closing hooks', () => {
  it('step runs under beforeStep and planDue under timelineOf', () => {
    const input = fundedMini();
    const statics = staticsOf(input);
    const base = oneMoneyTimeline(input, input.finance!);
    const other = replanAt(base, 3);
    const seen: PolicyTimeline[] = [];
    const asked: number[] = [];
    const sys: FundingSystem = {
      ...createFundingSystem(),
      beforeStep: (w, _s, t) => {
        expect(t).toBe(base);
        asked.push(w.month);
        return other;
      },
      timelineOf: (_w, _s, t) => {
        expect(t).toBe(base);
        return other;
      },
      serve: (ctx) => {
        seen.push(ctx.timeline);
      }
    };
    const core = withFunding(sys);
    const out = { event() {} };
    const w = core.createWorld(statics, base, 1, out);
    const due = core.planDue(w, statics, base, 1, 4);
    for (let m = 1; m <= 4; m++) core.step(w, due, statics, base, 1, out);
    expect(asked).toEqual([0, 1, 2, 3]);
    expect(seen).toEqual([other, other, other, other]);
  });
});

// Spent pools close (spec sec-design-spent), on the mini city with its money. Test values.

/** Enough for one affordable project on the mini city: its first award on the pool asks 2,713,804. */
const ONE_PROJECT = 3_000_000;
/** A seed whose project paid by CLOSE_POOL (on SOLO, `releaseDoc`) exits before construction after D. */
const RELEASE_SEED = 3;
const once = (day: Day, dollars: number): Inflow => ({ kind: 'once', day, dollars });

/** The mini money's guarantee needs `guaranteeRateCut` once money levers are in force. */
const TERMS: Policy = {
  id: 'terms',
  label: 'terms',
  preset: null,
  on: true,
  where: { tag: 'terms' },
  spans: [span(asOf, 1, null, { tag: 'terms', terms: { guaranteeRateCut: 0.01 } })]
};

/** A money document on the mini city: `policies` with TERMS. */
const docOf = (...policies: Policy[]): SimPolicy4 => miniDoc(...policies, TERMS);

/** One span from month 1, one `once` inflow of ONE_PROJECT in month 2. */
const closingDocA = docOf(
  closingPolicy(asOf, [{ from: 1, to: null, inflows: [once(monthFirstDay(asOf, 2), ONE_PROJECT)] }])
);

/** `p` with each programme of every span changed by `f`. */
function mapProgrammes(p: Policy, f: (g: Programme) => Programme): Policy {
  return {
    ...p,
    spans: p.spans.map((s) =>
      s.what.tag === 'fund'
        ? { ...s, what: { ...s.what, programmes: s.what.programmes.map(f) } }
        : s
    )
  };
}
const withMinHomes = (p: Policy, n: number): Policy =>
  mapProgrammes(p, (g) => ({ ...g, minHomes: n }));

/**
 * The mini city whose own money offers nothing: CLOSE_POOL's programmes are the only ones, so an
 * application's money is CLOSE_POOL's alone. (On `fundedMini()` the city's grants make every
 * affordable project certain, so none exits before construction, and they pay where
 * CLOSE_POOL's credit would.)
 */
const SOLO: SimInput = fundedMini({ ...miniFinance(asOf), programmes: [] });

/** On SOLO: CLOSE_GRANT at share 0.5 (an uncertain project can exit), ONE_PROJECT in month 2. */
const releaseDoc = docOf(
  mapProgrammes(
    closingPolicy(asOf, [
      { from: 1, to: null, inflows: [once(monthFirstDay(asOf, 2), ONE_PROJECT)] }
    ]),
    (g) => ({ ...g, instrument: { kind: 'grant', share: 0.5 } })
  )
);

/** CLOSE_POOL's grant asks no lot: its `minHomes` is above every lot's size. */
const unaskedDoc = docOf(
  withMinHomes(
    closingPolicy(asOf, [
      { from: 1, to: null, inflows: [once(monthFirstDay(asOf, 2), ONE_PROJECT)] }
    ]),
    1_000_000
  )
);
/** CLOSE_POOL's one arrival pays every ask through the horizon. */
const richDoc = docOf(
  closingPolicy(asOf, [{ from: 1, to: null, inflows: [once(monthFirstDay(asOf, 2), 1e9)] }])
);

interface Waiting {
  lot: number;
  kind: number;
  bundle: string;
}

interface ShutRow {
  id: string;
  from: Day;
  to: Day;
}

/** What `closing` records after each month (index m), month 0 empty. */
interface Closing {
  world: World;
  /** The shut rows after month m, in row order. */
  shutAfter(m: number): ShutRow[];
  /** `shutN` after month m. */
  shutNAfter(m: number): number;
  /** The programmes offered by the frame the world stepped month m under (`beforeStep`'s view). */
  offeredAt(m: number): string[];
  events: MonthEvent[];
  ledger: LedgerEvent[];
  /** The month whose step closed pool `id` first; throws when it never closed. */
  closedAt(id: string): number;
  /** The first day pool `id` was closed (its first shut row), or NO_DAY. */
  closedDayOf(id: string): Day;
  /** CLOSE_POOL's `closedDay` after month m. */
  closedDayAfter(m: number): Day;
  /** Waiting rows after month m whose bundle holds programme `prog`. */
  waitingWith(m: number, prog: string): number;
  /** The waiting rows after month m. */
  waitingAt(m: number): Waiting[];
  /** The spell day of (lot, kind) after month m, NO_DAY when none. */
  spellAt(m: number, lot: number, kind: number): Day;
  /** The spell day `remakeRow` writes for a lapse in month m: the day before its first day. */
  respellDay(m: number): Day;
  /** CLOSE_POOL's available money after month m. */
  availableAfter(m: number): number;
  /** The last month that ended with a money row of pool `id` and that instrument; throws when none. */
  lastMonthWithRow(id: string, instr: 'loan' | 'guarantee'): number;
}

/**
 * The mini city with its federal pool at 20,000,000 a year: every pool of an affordable bundle
 * runs short at times, so applications wait on the line (rule 16 as amended awards on whatever
 * pool can pay, so a short CLOSE_POOL alone keeps no one waiting).
 */
const capped = (asOf: Day) => withFederalYearly(miniFinance(asOf), asOf, 20_000_000);
const MINI = fundedMini(capped(asOf));

function closing(
  doc: SimPolicy4,
  through: number,
  opts: { seed?: number; poolClosing?: boolean; system?: FundingSystem; input?: SimInput } = {}
): Closing {
  const input = opts.input ?? MINI;
  const closedBy: Map<string, Day>[] = [new Map()];
  const waiting: Waiting[][] = [[]];
  const spells: Map<string, Day>[] = [new Map()];
  const avail: number[] = [0];
  const credit: Set<string>[] = [new Set()];
  const shut: ShutRow[][] = [[]];
  const offered: string[][] = [[]];
  const sys = opts.system ?? createFundingSystem({ poolClosing: opts.poolClosing });
  const system: FundingSystem = {
    ...sys,
    beforeStep(w, s, t) {
      const v = sys.beforeStep ? sys.beforeStep(w, s, t) : t;
      const fin = v.frameAt(w.month + 1).finance;
      offered.push(
        fin === null ? [] : fin.programmes.filter((_, i) => fin.offered[i] === 1).map((g) => g.id)
      );
      return v;
    }
  };
  const r = runFunded(staticsOf(input), moneyTimeline(input, doc), opts.seed ?? 1, through, {
    system,
    afterStep(w) {
      if (!('shutN' in w.pools)) {
        closedBy.push(new Map());
        waiting.push([]);
        spells.push(new Map());
        avail.push(0);
        credit.push(new Set());
        shut.push([]);
        return;
      }
      const { line, pools } = fundOf(w);
      const shutRows: ShutRow[] = [];
      for (let k = 0; k < pools.shutN; k++) {
        const id = pools.id[pools.shutRow[k]];
        shutRows.push({ id, from: pools.shutFrom[k], to: pools.shutTo[k] });
      }
      shut.push(shutRows);
      closedBy.push(new Map(pools.id.slice(0, pools.n).map((id, q) => [id, pools.closedDay[q]])));
      const rows: Waiting[] = [];
      for (let i = 0; i < line.n; i++)
        if (line.gone[i] === 0)
          rows.push({ lot: line.lot[i], kind: line.kind[i], bundle: line.bundle[i] });
      waiting.push(rows);
      const sp = new Map<string, Day>();
      for (let i = 0; i < line.spellN; i++)
        sp.set(`${line.spellLot[i]}|${line.spellKind[i]}`, line.spellR[i]);
      spells.push(sp);
      const q = pools.id.indexOf(CLOSE_POOL);
      avail.push(q < 0 || q >= pools.n ? 0 : availableOf(pools, q, closePool([])));
      const held = new Set<string>();
      for (let k = 0; k < pools.mN; k++) {
        const instr = pools.mInstr[k];
        if (instr === INSTR_LOAN) held.add(`${pools.mPool[k]}|loan`);
        if (instr === INSTR_GUARANTEE) held.add(`${pools.mPool[k]}|guarantee`);
      }
      credit.push(held);
    }
  });
  return {
    ...r,
    shutAfter: (m) => shut[m],
    shutNAfter: (m) => shut[m].length,
    offeredAt: (m) => offered[m],
    closedAt(id) {
      for (let m = 1; m <= through; m++) {
        const d = closedBy[m].get(id);
        if (d !== undefined && d !== NO_DAY) return m;
      }
      throw new Error(`closing: pool ${id} never closed`);
    },
    closedDayOf(id) {
      const { pools } = fundOf(r.world);
      for (let i = 0; i < pools.shutN; i++)
        if (pools.id[pools.shutRow[i]] === id) return pools.shutFrom[i];
      return NO_DAY;
    },
    closedDayAfter: (m) => closedBy[m].get(CLOSE_POOL) ?? NO_DAY,
    waitingWith: (m, prog) => waiting[m].filter((w) => w.bundle.split(',').includes(prog)).length,
    waitingAt: (m) => waiting[m],
    spellAt: (m, lot, kind) => spells[m].get(`${lot}|${kind}`) ?? NO_DAY,
    respellDay: (m) => monthFirstDay(asOf, m) - 1,
    availableAfter: (m) => avail[m],
    lastMonthWithRow(id, instr) {
      for (let m = through; m >= 1; m--) if (credit[m].has(`${id}|${instr}`)) return m;
      throw new Error(`closing: no ${instr} money row of pool ${id}`);
    }
  };
}

const commitsOn = (ledger: readonly LedgerEvent[], pool: string): number =>
  ledger.filter((e) => e.kind === 'commit' && e.pool === pool).length;

/** Every line column of the waiting rows (gone 0), row by row. */
function waitingRows(world: World): Record<string, unknown>[] {
  const { line } = fundOf(world);
  const cols = [
    'lot', 'kind', 'month', 'applied', 'keyDay', 'key', 'bundle', 'f', 'units', 'stories', 'level',
    'viewMonth', 'gone', 'seq'
  ] as const; // prettier-ignore
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < line.n; i++)
    if (line.gone[i] === 0) out.push(Object.fromEntries(cols.map((c) => [c, line[c][i]])));
  return out;
}

/** The baseline pool of the baseline case: one arrival of ONE_PROJECT in month 2. */
const B_POOL = 'b-close';
/** The months the switched-off comparison runs: only the case's pool closes in them. */
const CASE_MONTHS = 24;

const baselineInput: SimInput = (() => {
  const fin = capped(asOf);
  return fundedMini({
    ...fin,
    pools: [
      ...fin.pools,
      { ...closePool([once(monthFirstDay(asOf, 2), ONE_PROJECT)]), id: B_POOL, label: B_POOL }
    ],
    programmes: [
      ...fin.programmes,
      {
        ...fin.programmes[0],
        id: 'b-close-grant',
        label: 'b-close-grant',
        pool: B_POOL,
        instrument: { kind: 'grant', share: 1 }
      }
    ]
  });
})();

/**
 * `which`'s pool (`B_POOL` baseline, `CLOSE_POOL` added) run CASE_MONTHS months: with
 * `offFrom`, switched off from that day by policy (baseline scale 0; the added pool's span ending
 * the day before).
 */
function runCase(
  which: 'baseline' | 'added',
  opts: { poolClosing: boolean; offFrom?: Day }
): Closing & { pool: string } {
  const D = opts.offFrom;
  if (which === 'baseline') {
    const off: Policy[] =
      D === undefined
        ? []
        : [
            {
              id: 'off',
              label: 'off',
              preset: null,
              on: true,
              where: { tag: 'baseline' },
              spans: [
                span(asOf, 1, null, {
                  tag: 'scales',
                  entries: [{ pool: B_POOL, from: D, scale: 0 }]
                })
              ]
            }
          ];
    const r = closing(docOf(...off), CASE_MONTHS, {
      poolClosing: opts.poolClosing,
      input: baselineInput
    });
    return { ...r, pool: B_POOL };
  }
  const to = D === undefined ? null : monthOfDay(asOf, D) - 1;
  const doc = docOf(
    closingPolicy(asOf, [{ from: 1, to, inflows: [once(monthFirstDay(asOf, 2), ONE_PROJECT)] }])
  );
  return { ...closing(doc, CASE_MONTHS, { poolClosing: opts.poolClosing }), pool: CLOSE_POOL };
}

describe('closeSpent: a spent pool closes', () => {
  it('spent: closes from the first day of the month after an application finds it short', () => {
    const arrive = monthFirstDay(asOf, 3) + 4;
    const r = closing(
      docOf(closingPolicy(asOf, [{ from: 1, to: null, inflows: [once(arrive, ONE_PROJECT)] }])),
      120
    );
    const { pools } = fundOf(r.world);
    const q = pools.id.indexOf(CLOSE_POOL);
    expect(commitsOn(r.ledger, CLOSE_POOL)).toBe(1); // enough for one project
    // One closing of it (any other pool's closing has its own row).
    const rows = Array.from(pools.shutRow.subarray(0, pools.shutN));
    expect(rows.filter((x) => x === q)).toHaveLength(1);
    const k = rows.indexOf(q);
    const m = r.closedAt(CLOSE_POOL); // the month whose step set closedDay
    expect(m).toBeGreaterThan(monthOfDay(asOf, arrive));
    expect(pools.closedDay[q]).toBe(monthLastDay(asOf, m) + 1);
    expect([pools.shutRow[k], pools.shutFrom[k], pools.shutTo[k]]).toEqual([
      q,
      monthLastDay(asOf, m) + 1,
      NO_DAY
    ]);
  });

  it('in the arrival month a short application closes nothing', () => {
    const arrive = monthFirstDay(asOf, 6);
    const r = closing(
      docOf(closingPolicy(asOf, [{ from: 1, to: null, inflows: [once(arrive, 1)] }])),
      24
    );
    expect(r.waitingWith(6, CLOSE_GRANT)).toBeGreaterThan(0); // short in month 6: 1 dollar
    expect(r.closedDayAfter(6)).toBe(NO_DAY);
    expect(r.closedAt(CLOSE_POOL)).toBeGreaterThanOrEqual(7);
  });

  it.each(['loan', 'guarantee'] as const)('a %s money row holds the pool open', (extra) => {
    const r = closing(
      docOf(
        closingPolicy(
          asOf,
          // Twice ONE_PROJECT: lots apply one at a time (R2), and seed 1's first application with
          // the extra instrument asks more than ONE_PROJECT.
          [{ from: 1, to: null, inflows: [once(monthFirstDay(asOf, 2), 2 * ONE_PROJECT)] }],
          extra
        )
      ),
      240,
      { input: SOLO }
    );
    const last = r.lastMonthWithRow(CLOSE_POOL, extra); // end-of-month money rows of that instrument
    expect(last).toBeGreaterThan(2);
    expect(fundOf(r.world).pools.shutN).toBeGreaterThan(0);
    expect(r.closedAt(CLOSE_POOL)).toBeGreaterThan(last); // throws when it never closed
  });

  it('past its last arrival and asked by no one, or able to pay every ask, it stays open', () => {
    const unasked = closing(unaskedDoc, 120);
    const rich = closing(richDoc, 120);
    // CLOSE_POOL has no shut row.
    for (const r of [unasked, rich]) expect(r.closedDayOf(CLOSE_POOL)).toBe(NO_DAY);
    // Not vacuous. Unasked: applications waited after the last arrival (month 2), none on it.
    let waited = 0;
    for (let m = 3; m <= 120; m++) {
      waited += unasked.waitingAt(m).length;
      expect(unasked.waitingWith(m, CLOSE_GRANT)).toBe(0);
    }
    expect(waited).toBeGreaterThan(0);
    // Rich: it paid projects, and its money is left at the horizon.
    expect(commitsOn(rich.ledger, CLOSE_POOL)).toBeGreaterThan(1);
    expect(rich.availableAfter(120)).toBeGreaterThan(0);
    for (let m = 3; m <= 120; m++) expect(rich.waitingWith(m, CLOSE_GRANT)).toBe(0);
  });

  it('a yearly inflow with no end never closes, however short', () => {
    const r = closing(
      docOf(
        closingPolicy(asOf, [
          {
            from: 1,
            to: null,
            inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 1 }]
          }
        ])
      ),
      120
    );
    expect(r.waitingWith(60, CLOSE_GRANT)).toBeGreaterThan(0);
    expect(r.closedDayOf(CLOSE_POOL)).toBe(NO_DAY);
  });

  it.each(['baseline', 'added'] as const)(
    'closing is switching the pool off from D (%s pool)',
    (which) => {
      const a = runCase(which, { poolClosing: true });
      const P = a.pool;
      const D = a.closedDayOf(P);
      expect(D).not.toBe(NO_DAY);
      // Only P closed in the months compared.
      expect(fundOf(a.world).pools.shutN).toBe(1);
      const mD = monthOfDay(asOf, D);
      const b = runCase(which, { poolClosing: false, offFrom: D });
      expect(fundOf(b.world).pools.shutN).toBe(0);
      const from = (ev: MonthEvent[]) => ev.filter((e) => e.month >= mD);
      expect(from(a.events).length).toBeGreaterThan(0);
      expect(from(a.events)).toEqual(from(b.events));
      expect(a.ledger.filter((e) => e.day >= D)).toEqual(b.ledger.filter((e) => e.day >= D));
      expect(waitingRows(a.world)).toEqual(waitingRows(b.world));
    }
  );

  it('in the closing month every row on P is re-made without it or lapses', () => {
    const r = closing(closingDocA, 120);
    const mD = monthOfDay(asOf, r.closedDayOf(CLOSE_POOL));
    const before = r.waitingAt(mD - 1).filter((w) => w.bundle.split(',').includes(CLOSE_GRANT));
    expect(before.length).toBeGreaterThan(0);
    for (const w of before) {
      const now = r.waitingAt(mD).find((x) => x.lot === w.lot && x.kind === w.kind);
      if (now) expect(now.bundle.split(',')).not.toContain(CLOSE_GRANT);
      else expect(r.spellAt(mD, w.lot, w.kind)).toBe(r.respellDay(mD)); // remakeRow's lapse
    }
    for (let m = mD; m <= 120; m++)
      for (const w of r.waitingAt(m)) expect(w.bundle.split(',')).not.toContain(CLOSE_GRANT);
    expect(
      r.ledger.some(
        (e) => e.kind === 'commit' && e.pool === CLOSE_POOL && e.day >= r.closedDayOf(CLOSE_POOL)
      )
    ).toBe(false);
  });

  it('money returned to a closed pool stays in it', () => {
    const r = closing(releaseDoc, 240, { seed: RELEASE_SEED, input: SOLO });
    const D = r.closedDayOf(CLOSE_POOL);
    const release = r.ledger.find(
      (e) => e.kind === 'release' && e.pool === CLOSE_POOL && e.day >= D
    );
    expect(release).toBeDefined();
    const m = monthOfDay(asOf, release!.day);
    expect(r.availableAfter(m)).toBeGreaterThan(r.availableAfter(m - 1));
    expect(r.ledger.some((e) => e.kind === 'commit' && e.pool === CLOSE_POOL && e.day >= D)).toBe(
      false
    );
    const { pools } = fundOf(r.world);
    expect(pools.closedDay[pools.id.indexOf(CLOSE_POOL)]).toBe(D);
  });

  it('poolClosing false: no shut row; an application waits on a spent pool to the horizon', () => {
    const r = closing(closingDocA, 48, { poolClosing: false });
    expect(fundOf(r.world).pools.shutN).toBe(0);
    expect(r.waitingWith(48, CLOSE_GRANT)).toBeGreaterThan(0);
    // With closing on, the same document has no application on it by then.
    expect(closing(closingDocA, 48).waitingWith(48, CLOSE_GRANT)).toBe(0);
  });

  it('grouped serving and the direct scan give the same closings and events', () => {
    const direct: FundingSystem = {
      ...createFundingSystem(),
      serve: (ctx) => serveLine(ctx, { grouped: false, closing: true })
    };
    const a = closing(closingDocA, 120);
    const b = closing(closingDocA, 120, { system: direct });
    expect(fundOf(a.world).pools.shutN).toBeGreaterThan(0);
    expect(b.events).toEqual(a.events);
    expect(b.ledger).toEqual(a.ledger);
    expect(structuredClone(b.world)).toEqual(structuredClone(a.world));
  });

  it('a pool with no programme on offer past its last arrival is no candidate: no line scan', () => {
    // CLOSE_POOL is asked by no one through month T (as `unaskedDoc`), then its policy ends: the
    // pool stays in the frame, past its last arrival, with nothing offered. The mini money runs
    // without its market loan, so m-bank, the other pool past its last arrival, offers nothing
    // either (with the finite odds at full coverage it no longer runs out before T).
    const T = 36;
    const doc = docOf(
      withMinHomes(
        closingPolicy(asOf, [
          { from: 1, to: T, inflows: [once(monthFirstDay(asOf, 2), ONE_PROJECT)] }
        ]),
        1_000_000
      )
    );
    const scanned = new Set<number>();
    const system: FundingSystem = {
      ...createFundingSystem(),
      serve(ctx) {
        serveLine(ctx, { grouped: true, closing: false });
        const fm = frameMoney(ctx.timeline, ctx.frame);
        const read = fm.bundleIds;
        fm.bundleIds = (ids) => {
          scanned.add(ctx.month);
          return read(ids);
        };
        try {
          closeSpent(ctx);
        } finally {
          fm.bundleIds = read;
        }
      }
    };
    const fin = capped(asOf);
    const noLoan = fundedMini({
      ...fin,
      programmes: fin.programmes.filter((g) => g.id !== 'm-bank-loan')
    });
    const r = closing(doc, 120, { system, input: noLoan });
    expect(r.closedDayOf(CLOSE_POOL)).toBe(NO_DAY);
    // Not vacuous: applications wait on the line after T, and closeSpent scanned it before.
    let waited = 0;
    for (let m = T + 1; m <= 120; m++) waited += r.waitingAt(m).length;
    expect(waited).toBeGreaterThan(0);
    expect([...scanned].some((m) => m <= T)).toBe(true);
    expect([...scanned].filter((m) => m > T)).toEqual([]);
  });

  // Review Focus 2
  it('a world without money steps under its own timeline', () => {
    const input = miniInput();
    const t = oneFrame(frameOf(input)); // finance null in every month
    const r = runFunded(staticsOf(input), t, 1, 24);
    expect('shutN' in r.world.pools).toBe(false);
    expect(r.world.month).toBe(24);
  });
});

// A closed pool opens on a new arrival (spec sec-design-reopen); edits, rewind and copies
// (sec-design-edit). On SOLO, where CLOSE_POOL is the only money and m-bank never closes, the shut
// rows are CLOSE_POOL's alone.

/** The second span's first month: after CLOSE_POOL's closing under one span (test value). */
const S2 = 60;
/** One span from month 1: ONE_PROJECT in month 2. */
const singleSpanInflows = [once(monthFirstDay(asOf, 2), ONE_PROJECT)];
const singleSpanDoc = docOf(
  closingPolicy(asOf, [{ from: 1, to: null, inflows: singleSpanInflows }])
);
/** Span 1 as `singleSpanDoc` to month S2 - 1; span 2 from S2 with ONE_PROJECT on its fourth day. */
const twoSpanDoc = docOf(
  closingPolicy(asOf, [
    { from: 1, to: S2 - 1, inflows: [once(monthFirstDay(asOf, 2), ONE_PROJECT)] },
    { from: S2, to: null, inflows: [once(monthFirstDay(asOf, S2) + 3, ONE_PROJECT)] }
  ])
);

/** Every event and ledger entry a sink is sent, each event with its month. */
function recorder(): { out: StepSink; events: MonthEvent[]; month: { m: number } } {
  const events: MonthEvent[] = [];
  const month = { m: 0 };
  const out: StepSink = { event: (e) => events.push({ ...e, month: month.m }), ledger() {} };
  return { out, events, month };
}

/**
 * On `input`: months 1..k stepped under `a`'s timeline, then k+1..through under `b`'s, on one due
 * list planned under `a`'s at the start (the ensemble's `keep`).
 */
function stepThenKeep(
  a: SimPolicy4,
  b: SimPolicy4,
  k: number,
  through: number,
  input: SimInput = SOLO
): World {
  const statics = staticsOf(input);
  const ta = moneyTimeline(input, a);
  const tb = moneyTimeline(input, b);
  const core = withFunding(createFundingSystem());
  const { out } = recorder();
  const w = core.createWorld(statics, ta, 1, out);
  const due = core.planDue(w, statics, ta, 1, through);
  for (let m = 1; m <= through; m++) core.step(w, due, statics, m <= k ? ta : tb, 1, out);
  return w;
}

/**
 * On MINI: a world stepped to month k, then cloned and the clone's due list planned with
 * `planDue`; both stepped on to `through`.
 */
function stepTwins(doc: SimPolicy4, k: number, through: number) {
  const statics = staticsOf(MINI);
  const t = moneyTimeline(MINI, doc);
  const core = withFunding(createFundingSystem());
  const a = recorder();
  const original = core.createWorld(statics, t, 1, a.out);
  const due = core.planDue(original, statics, t, 1, through);
  for (let m = 1; m <= k; m++) {
    a.month.m = m;
    core.step(original, due, statics, t, 1, a.out);
  }
  const clone = structuredClone(original);
  const cloneDue = core.planDue(clone, statics, t, 1, through);
  const b = recorder();
  for (let m = k + 1; m <= through; m++) {
    a.month.m = m;
    b.month.m = m;
    core.step(original, due, statics, t, 1, a.out);
    core.step(clone, cloneDue, statics, t, 1, b.out);
  }
  return { original, clone, originalEvents: a.events, cloneEvents: b.events };
}

/**
 * On SOLO, `twoSpanDoc` stepped to month k; `stub` is its timeline ready only through k (its frames
 * past k still read, so only the ready check holds a step back).
 */
function steppedClosed(k: number) {
  const statics = staticsOf(SOLO);
  const t = moneyTimeline(SOLO, twoSpanDoc);
  const core = withFunding(createFundingSystem());
  const { out } = recorder();
  const w = core.createWorld(statics, t, 1, out);
  const due = core.planDue(w, statics, t, 1, k + 1);
  for (let m = 1; m <= k; m++) core.step(w, due, statics, t, 1, out);
  const stub: PolicyTimeline = { ...t, readyThrough: () => k };
  return { core, w, due, statics, stub };
}

/** The shut rows of CLOSE_POOL in `world`. */
function closeRows(world: World): ShutRow[] {
  const { pools } = fundOf(world);
  const out: ShutRow[] = [];
  for (let k = 0; k < pools.shutN; k++)
    if (pools.id[pools.shutRow[k]] === CLOSE_POOL)
      out.push({ id: CLOSE_POOL, from: pools.shutFrom[k], to: pools.shutTo[k] });
  return out;
}

describe('reopenArrivals: a closed pool opens on its next arrival', () => {
  it("a closed pool opens in the month of its next span's arrival, and can close again", () => {
    const r = closing(twoSpanDoc, 240, { input: SOLO });
    const c = r.closedAt(CLOSE_POOL);
    expect(c).toBeLessThan(S2);
    expect(r.closedDayAfter(S2)).toBe(NO_DAY);
    expect(r.shutAfter(S2)[0]).toEqual({
      id: CLOSE_POOL,
      from: monthLastDay(asOf, c) + 1,
      to: monthFirstDay(asOf, S2)
    });
    expect(r.offeredAt(S2)).toContain(CLOSE_GRANT); // the frame the world stepped month S2 under
    expect(r.offeredAt(S2 - 1)).not.toContain(CLOSE_GRANT);
    const { pools } = fundOf(r.world);
    expect(pools.shutN).toBe(2);
    expect(pools.closedDay[pools.id.indexOf(CLOSE_POOL)]).toBe(pools.shutFrom[1]);
  });

  it('a pool found spent in month m and opened in month m + 1 keeps a row shutTo = shutFrom', () => {
    const c = closing(singleSpanDoc, 120, { input: SOLO }).closedAt(CLOSE_POOL);
    const doc = docOf(
      closingPolicy(asOf, [
        { from: 1, to: c, inflows: singleSpanInflows },
        { from: c + 1, to: null, inflows: [once(monthFirstDay(asOf, c + 1), ONE_PROJECT)] }
      ])
    );
    const r = closing(doc, c + 1, { input: SOLO });
    const day = monthFirstDay(asOf, c + 1);
    expect(r.closedDayAfter(c)).toBe(day);
    expect(r.shutAfter(c)).toEqual([{ id: CLOSE_POOL, from: day, to: NO_DAY }]);
    // The history only grows: the opening sets the row's shutTo and keeps it.
    expect(r.shutAfter(c + 1)).toEqual([{ id: CLOSE_POOL, from: day, to: day }]);
    expect(r.closedDayAfter(c + 1)).toBe(NO_DAY);
    // It closes no month: every month stepped offered its programme ...
    for (let k = 1; k <= c + 1; k++) expect(r.offeredAt(k)).toContain(CLOSE_GRANT);
    // ... and the closed view of the final world is the base, frame for frame, with no change
    // month added.
    const base = moneyTimeline(SOLO, doc);
    const view = closedTimeline(base, fundOf(r.world).pools, asOf);
    for (let k = 1; k <= c + 1; k++) expect(view.frameAt(k)).toBe(base.frameAt(k));
    expect(view.changes()).toEqual(base.changes());
  });

  it('an edit before the closing that gives a later arrival (keep) defers it', () => {
    const c = closing(singleSpanDoc, 120, { input: SOLO }).closedAt(CLOSE_POOL);
    const j = c + 6;
    const later = docOf(
      closingPolicy(asOf, [
        {
          from: 1,
          to: null,
          inflows: [...singleSpanInflows, once(monthFirstDay(asOf, j) + 2, ONE_PROJECT)]
        }
      ])
    );
    // Months 1..c-1 under singleSpanDoc's timeline, then c..120 under later's, one due list.
    const rows = closeRows(stepThenKeep(singleSpanDoc, later, c - 1, 120));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((x) => x.from >= monthFirstDay(asOf, j + 2))).toEqual(rows.map(() => true));
  });

  it('two runs of one seed give identical worlds; a clone after a closing steps on identically', () => {
    const a = closing(closingDocA, 120);
    const b = closing(closingDocA, 120);
    expect(structuredClone(b.world)).toEqual(structuredClone(a.world));
    expect(b.events).toEqual(a.events);
    const c = a.closedAt(CLOSE_POOL);
    const t = stepTwins(closingDocA, c, 120);
    expect(fundOf(t.original).pools.shutN).toBeGreaterThan(0);
    expect(structuredClone(t.clone)).toEqual(structuredClone(t.original));
    expect(t.cloneEvents.length).toBeGreaterThan(0);
    expect(t.cloneEvents).toEqual(t.originalEvents.filter((e) => e.month > c));
  });

  it('restore: a month-0 clone planned with planDue equals the world stepped straight', () => {
    const t = stepTwins(closingDocA, 0, 120);
    expect(fundOf(t.original).pools.shutN).toBeGreaterThan(0);
    expect(structuredClone(t.clone)).toEqual(structuredClone(t.original));
  });

  // Review Focus 4
  it('beforeStep past readyThrough leaves the world as it was', () => {
    const { core, w, due, statics, stub } = steppedClosed(S2 - 1);
    const { pools } = fundOf(w);
    expect(pools.closedDay[pools.id.indexOf(CLOSE_POOL)]).not.toBe(NO_DAY); // closed
    const before = structuredClone(w);
    expect(() => core.step(w, due, statics, stub, 1, { event() {} })).toThrow(RangeError);
    expect(structuredClone(w)).toEqual(before);
  });
});

describe('spentAmong: a pool is spent only when no waiting ask fits', () => {
  const money = new Map([[0, 100]]);
  it('one ask fits: open', () => {
    expect(spentAmong([new Map([[0, 150]]), new Map([[0, 80]])], money)).toEqual(new Set());
  });
  it('every ask is above: spent', () => {
    expect(spentAmong([new Map([[0, 150]]), new Map([[0, 120]])], money)).toEqual(new Set([0]));
  });
  it('an exact fit holds it open', () => {
    expect(spentAmong([new Map([[0, 150]]), new Map([[0, 100]])], money)).toEqual(new Set());
  });
  it('asked by no one: open', () => {
    expect(spentAmong([new Map([[1, 5]])], money)).toEqual(new Set());
  });
  it('a zero ask does not count as asking', () => {
    expect(spentAmong([new Map([[0, 0]]), new Map([[0, 120]])], money)).toEqual(new Set([0]));
  });
});
