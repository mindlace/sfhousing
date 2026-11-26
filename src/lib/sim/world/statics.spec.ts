import { expect, it } from 'vitest';
import { parcelRankOf } from './input/build';
import { staticsOf } from './statics';
import { miniFzpInput } from './test/mini';

it('builds Statics from the loaded input', () => {
  const input = miniFzpInput();
  const s = staticsOf(input);
  expect(s.parcelId).toBe(input.parcels.id);
  expect(s.rank).toEqual(parcelRankOf(input.parcels.id));
  expect(s.projects).toBe(input.projects);
  expect(s.asOf).toBe(input.asOf);
  expect(s.districtMaxStories).toBe(input.districtMaxStories);
});
