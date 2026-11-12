// finance-engine Task 5: the funded latent starts of one attempt (spec 4.4).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS, fillStories } from '$lib/data/scenario-codec';
import { prototypeFor } from '$lib/sim/finance';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import { runOf } from './engine';
import { benchBaseline, withBenchFunding } from './fixtures/bench-finance';
import { miniCalibrationWithRoutes, miniFinance } from './fixtures/mini-finance';
import {
  WARM_CHUNK,
  attemptLatents,
  drawsOf,
  financePreOf,
  financeWarm,
  fundedRunStats,
  kindLatentInto,
  latentsWith,
  newKindOut,
  lineKey,
  respell,
  tableEntry,
  tablesOf,
  type AttemptLatents,
  type KindLatent
} from './funded';
import { coverageLevel } from './funding';
import { precomputeOf } from './input';
import { P, drawOn, seedHash, simEntity, streamOf } from './rng';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import { simulate } from './simulate';
import { runCollect } from './test/finance-harness';
import type { SimInput } from './types';

const H = GOLDEN_HORIZON;
const P19 = 524_288;
const P20 = 1_048_576;
const P28 = 268_435_456;
const base = goldenInput();
const asOf = base.asOf;
const withFinance = (finance: NonNullable<SimInput['finance']>, over: Partial<SimInput> = {}) =>
  ({ ...base, calibration: miniCalibrationWithRoutes(), finance, ...over }) as SimInput;
const input = withFinance(miniFinance(asOf));
const pre = precomputeOf(input);
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);

/** Rows some in-flight project names: the engine's held rows. */
const held = new Set<number>();
for (const p of base.projects) {
  for (const id of [...p.parcelIds, ...(p.phases ?? []).flatMap((ph) => ph.parcelIds)]) {
    const i = base.parcels.index.get(id);
    if (i !== undefined) held.add(i);
  }
}

const startOf = (r: Day, T: number) => r + 1 + Math.floor((T - 1) * MONTH_DAYS);

function eachLatent(inp: SimInput, fn: (lat: AttemptLatents, i: number, seed: number) => void) {
  for (const seed of seeds) {
    for (const i of pre.candidates) {
      fn(attemptLatents(inp, seed, H, i, 0, asOf, inp.parcels.existingUnits[i]), i, seed);
    }
  }
}

const hasNaN = (k: KindLatent | null) =>
  k !== null && Object.values(k).some((v) => typeof v === 'number' && Number.isNaN(v));

describe('financePreOf', () => {
  it('merges the change days after asOf and lists the offers per segment', () => {
    const fp = financePreOf(input);
    expect(financePreOf(input)).toBe(fp);
    // m-bank off from asOf + 2000 to asOf + 2400: the days asOf + 2000 and asOf + 2401
    expect(fp.days).toEqual([asOf + 2000, asOf + 2401]);
    expect(fp.view).toEqual([0, 0, 0]);
    expect(fp.ordSeg).toEqual([0, 0, 0]);
    expect(fp.m).toEqual([0, 0, 0]);
    expect(fp.reached).toEqual(['market', 'affordable']);
    expect(fp.offered.affordable).toEqual([
      [0, 1],
      [0, 1],
      [0, 1]
    ]);
    expect(fp.offered.market).toEqual([[2, 3], [3], [2, 3]]);
  });
});

