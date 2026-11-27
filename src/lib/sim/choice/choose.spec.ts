import { describe, expect, it } from 'vitest';
import {
  allowedCount,
  choiceCtxOf,
  choiceFeatures,
  choiceRow,
  choiceStepAt,
  expectations,
  mostHomes,
  optionHomes,
  pickOption,
  type ChoiceCtx
} from './choose';
import { lotConstants } from './options';
import { choiceModel, heightTime, opt, shippedPrices, table, typeICostTimes } from './test/model';
import type { Option } from './types';

// Lot 0, at the shipped step: Type V A-priced, Type III and Type I at C. Carrying (months beyond
// the anchor's band): III at 6 stories 0.7 months, 2,009 a home; I at 10 stories 1.2 months,
// 4,010 a home. At locationValue 1.5 the residual land values are V 2.98M, III 6.92M, I 9.27M,
// and (cost + carry) ÷ value is V 1.3202, III 1.2634, I 1.3222.
const lotOptions: Option[] = [
  opt('V', 'walkup', 4, 30),
  opt('III', 'podium', 6, 50),
  opt('I', 'midrise', 10, 80)
];
const bigOptions: Option[] = [
  opt('V', 'podium', 6, 400),
  opt('III', 'midrise', 8, 900),
  opt('I', 'block', 13, 1600),
  opt('I', 'block', 24, 2900),
  opt('I', 'tower', 40, 4800)
];
const lot = 0;
const bigLot = 1;
const bestRlvIndex = 2;
const typeIIIIndex = 1;

function ctxOf(locationValue: number, choiceSpread = 0.1, m = choiceModel(choiceSpread)) {
  const t = table([
    { options: lotOptions, locationValue },
    { options: bigOptions, locationValue }
  ]);
  return choiceCtxOf(t, m, heightTime);
}
const ctx = ctxOf(1.5);
const ctxChoiceSpread = (s: number) => ctxOf(1.5, s);
const ctxLocationValue = (v: number) => ctxOf(v);
const ctxTwoSteps = ctxOf(
  1.5,
  0.1,
  choiceModel(0.1, [
    { from: 0, value: shippedPrices() },
    { from: 365, value: typeICostTimes(shippedPrices(), 0.7) }
  ])
);

/** The option with the largest share in the market row of `lot`'s three options. */
function argmaxProb(c: ChoiceCtx, at: number): number {
  const out = new Float32Array(8);
  choiceRow(c, 0, at, 3, null, 0, 'market', out);
  let best = 0;
  let top = -1;
  for (let k = 0; k < 3; k++) {
    const share = out[k] - (k ? out[k - 1] : 0);
    if (share > top) [best, top] = [k, share];
  }
  return best;
}

describe('choiceRow', () => {
  it('becomes the argmax as choiceSpread goes to 0', () => {
    const out = new Float32Array(8);
    choiceRow(ctxChoiceSpread(1e-9), 0, lot, 3, null, 0, 'market', out);
    expect(pickOption(out, 3, 0.5)).toBe(bestRlvIndex);
  });
  it('stays finite at locationValue 30 and thousands of homes', () => {
    const out = new Float32Array(8);
    expect(choiceRow(ctxLocationValue(30), 0, bigLot, 5, null, 0, 'market', out)).toBe(true);
    for (let k = 0; k < 5; k++) expect(Number.isFinite(out[k])).toBe(true);
    expect(out[4]).toBe(1);
  });
  it('returns false and leaves zeros when no option gains a home', () => {
    const out = new Float32Array(8);
    expect(choiceRow(ctx, 0, lot, 3, 10, 12, 'market', out)).toBe(false);
    expect([...out.slice(0, 3)]).toEqual([0, 0, 0]);
  });
  it('treats a lot below break-even as at break-even', () => {
    // locationValue 0.6 < breakEvenValue: the best-per-dollar option (Type III at average values) is most likely
    expect(argmaxProb(ctxLocationValue(0.6), lot)).toBe(typeIIIIndex);
  });
  it('picks the most homes under the most-homes rule', () => {
    const out = new Float32Array(8);
    choiceRow(ctx, 0, lot, 3, null, 0, 'most-homes', out);
    expect(pickOption(out, 3, 0)).toBe(mostHomes(ctx.t, lot, 3, null, 0));
    expect([...out.slice(0, 3)]).toEqual([0, 0, 1]);
  });
  it('reads each cost step on its own', () => {
    // ctxTwoSteps: step 1 cuts Type I costPerHome by 30%
    const a = new Float32Array(8);
    const b = new Float32Array(8);
    choiceRow(ctxTwoSteps, 0, lot, 5, null, 0, 'market', a);
    choiceRow(ctxTwoSteps, 1, lot, 5, null, 0, 'market', b);
    expect([...b.slice(0, 5)]).not.toEqual([...a.slice(0, 5)]);
    expect(ctxTwoSteps.step(1).breakEvenValue[lot]).toBeLessThan(
      ctxTwoSteps.step(0).breakEvenValue[lot]
    );
  });
  it('gives an option that gains no home a zero share and ends at exactly 1', () => {
    // existing 40: the 30-home Type V gains nothing; a cap of 60 clips Type I to 60
    const out = new Float32Array(8);
    expect(choiceRow(ctx, 0, lot, 3, 60, 40, 'market', out)).toBe(true);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[2]).toBe(1);
  });
  it('sets every option after the last gaining one to 1', () => {
    // a cap of 40 over 30 existing homes clips III and I to 40, and V's 30 homes gain nothing
    const out = new Float32Array(8);
    expect(choiceRow(ctx, 0, lot, 3, 40, 30, 'most-homes', out)).toBe(true);
    // III and I tie at 40 clipped homes: the first wins
    expect([...out.slice(0, 3)]).toEqual([0, 1, 1]);
  });
});

