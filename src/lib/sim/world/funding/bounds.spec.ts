// Finite funding in the step engine: fixture-0's bounds as the pools receive them, and an older
// dataset's federal pool (read as 100 billion a year) never running short.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { prototypeFor } from '$lib/sim/finance';
import { dayOf } from '$lib/sim/scenario/dates';
import { asksOf, inflowArrivals } from '$lib/sim/scenario/funding';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { SimInput } from '$lib/sim/scenario/types';
import { parseCalibration } from '$lib/timelapse/model';
import type { Day } from '$lib/timelapse/time';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import { monthFirstDay, monthOfDay } from '../months';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf } from '../statics';
import { fixtureInput } from '../test/cities.node';
import type { World } from '../types';
import { KIND_AFFORDABLE, fundOf, poolRowOf } from './columns';
import { frameMoney } from './frame-money';
import { availableOf } from './pools';
import { moneyTimeline, runFunded, withBaselineMoney } from './test/fixtures';

const MONTHS = 480;
const FEDERAL = 'federal-tax-credits';
/** fixture-0's calibration before finite funding: its federal pool carries `uncapped: true`. */
const LEGACY_PATH = new URL(
  '../../../timelapse/fixtures/calibration-uncapped.json',
  import.meta.url
);

/** The `k`th anniversary of `asOf` (k = 0 is `asOf`), by `inflowArrivals`' rule. */
function anniversary(asOf: Day, k: number): Day {
  const yearly = { kind: 'yearly' as const, from: asOf, to: null, dollarsPerYear: 1 };
  return inflowArrivals(yearly, asOf, asOf + 366 * (k + 1))[k];
}

const insOf = (ledger: readonly LedgerEvent[], pool: string) =>
  ledger.filter((e) => e.kind === 'in' && e.pool === pool);

/**
 * The waiting rows short on pool `id` at the end of month `m`: a row is short on a pool when what
 * its offered bundle asks of it (`asksOf`, at the row's size) is more than the pool's available
 * money, the test `serve` makes (`awardPasses`, rule 10).
 */
function shortOn(
  world: World,
  timeline: PolicyTimeline,
  m: number,
  id: string
): { asking: number; short: number } {
  const fm = frameMoney(timeline, timeline.frameAt(m));
  const q = fm.pool.get(id);
  if (q === undefined) return { asking: 0, short: 0 };
  const { line, pools } = fundOf(world);
  const avail = availableOf(pools, poolRowOf(pools, id), fm.fin.pools[q]);
  let asking = 0;
  let short = 0;
  for (let i = 0; i < line.n; i++) {
    if (line.gone[i] === 1) continue;
    const bundle = fm.bundleIds(line.bundle[i]);
    if (bundle === null) continue;
    const kind = line.kind[i] === KIND_AFFORDABLE ? 'affordable' : 'market';
    const units = line.units[i];
    const ask = asksOf(fm.index, kind, bundle, prototypeFor(line.stories[i], units).id, units);
    const dollars = ask.get(q) ?? 0;
    if (dollars > 0) asking++;
    if (dollars > avail) short++;
  }
  return { asking, short };
}

