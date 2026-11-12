// finance-score test 23 (spec 4.9, 6): the shown run's `tiers` and `money` on every timeline post.
// Revision 0 carries both (money only with a pool), band-only posts carry the same values, the
// twin and the band stay on `simulateNet`, and `moneyOf` gets the twin input's pools as baseline.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Day } from '$lib/timelapse/time';
import { MINI_SCENARIO_URLS } from './fixtures/mini-parcels';
import { fundedCalibration } from './test/funded-calibration';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { SimInput, TimelineResponse } from './types';

type Call = { fn: 'net' | 'detailed'; twin: boolean; seed: number; input: SimInput };
/** A finance warm step or simulate call and the harness step (timer callback) it ran in. */
type Event = { fn: 'warm' | 'net' | 'detailed'; step: number; input: SimInput };

const hooks = vi.hoisted(() => ({
  calls: [] as Call[],
  events: [] as Event[],
  step: 0,
  /** with a finance, replace its pools and programmes by [] (parseCalibration rejects that) */
  emptyPools: false
}));

vi.mock('./simulate', async (importOriginal) => {
  const m = await importOriginal<typeof import('./simulate')>();
  const record = (fn: Call['fn'], input: SimInput, seed: number) => {
    const twin = input.parcels.envelopeStories === input.parcels.baseStories;
    hooks.calls.push({ fn, twin, seed, input });
    hooks.events.push({ fn, step: hooks.step, input });
  };
  return {
    ...m,
    simulateNet: vi.fn((input: SimInput, seed: number, horizon: Day, months: Day[]) => {
      record('net', input, seed);
      return m.simulateNet(input, seed, horizon, months);
    }),
    simulateDetailed: vi.fn((input: SimInput, seed: number, horizon: Day) => {
      record('detailed', input, seed);
      return m.simulateDetailed(input, seed, horizon);
    })
  };
});

vi.mock('./funded', async (importOriginal) => {
  const m = await importOriginal<typeof import('./funded')>();
  return {
    ...m,
    financeWarm: vi.fn((input: SimInput, horizon: Day) => {
      const warm = m.financeWarm(input, horizon);
      return {
        step(maxCandidates: number) {
          hooks.events.push({ fn: 'warm', step: hooks.step, input });
          return warm.step(maxCandidates);
        }
      };
    })
  };
});

vi.mock('./finance-score', async (importOriginal) => {
  const m = await importOriginal<typeof import('./finance-score')>();
  return { ...m, moneyOf: vi.fn(m.moneyOf) };
});

vi.mock('./input', async (importOriginal) => {
  const m = await importOriginal<typeof import('./input')>();
  return {
    ...m,
    buildSimInput: vi.fn((...a: Parameters<typeof m.buildSimInput>) => {
      const input = m.buildSimInput(...a);
      if (!hooks.emptyPools || !input.finance) return input;
      return { ...input, finance: { ...input.finance, pools: [], programmes: [] } };
    })
  };
});

const { moneyOf } = await import('./finance-score');
const moneyOfSpy = vi.mocked(moneyOf);

const N = 17; // lowered band size
const SEED = 1000; // no band seed, so the shown run is told apart

function harness(
  calibration?: unknown,
  warmFinance?: boolean,
  warmChunk?: number
): ScenarioHarness {
  hooks.calls.length = 0;
  hooks.events.length = 0;
  hooks.step = 0;
  moneyOfSpy.mockClear();
  return makeScenarioHarness({
    deps: {
      bandRuns: N,
      ...(warmFinance === undefined ? {} : { warmFinance }),
      ...(warmChunk === undefined ? {} : { warmChunk })
    },
    ...(calibration ? { bodies: { [MINI_SCENARIO_URLS.calibration]: calibration } } : {})
  });
}

const timelines = (h: ScenarioHarness): TimelineResponse[] =>
  h.posts.filter((m): m is TimelineResponse => m.type === 'timeline');

let warnSpy: MockInstance<typeof console.warn>;
beforeEach(() => {
  hooks.emptyPools = false;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  expect(warnSpy.mock.calls).toEqual([]);
  warnSpy.mockRestore();
});

