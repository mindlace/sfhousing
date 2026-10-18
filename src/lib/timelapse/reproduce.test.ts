/**
 * AC-1 ("if 10% die at stage z, ours do too"): seeded draws through `sampleTransition` recover
 * the calibration's cumulative incidence, eventual shares and geometric tail (stage-calibration
 * spec §6, §7).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { mulberry32 } from '../generator/seed';
import small from './fixtures/calibration-small.json';
import { exp, log } from './math';
import { cumulativeIncidence, eventualProbabilities, sampleTransition } from './model';
import { monthsIn } from './time';
import type { Calibration, Transition } from './types';

const t = (small as unknown as Calibration).transitions.discretionary.permitFiled as Transition;
const N = 200000;

/** N draws from `monthsElapsed`; returns each draw's kind and 1-based event month. */
function draw(monthsElapsed: number) {
  const rng = mulberry32(0x5eed);
  const kinds: string[] = [];
  const months = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const r = sampleTransition(t, rng(), monthsElapsed);
    kinds.push(r.kind);
    months[i] = monthsIn(0, r.days) + 1;
  }
  return { kinds, months };
}

describe('AC-1: sampleTransition reproduces the calibration', () => {
  // In beforeAll, not the describe body, so a sampler exception fails the named tests.
  let fromEntry: ReturnType<typeof draw>;
  beforeAll(() => {
    fromEntry = draw(0);
  });

  it('expires 10% by month 12', () => {
    let expired = 0;
    for (let i = 0; i < N; i++) {
      if (fromEntry.kinds[i] === 'expired' && fromEntry.months[i] <= 12) expired++;
    }
    expect(Math.abs(expired / N - 0.1)).toBeLessThanOrEqual(0.005);
  });

  it('matches the cumulative incidence of advance and expired at every month 1..36', () => {
    const advance = new Float64Array(37);
    const expired = new Float64Array(37);
    for (let i = 0; i < N; i++) {
      const k = fromEntry.months[i];
      if (k > 36) continue;
      if (fromEntry.kinds[i] === 'advance') advance[k]++;
      else if (fromEntry.kinds[i] === 'expired') expired[k]++;
    }
    let a = 0;
    let e = 0;
    for (let k = 1; k <= 36; k++) {
      a += advance[k];
      e += expired[k];
      const f = cumulativeIncidence(t, k);
      expect(Math.abs(a / N - f.advance)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(e / N - f.exit.expired!)).toBeLessThanOrEqual(0.005);
    }
  });

  it('matches the eventual shares conditional on six months elapsed', () => {
    const fromSix = draw(6);
    let advance = 0;
    let expired = 0;
    for (let i = 0; i < N; i++) {
      expect(fromSix.months[i]).toBeGreaterThan(6);
      if (fromSix.kinds[i] === 'advance') advance++;
      else if (fromSix.kinds[i] === 'expired') expired++;
    }
    const p = eventualProbabilities(t, 6);
    expect(advance + expired).toBe(N);
    expect(Math.abs(advance / N - p.advance)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(expired / N - p.exit.expired!)).toBeLessThanOrEqual(0.005);
  });

  // The survival form, not P(13 + j) / P(13): only ~3,600 of the draws land in month 13, so that
  // ratio has a standard error of ~0.022, while each survival share below has one under 0.002.
  it('has a geometric tail: P(month > 12 + j | month > 12) = (1 - rho)^j', () => {
    const rho = t.tail.advance + t.tail.exit.expired!;
    const beyond = new Float64Array(6); // beyond[j] = #draws with month > 12 + j
    for (let i = 0; i < N; i++) {
      for (let j = 0; j <= 5; j++) if (fromEntry.months[i] > 12 + j) beyond[j]++;
    }
    expect(Math.abs(beyond[0] / N - 0.3)).toBeLessThanOrEqual(0.005);
    for (let j = 1; j <= 5; j++) {
      const expected = exp(j * log(1 - rho));
      expect(Math.abs(beyond[j] / beyond[0] - expected)).toBeLessThanOrEqual(0.01);
    }
  });
});
