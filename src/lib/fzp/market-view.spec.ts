import { describe, expect, it } from 'vitest';
import { fixtureCalibrationWithoutMarket } from './fixtures/calibration';
import { fixtureMarketCalibration, liveMarketCalibration } from './fixtures/market';
import { marketSentence } from './market-view';

describe('marketSentence', () => {
  it('states the live all-starts form exactly', () => {
    expect(marketSentence(liveMarketCalibration(), 'all')).toBe(
      "It runs on today's market. In 2023 to 2025, 129 new projects started, where the start model, fitted on the city's records from 2007 to 2025, expected 246. So every lot's chance of starting is set to about 52% of that average, to the end of the timeline. This holds today's market; it is not a forecast."
    );
  });

  it('drops the window when the initiation provenance has none', () => {
    const s = marketSentence(fixtureMarketCalibration(), 'all')!;
    expect(s).toContain(
      "10 new projects started, where the start model, fitted on the city's records, expected 20"
    );
    expect(s).toContain('about 50%');
  });

  it('has a private form', () => {
    const s = marketSentence(fixtureMarketCalibration(), 'private')!;
    expect(s).toContain('9 new projects started other than');
    expect(s).toContain('about 45%');
    expect(s).toContain('without public money');
  });

  it('is null without a market', () => {
    expect(marketSentence(fixtureCalibrationWithoutMarket(), 'all')).toBeNull();
  });
});
