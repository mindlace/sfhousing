import { describe, expect, it } from 'vitest';
import { HORIZON } from '$lib/fzp/time';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { SimInput } from '$lib/sim/scenario/types';
import { monthOfDay } from './months';
import { rowStaticsOf } from './pipeline';
import { staticsOf } from './statics';
import { benchInput } from './test/cities.node';
import { Recorder, SEEDS, horizonMonth, readAll, runWorld } from './test/run';
import { frameOf, oneFrame, oldInputOf, viewOf } from './test/timeline';

/** The bench city with one entitled master whose phase 2 is planned before phase 1's gap ends. */
function outOfOrder(): SimInput {
  const bench = benchInput();
  const master = bench.projects.find((p) => p.id === 'CASE:SYN-M1PRX')!;
  const phases = master.phases!.map((ph, j) => ({
    ...ph,
    plannedPermitFiled: j === 0 ? null : j === 1 ? bench.asOf + 1 : ph.plannedPermitFiled
  }));
  return { ...bench, projects: [{ ...master, phases }] };
}

describe('phases', () => {
  const input = outOfOrder();
  const statics = staticsOf(input);

  // One test per seed (each steps the whole bench city); the last checks some seed swapped.
  let swapped = 0;
  it.each(SEEDS)('seed %i: phases file in day order when a plan date comes first', (seed) => {
    const rec = new Recorder();
    const w = runWorld(statics, oneFrame(frameOf(input)), seed, horizonMonth(input.asOf), rec);
    const filed = rec.events.filter((e) => e.kind === 'phaseFiled');
    expect(filed.length).toBe(input.projects[0].phases!.length);
    for (let i = 1; i < filed.length; i++) {
      expect(filed[i].day).toBeGreaterThanOrEqual(filed[i - 1].day);
    }
    for (const e of filed) expect(monthOfDay(input.asOf, e.day)).toBe(e.month);
    if (filed[0].kind === 'phaseFiled' && filed[0].phase !== 1) swapped++;
    const old = simulateDetailed(oldInputOf(input), seed, HORIZON);
    expect(readAll(w, statics, HORIZON)).toEqual({
      schedules: old.schedules,
      masters: old.masters
    });
  });

  it('some seed files a later phase first', () => {
    expect(swapped).toBeGreaterThan(0);
  });

  it('rowStaticsOf is memoised per statics and view', () => {
    const view = viewOf(input);
    const rs = rowStaticsOf(statics, view);
    expect(rowStaticsOf(statics, view)).toBe(rs);
    expect(rowStaticsOf(staticsOf(input), view)).not.toBe(rs);
    expect(rs[0].phased!.phases.map((ph) => ph.projectId)[1]).toBe('CASE:SYN-M1PRX:phase:2');
  });
});
