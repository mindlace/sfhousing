// The scenario host's `lotAt` request (sim UX plan 4, Task 3): the lot under a point and the
// layer that sets its height limit, answered at once from the limits the worker holds.
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { toLngLat } from '$lib/generator/geo';
import { DEFAULT_LEVERS, type SimLevers } from '../levers/types';
import { miniCity } from './fixtures/mini-parcels';
import { MINI_HISTORIC_ID } from './fixtures/mini-policy';
import { MINI_AS_OF } from './fixtures/mini-projects';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { LotAtResult, ScenarioResponse } from './types';

type LotAtPost = Extract<ScenarioResponse, { type: 'lotAt' }>;
type SummaryPost = Extract<ScenarioResponse, { type: 'parcelSummary' }>;

const city = miniCity();
const X: ParcelId = '0026T009';
const VACANT: ParcelId = '0026T003';
const cellOf = (id: ParcelId) =>
  city.parcels.cells[city.parcels.cell[city.parcels.index.get(id)!]].cellId;

function bboxOf(cellId: string): [number, number, number, number] {
  const c = city.manifest.chunks.find((x) => x.cellId === cellId)!;
  const x = (c.bbox[0] + c.bbox[2]) / 2;
  const y = (c.bbox[1] + c.bbox[3]) / 2;
  return [x - 1e-6, y - 1e-6, x + 1e-6, y + 1e-6];
}

async function loaded(levers?: SimLevers, also: ParcelId[] = []): Promise<ScenarioHarness> {
  const h = makeScenarioHarness({ deps: { bandRuns: 2 }, policy: true });
  h.init(levers ? { levers: structuredClone(levers) } : undefined);
  await h.flush();
  for (const id of [X, ...also]) h.host.handle({ type: 'prefetch', bbox: bboxOf(cellOf(id)) });
  await h.runAll();
  expect(h.errors()).toEqual([]);
  return h;
}

let reqId = 0;
function lotAt(h: ScenarioHarness, point: [number, number]): LotAtResult {
  const id = ++reqId;
  h.host.handle({ type: 'lotAt', reqId: id, point });
  const ps = h.posts.filter((m): m is LotAtPost => m.type === 'lotAt' && m.reqId === id);
  expect(h.errors()).toEqual([]);
  expect(ps).toHaveLength(1);
  return ps[0].result;
}

const labelOf = (id: ParcelId) => city.records.get(id)!.labelPoint;
const raised = (ruleId: string): SimLevers => ({
  ...DEFAULT_LEVERS,
  rules: [{ lots: [X], stories: 40, source: ruleId }],
  compare: 'fzp'
});

describe('lotAt', () => {
  it('answers the lot and the rule that raises it', async () => {
    const h = await loaded(raised('layer-1'));
    expect(lotAt(h, labelOf(X))).toEqual({
      ok: true,
      parcelId: X,
      owner: { kind: 'rule', ruleId: 'layer-1' }
    });
  });

  it('answers fzp for a vacant lot under no rule', async () => {
    const h = await loaded(raised('layer-1'));
    expect(lotAt(h, labelOf(VACANT))).toEqual({
      ok: true,
      parcelId: VACANT,
      owner: { kind: 'fzp' }
    });
  });

  it('answers fzp for a protected lot a rule names', async () => {
    const h = await loaded(
      {
        ...DEFAULT_LEVERS,
        protect: { ...DEFAULT_LEVERS.protect, historic: true },
        rules: [{ lots: [MINI_HISTORIC_ID], stories: 40, source: 'layer-1' }],
        compare: 'fzp'
      },
      [MINI_HISTORIC_ID]
    );
    expect(lotAt(h, labelOf(MINI_HISTORIC_ID))).toEqual({
      ok: true,
      parcelId: MINI_HISTORIC_ID,
      owner: { kind: 'fzp' }
    });
  });

  it('answers parcelId null at a point in no lot, in a loaded cell or in none', async () => {
    const h = await loaded(raised('layer-1'));
    const c = city.manifest.chunks.find((x) => x.cellId === cellOf(X))!;
    expect(lotAt(h, [c.bbox[0], c.bbox[1]])).toEqual({ ok: true, parcelId: null, owner: null });
    expect(lotAt(h, [-122.9, 37.2])).toEqual({ ok: true, parcelId: null, owner: null });
  });

  it('finds a lot by a point of its ring in lng/lat, not only its label point', async () => {
    const h = await loaded(raised('layer-1'));
    const rec = city.records.get(X)!;
    const ring = toLngLat(rec.polygon[0], rec.labelPoint);
    const mid: [number, number] = [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2];
    expect(lotAt(h, mid)).toMatchObject({ ok: true, parcelId: X });
  });

  it('answers no-session without levers', async () => {
    const h = await loaded();
    expect(lotAt(h, labelOf(X))).toMatchObject({ ok: false, reason: 'no-session' });
  });

  it('answers at once, owner null, before the session has any limits', async () => {
    const h = makeScenarioHarness({ deps: { bandRuns: 2 }, policy: true });
    h.init({ levers: structuredClone(raised('layer-1')) });
    await h.flush();
    h.host.handle({ type: 'prefetch', bbox: bboxOf(cellOf(X)) });
    await h.flush();
    expect(lotAt(h, labelOf(X))).toEqual({ ok: true, parcelId: X, owner: null });
  });

  it('parcelSummary carries limits.owner', async () => {
    const h = await loaded(raised('layer-1'));
    const id = ++reqId;
    h.host.handle({ type: 'parcelSummary', reqId: id, parcelId: X, day: MINI_AS_OF });
    await h.flush();
    const s = h.posts.find(
      (m): m is SummaryPost => m.type === 'parcelSummary' && m.reqId === id
    )!.summary;
    expect(s?.limits).toMatchObject({ allowed: 40, owner: { kind: 'rule', ruleId: 'layer-1' } });
  });
});
