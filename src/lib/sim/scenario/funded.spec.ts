// finance-engine Task 5: the funded latent starts of one attempt (spec 4.4).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import { runOf } from './engine';
import { miniCalibrationWithRoutes, miniFinance } from './fixtures/mini-finance';
import {
  attemptLatents,
  financePreOf,
  latentsWith,
  lineKey,
  respell,
  type AttemptLatents,
  type KindLatent
} from './funded';
import { precomputeOf } from './input';
import { P, drawOn, seedHash, simEntity, streamOf } from './rng';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import { simulate } from './simulate';
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
