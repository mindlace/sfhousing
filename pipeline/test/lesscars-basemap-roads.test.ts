import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASEMAP_ZOOMS, idVerdict, roadsNear, type RoadPiece } from '../lib/lesscars/basemap-roads';
import { MINI } from './helpers';

const MINI_BASEMAP = path.join(MINI, 'raw/protomaps-basemap.pmtiles');
// the mini I-80 (src_streets 4000) runs y = 75 m from O = (-122.4195, 37.7600), x 0..140 m east
const M_PER_DEG = 111_320;
const KX = M_PER_DEG * Math.cos((37.76 * Math.PI) / 180);
const MINI_I80_LNGLAT: [number, number][] = [0, 140].map((x) => [
  -122.4195 + x / KX,
  37.76 + 75 / M_PER_DEG
]);

function piece(p: Partial<RoadPiece>): RoadPiece {
  return {
    id: 1,
    z: 11,
    kind: 'highway',
    isLink: false,
    ref: null,
    name: null,
    lengthM: 100,
    inBandM: 0,
    ...p
  };
}

describe('idVerdict', () => {
  it('a merged line across the cut is mixed; a line wholly inside or outside is not', () => {
    const v = idVerdict([
      piece({ id: 1, z: 11, kind: 'highway', lengthM: 6000, inBandM: 3000 }),
      piece({ id: 2, z: 14, kind: 'highway', lengthM: 800, inBandM: 800 }),
      piece({ id: 3, z: 14, kind: 'highway', lengthM: 500, inBandM: 10 })
    ]);
    expect(v.find((x) => x.z === 11)).toMatchObject({
      ok: false,
      mixed: [expect.objectContaining({ id: 1 })]
    });
    expect(v.find((x) => x.z === 14)?.ok).toBe(true);
  });
  it('a mixed street does not fail the verdict; only highways do', () => {
    expect(
      idVerdict([piece({ z: 12, kind: 'major_road', lengthM: 100, inBandM: 50 })]).find(
        (v) => v.z === 12
      )?.ok
    ).toBe(true);
  });
  it('the verdict covers every zoom the page shows, pieces or not', () => {
    expect(idVerdict([]).map((v) => v.z)).toEqual([...BASEMAP_ZOOMS]);
    expect(idVerdict([]).every((v) => v.ok)).toBe(true);
  });
});

describe('roadsNear', () => {
  it('finds the fixture street under the mini I-80', async () => {
    const pieces = await roadsNear({ pmtiles: MINI_BASEMAP, lines: [MINI_I80_LNGLAT], bandM: 15 });
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      expect(p.inBandM).toBeLessThanOrEqual(p.lengthM + 1e-6);
      expect(Number.isSafeInteger(p.id)).toBe(true);
    }
  });
});
