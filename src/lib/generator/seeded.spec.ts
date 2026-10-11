import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import { synthParcels } from './fixtures/synth';
import golden from './fixtures/golden-seeded.json';

const cases = golden as unknown as { parcel: ParcelRecord; S: number; out: unknown }[];

describe('seeded snapshot (golden-seeded.json)', () => {
  it('has 200 frozen cases', () => {
    expect(cases).toHaveLength(200);
  });
  it('generate reproduces every frozen output exactly', () => {
    for (const c of cases) {
      expect(generate(c.parcel, { maxStories: c.S }, fnv1a32(c.parcel.id), 'max')).toEqual(c.out);
    }
  });
  it('synthParcels still produces the frozen inputs', () => {
    const fresh = synthParcels(200, 20261010);
    expect(fresh.map((f) => [f.parcel, f.S])).toEqual(cases.map((c) => [c.parcel, c.S]));
  });
});
