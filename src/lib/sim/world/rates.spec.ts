import { beforeAll, describe, expect, it } from 'vitest';
import { ordinaryMonth } from '$lib/sim/scenario/engine';
import {
  lastInitiationMonth,
  piecewiseMonth,
  precomputeOf,
  regimeMonths
} from '$lib/sim/scenario/input';
import { P, drawOn, seedHash, simEntity, streamOf } from '$lib/sim/scenario/rng';
import type { SimInput } from '$lib/sim/scenario/types';
import { log } from '$lib/timelapse/math';
import { MONTH_DAYS } from '$lib/timelapse/time';
import { monthFirstDay, monthLastDay, monthOfDay } from './months';
import type { PolicyFrame, PolicyTimeline, ZoningView } from './policy/frame';
import { lotEntity, ordinaryStart, skipBound, startRates } from './rates';
import { staticsOf, type Statics } from './statics';
import { benchInput } from './test/cities.node';
import { miniInput } from './test/mini';
import {
  IDENTITY,
  changingAt,
  frameOf,
  limited,
  marketAt,
  oneFrame,
  viewOf
} from './test/timeline';

/**
 * Asserts once that nothing was collected, naming the count and the first few: a per-item
 * `expect` over every candidate of the bench city is most of these tests' time.
 */
function expectNone(bad: unknown[]): void {
  expect({ count: bad.length, first: bad.slice(0, 5) }).toEqual({ count: 0, first: [] });
}

const cities: [string, () => SimInput][] = [
  ['mini', miniInput],
  ['bench', benchInput]
];

