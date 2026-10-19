import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ParcelRecord } from './parcel';
import { scenarioYield } from './scenario-yield';
import std from '../generator/fixtures/std-25x100.json';
import lot1000 from '../generator/fixtures/lot-1000.json';
import lot1200 from '../generator/fixtures/lot-1200.json';
import lot3000 from '../generator/fixtures/lot-3000.json';
import lshape from '../generator/fixtures/lshape.json';
import holed from '../generator/fixtures/holed.json';
import multipart from '../generator/fixtures/multipart.json';
import sliver from '../generator/fixtures/sliver.json';
import tiny from '../generator/fixtures/tiny.json';
import vacant from '../generator/fixtures/vacant-std.json';

const PARCELS = [
  std,
  lot1000,
  lot1200,
  lot3000,
  lshape,
  holed,
  multipart,
  sliver,
  tiny,
  vacant
] as unknown as ParcelRecord[];

describe('scenarioYield (real generator)', () => {
  it('is a deterministic integer in [0, 65535]', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PARCELS),
        fc.integer({ min: 0, max: 80 }),
        fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }),
        (rec, stories, cap) => {
          const a = scenarioYield(rec, stories, cap);
          expect(Number.isInteger(a)).toBe(true);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(65535);
          expect(scenarioYield(rec, stories, cap)).toBe(a);
        }
      ),
      { numRuns: 150 }
    );
  });
});
