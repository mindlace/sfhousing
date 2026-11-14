// The eligibility memo for lots with no row (perf), the `bundleOf` units array and the hoisted
// closures change no result. Events and ledger hash as recorded from the build before them
// (2026-11-13, at a7844ad1), with the memo on and off: synthCity seeds 1 and 2 (baseline money and
// the bench set) always; live 2026-11-10-6ee5a23d seeds 1 to 3 with SFH_WORLD_LIVE. Each run is
// `createWorld`, `planDue` through 480 and 130 steps on the money timeline with every frame from
// month 120 under another id (`replanAt`: every free lot is replanned then). On the mini city, the
// cases the planning proposal did not examine: a money timeline with a programme switched off and
// on, and a compiled timeline (`compileTimeline`) whose money changes and whose zoning changes
// mid-run (a painted policy from month 30, touching lots); there every memo answer is checked
// against `fundableAny` and lots with a row are seen to take the unchanged path.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { miniCalibrationWithRoutes } from '$lib/sim/scenario/fixtures/mini-finance';
import type { SimInput } from '$lib/sim/scenario/types';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import type { Effect, Policy, SimPolicy4 } from '$lib/timeline/policy4';
import type { Pool, Programme, ProjectKind } from '$lib/timelapse/types';
import { lotRow } from '../columns';
import { compileTimeline } from '../policy/compile';
import type { PolicyTimeline } from '../policy/frame';
import { miniCompileCtx } from '../policy/test/compile-fixtures';
import { miniDoc, span } from '../policy/test/fixtures';
import { staticsOf, type Statics } from '../statics';
import { liveDir } from '../test/cities.node';
import type { FundingSystem, StepSink, World } from '../types';
import { withFunding } from '../world';
import { ELIGIBILITY, fundableAny, rowlessBits, rowlessMemoSize, spellsOf } from './apply';
import { createFundingSystem } from './system';
import { benchFunded, liveFunded } from './test/cities.node';
import { moneyTimeline, replanAt, type MonthEvent } from './test/fixtures';

/** `planDue` through this month; `STEPS` months stepped; every frame from `CHANGE` re-identified. */
const PLAN = 480;
const STEPS = 130;
const CHANGE = 120;

/**
 * FNV-1a hash of every event (with its month) and ledger event, and their count, recorded from
 * the build before the memo (2026-11-13, a7844ad1).
 */
const RECORDED: Record<string, string> = {
  'synthCity baseline 1': '9bd46c06/35622',
  'synthCity baseline 2': 'd0658336/36032',
  'synthCity bench 1': '63fb1b40/36454',
  'synthCity bench 2': '5fd482e3/36944',
  'live 1': 'b04ec705/6292',
  'live 2': 'dbb6c92c/6849',
  'live 3': 'c590436b/6133'
};

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Runs `f` with the memo seam set to `memo`, restoring it after. */
function withMemo<T>(memo: boolean, f: () => T): T {
  ELIGIBILITY.memo = memo;
  try {
    return f();
  } finally {
    ELIGIBILITY.memo = true;
  }
}

/** The run's hash and count: `createWorld`, `planDue` through `PLAN`, `STEPS` steps. */
function hashRun(statics: Statics, timeline: PolicyTimeline, seed: number): string {
  let h = 0x811c9dc5;
  let n = 0;
  let month = 0;
  const out: StepSink = {
    event(e) {
      h = fnv(h, `e${month}${JSON.stringify(e)}`);
      n++;
    },
    ledger(e) {
      h = fnv(h, `l${JSON.stringify(e)}`);
      n++;
    }
  };
  const core = withFunding(createFundingSystem());
  const world = core.createWorld(statics, timeline, seed, out);
  const due = core.planDue(world, statics, timeline, seed, PLAN);
  for (let m = 1; m <= STEPS; m++) {
    month = m;
    core.step(world, due, statics, timeline, seed, out);
  }
  return `${h.toString(16).padStart(8, '0')}/${n}`;
}

const ON_OFF: [string, boolean][] = [
  ['on', true],
  ['off', false]
];

describe.each([['baseline'], ['bench']] as const)('synthCity, %s money: as recorded', (set) => {
  let statics: Statics;
  let timeline: PolicyTimeline;
  beforeAll(() => {
    const { input, doc } = benchFunded(set);
    statics = staticsOf(input);
    timeline = replanAt(moneyTimeline(input, doc), CHANGE);
  });

  it.each([1, 2].flatMap((seed) => ON_OFF.map(([w, memo]) => [seed, w, memo] as const)))(
    `synthCity ${set} seed %i, memo %s: events and ledger hash as recorded`,
    (seed, _w, memo) => {
      const got = withMemo(memo, () => hashRun(statics, timeline, seed));
      expect(got).toBe(RECORDED[`synthCity ${set} ${seed}`]);
      // The memo fills only when on, and outside the world.
      if (memo) expect(rowlessMemoSize(timeline).bytes).toBeGreaterThan(0);
    }
  );
});

