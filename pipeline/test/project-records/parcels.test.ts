import { describe, expect, it } from 'vitest';
import { resolveParcels } from '../../project-records/parcels';

const parcelIds = new Set(['0708021', '3512012', '1234001', '5555001']);
const table: Record<string, string> = { '0708023': '0708021', '3512099': '3512012' };
const input = { parcelIds, lineage: (b: string) => table[b] ?? null };

describe('resolveParcels', () => {
  it('maps a condo sub-lot through lineage', () => {
    expect(resolveParcels(['0708023'], input)).toEqual({
      ids: ['0708021'],
      mapped: 1,
      unmapped: 0
    });
  });
  it('maps a retired lot through lineage', () => {
    expect(resolveParcels(['3512099'], input).ids).toEqual(['3512012']);
  });
  it('uses an id that is itself a parcel when lineage has nothing', () => {
    expect(resolveParcels(['1234001'], input)).toEqual({
      ids: ['1234001'],
      mapped: 1,
      unmapped: 0
    });
  });
  it('drops ids in neither lineage nor the set', () => {
    expect(resolveParcels(['9999999'], input)).toEqual({ ids: [], mapped: 0, unmapped: 1 });
  });
  it('counts a lineage target absent from the parcel set as unmapped', () => {
    const r = resolveParcels(['0708023'], { parcelIds: new Set(), lineage: input.lineage });
    expect(r).toEqual({ ids: [], mapped: 0, unmapped: 1 });
  });
  it('collapses duplicates and nulls, counts distinct candidates, sorts output', () => {
    const r = resolveParcels(
      ['5555001', null, '0708023', '0708021', '0708023', '', '5555001', '9999999', null],
      input
    );
    expect(r).toEqual({ ids: ['0708021', '5555001'], mapped: 3, unmapped: 1 });
  });
  it('ignores null and empty candidates without counting them', () => {
    expect(resolveParcels([null, ''], input)).toEqual({ ids: [], mapped: 0, unmapped: 0 });
  });
  it('accepts any iterable', () => {
    expect(resolveParcels(new Set(['3512099']), input).ids).toEqual(['3512012']);
  });
});
