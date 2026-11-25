import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { exp } from '../../../src/lib/timelapse/math';
import { fitMnl } from '../../lib/cars/mnl';

/** mulberry32: a small seeded uniform generator for the synthetic draws. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw n choices over `levels` from coefficients `beta` ((levels - 1) x nFeat, level-major). */
function simulate(
  n: number,
  nFeat: number,
  levels: number,
  beta: number[],
  features: (r: () => number) => number[],
  seed: number
) {
  const r = rng(seed);
  const x = new Float64Array(n * nFeat);
  const choice = new Uint8Array(n);
  const p = new Float64Array(levels);
  for (let i = 0; i < n; i++) {
    const f = features(r);
    x.set(f, i * nFeat);
    let total = 1;
    p[0] = 1;
    for (let k = 1; k < levels; k++) {
      let u = 0;
      for (let j = 0; j < nFeat; j++) u += beta[(k - 1) * nFeat + j] * f[j];
      p[k] = exp(u);
      total += p[k];
    }
    let u = r() * total;
    let k = 0;
    while (k < levels - 1 && u >= p[k]) u -= p[k++];
    choice[i] = k;
  }
  return { x, choice };
}

describe('fitMnl', () => {
  // A constant and a centred covariate; levels 1, 2, 3+ against 0.
  const beta2 = [0.3, -0.4, 0.1, 0.3, -0.2, 0.6];
  const d2 = simulate(20_000, 2, 4, beta2, (r) => [1, 4 * r() - 2], 7);
  // The same with a 0/1 dummy as a third feature.
  const nFeat = 3;
  const beta = [0.3, -0.4, 0.5, 0.1, 0.3, -0.3, -0.2, 0.6, 0.4];
  const features = (r: () => number) => [1, 4 * r() - 2, r() < 0.5 ? 1 : 0];
  const { x, choice } = simulate(20_000, nFeat, 4, beta, features, 7);

  it('recovers known coefficients from 20,000 draws within 0.05', () => {
    const w = new Float64Array(d2.choice.length).fill(1);
    const r = fitMnl(d2.x, 2, d2.choice, w, 4, {});
    expect(r.coef).toHaveLength(6);
    r.coef.forEach((c, i) => expect(Math.abs(c - beta2[i]), `coef ${i}`).toBeLessThan(0.05));
    // Standard errors are positive and small at this sample size; the estimate sits within 3 SE.
    r.se.forEach((s, i) => {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(0.03);
      expect(Math.abs(r.coef[i] - beta2[i])).toBeLessThan(3 * s);
    });
    expect(r.logLik).toBeLessThan(0);
    expect(r.iterations).toBeGreaterThan(0);
  });

  it('treats a weight of 2 like a repeated record, and keeps SEs at the record count', () => {
    const n = 4000;
    const half = simulate(n, nFeat, 4, beta, features, 11);
    const xx = new Float64Array(2 * n * nFeat);
    xx.set(half.x);
    xx.set(half.x, n * nFeat);
    const cc = new Uint8Array(2 * n);
    cc.set(half.choice);
    cc.set(half.choice, n);
    const twice = fitMnl(xx, nFeat, cc, new Float64Array(2 * n).fill(1), 4, {});
    const weighted = fitMnl(half.x, nFeat, half.choice, new Float64Array(n).fill(2), 4, {});
    twice.coef.forEach((c, i) => expect(weighted.coef[i]).toBeCloseTo(c, 8));
    expect(weighted.logLik).toBeCloseTo(twice.logLik, 6);
    // Weights scale the likelihood, not the sample: SEs follow the n records (seN).
    const ratio = weighted.se[0] / twice.se[0];
    expect(ratio).toBeCloseTo(Math.SQRT2, 6);
  });

  it('takes a fixed offset per record and level', () => {
    // The offset carries the dummy's part; only the constant and covariate remain to fit.
    const n = choice.length;
    const offset = new Float64Array(n * 3);
    const x2 = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      x2[2 * i] = x[i * nFeat];
      x2[2 * i + 1] = x[i * nFeat + 1];
      for (let k = 0; k < 3; k++) offset[i * 3 + k] = beta[k * nFeat + 2] * x[i * nFeat + 2];
    }
    const r = fitMnl(x2, 2, choice, new Float64Array(n).fill(1), 4, { offset });
    expect(r.coef).toHaveLength(6);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(r.coef[k * 2] - beta[k * nFeat])).toBeLessThan(0.05);
      expect(Math.abs(r.coef[k * 2 + 1] - beta[k * nFeat + 1])).toBeLessThan(0.05);
    }
  });

  it('throws on a feature that never varies from zero (singular information)', () => {
    const n = 200;
    const z = new Float64Array(n * 2);
    const c = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      z[2 * i] = 1;
      c[i] = i % 4;
    }
    expect(() => fitMnl(z, 2, c, new Float64Array(n).fill(1), 4, {})).toThrow(/singular/);
  });
});

describe('determinism', () => {
  it('the fitting files take exp and log from math.ts: the lint passes on them', async () => {
    const root = process.cwd();
    const files = ['mnl.ts', 'fit.ts', 'report.ts'].map((f) => join(root, 'pipeline/lib/cars', f));
    const results = await new ESLint({ cwd: root }).lintFiles(files);
    for (const r of results) expect(r.messages, r.filePath).toEqual([]);
  });
});
