import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '$lib/data/parcel';
import { toLngLat } from '$lib/generator/geo';
import { packOutlines } from './outlines';

const sq = (s: number): [number, number][] => [
  [-s, -s],
  [s, -s],
  [s, s],
  [-s, s],
  [-s, -s]
];
const A = { id: '1', polygon: [sq(5)], labelPoint: [-122.42, 37.76] as [number, number] };
const B = {
  id: '2',
  polygon: [sq(8), sq(3)],
  labelPoint: [-122.41, 37.77] as [number, number]
} satisfies { id: string; polygon: ParcelRecord['polygon']; labelPoint: [number, number] };

describe('packOutlines', () => {
  it('is empty for no lots', () => {
    const { outlines, transfer } = packOutlines([]);
    expect(outlines.lots).toEqual([]);
    expect([...outlines.starts]).toEqual([0]);
    expect(outlines.ringLot.length).toBe(0);
    expect(outlines.positions.length).toBe(0);
    expect(transfer).toHaveLength(3);
  });

  it('packs one ring per polygon ring with cumulative starts and the lng/lat positions', () => {
    const { outlines, transfer } = packOutlines([A, B]);
    expect(outlines.lots).toEqual(['1', '2']);
    expect([...outlines.ringLot]).toEqual([0, 1, 1]);
    expect([...outlines.starts]).toEqual([0, 5, 10, 15]);
    const first = toLngLat(A.polygon[0], A.labelPoint);
    expect([outlines.positions[0], outlines.positions[1]]).toEqual(first[0]);
    const inner = toLngLat(B.polygon[1], B.labelPoint);
    expect([outlines.positions[2 * 10], outlines.positions[2 * 10 + 1]]).toEqual(inner[0]);
    expect(outlines.positions.length).toBe(30);
    expect(transfer).toEqual([
      outlines.ringLot.buffer,
      outlines.starts.buffer,
      outlines.positions.buffer
    ]);
  });
});
