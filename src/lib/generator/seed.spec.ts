import { describe, expect, it } from 'vitest';
import { fnv1a32, mulberry32 } from './seed';
import seeds from './fixtures/seeds.json';

describe('fnv1a32', () => {
  it('matches published FNV-1a 32-bit vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });
  it('matches frozen mapblklot seeds', () => {
    for (const [id, h] of Object.entries(seeds)) expect(fnv1a32(id)).toBe(h);
  });
  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // 'é' is two UTF-8 bytes (0xc3 0xa9); hashing the code unit 0xe9 would differ
    let h = 0x811c9dc5;
    for (const b of [0xc3, 0xa9]) h = Math.imul(h ^ b, 0x01000193);
    expect(fnv1a32('é')).toBe(h >>> 0);
  });
  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('3512008');
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
  });
});

describe('mulberry32', () => {
  it('first five outputs for seed 1 are frozen', () => {
    const r = mulberry32(1);
    expect([r(), r(), r(), r(), r()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
      0.9683778982143849
    ]);
  });
  it('outputs lie in [0, 1)', () => {
    const r = mulberry32(fnv1a32('x'));
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});
