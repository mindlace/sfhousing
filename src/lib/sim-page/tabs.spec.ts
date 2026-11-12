import { describe, expect, it } from 'vitest';
import { fixtureCalibrationWithoutMarket } from '$lib/fzp/fixtures/calibration';
import { SIM_TABS, simTabs, tabOrFirst } from './tabs';
import { fundingCalibration } from './test/funding';

describe('simTabs', () => {
  it('offers all five tabs with a calibration that has market and baselineFunding', () => {
    expect(simTabs(fundingCalibration()).map((t) => t.id)).toEqual([
      'transit',
      'paint',
      'permits',
      'protect',
      'funding'
    ]);
    expect(simTabs(fundingCalibration())).toEqual([...SIM_TABS]);
  });

  it('Funding is fifth', () => {
    expect(SIM_TABS[4]).toMatchObject({ id: 'funding', label: 'Funding' });
    expect(SIM_TABS).toHaveLength(5);
  });

  it('dropped without market', () => {
    const cal = structuredClone(fixtureCalibrationWithoutMarket());
    cal.baselineFunding = fundingCalibration().baselineFunding;
    expect(simTabs(cal).map((t) => t.id)).toEqual(['transit', 'paint', 'permits', 'protect']);
  });

  it('dropped without baselineFunding', () => {
    const cal = fundingCalibration();
    delete cal.baselineFunding;
    expect(simTabs(cal).map((t) => t.id)).toEqual(['transit', 'paint', 'permits', 'protect']);
  });

  it('null calibration drops Permits and Funding', () => {
    expect(simTabs(null).map((t) => t.id)).toEqual(['transit', 'paint', 'protect']);
  });
});

describe('tabOrFirst', () => {
  it('keeps a tab that is offered', () => {
    expect(tabOrFirst(simTabs(fundingCalibration()), 'funding')).toBe('funding');
  });

  it('falls back to the first tab when the active one is gone', () => {
    expect(tabOrFirst(simTabs(null), 'permits')).toBe('transit');
    expect(tabOrFirst(simTabs(null), 'funding')).toBe('transit');
  });
});