describe('attemptLatents (spec 4.4)', () => {
  it('O is the first-attempt start of today’s engine', () => {
    let starts = 0;
    for (const seed of seeds) {
      const first = new Map<ParcelId, Day>();
      for (const s of simulate(base, seed, H)) {
        if (s.origin === 'simulated' && s.projectId.endsWith(':0')) {
          first.set(s.parcelIds[0], s.revisions[0].day);
        }
      }
      for (const i of pre.candidates) {
        if (held.has(i)) continue;
        const lat = attemptLatents(input, seed, H, i, 0, asOf, base.parcels.existingUnits[i]);
        const want = first.get(base.parcels.id[i]) ?? null;
        expect(lat.O).toBe(want);
        if (want !== null) starts++;
      }
    }
    expect(starts).toBeGreaterThan(20);
  });

  it('the market latent is never later than the ordinary start', () => {
    let apps = 0;
    eachLatent(input, (lat) => {
      const m = lat.market!;
      expect(m.T === 0 || (lat.TO !== 0 && m.T <= lat.TO)).toBe(true);
      if (m.day !== null && lat.O !== null) expect(m.day).toBeLessThanOrEqual(lat.O);
      if (m.day !== null) apps++;
      expect(hasNaN(m)).toBe(false);
    });
    expect(apps).toBeGreaterThan(20);
  });

  it('a certain month starts on its first day', () => {
    let certain = 0;
    eachLatent(input, (lat) => {
      const a = lat.affordable!;
      expect(hasNaN(a)).toBe(false);
      if (a.level === 1 && a.day !== null) {
        certain++;
        expect(a.day).toBe(startOf(asOf, a.T));
      }
    });
    expect(certain).toBeGreaterThan(20);
  });

  it('no bundle on offer gives no application', () => {
    const f = miniFinance(asOf);
    for (const g of f.programmes) {
      g.from = asOf - 10;
      g.to = asOf - 1;
    }
    const inp = withFinance(f);
    let seen = 0;
    eachLatent(inp, (lat) => {
      expect(lat.market!.day).toBeNull();
      expect(lat.affordable!.day).toBeNull();
      seen++;
    });
    expect(seen).toBeGreaterThan(20);
  });

  it('draws on its purposes: uA moves only the affordable latent', () => {
    const run = runOf(input, 3, H, true);
    const fp = financePreOf(input);
    let moved = 0;
    for (const i of pre.candidates) {
      const e = base.parcels.existingUnits[i];
      const lat = attemptLatents(input, 3, H, i, 0, asOf, e);
      const s = streamOf(seedHash(3), simEntity(base.parcels.id[i]), 0);
      expect([lat.uO, lat.vO, lat.uA, lat.vA, lat.uS]).toEqual([
        drawOn(s, P.INIT, 0),
        drawOn(s, P.INIT_DAY, 0),
        drawOn(s, P.INIT_AFFORDABLE, 0),
        drawOn(s, P.INIT_DAY_AFFORDABLE, 0),
        drawOn(s, P.SIZE, 0)
      ]);
      const uA = lat.uA < 0.5 ? lat.uA + 0.4 : lat.uA - 0.4;
      const other = latentsWith(run, fp, i, asOf, e, { ...lat, uA });
      expect(other.market).toEqual(lat.market);
      expect(other.O).toBe(lat.O);
      expect(other.TO).toBe(lat.TO);
      if (JSON.stringify(other.affordable) !== JSON.stringify(lat.affordable)) moved++;
    }
    expect(moved).toBeGreaterThan(5);
  });

  it('a later regime: the affordable latent applies only once the lot has a hazard', () => {
    const i = pre.candidates.find((r) => !held.has(r))!;
    const closed = { ...base.parcels, hostable: base.parcels.hostable.slice() };
    closed.hostable[i] = 0;
    const D = asOf + 400;
    const inp = withFinance(miniFinance(asOf), {
      parcels: closed,
      regimes: [{ day: D, parcels: base.parcels }]
    });
    const p = precomputeOf(inp);
    expect(p.hazard[i]).toBe(0);
    expect(Number.isFinite(p.regimes[0].logit[i])).toBe(true);
    let apps = 0;
    for (const seed of seeds) {
      const lat = attemptLatents(inp, seed, H, i, 0, asOf, base.parcels.existingUnits[i]);
      const a = lat.affordable!;
      expect(hasNaN(a)).toBe(false);
      expect(hasNaN(lat.market)).toBe(false);
      for (const v of [lat.uO, lat.vO, lat.uA, lat.vA, lat.uS, lat.TO]) {
        expect(Number.isNaN(v)).toBe(false);
      }
      if (a.day !== null) {
        apps++;
        expect(a.day).toBeGreaterThanOrEqual(D);
        expect(a.view).toBe(1);
      }
      if (lat.O !== null) expect(lat.O).toBeGreaterThanOrEqual(D);
    }
    expect(apps).toBeGreaterThan(0);
  });

  it('a row whose unshifted affordable rates are all 0 has keyDay 2^28', () => {
    const inp = withFinance({ ...miniFinance(asOf), slope: 1e6 });
    let rows = 0;
    for (const i of pre.candidates) {
      const lat = attemptLatents(inp, 1, H, i, 0, asOf, base.parcels.existingUnits[i]);
      const a = lat.affordable!;
      expect(a.keyDay).toBe(P28);
      if (a.day !== null) rows++;
    }
    expect(rows).toBeGreaterThan(5);
  });
});

