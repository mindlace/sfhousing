import { describe, expect, it } from 'vitest';
import { parseCalibration } from '$lib/timelapse/model';
import type { SimInput } from '../world/input/types';
import { allowedCount, capFrom, mostHomes } from '$lib/sim/choice/choose';
import { MINI_NO_GAIN_ID, miniCity } from '../world/fixtures/mini-parcels';
import { miniOptions } from '../world/fixtures/mini-options';
import miniCalibrationJson from '../world/fixtures/mini-calibration.json';
import { MINI_AS_OF } from '../world/fixtures/mini-projects';
import { miniPolicy } from '../world/fixtures/mini-policy';
import { precomputeOf } from '../world/input/build';
import { stockTable, type LayerCtx } from './layers';
import { DEFAULT_LEVERS, type SimLevers } from './types';
import { envelopeOp, localProgramColumn, parcelsView } from './view';

function setup() {
  const city = miniCity();
  const ctx: LayerCtx = {
    parcels: city.parcels,
    policy: miniPolicy(city),
    options: miniOptions(city)
  };
  return { ctx, parcels: city.parcels };
}
const levers = (over: Partial<SimLevers>): SimLevers => ({
  ...structuredClone(DEFAULT_LEVERS),
  ...over
});
describe('parcelsView', () => {
  it('hosts where the table allows it and an allowed option gains a home after the cap', () => {
    const { ctx, parcels } = setup();
    const t = stockTable(ctx, 'fzp');
    const v = parcelsView(parcels, t, parcels.localProgram, ctx.options);
    let hosting = 0;
    for (let i = 0; i < parcels.count; i++) {
      const allowed = allowedCount(ctx.options, i, t.stories[i]);
      const gains =
        mostHomes(ctx.options, i, allowed, capFrom(t.cap[i]), parcels.existingUnits[i]) >= 0;
      expect(v.hostable[i]).toBe(t.hostable[i] === 1 && gains ? 1 : 0);
      hosting += v.hostable[i];
    }
    expect(hosting).toBeGreaterThan(30);
    expect(v.hostable[parcels.index.get(MINI_NO_GAIN_ID)!]).toBe(0);
  });

  it('presents the table without mutating any source column', () => {
    const { ctx, parcels } = setup();
    const before = Array.from(parcels.hostable);
    const t = stockTable(ctx, 'base');
    const v = parcelsView(parcels, t, new Uint8Array(parcels.count), ctx.options);
    expect(v.envelopeStories).toBe(t.stories);
    expect(v.fzpCap).toBe(t.cap);
    expect(Array.from(parcels.hostable)).toEqual(before);
  });

  it('precomputeOf gives the same hazard as the base input under an fzp table', () => {
    const { ctx, parcels } = setup();
    const calibration = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
    const input: SimInput = {
      parcels,
      options: ctx.options,
      projects: [],
      calibration,
      asOf: MINI_AS_OF,
      districtMaxStories: null
    };
    const t = stockTable(ctx, 'fzp');
    const view = parcelsView(parcels, t, parcels.localProgram, ctx.options);
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
    const out = envelopeOp(t, lp, ctx.options)(cal, parcels);
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
