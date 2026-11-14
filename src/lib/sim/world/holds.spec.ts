import { describe, expect, it } from 'vitest';
import { emptyWorld, lotRow } from './columns';
import { planDue } from './due';
import { block, holdEnd, holdStart, passToPhases } from './holds';
import type { RowStatics } from './pipeline';
import { seedHash } from '$lib/sim/scenario/rng';
import { ordinaryStart } from './rates';
import { staticsOf } from './statics';
import { fixtureInput } from './test/cities.node';
import { frameOf, oneFrame } from './test/timeline';
import { LOT_DONE, LOT_FREE, LOT_HELD, ORIGIN_MASTER } from './types';
import { createWorld, step } from './world';

const ASOF = 1000;
const lots = (...a: number[]) => Int32Array.from(a);

function state(w: ReturnType<typeof emptyWorld>, lot: number) {
  const i = lotRow(w.lots, lot);
  return { state: w.lots.state[i], r: w.lots.r[i], k: w.lots.k[i], holders: w.lots.holders[i] };
}

describe('holds', () => {
  it('a lot is freed by its last holder’s exit, from the latest exit day, on attempt 0', () => {
    const w = emptyWorld(0);
    holdStart(w, lots(4, 2), ASOF);
    holdStart(w, lots(4), ASOF);
    const freed: number[] = [];
    holdEnd(w, lots(4, 2), 1300, freed);
    expect(freed).toEqual([2]);
    expect(state(w, 2)).toEqual({ state: LOT_FREE, r: 1300, k: 0, holders: 0 });
    expect(state(w, 4).state).toBe(LOT_HELD);
    holdEnd(w, lots(4), 1200, freed);
    expect(freed).toEqual([2, 4]);
    expect(state(w, 4)).toEqual({ state: LOT_FREE, r: 1300, k: 0, holders: 0 });
  });

  it('a completion or a skipped holder blocks a lot for good', () => {
    const w = emptyWorld(0);
    holdStart(w, lots(1, 3), ASOF);
    holdStart(w, lots(3), ASOF);
    block(w, lots(5), ASOF);
    const freed: number[] = [];
    holdEnd(w, lots(1, 3), null, freed);
    holdEnd(w, lots(3), 1500, freed);
    expect(freed).toEqual([]);
    expect([1, 3, 5].map((l) => state(w, l).state)).toEqual([LOT_DONE, LOT_DONE, LOT_DONE]);
  });

  it('at entitlement a master blocks its rest and passes its holds to its phases', () => {
    const w = emptyWorld(0);
    const rs = [
      {
        entity: 0,
        rows: lots(1, 2, 3),
        yieldCap: 0,
        envelope: 0,
        phased: {
          all: lots(1, 2, 3, 4),
          rest: lots(1, 3),
          phases: [
            {
              projectId: 'm:phase:1',
              entity: 0,
              rows: lots(2, 4),
              existing: 0,
              yieldCap: 0,
              envelope: 0
            }
          ]
        }
      }
    ] as unknown as RowStatics;
    w.projects.n = 1;
    w.projects.origin = Uint8Array.of(ORIGIN_MASTER);
    w.projects.src = Int32Array.of(0);
    holdStart(w, rs[0].phased!.all, ASOF);
    passToPhases(w, rs, 0, ASOF);
    expect([1, 3].map((l) => state(w, l).state)).toEqual([LOT_DONE, LOT_DONE]);
    expect(state(w, 2)).toMatchObject({ state: LOT_HELD, holders: 1 });
    expect(state(w, 4)).toMatchObject({ state: LOT_HELD, holders: 1 });
    const freed: number[] = [];
    holdEnd(w, lots(2, 4), 1400, freed);
    expect(freed).toEqual([2, 4]);
  });
});

describe('the step and the due list', () => {
  it('throws when a lot is due in a month its start is not in', async () => {
    const input = await fixtureInput();
    const statics = staticsOf(input);
    const timeline = oneFrame(frameOf(input));
    const w = createWorld(statics, timeline, 1, { event() {} });
    const due = planDue(w, statics, timeline, 1, 600);
    let lot = -1;
    for (let i = 0; i < statics.parcelId.length && lot < 0; i++) {
      if (lotRow(w.lots, i) >= 0) continue;
      const s = ordinaryStart(statics, timeline, 1, seedHash(1), i, statics.asOf, 0);
      if (s !== null && s.month > 1) lot = i;
    }
    expect(lot).toBeGreaterThanOrEqual(0);
    due.put(lot, 1);
    expect(() => step(w, due, statics, timeline, 1, { event() {} })).toThrow(
      'due list out of step'
    );
  });
});
