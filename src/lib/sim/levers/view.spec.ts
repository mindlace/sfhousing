import { describe, expect, it } from 'vitest';
import { parseCalibration } from '$lib/timelapse/model';
import type { SimInput } from '../scenario/types';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import miniCalibrationJson from '../scenario/fixtures/mini-calibration.json';
import { MINI_AS_OF } from '../scenario/fixtures/mini-projects';
import { MINI_EXEMPT_PERM_ID, MINI_SB79_ID, miniPolicy } from '../scenario/fixtures/mini-policy';
import { precomputeOf } from '../scenario/input';
import { blendStock, sb79WinsAfter, type LayerCtx } from './layers';
import { DEFAULT_LEVERS, type SimLevers } from './types';
import { envelopeOp, localProgramColumn, parcelsView } from './view';

function setup() {
  const city = miniCity();
  const ctx: LayerCtx = { parcels: city.parcels, policy: miniPolicy(city) };
  return { ctx, parcels: city.parcels };
}
const levers = (over: Partial<SimLevers>): SimLevers => ({
  ...structuredClone(DEFAULT_LEVERS),
  ...over
});
const F = 5;

describe('parcelsView', () => {
  it('derives potentialRatio.fzp and storiesGap.fzp exactly as the decoder does', () => {
    const { ctx, parcels } = setup();
    const t = blendStock(ctx, ['fzp'], 'before', false);
    const v = parcelsView(parcels, t, parcels.localProgram);
    expect(v.potentialRatio.fzp.length).toBe(parcels.count);
    for (let i = 0; i < parcels.count; i++) {
      expect(Object.is(v.potentialRatio.fzp[i], parcels.potentialRatio.fzp[i])).toBe(true);
      expect(Object.is(v.storiesGap.fzp[i], parcels.storiesGap.fzp[i])).toBe(true);
    }
    expect(v.potentialRatio.base).toBe(parcels.potentialRatio.base);
    expect(v.storiesGap.base).toBe(parcels.storiesGap.base);
  });

  it('presents the table without mutating any source column', () => {
    const { ctx, parcels } = setup();
    const before = Array.from(parcels.yield);
    const t = blendStock(ctx, ['sb79'], 'before', false);
    const v = parcelsView(parcels, t, new Uint8Array(parcels.count));
    expect(v.envelopeStories).toBe(t.stories);
    expect(v.yield).toBe(t.yield);
    expect(v.hostable).toBe(t.hostable);
    expect(Array.from(parcels.yield)).toEqual(before);
    expect(v.yield.length).toBe(parcels.count * F);
  });

  it('precomputeOf gives the same hazard as the base input under an fzp table', () => {
    const { ctx, parcels } = setup();
    const calibration = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
    const input: SimInput = {
      parcels,
      projects: [],
      calibration,
      asOf: MINI_AS_OF,
      districtMaxStories: null
    };
    const t = blendStock(ctx, ['fzp'], 'before', false);
    const view = parcelsView(parcels, t, parcels.localProgram);
    const a = precomputeOf(input).hazard;
    const b = precomputeOf({ ...input, parcels: view }).hazard;
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});

describe('envelopeOp', () => {
  it('returns the calibration as the same object and the view as parcels', () => {
    const { ctx, parcels } = setup();
    const t = blendStock(ctx, ['fzp'], 'before', false);
    const lp = parcels.localProgram;
    const cal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
    const out = envelopeOp(t, lp)(cal, parcels);
    expect(out.cal).toBe(cal);
    expect(out.parcels.envelopeStories).toBe(t.stories);
    expect(out.parcels.localProgram).toBe(lp);
  });
});

describe('localProgramColumn', () => {
  it('follows the decoded column under fzp or currentLaw', () => {
    const { ctx, parcels } = setup();
    expect(parcels.localProgram.some((x) => x === 1)).toBe(true);
    for (const s of [['fzp'], ['currentLaw']] as const) {
      const col = localProgramColumn(ctx, levers({ stock: [...s] }), 'before');
      expect(Array.from(col)).toEqual(Array.from(parcels.localProgram));
    }
  });
  it('is all zero for sb79 alone and when streamlining is off', () => {
    const { ctx, parcels } = setup();
    const zero = (c: Uint8Array) => c.length === parcels.count && c.every((x) => x === 0);
    for (const period of ['before', 'after'] as const) {
      expect(zero(localProgramColumn(ctx, levers({ stock: ['sb79'] }), period))).toBe(true);
      expect(
        zero(
          localProgramColumn(
            ctx,
            levers({ stock: ['fzp'], localProgramStreamlined: false }),
            period
          )
        )
      ).toBe(true);
    }
  });
  it('Local Program follows the route shares where SB 79 wins after the switch', () => {
    const { ctx, parcels } = setup();
    const i = parcels.index.get(MINI_SB79_ID)!;
    const fzpWins = parcels.index.get(MINI_EXEMPT_PERM_ID)!;
    expect(parcels.localProgram[i]).toBe(1);
    expect(parcels.localProgram[fzpWins]).toBe(1);
    expect(sb79WinsAfter(ctx)[i]).toBe(1);
    expect(sb79WinsAfter(ctx)[fzpWins]).toBe(0);
    const col = (over: Partial<SimLevers>, period: 'before' | 'after') =>
      localProgramColumn(ctx, levers(over), period);
    expect(col({}, 'before')[i]).toBe(1);
    expect(col({}, 'after')[i]).toBe(0);
    expect(col({ assumeAlternativePlanKept: true }, 'after')[i]).toBe(1);
    expect(col({ stock: ['currentLaw', 'fzp'] }, 'after')[i]).toBe(1);
    expect(col({}, 'before')[fzpWins]).toBe(1);
    expect(col({}, 'after')[fzpWins]).toBe(1);
  });
});
