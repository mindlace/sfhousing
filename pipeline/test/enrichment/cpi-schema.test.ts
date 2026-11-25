import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CPI_JSON, parseCpiFile } from '../../enrichment/cpi-schema';

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

const cite = {
  label: 'BLS CPI-U San Francisco-Oakland-Hayward, all items',
  url: 'https://data.bls.gov/timeseries/CUURS49BSA0',
  page: 'period M13 (annual average)',
  accessed: '2026-11-25'
};
const file = (annual: Record<string, number>, sources = [cite]) => ({
  seriesId: 'CUURS49BSA0',
  annual,
  sources,
  method: 'annual averages as published'
});

describe('parseCpiFile', () => {
  it('parses annual averages by year', () => {
    expect(parseCpiFile(file({ '2024': 348.417, '2025': 356.005 })).annual['2025']).toBe(356.005);
  });

  it('rejects a year key that is not a year, a non-positive value, or no sources', () => {
    expect(() => parseCpiFile(file({ x: 1 }))).toThrow(/cpi/);
    expect(() => parseCpiFile(file({ '2025': 0 }))).toThrow(/cpi/);
    expect(() => parseCpiFile(file({ '2025': 356 }, []))).toThrow(/sources/);
  });

  it('parses the committed cpi.json: the BLS series, 2005 to 2025', () => {
    const c = parseCpiFile(readJson(CPI_JSON));
    expect(c.seriesId).toBe('CUURS49BSA0');
    expect(c.annual['2016']).toBe(266.344);
    expect(c.annual['2025']).toBe(356.005);
    expect(Object.keys(c.annual)).toHaveLength(21);
  });
});
