import { describe, expect, it } from 'vitest';
import { PLAN_ID_ALPHABET, PLAN_ID_RE, newPlanId } from './ids';

function seeded(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0; // LCG
      out[i] = s >>> 24;
    }
    return out;
  };
}

describe('newPlanId', () => {
  it('alphabet is 58 distinct base58 chars matched by PLAN_ID_RE', () => {
    expect(new Set(PLAN_ID_ALPHABET).size).toBe(58);
    expect(PLAN_ID_RE.test(PLAN_ID_ALPHABET.slice(0, 8))).toBe(true);
    for (const bad of ['0', 'O', 'I', 'l']) expect(PLAN_ID_RE.test(bad.repeat(8))).toBe(false);
  });
  it('10k ids all match PLAN_ID_RE', () => {
    for (let i = 0; i < 10_000; i++) expect(newPlanId()).toMatch(PLAN_ID_RE);
  });
  it('skips bytes >= 232 (rejection sampling)', () => {
    const bytes = [232, 255, 0, 240, 1, 2, 3, 4, 5, 6, 57, 58];
    let i = 0;
    const rand = (n: number) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]);
    expect(newPlanId(rand)).toBe(
      [0, 1, 2, 3, 4, 5, 6, 57].map((k) => PLAN_ID_ALPHABET[k]).join('')
    );
  });
  it('is uniform within ±20% over 58k chars (seeded)', () => {
    const counts = new Map<string, number>();
    const rand = seeded(42);
    for (let i = 0; i < 58_000 / 8; i++)
      for (const c of newPlanId(rand)) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const c of PLAN_ID_ALPHABET) {
      const n = counts.get(c) ?? 0;
      expect(n).toBeGreaterThanOrEqual(800);
      expect(n).toBeLessThanOrEqual(1200);
    }
  });
});
