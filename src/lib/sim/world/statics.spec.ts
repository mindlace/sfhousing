import { expect, it } from 'vitest';
import { parcelRankOf } from '../scenario/input';
import { goldenInput } from '../scenario/simulate.golden.cases';
import { staticsOf } from './statics';

it('builds Statics from the loaded input', () => {
  const input = goldenInput();
  const s = staticsOf(input);
  expect(s.parcelId).toBe(input.parcels.id);
  expect(s.rank).toEqual(parcelRankOf(input.parcels.id));
  expect(s.projects).toBe(input.projects);
  expect(s.asOf).toBe(input.asOf);
  expect(s.districtMaxStories).toBe(input.districtMaxStories);
});