describe('respell (spec 4.11)', () => {
  it('starts its months on D with the same draws', () => {
    const run = runOf(input, 1, H, true);
    const fp = financePreOf(input);
    const D = asOf + 100;
    let apps = 0;
    for (const i of pre.candidates) {
      const lat = attemptLatents(input, 1, H, i, 0, asOf, base.parcels.existingUnits[i]);
      const again = respell(run, fp, i, lat, 'affordable', D);
      if (again === null) continue;
      apps++;
      expect(again.day!).toBeGreaterThanOrEqual(D);
      // the certain stack: the first month from D
      expect(again.T).toBe(1);
      expect(again.day).toBe(D);
      expect(again.keyDay).toBeGreaterThanOrEqual(D);
    }
    expect(apps).toBeGreaterThan(5);
  });
});

describe('lineKey', () => {
  it('orders by keyDay, then rank, then market before affordable', () => {
    expect(lineKey(10, 5, 'affordable')).toBeLessThan(lineKey(11, 0, 'market'));
    expect(lineKey(10, 4, 'affordable')).toBeLessThan(lineKey(10, 5, 'market'));
    expect(lineKey(10, 5, 'market')).toBeLessThan(lineKey(10, 5, 'affordable'));
    expect(lineKey(P28 + 5, 3, 'market')).toBe(lineKey(P28, 3, 'market'));
    expect(lineKey(P28, P19 - 1, 'affordable')).toBe(P28 * P20 + (P19 - 1) * 2 + 1);
    expect(() => lineKey(10, P19, 'market')).toThrow(RangeError);
  });
});

