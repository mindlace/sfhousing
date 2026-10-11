import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import golden from './fixtures/golden-seeded.json';

const cases = golden as unknown as { parcel: ParcelRecord; S: number; out: unknown }[];

describe('seeded snapshot in Chromium (AC3)', () => {
  it('deep-equals golden-seeded.json', () => {
    expect(cases).toHaveLength(200);
    for (const c of cases) {
      expect(generate(c.parcel, { maxStories: c.S }, fnv1a32(c.parcel.id), 'max')).toEqual(c.out);
    }
  });
});
