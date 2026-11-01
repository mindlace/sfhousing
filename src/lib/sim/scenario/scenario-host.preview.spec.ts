// The scenario host's `previewBuildings` request (map overlays plan 2, Task 6): the buildings a
// painted stroke's or a saved rule's lots could hold, packed as one cell for the paint feedback.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { lotPhysicalMaxStories } from '$lib/generator';
import { DEFAULT_LEVERS, type SimLevers } from '../levers/types';
import { miniCity } from './fixtures/mini-parcels';
import { MINI_HISTORIC_ID } from './fixtures/mini-policy';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { PreviewResult, ScenarioResponse } from './types';
import type { ScenarioHostDeps } from './scenario-host';

type PreviewPost = Extract<ScenarioResponse, { type: 'previewBuildings' }>;

const city = miniCity();
/** Cell 50_25 is the one loaded: two of its lots, and one of cell 50_26 (not loaded). */
const LOADED_LOT: ParcelId = '0026T009';
const OTHER_LOADED_LOT: ParcelId = '0026T014';
const UNLOADED_LOT: ParcelId = '2999A001';
const cellOf = (id: ParcelId) =>
  city.parcels.cells[city.parcels.cell[city.parcels.index.get(id)!]].cellId;

/** A tiny bbox at the centre of one cell that intersects no other cell. */
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
afterEach(() => {
  warnSpy.mockRestore();
});

/** A lever session run until its first `current`, with `cells` loaded (default: LOADED_LOT's). */
async function leverSession(
  levers: SimLevers,
  deps: Partial<ScenarioHostDeps> = {},
  cells: string[] = [cellOf(LOADED_LOT)]
) {
  const h: ScenarioHarness = makeScenarioHarness({ deps: { bandRuns: 2, ...deps }, policy: true });
  h.init({ levers: structuredClone(levers) });
  await h.flush();
  for (const c of cells) h.host.handle({ type: 'prefetch', bbox: bboxOf(c) });
  await h.runAll();
  expect(h.errors()).toEqual([]);
  let reqId = 0;
  return {
    h,
    record: (id: ParcelId) => city.records.get(id)!,
    async preview(lots: ParcelId[], stories?: number): Promise<PreviewResult> {
      const id = ++reqId;
      h.host.handle({
        type: 'previewBuildings',
        reqId: id,
        lots,
        ...(stories === undefined ? {} : { stories })
      });
      await h.flush();
      const ps = h.posts.filter(
        (m): m is PreviewPost => m.type === 'previewBuildings' && m.reqId === id
      );
      expect(ps).toHaveLength(1);
      return ps[0].result;
    }
  };
}

describe('previewBuildings', () => {
  it('a stroke height builds the loaded lots at that height, at most the physical max', async () => {
    const h = await leverSession(DEFAULT_LEVERS);
    const r = await h.preview([LOADED_LOT, UNLOADED_LOT], 40);
    expect(r).toMatchObject({ ok: true, missing: 1 });
    if (!r.ok) throw new Error(r.message);
    const s = r.pack!.parcelIds.indexOf(LOADED_LOT);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(r.pack!.parcelMeta[4 * s + 2]).toBeLessThanOrEqual(
      Math.min(40, lotPhysicalMaxStories(h.record(LOADED_LOT).polygon)!)
    );
    expect(r.pack!.cellId).toBe('preview');
    // the pack's buffers are transferred
    const k = h.h.posts.findLastIndex((m) => m.type === 'previewBuildings');
    expect(h.h.transfers[k]).toContain(r.pack!.positions.buffer);
  });

  it('a protected lot builds nothing', async () => {
    const h = await leverSession(
      { ...DEFAULT_LEVERS, protect: { ...DEFAULT_LEVERS.protect, historic: true }, compare: 'fzp' },
      {},
      [cellOf(MINI_HISTORIC_ID)]
    );
    // loaded, so `built: 0` is the protection, not a missing record
    const loaded = await h.preview([MINI_HISTORIC_ID], 40);
    expect(loaded).toMatchObject({ ok: true, built: 0, pack: null, missing: 0 });
  });

  it('the same lot unprotected builds', async () => {
    const h = await leverSession(DEFAULT_LEVERS, {}, [cellOf(MINI_HISTORIC_ID)]);
    expect(await h.preview([MINI_HISTORIC_ID], 40)).toMatchObject({ ok: true, built: 1 });
  });

  it('without stories, only lots the policy changed build, at their plan height', async () => {
    const h = await leverSession({
      ...DEFAULT_LEVERS,
      rules: [{ lots: [LOADED_LOT], stories: 30 }],
      compare: 'fzp'
    });
    const r = await h.preview([LOADED_LOT, OTHER_LOADED_LOT]);
    expect(r.ok && r.pack!.parcelIds).toEqual([LOADED_LOT]);
  });

  it('cap: builds at most previewMaxLots, in request order', async () => {
    const h = await leverSession(DEFAULT_LEVERS, { previewMaxLots: 1 });
    const r = await h.preview([LOADED_LOT, OTHER_LOADED_LOT], 12);
    expect(r.ok && r.pack!.parcelIds).toEqual([LOADED_LOT]);
  });

  it('answers no-session without levers', async () => {
    const h = makeScenarioHarness({ deps: { bandRuns: 2 }, policy: true });
    h.init();
    await h.flush();
    h.host.handle({ type: 'previewBuildings', reqId: 1, lots: [LOADED_LOT], stories: 8 });
    const p = h.posts.find((m): m is PreviewPost => m.type === 'previewBuildings');
    expect(p?.result).toMatchObject({ ok: false, reason: 'no-session' });
  });
});
