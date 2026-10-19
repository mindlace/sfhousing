// Constant-hazard tail fit and the cell rejection rule (stage-calibration spec §4.4).
import { describe, expect, it } from 'vitest';
import { exposureFrom, rejects, tailFit } from '../../lib/fzp-cal/tail';
import { LIVE_CAL } from '../../lib/fzp-cal/config';
import type { CalProfile, Spell } from '../../lib/fzp-cal/types';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';

const M = MONTH_DAYS;

let seq = 0;
function spell(a: number, x: number, outcome: Spell['outcome']): Spell {
  seq++;
  return {
    pathway: null,
    stage: 'permitIssued',
    a,
    e: 0,
    x,
    outcome,
    projectId: `t${String(seq).padStart(5, '0')}`
  };
}

const cal = (over: Partial<CalProfile>): CalProfile => ({ ...LIVE_CAL, ...over });

describe('tailFit', () => {
  /*
   * months 4, TAIL_SPAN 2: k0 = max(1, 4 - 2 + 1) = 3, so the span starts at (k0 - 1) * M = 2M.
   * Exposure max(0, x - max(a, 2M)) / M: 1 + 2 + 3 + 0 + 1 = 7 person-months.
   * Events with x >= 2M: advance 1, withdrawn 1, expired 1 (the advance at M is before the span).
   * lambda_j = 1/7 each, lambda = 3/7, p_j = (1/3)(1 - exp(-3/7)) = 0.11618698... -> 0.116187.
   */
  const hand = [
    spell(0, 3 * M, 'advance'),
    spell(0, 4 * M, 'withdrawn'),
    spell(0, 5 * M, 'censored'),
    spell(0, M, 'advance'),
    spell(2.5 * M, 3.5 * M, 'expired')
  ];

  it('p_j = (lambda_j / lambda)(1 - exp(-lambda)) on hand counts, 6 significant digits', () => {
    const f = tailFit(hand, 4, cal({ tailSpan: 2, tailMinEvents: 1 }));
    expect(f.k0).toBe(3);
    expect(f.observedEvents).toBe(3);
    expect(f.personMonths).toBeCloseTo(7, 9);
    expect(f.lambda.advance).toBeCloseTo(1 / 7, 12);
    expect(f.lambda.withdrawn).toBeCloseTo(1 / 7, 12);
    expect(f.lambda.expired).toBeCloseTo(1 / 7, 12);
    expect(f.lambda.disapproved).toBe(0);
    expect(f.lambda.cancelled).toBe(0);
    expect(f.tail).toEqual({
      advance: 0.116187,
      exit: { withdrawn: 0.116187, disapproved: 0, cancelled: 0, expired: 0.116187 }
    });
    expect(Object.keys(f.tail.exit)).toEqual(['withdrawn', 'disapproved', 'cancelled', 'expired']);
  });

  it('scale multiplies lambda_j before the probability formula', () => {
    // lambda_adv = 2/7, lambda = 4/7: p_adv = (1/2)(1 - exp(-4/7)) = 0.217641; others 0.108820
    const f = tailFit(hand, 4, cal({ tailSpan: 2, tailMinEvents: 1 }), { advance: 2 });
    expect(f.lambda.advance).toBeCloseTo(2 / 7, 12);
    expect(f.tail.advance).toBe(0.217641);
    expect(f.tail.exit.withdrawn).toBe(0.10882);
    expect(f.tail.exit.expired).toBe(0.10882);
    expect(f.observedEvents).toBe(3);
  });

  /*
   * months 4, TAIL_SPAN 1: k0 starts at 4 (span from 3M). Events at 0.5M, 1.5M, 2.5M, 3.5M.
   * k0 = 4 holds 1 event, k0 = 3 holds 2, k0 = 2 holds 3, k0 = 1 holds 4.
   */
  const spread = [
    spell(0, 0.5 * M, 'advance'),
    spell(0, 1.5 * M, 'withdrawn'),
    spell(0, 2.5 * M, 'advance'),
    spell(0, 3.5 * M, 'expired'),
    spell(0, 6 * M, 'censored')
  ];

  it('k0 moves earlier until the span holds TAIL_MIN_EVENTS events', () => {
    const one = tailFit(spread, 4, cal({ tailSpan: 1, tailMinEvents: 1 }));
    expect(one.k0).toBe(4);
    expect(one.observedEvents).toBe(1);
    expect(one.personMonths).toBeCloseTo(0.5 + 3, 9);

    const three = tailFit(spread, 4, cal({ tailSpan: 1, tailMinEvents: 3 }));
    expect(three.k0).toBe(2);
    expect(three.observedEvents).toBe(3);
    expect(three.personMonths).toBeCloseTo(0.5 + 1.5 + 2.5 + 5, 9);
  });

  it('k0 stops at 1 when even the whole range holds too few events', () => {
    const f = tailFit(spread, 4, cal({ tailSpan: 1, tailMinEvents: 10 }));
    expect(f.k0).toBe(1);
    expect(f.observedEvents).toBe(4);
    expect(f.personMonths).toBeCloseTo(0.5 + 1.5 + 2.5 + 3.5 + 6, 9);
  });

  it('a short table starts the span at k0 = 1', () => {
    expect(tailFit(spread, 2, LIVE_CAL).k0).toBe(1);
  });

  it('every w = 1 gives the unweighted fits bit for bit', () => {
    const c = cal({ tailSpan: 2, tailMinEvents: 1 });
    const ones = hand.map((s) => ({ ...s, w: 1 }));
    expect(tailFit(ones, 4, c)).toEqual(tailFit(hand, 4, c));
    expect(tailFit(ones, 4, c, { advance: 2 })).toEqual(tailFit(hand, 4, c, { advance: 2 }));
    const spreadOnes = spread.map((s) => ({ ...s, w: 1 }));
    const c3 = cal({ tailSpan: 1, tailMinEvents: 3 });
    expect(tailFit(spreadOnes, 4, c3)).toEqual(tailFit(spread, 4, c3));
  });

  /*
   * hand with the advance at 3M weighted 2: exposure 2*1 + 2 + 3 + 0 + 1 = 8 person-months;
   * span events advance 2, withdrawn 1, expired 1 (4 in all): lambda_adv = 1/4, the others 1/8.
   */
  it('weights the person-months and the events of the span', () => {
    const w = hand.map((s, i) => (i === 0 ? { ...s, w: 2 } : s));
    const f = tailFit(w, 4, cal({ tailSpan: 2, tailMinEvents: 1 }));
    expect(f.k0).toBe(3);
    expect(f.observedEvents).toBe(3);
    expect(f.weightedEvents).toBe(4);
    expect(f.personMonths).toBeCloseTo(8, 9);
    expect(f.lambda.advance).toBeCloseTo(1 / 4, 12);
    expect(f.lambda.withdrawn).toBeCloseTo(1 / 8, 12);
    expect(exposureFrom(w, 2 * M) / M).toBeCloseTo(8, 9);
    const c = cal({ tailSpan: 2, tailMinEvents: 1 });
    expect(exposureFrom(hand, 2 * M) / M).toBe(tailFit(hand, 4, c).personMonths);
  });

  it('weights never move k0: TAIL_MIN_EVENTS counts observed events (ruling R18)', () => {
    // the span from 3M holds one observed event, the expired at 3.5M; weighted 3 it would meet
    // TAIL_MIN_EVENTS = 3 on its own, but k0 still moves to 2 as for unit weights
    const w = spread.map((s) => (s.outcome === 'expired' ? { ...s, w: 3 } : s));
    const c3 = cal({ tailSpan: 1, tailMinEvents: 3 });
    const f = tailFit(w, 4, c3);
    expect(f.k0).toBe(tailFit(spread, 4, c3).k0);
    expect(f.k0).toBe(2);
    expect(f.observedEvents).toBe(3);
    // withdrawn at 1.5M, advance at 2.5M, expired at 3.5M weighted 3
    expect(f.weightedEvents).toBe(5);
  });

  it('no exposure or no events gives a zero tail', () => {
    const f = tailFit([spell(0, 10, 'censored')], 1, LIVE_CAL);
    expect(f.observedEvents).toBe(0);
    expect(f.tail.advance).toBe(0);
    expect(Object.values(f.tail.exit)).toEqual([0, 0, 0, 0]);
    expect(tailFit([], 1, LIVE_CAL).tail.advance).toBe(0);
  });
});

