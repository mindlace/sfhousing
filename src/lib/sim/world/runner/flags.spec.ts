// The two flags of a project slot (map-on-screen Task 1): your zoning sets its lot, your pool
// funds it. On the mini city's own compile, so `limitsAt` reads frames a live compile handed out.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { SLOT_FLAG } from '$lib/map/types';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import type { Policy } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { addProject, emptyWorld } from '../columns';
import { monthFirstDay } from '../months';
import { compileTimeline } from '../policy/compile';
import type { PolicyTimeline } from '../policy/frame';
import { miniCompileCtx } from '../policy/test/compile-fixtures';
import { miniDoc, span } from '../policy/test/fixtures';
import { staticsOf, type Statics } from '../statics';
import { ORIGIN_MASTER, ORIGIN_PHASE, ORIGIN_PIPELINE, ORIGIN_SIM, type World } from '../types';
import { slotFlags, type FlagSources } from './flags';

const CTX = miniCompileCtx({ finance: true, windowMonths: 24 });
const ASOF: Day = CTX.input.asOf;
const NS = 7;

// District-1 lots outside the Local Program with no base cap (as compile.spec.ts)
const D1: ParcelId[] = ['2999A001', '2999A013', '3512005', '3600014', '3600016'];
const PAINT: CustomBrush = {
  id: 'b9',
  kind: 'paint',
  strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }],
  stories: 9
};
const LOTS: Record<string, ParcelId[]> = { [queryKey(customQuery(PAINT))]: D1 };
/** Painted from model month 10 on. */
const PAINTED_FROM = 10;

const policy = (
  id: string,
  where: Policy['where'],
  from: number,
  what: Policy['spans'][0]['what']
) =>
  ({
    id,
    label: id,
    preset: null,
    on: true,
    where,
    spans: [span(ASOF, from, null, what)]
  }) satisfies Policy;

const FUND = fundingOnly();
const ADDED_PROGRAMME = FUND.programmes[0].id;

let timeline: PolicyTimeline;
let statics: Statics;
let src: FlagSources;

beforeAll(() => {
  const doc = miniDoc(
    policy('p1', { tag: 'painted' }, PAINTED_FROM, { tag: 'brushes', brushes: [PAINT] }),
    policy('fund', { tag: 'fund', pool: FUND.pools[0].id }, 1, {
      tag: 'fund',
      pool: FUND.pools[0],
      programmes: FUND.programmes
    }),
    // the mini finance's guarantee needs it (as compile.spec.ts's RATE_CUT)
    policy('terms', { tag: 'terms' }, 1, { tag: 'terms', terms: { guaranteeRateCut: 0.01 } })
  );
  const c = compileTimeline(doc, LOTS, CTX, 'plan');
  expect(c.step(Infinity)).toBe(true);
  timeline = c.result();
  statics = staticsOf(CTX.input);
  src = {
    frameAt: (m) => timeline.frameAt(m),
    basePools: new Set(CTX.input.finance!.pools.map((p) => p.id))
  };
});

const lotRow = (id: ParcelId) => CTX.input.parcels.index.get(id)!;
const OFF_LOT: ParcelId = CTX.input.parcels.id.find((id) => !D1.includes(id))!;

interface RowOpts {
  origin?: number;
  lot?: ParcelId;
  /** Entered days by stage index. */
  entered?: Record<number, Day>;
  funded?: boolean;
  programmes?: string[];
}

/** A world at month 20 holding one row. */
function worldWith(o: RowOpts): { world: World; row: number } {
  const world = emptyWorld(0);
  world.month = 20;
  const p = world.projects;
  const row = addProject(p);
  p.origin[row] = o.origin ?? ORIGIN_SIM;
  p.src[row] = (o.origin ?? ORIGIN_SIM) === ORIGIN_SIM ? lotRow(o.lot ?? D1[0]) : 0;
  for (const [j, d] of Object.entries(o.entered ?? {})) p.entered[row * NS + Number(j)] = d;
  p.funded[row] = o.funded ? 1 : 0;
  p.programmes[row] = (o.programmes ?? []).join(',');
  return { world, row };
}

const inMonth = (m: number): Day => monthFirstDay(ASOF, m) + 3;
const flagsOf = (o: RowOpts) => {
  const { world, row } = worldWith(o);
  return slotFlags(world, statics, row, src);
};

describe('slotFlags: zoning', () => {
  it('a simulated row on a lot a painted policy sets in its start month has the zoning bit', () => {
    expect(flagsOf({ entered: { 0: inMonth(12) } })).toBe(SLOT_FLAG.zoning);
  });

  it('a row on a lot current law sets has no zoning bit', () => {
    expect(flagsOf({ lot: OFF_LOT, entered: { 0: inMonth(12) } })).toBe(0);
  });

  it('pipeline, phase and master rows never have the zoning bit, whatever owns their lots', () => {
    for (const origin of [ORIGIN_PIPELINE, ORIGIN_PHASE, ORIGIN_MASTER])
      expect(flagsOf({ origin, entered: { 0: inMonth(12) } }), `origin ${origin}`).toBe(0);
  });

  it("the zoning bit reads the frame of the row's first entered stage month, not the world's month", () => {
    // current law in month 4, painted from month 10; the world is at month 20
    expect(flagsOf({ entered: { 0: inMonth(4), 2: inMonth(12) } })).toBe(0);
    // a row with its first stage on or before the dataset date reads month 1
    expect(flagsOf({ entered: { 1: ASOF - 30 } })).toBe(0);
  });
});

describe('slotFlags: money', () => {
  it('a funded row with a programme of an added pool has the money bit', () => {
    expect(
      flagsOf({
        lot: OFF_LOT,
        entered: { 0: inMonth(3) },
        funded: true,
        programmes: ['m-city-grant', ADDED_PROGRAMME]
      })
    ).toBe(SLOT_FLAG.money);
  });

  it('a funded row whose programmes are all of baseline pools has none; an unfunded row has none', () => {
    const at = { lot: OFF_LOT, entered: { 0: inMonth(3) } };
    expect(flagsOf({ ...at, funded: true, programmes: ['m-city-grant', 'federal-grant'] })).toBe(0);
    expect(flagsOf({ ...at, funded: false, programmes: [ADDED_PROGRAMME] })).toBe(0);
    expect(flagsOf({ ...at, funded: false })).toBe(0);
    // a master row: 0 whatever it holds
    expect(
      flagsOf({ ...at, origin: ORIGIN_MASTER, funded: true, programmes: [ADDED_PROGRAMME] })
    ).toBe(0);
  });

  it('both bits together', () => {
    expect(
      flagsOf({ entered: { 0: inMonth(12) }, funded: true, programmes: [ADDED_PROGRAMME] })
    ).toBe(SLOT_FLAG.zoning | SLOT_FLAG.money);
    expect(SLOT_FLAG.zoning | SLOT_FLAG.money).toBe(3);
  });
});
