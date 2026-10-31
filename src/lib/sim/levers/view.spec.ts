import { describe, expect, it } from 'vitest';
import { parseCalibration } from '$lib/timelapse/model';
import type { SimInput } from '../scenario/types';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import miniCalibrationJson from '../scenario/fixtures/mini-calibration.json';
import { MINI_AS_OF } from '../scenario/fixtures/mini-projects';
import { miniPolicy } from '../scenario/fixtures/mini-policy';
import { precomputeOf } from '../scenario/input';
import { stockTable, type LayerCtx } from './layers';
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
    const t = stockTable(ctx, 'fzp');
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
    const t = stockTable(ctx, 'base');
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
    const t = stockTable(ctx, 'fzp');
    const view = parcelsView(parcels, t, parcels.localProgram);
    const a = precomputeOf(input).hazard;
    const b = precomputeOf({ ...input, parcels: view }).hazard;
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});

describe('envelopeOp', () => {
  it('returns the calibration as the same object and the view as parcels', () => {
    const { ctx, parcels } = setup();
    const t = stockTable(ctx, 'fzp');
    const lp = parcels.localProgram;
    const cal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
    const out = envelopeOp(t, lp)(cal, parcels);
    expect(out.cal).toBe(cal);
    expect(out.parcels.envelopeStories).toBe(t.stories);
    expect(out.parcels.localProgram).toBe(lp);
  });
});

describe('localProgramColumn', () => {
  it('is the decoded column when Local Program lots are streamlined', () => {
    const { ctx, parcels } = setup();
    expect(parcels.localProgram.some((x) => x === 1)).toBe(true);
    expect(localProgramColumn(ctx, DEFAULT_LEVERS)).toBe(parcels.localProgram);
  });
  it('is all zero when streamlining is off', () => {
    const { ctx, parcels } = setup();
    const col = localProgramColumn(ctx, levers({ localProgramStreamlined: false }));
    expect(col.length).toBe(parcels.count);
    expect(col.every((x) => x === 0)).toBe(true);
  });
});
