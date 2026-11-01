// The scenario host's `lotOutlines` request (map overlays plan, Task 5): the ring outlines of
// lots whose chunk is loaded, answered only in a lever session.
import { describe, expect, it } from 'vitest';
import { toLngLat } from '$lib/generator/geo';
import { DEFAULT_LEVERS } from '../levers/types';
import { miniCity } from './fixtures/mini-parcels';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { LotOutlinesResult, ScenarioResponse } from './types';

type OutlinePost = Extract<ScenarioResponse, { type: 'lotOutlines' }>;

const city = miniCity();

function harness(): ScenarioHarness {
  return makeScenarioHarness({ deps: { bandRuns: 2 }, policy: true });
}

/** A tiny bbox at the centre of one cell that intersects no other cell. */
function bboxOf(cellId: string): [number, number, number, number] {
  const c = city.manifest.chunks.find((x) => x.cellId === cellId)!;
  const x = (c.bbox[0] + c.bbox[2]) / 2;
  const y = (c.bbox[1] + c.bbox[3]) / 2;
  return [x - 1e-6, y - 1e-6, x + 1e-6, y + 1e-6];
}

let reqId = 0;
function ask(h: ScenarioHarness, lots: string[]): number {
  const id = ++reqId;
  h.host.handle({ type: 'lotOutlines', reqId: id, lots });
  return id;
}
function answer(h: ScenarioHarness, id: number): LotOutlinesResult {
  const ps = h.posts.filter((m): m is OutlinePost => m.type === 'lotOutlines' && m.reqId === id);
  expect(ps).toHaveLength(1);
  return ps[0].result;
}

describe('lotOutlines', () => {
  it('answers the loaded lot, counts the unloaded and unknown ones as missing', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.flush();
    h.host.handle({ type: 'prefetch', bbox: bboxOf('50_25') });
    await h.flush();
    const inCell0 = '0026T001A';
    const otherCell = '2999A001';
    const id = ask(h, [otherCell, inCell0, 'NOPE']);
    const r = answer(h, id);
    if (!r.ok) throw new Error(`not ok: ${r.message}`);
    expect(r.lots).toEqual([inCell0]);
    expect(r.missing).toBe(2);
    expect(r.starts.at(-1)! * 2).toBe(r.positions.length);
    expect(r.starts.length).toBe(r.ringLot.length + 1);
    expect([...r.ringLot].every((k) => k === 0)).toBe(true);
    const rec = city.records.get(inCell0)!;
    const first = toLngLat(rec.polygon[0], rec.labelPoint)[0];
    expect([r.positions[0], r.positions[1]]).toEqual(first);
    // the typed arrays are transferred
    const k = h.posts.findIndex((m) => m.type === 'lotOutlines' && m.reqId === id);
    expect(h.transfers[k]).toEqual([r.ringLot.buffer, r.starts.buffer, r.positions.buffer]);
  });

  it('answers no-session without levers', async () => {
    const h = harness();
    h.init();
    await h.flush();
    const r = answer(h, ask(h, ['0026T001A']));
    expect(r).toMatchObject({ ok: false, reason: 'no-session' });
  });
});
