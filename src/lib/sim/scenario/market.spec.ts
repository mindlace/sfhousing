import { describe, expect, it } from 'vitest';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniFunding, miniMarket } from './fixtures/mini-market';
import { marketLevel, marketSteps } from './market';

const cal = (): Calibration => parseCalibration(structuredClone(miniCalibrationJson) as unknown);

describe('marketSteps', () => {
  it('is empty without a model', () => {
    expect(marketSteps(undefined, 100, 'all')).toEqual([]);
  });

  it('is one step at asOf with the level asked for', () => {
    const m = miniMarket();
    expect(marketSteps(m, 100, 'all')).toEqual([{ from: 100, logOdds: m.today.all }]);
    expect(marketSteps(m, 100, 'private')).toEqual([{ from: 100, logOdds: m.today.private }]);
  });

  it('returns a fresh array each call', () => {
    const m = miniMarket();
    const a = marketSteps(m, 100, 'all');
    const b = marketSteps(m, 100, 'all');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('marketLevel', () => {
  it("is 'all' with and without a market, and with baselineFunding present", () => {
    expect(marketLevel(cal())).toBe('all');
    expect(marketLevel({ ...cal(), market: miniMarket() })).toBe('all');
    // finance-engine changes this last case to 'private'
    const withFunding = {
      ...cal(),
      market: miniMarket(),
      baselineFunding: miniFunding()
    };
    expect(marketLevel(withFunding)).toBe('all');
  });
});