// The inputs of the per-input shortcut tests, shared with the finance warm's tests.
const later = {
  market: [
    { from: asOf, logOdds: 0.4 },
    { from: asOf + 1500, logOdds: -0.6 }
  ]
};
const regime = { regimes: [{ day: asOf + 700, parcels: base.parcels }] };
const reserved = {
  reservedFrom: Int32Array.from({ length: base.parcels.count }, (_, i) =>
    i % 5 === 0 ? asOf + 900 : 0
  )
};
const bench = withBenchFunding(benchBaseline(asOf), asOf);
// [name, input, whether some lot is passed over on its draws]
const cases: [string, SimInput, boolean][] = [
  // the certain affordable stack (minHomes 2) reaches nearly every lot: nothing to pass over
  ['miniFinance', input, false],
  ['benchBaseline', withFinance(benchBaseline(asOf)), true],
  ['benchBaseline with the bench funding set', withFinance(bench), true],
  [
    'miniFinance with market steps and a regime',
    withFinance(miniFinance(asOf), { ...later, ...regime }),
    false
  ],
  [
    'the bench funding set with market steps, a regime and reservations',
    withFinance(bench, { ...later, ...regime, ...reserved }),
    true
  ]
];
// A regime from mid-run whose view differs from view 0: some lots gain yields past every
// programme's least minHomes only in the regime, and some lots have no hazard in one view but
// not the other (hostable 0).
const F5 = 5;
const view0 = structuredClone(base.parcels);
const view1 = structuredClone(base.parcels);
for (let i = 0; i < base.parcels.count; i++) {
  if (i % 3 === 0) {
    for (let f = 0; f < F5; f++) {
      view1.yield[i * F5 + f] = Math.min(4000, view1.yield[i * F5 + f] * 12 + 75);
    }
  }
  if (i % 7 === 1) view1.hostable[i] = 0;
  if (i % 7 === 2) view0.hostable[i] = 0;
}
const regimeDay = asOf + 1200;
const viewed = { parcels: view0, regimes: [{ day: regimeDay, parcels: view1 }] };
/** Some lot is eligible only through the regime (no hazard or too few homes in view 0). */
const onlyThroughRegime = (inp: SimInput) => {
  // some lot is eligible only through the regime (no hazard or too few homes in view 0)
  const pre0 = precomputeOf(inp);
  const fp = financePreOf(inp);
  let onlyRegime = 0;
  pre0.candidates.forEach((i, c) => {
    let top = 0;
    for (let f = 0; f < F5; f++) top = Math.max(top, view0.yield[i * F5 + f]);
    const in0 = pre0.logit[i] !== -Infinity && top >= 70;
    if (fp.eligible.affordable[c] === 1 && !in0) onlyRegime++;
  });
  expect(onlyRegime).toBeGreaterThan(0);
};
const offCase = (
  fin: NonNullable<SimInput['finance']>,
  off: NonNullable<SimInput['finance']>['off']
) => ({ ...fin, off: [...fin.off, ...off] });
// [name, input, passed over?, check that the case is not vacuous]
const deep: [string, SimInput, boolean, (inp: SimInput, respells: number) => void][] = [
  [
    'the bench funding set, a regime view that differs from view 0',
    withFinance(bench, viewed),
    true,
    onlyThroughRegime
  ],
  [
    'the bench baseline, a regime view that differs from view 0',
    withFinance(benchBaseline(asOf), viewed),
    true,
    onlyThroughRegime
  ],
  [
    'miniFinance, a pool every affordable bundle needs off and on again',
    withFinance(
      offCase(miniFinance(asOf), [{ pool: 'm-city', from: asOf + 600, to: asOf + 1400 }])
    ),
    false,
    (_inp, respells) => expect(respells).toBeGreaterThan(0)
  ],
  [
    'miniFinance, a pool every affordable bundle needs off for good',
    withFinance(offCase(miniFinance(asOf), [{ pool: 'm-city', from: asOf + 1800, to: null }])),
    false,
    (_inp, respells) => expect(respells).toBeGreaterThan(0)
  ],
  [
    'the bench funding set with the state pool off and on again, and a regime',
    withFinance(offCase(bench, [{ pool: 'state', from: asOf + 600, to: asOf + 1400 }]), viewed),
    true,
    (inp) => {
      const off = financePreOf(inp).offered.affordable;
      expect(new Set(off.map((s) => s.join(','))).size).toBeGreaterThan(1);
    }
  ],
  [
    'the bench baseline with the state pool off for good',
    withFinance(offCase(benchBaseline(asOf), [{ pool: 'state', from: asOf + 900, to: null }]), {
      regimes: [{ day: asOf + 300, parcels: view1 }]
    }),
    true,
    (_inp, respells) => expect(respells).toBeGreaterThan(0)
  ]
];
describe('the per-input shortcuts (spec 4.5 cost note, 4.17 items 1 and 2)', () => {
  for (const [name, inp, passes, check] of deep) {
    it(`${name}: seeds 1 to 20 give the same schedules and ledgers with and without them`, () => {
      let passedOver = 0;
      let respells = 0;
      let funded = 0;
      for (const seed of seeds) {
        const fast = runCollect(inp, seed, H);
        passedOver += fundedRunStats().passedOver;
        respells += fundedRunStats().respells;
        const slow = runCollect(inp, seed, H, { noShortcuts: true });
        expect(fast.order, `seed ${seed} order`).toEqual(slow.order);
        expect(fast.schedules, `seed ${seed} schedules`).toEqual(slow.schedules);
        expect(fast.ledger, `seed ${seed} ledger`).toEqual(slow.ledger);
        expect(fast.reservations).toEqual(slow.reservations);
        funded += fast.schedules.filter((s) => s.funding !== undefined).length;
      }
      console.log(
        `[shortcuts] ${name}: passedOver ${passedOver}, respells ${respells}, funded ${funded}`
      );
      expect(funded).toBeGreaterThan(0);
      if (passes) expect(passedOver).toBeGreaterThan(0);
      check(inp, respells);
    }, 300_000);
  }
  for (const [name, inp, passes] of cases) {
    it(`${name}: seeds 1 to 20 give the same schedules and ledgers with and without them`, () => {
      let passedOver = 0;
      let schedules = 0;
      for (const seed of seeds) {
        const fast = runCollect(inp, seed, H);
        passedOver += fundedRunStats().passedOver;
        const slow = runCollect(inp, seed, H, { noShortcuts: true });
        expect(fundedRunStats().passedOver).toBe(0);
        expect(fast.order, `seed ${seed} order`).toEqual(slow.order);
        expect(fast.schedules, `seed ${seed} schedules`).toEqual(slow.schedules);
        expect(fast.ledger, `seed ${seed} ledger`).toEqual(slow.ledger);
        expect(fast.reservations).toEqual(slow.reservations);
        schedules += fast.schedules.length;
      }
      expect(schedules).toBeGreaterThan(0);
      if (passes) expect(passedOver).toBeGreaterThan(0);
      else expect(passedOver).toBe(0);
    }, 300_000);
  }
});