const live = process.env.SFH_WORLD_LIVE ? liveDir() : null;

describe.skipIf(live === null)('live 2026-11-10-6ee5a23d, baseline money: as recorded', () => {
  let statics: Statics;
  let timeline: PolicyTimeline;
  beforeAll(async () => {
    const { input, doc } = await liveFunded(live!);
    statics = staticsOf(input);
    timeline = replanAt(moneyTimeline(input, doc), CHANGE);
  });

  it.each([1, 2, 3].flatMap((seed) => ON_OFF.map(([w, memo]) => [seed, w, memo] as const)))(
    'live seed %i, memo %s: events and ledger hash as recorded',
    (seed, _w, memo) => {
      expect(withMemo(memo, () => hashRun(statics, timeline, seed))).toBe(RECORDED[`live ${seed}`]);
    }
  );

  it('the memo: one table per (first month, last change read), a byte per lot', () => {
    hashRun(statics, timeline, 1);
    const size = rowlessMemoSize(timeline);
    // Months 1 to 119 read frame 1; from 120 also the change at 120.
    expect(size.tables).toBe(2);
    expect(size.bytes).toBe(2 * statics.parcelId.length);
    console.log(
      `rowless memo, live: ${size.tables} tables x ${statics.parcelId.length} lots = ${size.bytes} bytes`
    );
  });
});

// ---- The mini city: money switched off and on, a compiled timeline with zoning mid-run ----

/** Model months stepped (10 years); the money changes at `RAISE`, `OFF` and `ON`, zoning at `ZONE`. */
const W = 120;
const RAISE = 13;
const OFF = 25;
const ON = 37;
const ZONE = 30;
const TIERS = { veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 };

const CTX = miniCompileCtx({ finance: true, windowMonths: W });
/** The mini city whose own programmes open after the run: the added grant is all there is. */
const INPUT: SimInput = (() => {
  const fin = CTX.input.finance!;
  const later = CTX.input.asOf + 100_000;
  return {
    ...CTX.input,
    calibration: miniCalibrationWithRoutes(),
    finance: { ...fin, programmes: fin.programmes.map((g) => ({ ...g, from: later })) }
  };
})();

function pol(id: string, where: Policy['where'], spans: [number, number | null, Effect][]) {
  const p: Policy = {
    id,
    label: id,
    preset: null,
    on: true,
    where,
    spans: spans.map(([a, b, what]) => span(INPUT.asOf, a, b, what))
  };
  return p;
}

/** An added pool and grant (test values): share raised at `RAISE`, off `OFF` to `ON - 1`. */
function moneyPolicies(): Policy[] {
  const asOf = INPUT.asOf;
  const pool: Pool = {
    id: 'u-x',
    kind: 'generalRevenue',
    label: 'Added pool',
    inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 20_000_000 }],
    uncapped: false,
    debt: null,
    leverage: 1
  };
  const grant = (share: number): Programme => ({
    id: 'u-x-grant',
    label: 'Added grant',
    pool: 'u-x',
    reach: 'affordable',
    instrument: { kind: 'grant', share },
    from: asOf,
    to: null,
    minHomes: 2,
    tiers: { ...TIERS }
  });
  const fund = (share: number): Effect => ({ tag: 'fund', pool, programmes: [grant(share)] });
  return [
    pol('t', { tag: 'terms' }, [[1, null, { tag: 'terms', terms: { guaranteeRateCut: 0.01 } }]]),
    pol('f', { tag: 'fund', pool: 'u-x' }, [
      [1, RAISE - 1, fund(0.8)],
      [RAISE, OFF - 1, fund(0.9)],
      [ON, null, fund(0.9)]
    ])
  ];
}

const PAINT: CustomBrush = {
  id: 'paint',
  kind: 'paint',
  strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }],
  stories: 7
};
const PAINTED: ParcelId[] = ['2999A001', '2999A013', '3512005', '3600014', '3600016'];
const LOTS: Record<string, ParcelId[]> = { [queryKey(customQuery(PAINT))]: PAINTED };

/** The money policies through policy-timeline's money track only (`moneyTimeline`). */
function moneyOnly(): PolicyTimeline {
  const doc: SimPolicy4 = miniDoc(...moneyPolicies());
  return moneyTimeline(INPUT, doc);
}

/** The money policies and a painted zoning policy from `ZONE`, compiled. */
function compiled(): PolicyTimeline {
  const zoning = pol('p', { tag: 'painted' }, [[ZONE, null, { tag: 'brushes', brushes: [PAINT] }]]);
  const c = compileTimeline(
    miniDoc(...moneyPolicies(), zoning),
    LOTS,
    { ...CTX, input: INPUT },
    'plan'
  );
  expect(c.step(Infinity)).toBe(true);
  return c.result();
}

