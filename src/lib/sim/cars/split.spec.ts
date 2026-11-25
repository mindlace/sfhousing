import { describe, expect, it } from 'vitest';
import { roundSystematic, splitSystematic } from './split';

describe('splitSystematic', () => {
  it('sums to n and stays within floor and ceil of each share', () => {
    const w = [0.1, 0.2, 0.3, 0.4];
    for (const u of [0.01, 0.5, 0.99]) {
      const out = new Int32Array(4);
      splitSystematic(17, w, u, out);
      expect(out.reduce((a, b) => a + b, 0)).toBe(17);
      out.forEach((v, i) => expect(Math.abs(v - 17 * w[i])).toBeLessThan(1));
    }
  });

  it('handles n = 0 and zero-weight entries', () => {
    const out = new Int32Array(3);
    splitSystematic(0, [0, 0, 0], 0.5, out);
    expect(Array.from(out)).toEqual([0, 0, 0]);
    splitSystematic(5, [0, 1, 0], 0.5, out);
    expect(Array.from(out)).toEqual([0, 5, 0]);
  });

  it('with zero weights and n > 0 throws', () => {
    expect(() => splitSystematic(3, [0, 0], 0.5, new Int32Array(2))).toThrow(RangeError);
  });

  it('rounds floor(x + u)', () => {
    expect(roundSystematic(2.4, 0.5)).toBe(2);
    expect(roundSystematic(2.6, 0.5)).toBe(3);
  });
});
