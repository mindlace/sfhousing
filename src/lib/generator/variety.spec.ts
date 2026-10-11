import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { drawVariety, varietyFromUniforms } from './variety';
import { mulberry32 } from './seed';

describe('drawVariety', () => {
  it('takes exactly six draws in the frozen order', () => {
    const r = mulberry32(1);
    const u = [r(), r(), r(), r(), r(), r()];
    expect(drawVariety(1)).toEqual({
      edgeInsetM: 0.2 + 0.4 * u[0],
      stepbackM: 1.5 + 1.5 * u[1],
      parapetM: 0.3 + 0.9 * u[2],
      towerSlide: 2 * u[3] - 1,
      towerAspect: 1 + 0.5 * u[4],
      aduEnd: u[5] < 0.5 ? 1 : -1
    });
  });
  it('keeps every draw in range', () => {
    expect(() =>
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
          const d = drawVariety(seed);
          return (
            d.edgeInsetM >= 0.2 &&
            d.edgeInsetM < 0.6 &&
            d.stepbackM >= 1.5 &&
            d.stepbackM < 3 &&
            d.parapetM >= 0.3 &&
            d.parapetM < 1.2 &&
            d.towerSlide >= -1 &&
            d.towerSlide < 1 &&
            d.towerAspect >= 1 &&
            d.towerAspect < 1.5 &&
            (d.aduEnd === 1 || d.aduEnd === -1)
          );
        }),
        { numRuns: 1000 }
      )
    ).not.toThrow();
  });
  it('varietyFromUniforms maps the golden draws', () => {
    expect(varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25])).toEqual({
      edgeInsetM: 0.4,
      stepbackM: 2.25,
      parapetM: 0.75,
      towerSlide: 0,
      towerAspect: 1,
      aduEnd: 1
    });
  });
});
