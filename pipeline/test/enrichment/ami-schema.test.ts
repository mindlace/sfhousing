import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AMI_JSON, parseAmiFile } from '../../enrichment/ami-schema';

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

const cite = {
  label: 'MOHCD 2026 AMI chart',
  url: 'https://media.api.sf.gov/documents/2026_AMI-IncomeLimits-HMFA.pdf',
  page: 'p. 1, row "100% of Median"',
  accessed: '2026-11-24'
};
const ROW_2026 = [113450, 129700, 145900, 162100, 175050, 188050, 201000, 213950];

const file = (years: { year: number; bySize: number[] }[], sources = [cite]) => ({
  years,
  sources
});

describe('parseAmiFile', () => {
  it('accepts years of eight household sizes', () => {
    expect(parseAmiFile(file([{ year: 2026, bySize: ROW_2026 }])).years[0].bySize[3]).toBe(162100);
  });

  it('rejects a year without eight sizes', () => {
    expect(() => parseAmiFile(file([{ year: 2026, bySize: ROW_2026.slice(0, 7) }]))).toThrow();
  });

  it('rejects incomes that fall as the household grows', () => {
    const bad = [...ROW_2026];
    bad[4] = 100;
    expect(() => parseAmiFile(file([{ year: 2026, bySize: bad }]))).toThrow(/size/);
  });

  it('rejects years out of order or repeated', () => {
    const y = (year: number) => ({ year, bySize: ROW_2026 });
    expect(() => parseAmiFile(file([y(2026), y(2025)]))).toThrow(/year/);
    expect(() => parseAmiFile(file([y(2026), y(2026)]))).toThrow(/year/);
  });

  it('rejects a file without sources', () => {
    expect(() => parseAmiFile(file([{ year: 2026, bySize: ROW_2026 }], []))).toThrow(/sources/);
  });

  it('parses the committed ami.json: 2026 is the MOHCD chart row', () => {
    const ami = parseAmiFile(readJson(AMI_JSON));
    expect(ami.years.at(-1)).toEqual({ year: 2026, bySize: ROW_2026 });
    expect(ami.years[0].bySize).toHaveLength(8);
  });
});
