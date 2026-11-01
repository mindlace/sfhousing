import { expect, it } from 'vitest';
import { makeSyntheticFog } from './synthetic-fog';
import { fogInstances } from '../fog/grid';

it('is deterministic and covers the city with more than 10,000 fog cells', () => {
  const g = makeSyntheticFog(1);
  expect(makeSyntheticFog(1)).toEqual(g);
  expect(fogInstances(g).count).toBeGreaterThan(10_000);
});