describe.each(cities)('the ordinary clock on the %s city', (_name, inputOf) => {
  // The city, its precompute and statics are memoised per process: build them once here rather
  // than in whichever test runs first.
  beforeAll(() => {
    const input = inputOf();
    precomputeOf(input);
    staticsOf(input);
  });

  it('startRates is precompute log1mh at the market in force at asOf', () => {
    const input = inputOf();
    const pre = precomputeOf(input);
    const rates = startRates(viewOf(input), marketAt(input, input.asOf));
    expect(rates.length).toBe(pre.log1mh.length);
    const bad: unknown[] = [];
    for (let i = 0; i < rates.length; i++) {
      if (!Object.is(rates[i], pre.log1mh[i])) bad.push({ i, got: rates[i], want: pre.log1mh[i] });
    }
    expectNone(bad);
    expect(startRates(viewOf(input), marketAt(input, input.asOf))).toBe(rates);
  });

  it('lotEntity is simEntity of the lot’s parcel id', () => {
    const input = inputOf();
    const statics = staticsOf(input);
    const pre = precomputeOf(input);
    for (let c = 0; c < pre.candidates.length; c += 97) {
      expect(lotEntity(statics, pre.candidates[c])).toBe(pre.entity[c]);
    }
    expect(lotEntity(statics, 0)).toBe(simEntity(input.parcels.id[0]));
  });

  it('one frame: the day of today’s first initiation, every candidate, seeds 1..3', () => {
    const input = inputOf();
    const pre = precomputeOf(input);
    const statics = staticsOf(input);
    const t = oneFrame(frameOf(input));
    const asOf = input.asOf;
    let planned = 0;
    const bad: unknown[] = [];
    for (const s of [1, 2, 3]) {
      const sh = seedHash(s);
      for (let c = 0; c < pre.candidates.length; c++) {
        const i = pre.candidates[c];
        const stream = streamOf(sh, pre.entity[c], 0);
        const T = ordinaryMonth(drawOn(stream, P.INIT, 0), pre.log1mh[i], null, []);
        const got = ordinaryStart(statics, t, 1, sh, i, asOf, 0);
        if (T === 0) {
          if (got !== null) bad.push({ s, c, got, want: null });
          continue;
        }
        const day = asOf + 1 + Math.floor((T - 1 + drawOn(stream, P.INIT_DAY, 0)) * MONTH_DAYS);
        const month = monthOfDay(asOf, day);
        const frameMonth = monthOfDay(asOf, asOf + 1 + Math.floor((T - 1) * MONTH_DAYS));
        if (got) planned++;
        if (got?.day !== day || got.month !== month || got.frameMonth !== frameMonth) {
          bad.push({ s, c, got, want: { day, month, frameMonth } });
        }
      }
    }
    expectNone(bad);
    expect(planned).toBeGreaterThan(0);
  });

  it('two frames: piecewiseMonth over regimeMonths bounds', () => {
    const input = inputOf();
    const pre = precomputeOf(input);
    const statics = staticsOf(input);
    const asOf = input.asOf;
    const s0 = marketAt(input, asOf);
    const view = viewOf(input);
    const f = frameOf(input);
    const g = frameOf(input, { id: 1, market: s0 + 0.4 });
    const t = changingAt(37, f, g, null);
    const l0 = startRates(view, s0);
    const l1 = startRates(view, s0 + 0.4);
    const sh = seedHash(1);
    let planned = 0;
    const bad: unknown[] = [];
    for (const r of [asOf, asOf + 1000]) {
      const bounds = regimeMonths(r, [monthFirstDay(asOf, 37)]);
      for (let c = 0; c < pre.candidates.length; c++) {
        const i = pre.candidates[c];
        const stream = streamOf(sh, pre.entity[c], 2);
        const T = piecewiseMonth(log(1 - drawOn(stream, P.INIT, 0)), bounds, [l0[i], l1[i]]);
        const got = ordinaryStart(statics, t, 60, sh, i, r, 2);
        if (T === 0) {
          if (got !== null) bad.push({ r, c, got, want: null });
          continue;
        }
        planned++;
        const day = r + 1 + Math.floor((T - 1 + drawOn(stream, P.INIT_DAY, 0)) * MONTH_DAYS);
        const month = monthOfDay(asOf, day);
        const frameMonth = monthOfDay(asOf, r + 1 + Math.floor((T - 1) * MONTH_DAYS));
        if (got?.day !== day || got.month !== month || got.frameMonth !== frameMonth) {
          bad.push({ r, c, got, want: { day, month, frameMonth } });
        }
      }
    }
    expectNone(bad);
    expect(planned).toBeGreaterThan(0);
  });

  it('a change that leaves the rate alone gives exactly the one-frame plan', () => {
    const input = inputOf();
    const pre = precomputeOf(input);
    const statics = staticsOf(input);
    const f = frameOf(input);
    const halfFiled = { ...IDENTITY, discretionary: { filed: 0.5 } };
    const changed = changingAt(37, f, { ...f, id: 1, speed: halfFiled }, null);
    const one = oneFrame(f);
    const sh = seedHash(1);
    const bad: unknown[] = [];
    let planned = 0;
    for (const r of [input.asOf, input.asOf + 1000]) {
      for (let c = 0; c < pre.candidates.length; c++) {
        const i = pre.candidates[c];
        const got = ordinaryStart(statics, changed, 60, sh, i, r, 1);
        const want = ordinaryStart(statics, one, 60, sh, i, r, 1);
        if (want) planned++;
        if (
          got?.day !== want?.day ||
          got?.month !== want?.month ||
          got?.frameMonth !== want?.frameMonth
        ) {
          bad.push({ r, c, got, want });
        }
      }
    }
    expectNone(bad);
    expect(planned).toBeGreaterThan(0);
  });

  it('an empty segment between two changes in a row: unmerged bounds, and A, B, A is one frame', () => {
    const input = inputOf();
    const pre = precomputeOf(input);
    const statics = staticsOf(input);
    const asOf = input.asOf;
    const s0 = marketAt(input, asOf);
    // A free day r and a change month c with no lot-month starting in model month c.
    let r = -1;
    let c = -1;
    for (let d = asOf; d < asOf + 400 && r < 0; d++) {
      for (let m = monthOfDay(asOf, d + 1) + 1; m < 40; m++) {
        const b0 = lastInitiationMonth(d, monthFirstDay(asOf, m) - 1);
        if (b0 === lastInitiationMonth(d, monthFirstDay(asOf, m + 1) - 1)) {
          r = d;
          c = m;
          break;
        }
      }
    }
    expect(r).toBeGreaterThanOrEqual(asOf);
    const fa = frameOf(input);
    const fb = frameOf(input, { id: 1, market: s0 + 0.4 });
    const fc = frameOf(input, { id: 2, market: s0 + 0.8 });
    const steps = (b: PolicyFrame, d: PolicyFrame): PolicyTimeline => ({
      frameAt: (m) => (m > c ? d : m === c ? b : fa),
      changes: () => [c, c + 1],
      touched: () => null,
      readyThrough: () => Number.MAX_SAFE_INTEGER
    });
    const abc = steps(fb, fc);
    const aba = steps(fb, { ...fa, id: 3 });
    const rates = [fa, fb, fc].map((g) => startRates(g.view, g.market));
    const bounds = regimeMonths(r, [monthFirstDay(asOf, c), monthFirstDay(asOf, c + 1)]);
    expect(bounds[0]).toBe(bounds[1]);
    const sh = seedHash(1);
    let planned = 0;
    const bad: unknown[] = [];
    const one = oneFrame(fa);
    for (let j = 0; j < pre.candidates.length; j++) {
      const i = pre.candidates[j];
      const stream = streamOf(sh, pre.entity[j], 0);
      const T = piecewiseMonth(log(1 - drawOn(stream, P.INIT, 0)), bounds, [
        rates[0][i],
        rates[1][i],
        rates[2][i]
      ]);
      const got = ordinaryStart(statics, abc, c + 5, sh, i, r, 0);
      if (T === 0) {
        if (got !== null) bad.push({ abc: j, got, want: null });
      } else {
        planned++;
        const day = r + 1 + Math.floor((T - 1 + drawOn(stream, P.INIT_DAY, 0)) * MONTH_DAYS);
        if (got?.day !== day) bad.push({ abc: j, got, want: day });
      }
      const a = ordinaryStart(statics, aba, c + 5, sh, i, r, 0);
      const o = ordinaryStart(statics, one, c + 5, sh, i, r, 0);
      if (a?.day !== o?.day || a?.month !== o?.month || a?.frameMonth !== o?.frameMonth) {
        bad.push({ aba: j, got: a, want: o });
      }
    }
    expectNone(bad);
    expect(planned).toBeGreaterThan(0);
  });

  it('reads no frame past `month`', () => {
    const input = inputOf();
    const pre = precomputeOf(input);
    const statics = staticsOf(input);
    const f = frameOf(input);
    const g = frameOf(input, { id: 1, market: marketAt(input, input.asOf) + 0.4 });
    const r = monthLastDay(input.asOf, 12);
    const sh = seedHash(1);
    for (const t of [oneFrame(f), changingAt(13, f, g, null), changingAt(37, f, g, null)]) {
      const lim = limited(t, () => 12);
      for (let c = 0; c < Math.min(pre.candidates.length, 500); c++) {
        const i = pre.candidates[c];
        expect(() => ordinaryStart(statics, lim, 12, sh, i, r, 0)).not.toThrow();
      }
    }
  });
});