describe('rejects', () => {
  const tail = { advance: 0.05, exit: { expired: 0.01 } };

  it('accepts C(K) <= 1 - 1e-6 with rho > 0', () => {
    expect(rejects([0.1, 0.5], { expired: [0.05, 0.2] }, tail)).toBe(false);
  });

  it('rejects rho = 0', () => {
    expect(rejects([0.1, 0.5], { expired: [0.05, 0.2] }, { advance: 0, exit: {} })).toBe(true);
    expect(rejects([0.1], {}, { advance: 0, exit: { withdrawn: 0, expired: 0 } })).toBe(true);
  });

  it('rejects C(K) = 1 and C(K) within 1e-6 of 1', () => {
    expect(rejects([0.5, 0.6], { expired: [0.2, 0.4] }, tail)).toBe(true);
    expect(rejects([0.5, 0.6], { expired: [0.2, 0.3999995] }, tail)).toBe(true);
  });

  it('rejects rho > 1 (6-significant-digit rounding can push the sum over 1) and accepts 1', () => {
    expect(rejects([0.1], {}, { advance: 0.6, exit: { expired: 0.400001 } })).toBe(true);
    expect(rejects([0.1], {}, { advance: 0.6, exit: { expired: 0.4 } })).toBe(false);
  });

  it('rejects an empty table', () => {
    expect(rejects([], {}, tail)).toBe(true);
  });
});
