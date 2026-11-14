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

  // Each seed's phase filings, kept from whichever test ran the seed first (each run steps the
  // whole bench city), so each test holds on its own when run alone or shuffled.
  const filings = new Map<number, Recorder['events']>();
  const runOf = (seed: number) => {
    const rec = new Recorder();
    const w = runWorld(statics, oneFrame(frameOf(input)), seed, horizonMonth(input.asOf), rec);
    const filed = rec.events.filter((e) => e.kind === 'phaseFiled');
    filings.set(seed, filed);
    return { w, filed };
  };
  const firstPhase = (seed: number) => {
    const filed = filings.get(seed) ?? runOf(seed).filed;
    const first = filed[0];
    return first !== undefined && first.kind === 'phaseFiled' ? first.phase : 0;
  };

  it.each(SEEDS)('seed %i: phases file in day order when a plan date comes first', (seed) => {
    const { w, filed } = runOf(seed);
    expect(filed.length).toBe(input.projects[0].phases!.length);
    for (let i = 1; i < filed.length; i++) {
      expect(filed[i].day).toBeGreaterThanOrEqual(filed[i - 1].day);
    }
    for (const e of filed) expect(monthOfDay(input.asOf, e.day)).toBe(e.month);
    const old = simulateDetailed(oldInputOf(input), seed, HORIZON);
    expect(readAll(w, statics, HORIZON)).toEqual({
      schedules: old.schedules,
      masters: old.masters
    });
  });

  it('some seed files a later phase first', () => {
    expect(SEEDS.some((seed) => firstPhase(seed) > 1)).toBe(true);
  });

  it('rowStaticsOf is memoised per statics and view', () => {
    const view = viewOf(input);
    const rs = rowStaticsOf(statics, view);
    expect(rowStaticsOf(statics, view)).toBe(rs);
    expect(rowStaticsOf(staticsOf(input), view)).not.toBe(rs);
    expect(rs[0].phased!.phases.map((ph) => ph.projectId)[1]).toBe('CASE:SYN-M1PRX:phase:2');
  });
});