describe('the finance warm (perf Task 1)', () => {
  const all: [string, SimInput][] = [
    ...cases.map(([name, inp]): [string, SimInput] => [name, inp]),
    ...deep.map(([name, inp]): [string, SimInput] => [name, inp])
  ];
  /** A fresh copy of `inp` (the warm and the tables are memoised per input), warmed one candidate
   *  per step. */
  const warmedCopy = (inp: SimInput): SimInput => {
    const w = structuredClone(inp);
    const warm = financeWarm(w, H);
    while (!warm.step(1));
    return w;
  };

  it('financeWarm steps in chunks and finishes', () => {
    const inp = structuredClone(withFinance(withBenchFunding(benchBaseline(asOf), asOf)));
    const n = precomputeOf(inp).candidates.length;
    expect(n).toBeGreaterThan(3);
    const warm = financeWarm(inp, H);
    expect(financeWarm(inp, H)).toBe(warm);
    let steps = 0;
    while (!warm.step(1)) steps++;
    // at most one step builds the precompute; then one candidate per step
    expect(steps).toBeGreaterThanOrEqual(n - 1);
    expect(steps).toBeLessThanOrEqual(n);
    expect(warm.step(1)).toBe(true);
    expect(warm.step(WARM_CHUNK)).toBe(true);
    // a second horizon only adds its bounds
    expect(financeWarm(inp, H - 400).step(1)).toBe(true);
  });

  for (const [name, inp] of all) {
    it(`${name}: the warmed skip bounds equal the unwarmed ones`, () => {
      const warmed = financePreOf(warmedCopy(inp));
      const cold = financePreOf(structuredClone(inp));
      expect(Array.from(warmed.marketSkip(H))).toEqual(Array.from(cold.marketSkip(H)));
      expect(Array.from(warmed.affordableSkip(H))).toEqual(Array.from(cold.affordableSkip(H)));
    });

    it(`${name}: warmed and unwarmed runs are identical`, () => {
      const warmed = warmedCopy(inp);
      const cold = structuredClone(inp);
      for (let seed = 1; seed <= 5; seed++) {
        expect(runCollect(warmed, seed, H), `seed ${seed}`).toEqual(runCollect(cold, seed, H));
      }
    }, 300_000);
  }

  it('a run completes an unfinished warm and gives the same output', () => {
    for (const [name, inp] of all) {
      const part = structuredClone(inp);
      expect(financeWarm(part, H).step(3)).toBe(false);
      const full = warmedCopy(inp);
      for (const seed of [1, 2]) {
        expect(runCollect(part, seed, H), `${name} seed ${seed}`).toEqual(
          runCollect(full, seed, H)
        );
      }
    }
  }, 300_000);

  it('a segment with 300 values keeps every index', () => {
    const F5 = 5;
    // one market programme per minHomes 1 to 300 on one pool, and lots whose yields span 1 to 300
    const fin = miniFinance(asOf);
    const loan = fin.programmes.find((g) => g.reach === 'market')!;
    fin.programmes = Array.from({ length: 300 }, (_, k) => ({
      ...loan,
      id: `loan-${k + 1}`,
      minHomes: k + 1
    }));
    fin.off = [];
    const parcels = structuredClone(base.parcels);
    let next = 0;
    for (let i = 0; i < parcels.count; i++) {
      for (let f = 0; f < F5; f++) parcels.yield[i * F5 + f] = 1 + (next++ % 300);
    }
    const inp = withFinance(fin, { parcels });
    const fp = financePreOf(inp);
    expect(fp.days).toEqual([]);
    const warm = financeWarm(inp, H);
    while (!warm.step(WARM_CHUNK));
    const pc = precomputeOf(inp);
    const values = new Set<string>();
    let entries = 0;
    pc.candidates.forEach((i, c) => {
      if (fp.eligible.market[c] === 0 || pc.logit[i] === -Infinity) return;
      for (let f = 0; f < F5; f++) {
        const units = parcels.yield[i * F5 + f];
        const e = tableEntry(fp, 'market', 0, c, f);
        if (!(units > 0)) continue;
        expect(e).not.toBeNull();
        const want = fp.offered.market[0].filter((g) => fin.programmes[g].minHomes <= units);
        expect(e!.bundle).toEqual(want);
        const stories = fillStories(FILL_LEVELS[f], parcels.envelopeStories[i]);
        const proto = prototypeFor(stories, units).id;
        const priced = fp.index.price('market', want, proto);
        expect(e!.level).toBe(coverageLevel(priced.coverage));
        values.add(`${e!.bundle.join(',')}|${e!.level}`);
        entries++;
      }
    });
    expect(entries).toBeGreaterThanOrEqual(values.size);
    expect(values.size).toBeGreaterThan(255);
  });
});