interface Checked {
  world: World;
  events: MonthEvent[];
  ledger: LedgerEvent[];
}

/** How the memo was read: calls on lots with no row (respelled among them) and with a row. */
interface Seen {
  rowless: number;
  respelled: number;
  rows: number;
  /** Memo answers that differ from `fundableAny` (from `asOf`, and from a respelled start). */
  wrong: number;
}

/** The funding system whose `planLot` checks the memo against `fundableAny` on every call. */
function checking(seen: Seen): FundingSystem {
  const f = createFundingSystem();
  const inner = f.planLot;
  f.planLot = (ctx, lot) => {
    if (lotRow(ctx.world.lots, lot) >= 0) seen.rows++;
    else {
      seen.rowless++;
      const bits = rowlessBits(ctx, lot);
      const spells = spellsOf(ctx, lot);
      let respelled = false;
      for (const kind of ['market', 'affordable'] as ProjectKind[]) {
        const bit = kind === 'market' ? 2 : 4;
        const memo = (bits & bit) !== 0;
        if (memo !== fundableAny(ctx, ctx.statics.asOf, kind, lot)) seen.wrong++;
        const r = spells[kind].r;
        if (r === ctx.statics.asOf) continue;
        respelled = true;
        // Not fundable from the dataset date: not fundable from a later spell start either.
        if (!memo && fundableAny(ctx, r, kind, lot)) seen.wrong++;
      }
      if (respelled) seen.respelled++;
    }
    return inner(ctx, lot);
  };
  return f;
}

function run(
  f: FundingSystem,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  memo: boolean
): Checked {
  return withMemo(memo, () => {
    const events: MonthEvent[] = [];
    const ledger: LedgerEvent[] = [];
    let month = 0;
    const out: StepSink = {
      event: (e) => events.push({ ...e, month }),
      ledger: (e) => ledger.push(e)
    };
    const core = withFunding(f);
    const world = core.createWorld(statics, timeline, seed, out);
    const due = core.planDue(world, statics, timeline, seed, W);
    for (let m = 1; m <= W; m++) {
      month = m;
      core.step(world, due, statics, timeline, seed, out);
    }
    return { world, events, ledger };
  });
}

const SEEDS = [1, 2, 3, 4, 5, 6];

describe.each([
  ['moneyTimeline, a programme switched off and on', moneyOnly],
  ['compileTimeline, money changes and a painted zoning policy from month 30', compiled]
] as const)('the mini city, %s', (name, make) => {
  const statics = staticsOf(INPUT);
  let timeline: PolicyTimeline;
  const seen: Seen = { rowless: 0, respelled: 0, rows: 0, wrong: 0 };
  beforeAll(() => {
    timeline = make();
  });

  it('the timeline changes as built', () => {
    expect(timeline.changes()).toEqual(expect.arrayContaining([RAISE, OFF, ON]));
    if (make === compiled) {
      expect(timeline.changes()).toContain(ZONE);
      const touched = timeline.touched(ZONE);
      expect(touched === null || touched.length > 0).toBe(true);
      // The painted lots' view differs from month 30: their yields change.
      expect(timeline.frameAt(ZONE).view).not.toBe(timeline.frameAt(ZONE - 1).view);
    }
  });

  it.each(SEEDS)(`${name}, seed %i: the same events, ledger and world, memo on and off`, (seed) => {
    const off = run(createFundingSystem(), statics, timeline, seed, false);
    const on = run(checking(seen), statics, timeline, seed, true);
    expect(on.events).toEqual(off.events);
    expect(on.ledger).toEqual(off.ledger);
    // The world holds no memo: equal with it filled and never filled, and in a kept copy.
    expect(on.world).toEqual(off.world);
    expect(structuredClone(on.world)).toEqual(off.world);
    expect(on.events.some((e) => e.kind === 'award')).toBe(true);
  });

  it(`${name}: every memo answer agrees with fundableAny; lots with a row take the old path`, () => {
    expect(seen.wrong).toBe(0);
    expect(seen.rowless).toBeGreaterThan(0);
    // Lapses respell rowless lots (rule 18): the memo is read for them only as "not fundable".
    expect(seen.respelled).toBeGreaterThan(0);
    expect(seen.rows).toBeGreaterThan(0);
    // A table per (first month, last change read): the changes give several.
    expect(rowlessMemoSize(timeline).tables).toBeGreaterThan(3);
    console.log(
      `${name}: ${JSON.stringify(seen)}, memo ${JSON.stringify(rowlessMemoSize(timeline))}`
    );
  });
});
