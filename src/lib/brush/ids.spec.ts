import { describe, expect, it } from 'vitest';
import { newOpId } from './ids';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{12}$/;

describe('newOpId', () => {
  it('returns 12 base58 characters', () => {
    const id = newOpId();
    expect(id).toHaveLength(12);
    expect(id).toMatch(BASE58);
  });

  it('rejects bytes ≥ 232 and maps the rest mod 58', () => {
    const bytes = [255, 0, 57, 58, 231, 232, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let i = 0;
    const rand = (buf: Uint8Array) => {
      for (let j = 0; j < buf.length; j++) buf[j] = i < bytes.length ? bytes[i++] : 0;
      return buf;
    };
    expect(newOpId(rand)).toBe('1z1z23456789');
  });

  it('produces 1,000 unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newOpId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(BASE58);
  });
});
