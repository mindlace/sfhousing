import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MONTH_DAYS } from '$lib/timelapse/time';
import { DEFAULT_SPEED, FRAME_CLAMP_MS, SPEED_DAYS, SPEED_NAME, advance } from './playback';
import { HORIZON, dayFromUtc } from './time';
import type { Speed } from './types';

const asOf = dayFromUtc(2026, 10, 16);

describe('speed tables', () => {
  it('maps speeds to days per second', () => {
    expect(Object.keys(SPEED_DAYS).sort()).toEqual(['threeYears', 'year']);
    expect(SPEED_DAYS).toEqual({
      year: 12 * MONTH_DAYS,
      threeYears: 36 * MONTH_DAYS
    });
    expect(DEFAULT_SPEED).toBe('year');
    expect(FRAME_CLAMP_MS).toBe(100);
  });

  it('names speeds', () => {
    expect(SPEED_NAME).toEqual({
      year: '1 year per second',
      threeYears: '3 years per second'
    });
  });

  it('3 years per second advances 36 months a second (a frame counts at most 100 ms)', () => {
    expect(advance(0, 100, 'threeYears', 10_000).day).toBe(Math.floor(3.6 * MONTH_DAYS));
    expect(advance(0, 1000, 'threeYears', 10_000).day).toBe(Math.floor(3.6 * MONTH_DAYS));
    expect(advance(0, 100, 'threeYears', 10_000).t).toBeCloseTo(0.1 * 36 * MONTH_DAYS, 9);
  });
});

describe('advance', () => {
  it('advances by dt x days per second', () => {
    const t0 = asOf + 0.25;
    const r = advance(t0, 16, 'year', HORIZON);
    expect(r.t).toBeCloseTo(t0 + 0.016 * 12 * MONTH_DAYS, 9);
    expect(r.day).toBe(Math.floor(r.t));
    expect(r.done).toBe(false);
  });

  it('clamps a long frame to 100 ms', () => {
    expect(advance(asOf, 5000, 'year', HORIZON).t).toBe(advance(asOf, 100, 'year', HORIZON).t);
  });

  it('stops at the horizon', () => {
    const r = advance(HORIZON - 0.5, 100, 'year', HORIZON);
    expect(r.day).toBe(HORIZON);
    expect(r.t).toBe(HORIZON);
    expect(r.done).toBe(true);
  });

  it('keeps day within [asOf, HORIZON] and non-decreasing for any frame sequence', () => {
    const speed = fc.constantFrom<Speed>('year', 'threeYears');
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.double({ min: 0, max: 10000, noNaN: true }), speed), {
          maxLength: 300
        }),
        (frames) => {
          let t: number = asOf;
          let prev: number = asOf;
          for (const [dt, s] of frames) {
            const r = advance(t, dt, s, HORIZON);
            expect(r.day).toBeGreaterThanOrEqual(prev);
            expect(r.day).toBeLessThanOrEqual(HORIZON);
            t = r.t;
            prev = r.day;
          }
        }
      )
    );
  });
});
