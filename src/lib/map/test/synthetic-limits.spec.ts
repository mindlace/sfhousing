import { expect, it } from 'vitest';
import { makeSyntheticLimits } from './synthetic-limits';

it('is deterministic per seed and has more than 10,000 rim paths and 1,000 chains', () => {
  const a = makeSyntheticLimits(1);
  const b = makeSyntheticLimits(1);
  expect(b.lids.rims.starts).toEqual(a.lids.rims.starts);
  expect(b.city.chains.hi).toEqual(a.city.chains.hi);
  expect(a.lids.rims.starts.length - 1).toBeGreaterThan(10_000);
  expect(a.city.chains.starts.length - 1).toBeGreaterThan(1_000);
}, 60_000);
