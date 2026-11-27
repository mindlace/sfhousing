import { describe, expect, it } from 'vitest';
import { FTF_M, GROUND_FTF_M } from '$lib/generator/constants';
import type { EnvelopeTable } from '$lib/sim/levers/layers';
import { contourLabelText, countableMask, glazeStep, lidLabelText, storiesToM } from './room';

describe('room to grow', () => {
  it('storiesToM matches the fog it replaces', () => {
    expect(storiesToM(0)).toBe(0);
    expect(storiesToM(1)).toBe(GROUND_FTF_M);
    expect(storiesToM(4)).toBeCloseTo(GROUND_FTF_M + 3 * FTF_M);
  });
  it('countable: hostable, eligible, >= 1 story, not protected', () => {
    // rows: 0 hostable; 1 not hostable; 2 hostable at 6; 3 protected hostable; 4 ineligible
    // hostable; 5 stories 0
    const t: EnvelopeTable = {
      count: 6,
      stories: Uint8Array.of(4, 4, 6, 4, 6, 0),
      cap: new Uint16Array(6),
      hostable: Uint8Array.of(1, 0, 1, 1, 1, 1)
    };
    const eligible = Uint8Array.of(1, 1, 1, 1, 0, 1);
    expect([...countableMask(t, eligible, Int32Array.of(3))]).toEqual([1, 0, 1, 0, 0, 0]);
  });
  it('glaze steps at 1, 3, 6 unused stories per area', () => {
    expect([0.5, 1, 2.9, 3, 6, 40].map((m) => glazeStep(m * 100, 100))).toEqual([0, 1, 1, 2, 3, 3]);
    expect(glazeStep(0, 0)).toBe(0);
  });
  it('label text', () => {
    expect(lidLabelText(4, 120)).toBe('4 stories · +120 floors');
    expect(lidLabelText(1, 1)).toBe('1 story · +1 floor');
    expect(lidLabelText(12, 1240)).toBe('12 stories · +1,240 floors');
    expect(lidLabelText(4, 0)).toBe('4 stories · +0 floors');
    expect([4, 39, 40, 65].map(contourLabelText)).toEqual(['4', '39', '40+', '40+']);
  });
});
