// T11 / spec §2: the scenario view of a chunk record, shared by the pipeline's yields and the
// timelapse worker's simulated massing (IA-8).
import { describe, expect, it } from 'vitest';
import { FTF_M } from '../generator/constants';
import { scenarioTiny } from './fixtures/scenario-tiny';
import type { ParcelRecord } from './parcel';
import { scenarioRecordFrom, scenarioRecordOf } from './scenario-codec';

/**
 * A chunk record for `id` (LUDB-style values that differ from every tiny row). The tiny fixture's
 * 3512010 has no land-use row (`landUse` 'NONE', so `eligible: false`) but is eligible in the
 * scenario (T14 sd.landuse.none-with-units); every other record is eligible.
 */
function chunkRecord(id: string): ParcelRecord {
  const none = id === NONE_ID;
  return {
    id,
    polygon: [
      [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10]
      ]
    ],
    labelPoint: [-122.41, 37.76],
    areaM2: 400,
    existingUnits: 9,
    existingFloorAreaM2: 543.2,
    existingHeightM: 12.4,
    landUse: none ? 'NONE' : 'RESIDENTIAL',
    eligible: !none,
    neighborhood: 'Mission'
  };
}

const NONE_ID = '3512010';
const REPLACED = ['existingUnits', 'existingFloorAreaM2', 'existingHeightM', 'eligible'] as const;

describe('scenarioRecordOf', () => {
  const p = scenarioTiny();

  it('replaces exactly units, floor area, height and eligibility from row i, for every row', () => {
    for (let i = 0; i < p.count; i++) {
      const rec = chunkRecord(p.id[i]);
      const out = scenarioRecordOf(p, i, rec);
      expect(out, p.id[i]).not.toBe(rec);
      expect(Object.keys(out).sort()).toEqual(Object.keys(rec).sort());
      expect(out.existingUnits).toBe(p.existingUnits[i]);
      expect(out.existingFloorAreaM2).toBe(p.existingFloorAreaM2[i]);
      expect(out.existingHeightM).toBe(p.existingStories[i] * FTF_M);
      expect(out.eligible).toBe(p.eligible[i] === 1);
      // Every other field is kept by identity (the polygon is the same array, not a copy).
      for (const k of Object.keys(rec) as (keyof ParcelRecord)[]) {
        if ((REPLACED as readonly string[]).includes(k)) continue;
        expect(out[k], `${p.id[i]} ${k}`).toBe(rec[k]);
      }
    }
  });

  it('takes the scenario eligibility (flags bit 5), not the chunk record’s', () => {
    // 3512010: chunk record ineligible (no land-use row), scenario eligible.
    const i = p.index.get(NONE_ID)!;
    expect(chunkRecord(NONE_ID).eligible).toBe(false);
    expect(scenarioRecordOf(p, i, chunkRecord(NONE_ID)).eligible).toBe(true);
    // 3512008: chunk record eligible here, scenario ineligible; the row wins either way.
    const j = p.index.get('3512008')!;
    expect(chunkRecord('3512008').eligible).toBe(true);
    expect(scenarioRecordOf(p, j, chunkRecord('3512008')).eligible).toBe(false);
  });

  it('does not mutate the chunk record', () => {
    const rec = chunkRecord(p.id[4]);
    const before = structuredClone(rec);
    const polygon = rec.polygon;
    Object.freeze(rec);
    scenarioRecordOf(p, 4, rec);
    expect(rec).toEqual(before);
    expect(rec.polygon).toBe(polygon);
  });

  it('throws RangeError when p.id[i] is not rec.id', () => {
    expect(() => scenarioRecordOf(p, 0, chunkRecord(p.id[1]))).toThrow(RangeError);
    expect(() => scenarioRecordOf(p, 0, chunkRecord(p.id[1]))).toThrow(/3512001/);
    expect(() => scenarioRecordOf(p, p.count, chunkRecord(p.id[0]))).toThrow(RangeError);
  });

  it('agrees with scenarioRecordFrom on row i', () => {
    for (let i = 0; i < p.count; i++) {
      const rec = chunkRecord(p.id[i]);
      expect(scenarioRecordOf(p, i, rec)).toEqual(
        scenarioRecordFrom(rec, {
          existingUnits: p.existingUnits[i],
          existingFloorAreaM2: p.existingFloorAreaM2[i],
          existingStories: p.existingStories[i],
          eligible: p.eligible[i] === 1
        })
      );
    }
  });
});

describe('scenarioRecordFrom', () => {
  it('sets existingHeightM = existingStories × FTF_M and eligible, and keeps the rest', () => {
    const rec = chunkRecord('3512005');
    const out = scenarioRecordFrom(rec, {
      existingUnits: 3,
      existingFloorAreaM2: 280,
      existingStories: 4,
      eligible: false
    });
    expect(out).toEqual({
      ...rec,
      existingUnits: 3,
      existingFloorAreaM2: 280,
      existingHeightM: 4 * FTF_M,
      eligible: false
    });
    expect(out.polygon).toBe(rec.polygon);
    expect(rec.existingUnits).toBe(9);
    expect(rec.eligible).toBe(true);
  });

  it('makes a no-land-use record eligible when v.eligible says so', () => {
    const rec = chunkRecord(NONE_ID);
    const v = { existingUnits: 1, existingFloorAreaM2: 1250, existingStories: 1 };
    expect(scenarioRecordFrom(rec, { ...v, eligible: true }).eligible).toBe(true);
    expect(scenarioRecordFrom(rec, { ...v, eligible: false }).eligible).toBe(false);
  });
});
