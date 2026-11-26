// The T9 policy seam (spec §6 `policy.spec.ts`, AC 17): the `baseZoning` view and `applyPolicies`.
import { describe, expect, it } from 'vitest';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Calibration } from '$lib/timelapse/types';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import { miniMarket } from './fixtures/mini-market';
import { miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput, precomputeOf } from './input';
import { applyPolicies, baseZoning, type PolicyOp } from './policy';
import type { SimInput } from './types';

const miniCalibration = (): Calibration =>
  parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const miniFiles = () => ({
  parcels: miniCity().parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: miniCalibration()
});
const miniInput = (): SimInput => buildSimInput(miniFiles());

describe('baseZoning view (§4.4.8)', () => {
  it('swaps envelope, yield, hostable and the feature variants onto the base columns', () => {
    const p = miniInput().parcels;
    const { parcels: v } = baseZoning(miniCalibration(), p);
    expect(v.envelopeStories).toBe(p.baseStories);
    expect(v.yield).toBe(p.baseYield);
    expect(v.hostable).toBe(p.hostableBase);
    expect(v.potentialRatio.fzp).toBe(p.potentialRatio.base);
    expect(v.storiesGap.fzp).toBe(p.storiesGap.base);
    expect(v.potentialRatio.base).toBe(p.potentialRatio.base);
    expect(v.storiesGap.base).toBe(p.storiesGap.base);
  });

  it('turns the Local Program off with a fresh zero column; the source is untouched', () => {
    const p = miniInput().parcels;
    expect(Array.from(p.localProgram).some((x) => x === 1)).toBe(true);
    const before = Array.from(p.localProgram);
    const { parcels: v } = baseZoning(miniCalibration(), p);
    expect(v.localProgram).not.toBe(p.localProgram);
    expect(v.localProgram.length).toBe(p.count);
    expect(Array.from(v.localProgram).every((x) => x === 0)).toBe(true);
    expect(Array.from(p.localProgram)).toEqual(before);
  });

  it('copies nothing else: every other column is the same object', () => {
    const p = miniInput().parcels;
    const { parcels: v } = baseZoning(miniCalibration(), p);
    const swapped = new Set([
      'envelopeStories',
      'yield',
      'hostable',
      'localProgram',
      'potentialRatio',
      'storiesGap'
    ]);
    for (const k of Object.keys(p) as (keyof ScenarioParcels)[]) {
      if (swapped.has(k)) continue;
      expect(v[k]).toBe(p[k]);
    }
  });

  it('returns the same calibration object, deep-equal to a pre-call clone', () => {
    const cal = miniCalibration();
    const clone = structuredClone(cal);
    const out = baseZoning(cal, miniInput().parcels);
    expect(out.cal).toBe(cal);
    expect(out.cal).toEqual(clone);
  });
});

describe('applyPolicies', () => {
  it('returns a new SimInput with its own precompute; the original is unchanged', () => {
    const inp = miniInput();
    const twin = applyPolicies([baseZoning], inp);
    expect(twin).not.toBe(inp);
    expect(twin.parcels).not.toBe(inp.parcels);
    expect(twin.projects).toBe(inp.projects);
    expect(twin.calibration).toBe(inp.calibration);
    expect(twin.asOf).toBe(inp.asOf);
    expect(inp.parcels.envelopeStories).not.toBe(inp.parcels.baseStories);
    expect(precomputeOf(twin)).not.toBe(precomputeOf(inp));
  });

  it('with no ops still returns a new object', () => {
    const inp = miniInput();
    const same = applyPolicies([], inp);
    expect(same).not.toBe(inp);
    expect(same).toEqual(inp);
  });

  it('applies ops in order, threading calibration and parcels through each', () => {
    const inp = miniInput();
    const seen: string[] = [];
    const tag =
      (name: string): PolicyOp =>
      (cal, parcels) => {
        seen.push(name);
        return { cal, parcels };
      };
    const cal2 = miniCalibration();
    const swapCal: PolicyOp = (_cal, parcels) => ({ cal: cal2, parcels });
    const out = applyPolicies([tag('a'), swapCal, baseZoning, tag('b')], inp);
    expect(seen).toEqual(['a', 'b']);
    expect(out.calibration).toBe(cal2);
    expect(out.parcels.hostable).toBe(inp.parcels.hostableBase);
  });
});

describe('applyPolicies keeps the market', () => {
  it('passes input.market through untouched', () => {
    const files = miniFiles();
    files.calibration = { ...files.calibration, market: miniMarket() };
    const input = buildSimInput(files);
    expect(input.market).toBeDefined();
    expect(applyPolicies([baseZoning], input).market).toBe(input.market);
  });
});
