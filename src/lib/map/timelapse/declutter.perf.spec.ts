// Wall-clock budget for declutter: runs in `npm run test:perf`, not in test:unit or signoff.
import { describe, expect, it } from 'vitest';
import { BAR_MIN_ZOOM } from './constants';
import { declutter } from './declutter';
import type { BarAttrs } from './types';
import { OPEN_DAY } from '$lib/timelapse/time';

const LAT = 37.75;
const LNG = -122.44;
const M_PER_DEG_LAT = 111320;

function mk(
  id: string,
  units: number,
  dx: number,
  dy: number,
  from = 0,
  to: number = OPEN_DAY,
  parcelId = id
): BarAttrs {
  const lat = LAT + dy / M_PER_DEG_LAT;
  const lng = LNG + dx / (M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180));
  return {
    projectId: id,
    parcelId,
    units,
    pathway: 0,
    anchor: [lng, lat, 20],
    from,
    to,
    barEnd: to,
    endDay: OPEN_DAY,
    endKind: 0,
    completeDay: OPEN_DAY,
    segCount: 5,
    segEntry: [],
    segTypicalDays: [],
    segRow: [],
    minZoom: BAR_MIN_ZOOM
  };
}

describe('declutter budget', () => {
  it('declutters 30,000 bars across the SF bbox in 50 ms', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const make = () => {
      const bars: BarAttrs[] = [];
      for (let i = 0; i < 30000; i++) {
        const from = Math.floor(rnd() * 8000);
        const b = mk(`p${i}`, 1 + Math.floor(rnd() * 400), 0, 0, from, from + 500 + rnd() * 3000);
        b.anchor = [-122.515 + rnd() * 0.17, 37.708 + rnd() * 0.12, 20];
        bars.push(b);
      }
      return bars;
    };
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const bars = make();
      const t0 = performance.now();
      declutter(bars);
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThanOrEqual(50);
  });
});