describe('zero and infinite rates across segments', () => {
  const input = miniInput();
  const asOf = input.asOf;
  const fakeView = (logit: number[]): ZoningView =>
    ({ parcels: input.parcels, pre: { logit: Float64Array.from(logit) } }) as unknown as ZoningView;
  const statics: Statics = { ...staticsOf(input), parcelId: input.parcels.id.slice(0, 3) };
  const before = fakeView([-Infinity, 40, -2]);
  const after = fakeView([40, 40, -2]);
  const f = { ...frameOf(input), market: 0, view: before };
  const g = { ...f, id: 1, view: after };
  const t: PolicyTimeline = changingAt(5, f, g, null);

  it('gives h = 1 a rate of -Infinity and no chance a rate of 0', () => {
    const rates = startRates(before, 0);
    expect(rates[0]).toBe(0);
    expect(rates[1]).toBe(-Infinity);
    expect(rates[2]).toBeLessThan(0);
  });

  it('starts a lot with rate 0 then -Infinity in the change month', () => {
    for (const s of [1, 2, 3]) {
      const got = ordinaryStart(statics, t, 8, seedHash(s), 0, asOf, 0);
      expect(got).not.toBeNull();
      expect(got!.frameMonth).toBe(5);
      expect(got!.day).toBeGreaterThanOrEqual(asOf + 1 + Math.floor(4 * MONTH_DAYS));
      expect(got!.day).toBeLessThanOrEqual(asOf + Math.floor(5 * MONTH_DAYS));
      expect(Number.isNaN(got!.day)).toBe(false);
    }
  });

  it('starts a lot with rate -Infinity from the start in lot-month 1', () => {
    for (const s of [1, 2, 3]) {
      const got = ordinaryStart(statics, t, 8, seedHash(s), 1, asOf, 0);
      expect(got).not.toBeNull();
      expect(got!.frameMonth).toBe(1);
      expect(got!.day).toBeGreaterThanOrEqual(asOf + 1);
      expect(got!.day).toBeLessThanOrEqual(asOf + Math.floor(MONTH_DAYS));
    }
  });

  it('plans no lot whose rate is 0 under every frame read, and none is NaN', () => {
    const none = changingAt(5, f, { ...f, id: 1 }, null);
    expect(ordinaryStart(statics, none, 8, seedHash(1), 0, asOf, 0)).toBeNull();
    const got = ordinaryStart(statics, t, 8, seedHash(1), 2, asOf, 0);
    expect(got).not.toBeNull();
    expect(Number.isFinite(got!.day + got!.month + got!.frameMonth)).toBe(true);
  });

  it('bounds follow lastInitiationMonth from the day the lot became free', () => {
    const r = asOf + 50;
    const got = ordinaryStart(statics, t, 8, seedHash(1), 0, r, 0);
    const T = lastInitiationMonth(r, monthFirstDay(asOf, 5) - 1) + 1;
    expect(got!.frameMonth).toBe(monthOfDay(asOf, r + 1 + Math.floor((T - 1) * MONTH_DAYS)));
  });
});

describe('skipBound memo', () => {
  it('is shared by every month between two frame changes (keyed on the last change)', () => {
    const input = benchInput();
    const statics = staticsOf(input);
    const f = frameOf(input);
    const t = changingAt(10, f, frameOf(input, { id: 1, market: f.market + 1 }), null);
    const before = skipBound(statics, t, 3, 40);
    expect(skipBound(statics, t, 1, 40)).toBe(before);
    expect(skipBound(statics, t, 9, 40)).toBe(before);
    const after = skipBound(statics, t, 10, 40);
    expect(after).not.toBe(before);
    expect(skipBound(statics, t, 25, 40)).toBe(after);
    expect(skipBound(statics, t, 25, 41)).not.toBe(after);
    expect(Array.from(after)).not.toEqual(Array.from(before));
  });
});
