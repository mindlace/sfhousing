import { describe, expect, it } from 'vitest';
import { balance } from '../../lib/cars/ipf';

describe('balance (IPF)', () => {
  it('meets two margins on a 3-class seed within tol and reports maxRelErr', () => {
    // Records 0-2 are the three household classes, repeated with different seed weights.
    const seed = Float64Array.from([10, 20, 30, 5, 15, 25]);
    // Margin A: tenure (0 owner, 1 renter); margin B: size class (0, 1, 2).
    const a = Int32Array.from([0, 0, 1, 1, 1, 0]);
    const b = Int32Array.from([0, 1, 2, 0, 1, 2]);
    const ta = Float64Array.from([40, 60]);
    const tb = Float64Array.from([30, 30, 40]);
    const r = balance(seed, [a, b], [ta, tb], { maxIter: 500, tol: 1e-6 });
    const sum = (rows: Int32Array, c: number) =>
      r.weights.reduce((s, w, i) => (rows[i] === c ? s + w : s), 0);
    for (let c = 0; c < 2; c++) expect(Math.abs(sum(a, c) - ta[c]) / ta[c]).toBeLessThan(1e-6);
    for (let c = 0; c < 3; c++) expect(Math.abs(sum(b, c) - tb[c]) / tb[c]).toBeLessThan(1e-6);
    expect(r.maxRelErr).toBeLessThan(1e-6);
    expect(r.maxRelErr).toBeGreaterThanOrEqual(0);
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.iterations).toBeLessThan(500);
  });

  it('a zero target empties its class; an unreachable class shows in maxRelErr', () => {
    const seed = Float64Array.from([1, 1, 1]);
    const a = Int32Array.from([0, 0, 1]);
    const r = balance(seed, [a], [Float64Array.from([5, 0])], { maxIter: 50, tol: 1e-9 });
    expect(Array.from(r.weights)).toEqual([2.5, 2.5, 0]);
    expect(r.maxRelErr).toBe(0);
    // Class 2 has a target but no record: it can never be met.
    const u = balance(seed, [Int32Array.from([0, 1, 1])], [Float64Array.from([1, 1, 3])], {
      maxIter: 20,
      tol: 1e-9
    });
    expect(u.maxRelErr).toBe(1);
  });

  it('leaves the seed unchanged with no margins', () => {
    const r = balance(Float64Array.from([1, 2]), [], [], { maxIter: 10, tol: 1e-6 });
    expect(Array.from(r.weights)).toEqual([1, 2]);
    expect(r.maxRelErr).toBe(0);
  });
});
