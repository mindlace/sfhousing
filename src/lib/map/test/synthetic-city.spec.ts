import { expect, it } from 'vitest';
import { makeSyntheticCity, benchmarkExemplars } from './synthetic-city';
it('represents every family, roofs and sibling towers with real generated exemplars', () => {
  const buildings = benchmarkExemplars('representative');
  for (const family of ['simple', 'terrace', 'divided', 'slab', 'shouldered', 'offset', 'paired'])
    expect(buildings.some((b) => b.composition === family)).toBe(true);
  expect(buildings.some((b) => b.parts.some((p) => p.role === 'roof'))).toBe(true);
  expect(
    buildings.some(
      (b) =>
        b.composition === 'paired' &&
        b.parts.filter((p) => p.baseM === 16.9 && p.role === 'occupied').length === 2
    )
  ).toBe(true);
  expect(makeSyntheticCity(1, 30, 10)).toEqual(makeSyntheticCity(1, 30, 10));
});
it('exercises the full solid and vertex budgets in the stress fixture', () => {
  const b = benchmarkExemplars('worst')[0];
  expect(b.parts.filter((p) => p.role === 'occupied')).toHaveLength(8);
  expect(b.parts.filter((p) => p.role === 'roof')).toHaveLength(2);
  expect(b.parts.reduce((n, p) => n + p.footprint.length, 0)).toBe(128);
  const pack = makeSyntheticCity(1, 1, 1, 'worst')[0].cells[0].settled;
  expect(pack.partCount).toBe(10);
  expect(pack.positions.length / 2).toBe(128);
});
