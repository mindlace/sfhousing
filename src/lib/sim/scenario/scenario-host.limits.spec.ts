// The lot-limits line of `parcelSummary` (map overlays plan 2, Task 7): `limits` for a lot in a
// lever session, so the /sim tooltip can read "Allowed: N · Buildable here: M".
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { lotBuildableStories, lotPhysicalMaxStories } from '$lib/generator';
import { DEFAULT_LEVERS, type SimLevers } from '../levers/types';
import { miniCity } from './fixtures/mini-parcels';
import { MINI_HISTORIC_ID } from './fixtures/mini-policy';
import { MINI_AS_OF } from './fixtures/mini-projects';
import { makeScenarioHarness } from './test/host-harness';
import type { ScenarioHostDeps } from './scenario-host';
import type { ScenarioResponse } from './types';

type SummaryPost = Extract<ScenarioResponse, { type: 'parcelSummary' }>;

const city = miniCity();
const LOT: ParcelId = '0026T009';
const cellOf = (id: ParcelId) =>
  city.parcels.cells[city.parcels.cell[city.parcels.index.get(id)!]].cellId;

function bboxOf(cellId: string): [number, number, number, number] {
  const c = city.manifest.chunks.find((x) => x.cellId === cellId)!;
  const x = (c.bbox[0] + c.bbox[2]) / 2;
  const y = (c.bbox[1] + c.bbox[3]) / 2;
  return [x - 1e-6, y - 1e-6, x + 1e-6, y + 1e-6];
}

let warnSpy: MockInstance<typeof console.warn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

async function session(levers: SimLevers, id: ParcelId, deps: Partial<ScenarioHostDeps> = {}) {
  const h = makeScenarioHarness({ deps: { bandRuns: 2, ...deps }, policy: true });
  h.init({ levers: structuredClone(levers) });
  await h.flush();
  h.host.handle({ type: 'prefetch', bbox: bboxOf(cellOf(id)) });
  await h.runAll();
  expect(h.errors()).toEqual([]);
  let reqId = 0;
  return async () => {
    const r = ++reqId;
    h.host.handle({ type: 'parcelSummary', reqId: r, parcelId: id, day: MINI_AS_OF });
    await h.flush();
    return h.posts.find((m): m is SummaryPost => m.type === 'parcelSummary' && m.reqId === r)!
      .summary;
  };
}

const painted = (stories: number): SimLevers => ({
  ...DEFAULT_LEVERS,
  rules: [{ lots: [LOT], stories }],
  compare: 'fzp'
});

describe('parcelSummary limits', () => {
  it('a lot painted to 40 reads allowed 40 and a buildable below it, within the physical max', async () => {
    const summary = await session(painted(40), LOT);
    const s = await summary();
    const rec = city.records.get(LOT)!;
    expect(s?.envelope?.maxStories).toBe(40);
    expect(s?.limits).toMatchObject({ allowed: 40, protected: false });
    const b = s!.limits!.buildable!;
    expect(b).toBeLessThanOrEqual(lotPhysicalMaxStories(rec.polygon)!);
    expect(b).toBeLessThan(40);
  });

  it('a protected historic lot reads protected', async () => {
    const summary = await session(
      { ...DEFAULT_LEVERS, protect: { ...DEFAULT_LEVERS.protect, historic: true }, compare: 'fzp' },
      MINI_HISTORIC_ID
    );
    expect((await summary())?.limits).toMatchObject({ buildable: null, protected: true });
  });

  it('a lot with no plan stories has no limits', async () => {
    // 0026T008 lies outside every height district: plan stories 0
    const summary = await session(DEFAULT_LEVERS, '0026T008');
    expect((await summary())?.limits).toBeUndefined();
  });

  it('a null generate falls back to lotBuildableStories', async () => {
    const summary = await session(painted(40), LOT, { generate: () => null });
    const s = await summary();
    const rec = city.records.get(LOT)!;
    expect(s!.limits!.buildable).toBe(lotBuildableStories(rec.polygon, 40, s!.existingUnits));
  });
});