describe('scenario host: tiers and money (finance-score test 23)', () => {
  it('revision 0 carries tiers and money; band-only posts carry the same', async () => {
    const h = harness(fundedCalibration());
    h.init({ seed: SEED });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const ts = timelines(h);
    expect(ts.length).toBeGreaterThan(1);
    const r0 = ts[0];
    expect(r0.render.revision).toBe(0);
    expect(r0.score.tiers!.targets).toHaveLength(4);
    expect(r0.score.money!.pools.map((p) => p.id)).toEqual(['m-city', 'm-bank', 'federal']);
    const later = ts.slice(1);
    for (const t of later) {
      expect(t.render.cells).toEqual([]);
      expect(t.score.tiers).toEqual(r0.score.tiers);
      expect(t.score.money).toEqual(r0.score.money);
    }
    // the tier sums of the last month are the shown run's completedNet
    const last = r0.score.tiers!.completed.at(-1)!;
    const sum = last.veryLow + last.low + last.moderate + last.aboveModerate + last.unrecorded;
    expect(sum).toBe(r0.score.shown.at(-1)!.completedNet);
  });

  it('only the shown run is detailed; the twin and the band run simulateNet', async () => {
    const h = harness(fundedCalibration());
    h.init({ seed: SEED });
    await h.runAll();
    const detailed = hooks.calls.filter((c) => c.fn === 'detailed');
    expect(detailed).toHaveLength(1);
    expect(detailed[0]).toMatchObject({ twin: false, seed: SEED });
    const twin = hooks.calls.filter((c) => c.twin);
    expect(twin.length).toBeGreaterThan(0);
    for (const c of twin) expect(c.fn).toBe('net');
    expect(hooks.calls.filter((c) => c.fn === 'net')).toHaveLength(hooks.calls.length - 1);
  });

  it("moneyOf gets the twin input's pools as baseline, once per run", async () => {
    const h = harness(fundedCalibration());
    h.init({ seed: SEED });
    await h.runAll();
    const twin = hooks.calls.find((c) => c.twin)!.input;
    expect(twin.finance!.pools.length).toBe(3);
    expect(moneyOfSpy).toHaveBeenCalledTimes(1);
    expect(moneyOfSpy.mock.calls[0][0].baseline).toEqual(twin.finance!.pools);
  });

  it('without funding: tiers on every post, no money key', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    const ts = timelines(h);
    expect(ts.length).toBeGreaterThan(1);
    for (const t of ts) {
      expect(t.score.tiers!.targets).toHaveLength(4);
      expect('money' in t.score).toBe(false);
    }
    expect(moneyOfSpy).not.toHaveBeenCalled();
  });

  it('with finance but no pools: tiers, no money key', async () => {
    hooks.emptyPools = true;
    const h = harness(fundedCalibration());
    h.init({ seed: SEED });
    await h.runAll();
    const shownInput = hooks.calls.find((c) => c.fn === 'detailed')!.input;
    expect(shownInput.finance!.pools).toEqual([]);
    const ts = timelines(h);
    expect(ts.length).toBeGreaterThan(1);
    for (const t of ts) {
      expect(t.score.tiers!.targets).toHaveLength(4);
      expect('money' in t.score).toBe(false);
    }
    expect(moneyOfSpy).not.toHaveBeenCalled();
  });
});

/** Fires the harness's timers one at a time, numbering each step in `hooks.step`. */
async function stepAll(h: ScenarioHarness): Promise<void> {
  for (;;) {
    hooks.step++;
    if (!(await h.step())) return;
  }
}

describe('scenario host: the finance precompute is warmed (finance-levers I2)', () => {
  it('the finance precompute is warmed in tasks of its own before the first band task', async () => {
    const h = harness(fundedCalibration(), undefined, 1);
    h.init({ seed: null }); // the FZP band runs come first
    await stepAll(h);
    expect(h.errors()).toEqual([]);
    const sims = hooks.events.filter((e) => e.fn !== 'warm');
    const firstNet = sims.find((e) => e.fn === 'net')!;
    expect(firstNet.input.parcels.envelopeStories).not.toBe(firstNet.input.parcels.baseStories);
    const inputs = [...new Set(sims.map((e) => e.input))];
    expect(inputs).toHaveLength(2); // the FZP input and its twin
    for (const input of inputs) {
      const warms = hooks.events.filter((e) => e.fn === 'warm' && e.input === input);
      // one candidate per step: several warm tasks per input, one step per task
      expect(new Set(warms.map((e) => e.step)).size).toBe(warms.length);
      expect(warms.length).toBeGreaterThan(1);
      for (const warm of warms) {
        expect(sims.filter((e) => e.step === warm.step)).toEqual([]);
        expect(warm.step).toBeLessThan(firstNet.step);
      }
    }
  });

  it('warming changes no output', async () => {
    const outputs = async (warmFinance: boolean) => {
      const h = harness(fundedCalibration(), warmFinance);
      h.init({ seed: null });
      await h.runAll();
      expect(h.errors()).toEqual([]);
      const ts = timelines(h);
      const r0 = ts.find((t) => t.render.revision === 0)!;
      const last = ts.at(-1)!;
      expect(last.bandRuns).toBe(last.bandRunsTotal);
      return {
        r0: { score: r0.score, render: r0.render },
        last: { score: last.score, render: last.render, bandRuns: last.bandRuns }
      };
    };
    const warm = await outputs(true);
    const cold = await outputs(false);
    expect(warm.r0.score.money).toBeDefined();
    expect(warm).toEqual(cold);
  });
});