describe('pickOption', () => {
  it('takes the first k with u below the cumulative probability, or -1', () => {
    const cum = Float32Array.of(0, 0.25, 1);
    expect(pickOption(cum, 3, 0)).toBe(1);
    expect(pickOption(cum, 3, 0.25)).toBe(2);
    expect(pickOption(new Float32Array(3), 3, 0.5)).toBe(-1);
  });
});

describe('the step context', () => {
  it("holds each lot's constants at the step", () => {
    const p = shippedPrices();
    const s = ctx.step(0);
    const want = lotConstants(lotOptions, p, heightTime.steps[0].value, heightTime.upTo);
    expect(s.breakEvenValue[lot]).toBeCloseTo(want.breakEvenValue, 5);
    expect(s.meanOptionHomes[lot]).toBeCloseTo(want.meanOptionHomes, 3);
    expect(s.meanOptionCost[lot]).toBeCloseTo(want.meanOptionCost, 0);
    // III at 6 stories: (736,700 + 2,009) ÷ 584,700
    expect(s.breakEvenValue[lot]).toBeCloseTo(1.2634, 4);
    // (cost, value, carry) per option: Type V at A
    expect([...s.price.slice(0, 3)]).toEqual([729_700, 552_700, 0]);
    expect(s.price.length).toBe(3 * (lotOptions.length + bigOptions.length));
  });
  it('is built once and memoised per table and model', () => {
    expect(ctx.step(0)).toBe(ctx.step(0));
    expect(choiceCtxOf(ctx.t, ctx.m, ctx.ht)).toBe(ctx);
  });
  it("indexes steps over both series' days", () => {
    expect(choiceStepAt(ctxTwoSteps, 0)).toBe(0);
    expect(choiceStepAt(ctxTwoSteps, 364)).toBe(0);
    expect(choiceStepAt(ctxTwoSteps, 400)).toBe(1);
    expect(choiceStepAt(ctx, 400)).toBe(0);
    expect(() => ctx.step(1)).toThrow(RangeError);
  });
});

describe('caps and capacity', () => {
  it('counts the options allowed at a story cap', () => {
    expect(allowedCount(ctx.t, lot, 3)).toBe(0);
    expect(allowedCount(ctx.t, lot, 6)).toBe(2);
    expect(allowedCount(ctx.t, lot, 80)).toBe(3);
    expect(allowedCount(ctx.t, bigLot, 24)).toBe(4);
  });
  it('clips homes as capScenarioYield does', () => {
    const j = ctx.t.offset[lot] + 2;
    expect(optionHomes(ctx.t, j, null, 0)).toBe(80);
    expect(optionHomes(ctx.t, j, 60, 0)).toBe(60);
    expect(optionHomes(ctx.t, j, 10, 12)).toBe(0);
  });
  it('finds the most homes allowed, or -1', () => {
    expect(mostHomes(ctx.t, lot, 2, null, 0)).toBe(1);
    expect(mostHomes(ctx.t, lot, 3, 40, 30)).toBe(1);
    expect(mostHomes(ctx.t, lot, 3, 10, 12)).toBe(-1);
    expect(mostHomes(ctx.t, lot, 0, null, 0)).toBe(-1);
  });
});

describe('expectations', () => {
  it('gives the expected homes and stories and the best margin', () => {
    const e = expectations(ctxChoiceSpread(1e-9), 0, lot, 3, null, 0);
    expect(e.gains).toBe(true);
    expect(e.homes).toBeCloseTo(80, 3);
    expect(e.stories).toBeCloseTo(10, 3);
    // Type I: 80 × (1.5 × 651,700 − 857,700 − 4,010) ÷ (meanOptionHomes × meanOptionCost)
    const s = ctx.step(0);
    const rlv = 80 * (1.5 * 651_700 - 857_700 - 0.085 * 0.55 * 857_700 * 0.1);
    expect(e.margin).toBeCloseTo(rlv / (s.meanOptionHomes[lot] * s.meanOptionCost[lot]), 4);
    expect(e.best).toBe(2);
  });
  it('gives nothing when no option gains', () => {
    expect(expectations(ctx, 0, lot, 3, 10, 12)).toEqual({
      homes: 0,
      stories: 0,
      margin: 0,
      best: -1,
      gains: false
    });
  });
});

describe('choiceFeatures', () => {
  it('reads the start features off the expectations', () => {
    const c = ctxChoiceSpread(1e-9);
    const e = expectations(c, 0, lot, 3, null, 4);
    expect(choiceFeatures(c, 0, lot, 3, null, 4, 2)).toEqual({
      potentialRatio: e.homes / 4,
      storiesGap: e.stories - 2,
      choiceMargin: e.margin
    });
    // 80 homes at 10 stories by the argmax: ratio over max(existing, 1)
    expect(choiceFeatures(c, 0, lot, 3, null, 0, 2).potentialRatio).toBeCloseTo(80, 3);
    expect(choiceFeatures(c, 0, lot, 3, null, 0, 2).storiesGap).toBeCloseTo(8, 3);
  });
  it('is 0 homes, a gap of −existing stories and no margin when nothing gains', () => {
    expect(choiceFeatures(ctx, 0, lot, 3, 10, 12, 3)).toEqual({
      potentialRatio: 0,
      storiesGap: -3,
      choiceMargin: 0
    });
  });
});
