import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarketFile } from '../../enrichment/market-schema';
import { CalibrationError } from '../../lib/fzp-cal/types';
import { REFERENCES } from '../../../src/lib/sim/scenario/score';

const MARKET_JSON_PATH = resolve(__dirname, '../../enrichment/market.json');
const raw = () => JSON.parse(readFileSync(MARKET_JSON_PATH, 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('market.json', () => {
  it('parses with the Controller coefficients, every cost year and the two price periods', () => {
    const file = parseMarketFile(raw(), 'market.json');
    expect(file.coefficients.cost.value).toBe(-0.0992);
    expect(file.coefficients.price.value).toBe(0.0143);
    expect(Object.keys(file.costIndex.values)).toEqual(range(2005, 2023).map(String));
    expect(file.priceIndex.means.map((m) => [m.from, m.to])).toEqual([
      [2005, 2020],
      [2021, 2023]
    ]);
    expect(Object.keys(file.priceIndex)).toEqual(['locator', 'means']);
  });

  it('rejects a missing cost year, an extra priceIndex key and three periods', () => {
    const missing = raw();
    delete missing.costIndex.values['2014'];
    const extra = raw();
    extra.priceIndex.values = {};
    const three = raw();
    three.priceIndex.means.push({ from: 2024, to: 2024, mean: 90 });
    for (const bad of [missing, extra, three]) {
      expect(() => parseMarketFile(bad, 'x.json')).toThrow(CalibrationError);
      expect(() => parseMarketFile(bad, 'x.json')).toThrow(/^market: x\.json: /);
    }
  });

  it('is the source the Controller references cite', () => {
    const file = parseMarketFile(raw(), 'market.json');
    for (const id of ['controller-high', 'controller-low']) {
      const r = REFERENCES.find((x) => x.id === id)!;
      expect(r.provenance.sources.map((s) => s.url)).toEqual([file.source.url]);
      expect(r.provenance.sources.map((s) => s.label)).toEqual([`${file.source.label}, slide 18`]);
    }
  });
});
