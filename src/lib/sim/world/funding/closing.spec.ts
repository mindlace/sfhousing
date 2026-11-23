import { describe, expect, it } from 'vitest';
import type { PolicyTimeline } from '../../policy/frame';
import { staticsOf } from '../statics';
import type { FundingSystem } from '../types';
import { withFunding } from '../world';
import { createFundingSystem } from './system';
import { fundedMini, oneMoneyTimeline, replanAt } from './test/fixtures';

describe('withFunding and the closing hooks', () => {
  it('step runs under beforeStep and planDue under timelineOf', () => {
    const input = fundedMini();
    const statics = staticsOf(input);
    const base = oneMoneyTimeline(input, input.finance!);
    const other = replanAt(base, 3);
    const seen: PolicyTimeline[] = [];
    const asked: number[] = [];
    const sys: FundingSystem = {
      ...createFundingSystem(),
      beforeStep: (w, _s, t) => {
        expect(t).toBe(base);
        asked.push(w.month);
        return other;
      },
      timelineOf: (_w, _s, t) => {
        expect(t).toBe(base);
        return other;
      },
      serve: (ctx) => {
        seen.push(ctx.timeline);
      }
    };
    const core = withFunding(sys);
    const out = { event() {} };
    const w = core.createWorld(statics, base, 1, out);
    const due = core.planDue(w, statics, base, 1, 4);
    for (let m = 1; m <= 4; m++) core.step(w, due, statics, base, 1, out);
    expect(asked).toEqual([0, 1, 2, 3]);
    expect(seen).toEqual([other, other, other, other]);
  });
});
