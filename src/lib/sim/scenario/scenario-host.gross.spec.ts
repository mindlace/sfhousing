// The scenario host's table path (gross-table Task 5): with `scenarios.fzp.gross` a /sim session
// loads gross.bin and resolves each lever revision from the table, with no `resolving` post and
// no chunk fetch. Without the key it keeps the recompute (scenario-host.levers.spec.ts covers it).
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { grossRowOf, grossTableOf } from '$lib/data/gross-table';
import type { ParcelId } from '$lib/data/parcel';
import { scenarioRecordOf } from '$lib/data/scenario-codec';
import { DEFAULT_LEVERS, type SimLevers } from '../levers/types';
import { MINI_GROSS_URL } from './fixtures/mini-gross';
import { MINI_VERSION, miniCity } from './fixtures/mini-parcels';
import { grossBinOf, makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { ScenarioResponse, TimelineResponse } from './types';

type LeversPost = Extract<ScenarioResponse, { type: 'levers' }>;

const WORLD: [number, number, number, number] = [-180, -90, 180, 90];
const N = 5; // band runs: small, so a run completes quickly
const city = miniCity();
/** Two lots in different cells (50_25 and 50_26). */
const LOT_A: ParcelId = '0026T009';
const LOT_B: ParcelId = '2999A001';

/** A fresh copy of `base` with one rule above FZP (uncapped): every named lot is a Need. */
function raised(lots: ParcelId[], stories: number, base: SimLevers = DEFAULT_LEVERS): SimLevers {
  const l = structuredClone(base);
  l.rules.push({ lots, stories });
  return l;
}

function harness(over: { gross?: boolean; bodies?: Record<string, unknown> } = {}) {
  return makeScenarioHarness({
    deps: { bandRuns: N },
    policy: true,
    gross: over.gross ?? true,
    bodies: over.bodies
  });
}

let warnSpy: MockInstance<typeof console.warn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

const timelines = (h: ScenarioHarness): TimelineResponse[] =>
  h.posts.filter((m): m is TimelineResponse => m.type === 'timeline');
const leversPosts = (h: ScenarioHarness): LeversPost[] =>
  h.posts.filter((m): m is LeversPost => m.type === 'levers');
const content = (t: TimelineResponse) => ({
  rev: t.rev,
  seed: t.seed,
  revision: t.render.revision,
  score: t.score,
  bandRuns: t.bandRuns,
  bandRunsTotal: t.bandRunsTotal,
  complete: t.complete
});
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const chunkUrls = new Set(Object.keys(city.chunks));
const chunkFetches = (h: ScenarioHarness) => h.fetches.filter((f) => chunkUrls.has(f.url));
const indexOf = (h: ScenarioHarness, pred: (m: ScenarioResponse) => boolean) =>
  h.posts.findIndex(pred);

/** The mini gross rows, as `miniGross` builds them. */
const rows = () =>
  Array.from({ length: city.parcels.count }, (_, i) =>
    grossRowOf(scenarioRecordOf(city.parcels, i, city.records.get(city.parcels.id[i] as ParcelId)!))
  );

describe('scenario host with gross.bin', () => {
  it('with gross.bin a lever revision posts no resolving and fetches no chunk', async () => {
    const h = harness();
    const rev = h.init({ levers: raised([LOT_A, LOT_B], 8) });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(h.fetchesOf(MINI_GROSS_URL)).toHaveLength(1);
    expect(leversPosts(h).map((m) => m.phase)).toEqual(['current']);
    expect(chunkFetches(h)).toEqual([]);
    const heights = indexOf(h, (m) => m.type === 'heights' && m.rev === rev);
    const current = indexOf(h, (m) => m.type === 'levers' && m.phase === 'current');
    const first = indexOf(h, (m) => m.type === 'timeline');
    expect(heights).toBeGreaterThanOrEqual(0);
    expect(heights).toBeLessThan(current);
    expect(current).toBeLessThan(first);
  });

  it('table and recompute give the same current and the same timelines', async () => {
    const run = async (gross: boolean) => {
      const h = harness({ gross });
      h.init({ levers: raised([LOT_A, LOT_B], 8) });
      await h.runAll();
      expect(timelines(h).length).toBeGreaterThan(0);
      h.host.handle({ type: 'prefetch', bbox: WORLD });
      await h.runAll();
      expect(h.errors()).toEqual([]);
      const current = leversPosts(h).filter((m) => m.phase === 'current');
      expect(current).toHaveLength(1);
      const { lookups, capacity, unknownLots } = current[0] as Extract<
        LeversPost,
        { phase: 'current' }
      >;
      return { current: { lookups, capacity, unknownLots }, timelines: timelines(h).map(content) };
    };
    const table = await run(true);
    const recompute = await run(false);
    expect(table.current).toEqual(recompute.current);
    expect(sha(table.timelines)).toBe(sha(recompute.timelines));
  });

  it('a manifest without gross runs the recompute and never fetches gross.bin', async () => {
    const h = harness({ gross: false }); // the body is served anyway
    h.init({ levers: raised([LOT_A, LOT_B], 8) });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(h.fetchesOf(MINI_GROSS_URL)).toEqual([]);
    const phases = leversPosts(h).map((m) => m.phase);
    expect(phases[0]).toBe('resolving');
    expect(phases.at(-1)).toBe('current');
    expect(chunkFetches(h).length).toBeGreaterThan(0);
  });

  it('/fzp never fetches gross.bin even when the manifest names it', async () => {
    const h = harness();
    h.init();
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(timelines(h).length).toBeGreaterThan(0);
    expect(h.fetchesOf(MINI_GROSS_URL)).toEqual([]);
  });

  it('a gross.bin with another row count fails the load as scenario-invalid', async () => {
    const short = grossBinOf(grossTableOf(MINI_VERSION, rows().slice(1)));
    const h = harness({ bodies: { [MINI_GROSS_URL]: short } });
    h.init({ levers: raised([LOT_A, LOT_B], 8) });
    await h.runAll();
    expect(h.errors()).toHaveLength(1);
    expect(h.errors()[0].code).toBe('scenario-invalid');
    expect(h.errors()[0].message).toContain('gross.bin');
    expect(leversPosts(h)).toEqual([]);
  });

  it('a gross.bin from another datasetVersion fails the load as scenario-invalid', async () => {
    const other = grossBinOf(grossTableOf('fixture-61', rows()));
    const h = harness({ bodies: { [MINI_GROSS_URL]: other } });
    h.init({ levers: raised([LOT_A, LOT_B], 8) });
    await h.runAll();
    expect(h.errors()).toHaveLength(1);
    expect(h.errors()[0].code).toBe('scenario-invalid');
    expect(h.errors()[0].message).toMatch(/^scenario gross\.bin: .*fixture-61/);
    expect(leversPosts(h)).toEqual([]);
  });

  it('a gross.bin that does not decode fails the load as scenario-invalid', async () => {
    const h = harness({ bodies: { [MINI_GROSS_URL]: new Uint8Array([1, 2, 3]) } });
    h.init({ levers: raised([LOT_A, LOT_B], 8) });
    await h.runAll();
    expect(h.errors()).toHaveLength(1);
    expect(h.errors()[0].code).toBe('scenario-invalid');
    expect(h.errors()[0].message).toMatch(/^scenario gross\.bin: /);
    expect(leversPosts(h)).toEqual([]);
  });

  it('a gross.bin that 404s on every attempt fails the load', async () => {
    const h = harness();
    h.fail(MINI_GROSS_URL, 4, { status: 404 });
    h.init({ levers: raised([LOT_A, LOT_B], 8) });
    await h.runAll();
    expect(h.errors()).toHaveLength(1);
    expect(h.errors()[0].code).toBe('internal');
    expect(h.errors()[0].message).toContain(MINI_GROSS_URL);
    expect(h.fetchesOf(MINI_GROSS_URL)).toHaveLength(4);
    expect(leversPosts(h)).toEqual([]);
  });
});