describe('fixture-0 bounds', () => {
  let input: SimInput;
  let ledger: LedgerEvent[];
  let awardsFirstYear: number;

  beforeAll(async () => {
    input = withBaselineMoney(await fixtureInput());
    const timeline = moneyTimeline(input, DEFAULT_POLICY4);
    const run = runFunded(staticsOf(input), timeline, 1, MONTHS);
    ledger = run.ledger;
    awardsFirstYear = run.events.filter(
      (e) => e.kind === 'award' && e.month >= 1 && e.month <= 12
    ).length;
  });

  it("city-debt's last arrival is 500,000 on its second anniversary", () => {
    const last = insOf(ledger, 'city-debt').at(-1)!;
    expect(last.day).toBe(anniversary(input.asOf, 2));
    expect(last.dollars).toBe(500_000);
  });

  it("city-impact-fees' last arrival is on its first anniversary", () => {
    expect(insOf(ledger, 'city-impact-fees').at(-1)!.day).toBe(anniversary(input.asOf, 1));
  });

  it("city-housing-trust-fund's last arrival is on 2042-10-10", () => {
    expect(insOf(ledger, 'city-housing-trust-fund').at(-1)!.day).toBe(dayOf(2042, 10, 10));
  });

  it('city-redevelopment and city-housing-stability-fund receive nothing and have no programme', () => {
    for (const id of ['city-redevelopment', 'city-housing-stability-fund']) {
      expect(insOf(ledger, id)).toEqual([]);
      expect(input.finance!.pools.some((p) => p.id === id)).toBe(true);
      expect(input.finance!.programmes.filter((g) => g.pool === id)).toEqual([]);
    }
  });

  it("the continuing pools receive money in the window's last twelve months", () => {
    for (const id of ['city-ocoh', 'city-general-fund', 'state', FEDERAL]) {
      const late = insOf(ledger, id).filter((e) => {
        const m = monthOfDay(input.asOf, e.day);
        return m >= MONTHS - 11 && m <= MONTHS;
      });
      expect(late.length, id).toBeGreaterThan(0);
    }
  });

  it('at least one funded start happens in the first year', () => {
    expect(awardsFirstYear).toBeGreaterThan(0);
  });
});

describe('older-format calibration', () => {
  let input: SimInput;

  beforeAll(async () => {
    const legacy = parseCalibration(JSON.parse(readFileSync(LEGACY_PATH, 'utf8')));
    input = withBaselineMoney({ ...(await fixtureInput()), calibration: legacy });
  });

  /** One world to month 480 under `doc`: the federal pool's least available money and shortfalls. */
  function run(doc: SimPolicy4) {
    const timeline = moneyTimeline(input, doc);
    let least = Infinity;
    let short = 0;
    let asking = 0;
    const { ledger } = runFunded(staticsOf(input), timeline, 1, MONTHS, {
      afterStep(world, m) {
        const fm = frameMoney(timeline, timeline.frameAt(m));
        const q = fm.pool.get(FEDERAL)!;
        const { pools } = fundOf(world);
        least = Math.min(least, availableOf(pools, poolRowOf(pools, FEDERAL), fm.fin.pools[q]));
        const got = shortOn(world, timeline, m, FEDERAL);
        short += got.short;
        asking += got.asking;
      }
    });
    return { least, short, asking, ledger };
  }

  it('the federal pool never falls below 99 billion and no waiting row is short on it', () => {
    const fed = input.finance!.pools.find((p) => p.id === FEDERAL)!;
    expect('uncapped' in fed).toBe(false);
    const got = run(DEFAULT_POLICY4);
    expect(got.least).toBeGreaterThanOrEqual(99_000_000_000);
    expect(got.short).toBe(0);
    // rows waiting on other pools still ask this one: the check is not vacuous
    expect(got.asking).toBeGreaterThan(0);
    expect(got.ledger.some((e) => e.kind === 'commit' && e.pool === FEDERAL)).toBe(true);
  });

  it('Review Focus 4: switched off from month 13 and back on from month 25, it awards nothing while off and is never short', () => {
    const entries = [
      { pool: FEDERAL, from: monthFirstDay(input.asOf, 13), scale: 0 },
      { pool: FEDERAL, from: monthFirstDay(input.asOf, 25), scale: 1 }
    ];
    const doc: SimPolicy4 = {
      schema: 4,
      kinds: {
        zoning: [],
        permitting: [],
        money: [
          {
            id: 'federal-off',
            label: 'Federal tax credits',
            preset: null,
            on: true,
            where: { tag: 'baseline' },
            spans: [{ from: input.asOf, to: null, what: { tag: 'scales', entries } }]
          }
        ]
      }
    };
    const got = run(doc);
    const offCommits = got.ledger.filter((e) => {
      const m = monthOfDay(input.asOf, e.day);
      return e.kind === 'commit' && e.pool === FEDERAL && m >= 13 && m <= 24;
    });
    expect(offCommits).toEqual([]);
    expect(got.short).toBe(0);
    expect(got.asking).toBeGreaterThan(0);
    expect(
      got.ledger.some(
        (e) => e.kind === 'commit' && e.pool === FEDERAL && monthOfDay(input.asOf, e.day) >= 25
      )
    ).toBe(true);
  });
});