describe('the typed walk (perf Task 3)', () => {
  it('kindLatentInto and kindLatent agree', () => {
    const inp = withFinance(bench);
    const fp = financePreOf(inp);
    const pc = precomputeOf(inp);
    const tabs = tablesOf(fp);
    const out = newKindOut();
    let compared = 0;
    let applying = 0;
    for (const seed of [1, 2, 3]) {
      const run = runOf(inp, seed, H, true);
      pc.candidates.forEach((i, c) => {
        const e = inp.parcels.existingUnits[i];
        const d = drawsOf(streamOf(run.sh, pc.entity[c], 0));
        const lat = latentsWith(run, fp, i, asOf, e, d);
        for (const kind of ['market', 'affordable'] as const) {
          const want = lat[kind];
          if (want === null) continue;
          const [u, v] = kind === 'market' ? [d.uO, d.vO] : [d.uA, d.vA];
          // the tables only hold the lots eligible for the kind; any other takes the direct path
          const tab = fp.eligible[kind][c] === 1 ? tabs[kind] : null;
          kindLatentInto(out, run, fp, i, lat.size, kind, asOf, u, v, lat.TO, c, tab);
          expect({ ...out }).toEqual(want);
          kindLatentInto(out, run, fp, i, lat.size, kind, asOf, u, v, lat.TO, -1, null);
          expect({ ...out }).toEqual(want);
          compared++;
          if (want.day !== null) applying++;
        }
      });
    }
    expect(compared).toBeGreaterThan(0);
    expect(applying).toBeGreaterThan(0);
  }, 300_000);
});
