import { describe, expect, it } from 'vitest';
import { lowZoomGate, type LowZoomStats } from './low-zoom-gate';

const before: LowZoomStats = { z12Bytes: 0, z12Parcels: 1000, z13Parcels: 1000 };
const after = (o: Partial<LowZoomStats>): LowZoomStats => ({ ...before, ...o });

describe('lowZoomGate', () => {
  it('passes at exactly +60,000 B and a 1% parcel drop', () => {
    const r = lowZoomGate(before, after({ z12Bytes: 60_000, z12Parcels: 990 }));
    expect(r.ok).toBe(true);
    expect(r.lines.length).toBeGreaterThanOrEqual(2);
  });

  it('fails at +60,001 B', () => {
    expect(lowZoomGate(before, after({ z12Bytes: 60_001 })).ok).toBe(false);
  });

  it('fails at 989 parcels', () => {
    expect(lowZoomGate(before, after({ z12Parcels: 989 })).ok).toBe(false);
  });

  it('passes when parcels rise', () => {
    expect(lowZoomGate(before, after({ z12Parcels: 1200, z13Parcels: 1300 })).ok).toBe(true);
  });
});
