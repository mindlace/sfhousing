import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFundingFile } from '../../enrichment/funding-schema';

const LIVE = resolve(__dirname, '../../enrichment/funding.json');
const FIXTURE = resolve(__dirname, '../fixtures/mini/enrichment/funding.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>;

const POOL_IDS = [
  'city-debt',
  'city-ocoh',
  'city-general-fund',
  'city-impact-fees',
  'city-housing-trust-fund',
  'city-redevelopment'
];

function pages(v: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) v.forEach((x) => pages(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('label' in o && 'url' in o && 'retrieved' in o) out.push(o.page);
    Object.values(o).forEach((x) => pages(x, out));
  }
  return out;
}

describe('funding.json', () => {
  it('parses, with the pinned ids and a page on every cite', () => {
    const f = parseFundingFile(load(LIVE), 'funding.json');
    expect(f.retiredIds).toEqual([]);
    expect(f.city.sources.map((s) => s.id)).toEqual(POOL_IDS);
    expect(f.state.id).toBe('state');
    expect(f.federal.id).toBe('federal-tax-credits');
    const all = pages(f);
    expect(all.length).toBeGreaterThan(20);
    for (const p of all) expect(typeof p === 'string' && p.length > 0).toBe(true);
  });

  it('has the expected award sums', () => {
    const f = parseFundingFile(load(LIVE), 'funding.json');
    const sum = (year: number, newOnly: boolean) =>
      f.awards.rows
        .filter((r) => r.year === year && (!newOnly || r.newConstruction))
        .reduce((a, r) => a + r.homes, 0);
    expect(f.awards.rows).toHaveLength(19);
    expect([sum(2024, true), sum(2025, true), sum(2024, false), sum(2025, false)]).toEqual([
      1274, 686, 1384, 839
    ]);
  });

  it('fixture twin parses with the live ids and kinds and Fixture: labels', () => {
    const live = parseFundingFile(load(LIVE), 'funding.json');
    const fx = parseFundingFile(load(FIXTURE), 'funding.json');
    expect(fx.city.sources.map((s) => [s.id, s.kind])).toEqual(
      live.city.sources.map((s) => [s.id, s.kind])
    );
    expect(fx.state.id).toBe(live.state.id);
    expect(fx.federal.id).toBe(live.federal.id);
    expect({ ...fx.perHome, cite: null }).toEqual({ ...live.perHome, cite: null });
    const citeLabels: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if ('url' in o && 'label' in o) citeLabels.push(String(o.label));
        Object.values(o).forEach(walk);
      }
    };
    walk(fx);
    expect(citeLabels.length).toBeGreaterThan(5);
    for (const l of citeLabels) expect(l).toMatch(/^Fixture:/);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutations: [string, (f: Record<string, any>) => void, string][] = [
    ['perHome.other +1', (f) => (f.perHome.other += 1), 'perHome parts must sum to total'],
    [
      'a city source +1',
      (f) => (f.city.sources[0].dollarsPerYear += 1),
      'city sources must sum to total'
    ],
    [
      'a 32-character id',
      (f) => (f.city.sources[1].id = 'a'.repeat(32)),
      'funding ids must be unique, at most 31 characters of a-z, 0-9 and -, and not start u-'
    ],
    [
      'id u-city',
      (f) => (f.city.sources[1].id = 'u-city'),
      'funding ids must be unique, at most 31 characters of a-z, 0-9 and -, and not start u-'
    ],
    [
      'id City-debt',
      (f) => (f.city.sources[0].id = 'City-debt'),
      'funding ids must be unique, at most 31 characters of a-z, 0-9 and -, and not start u-'
    ],
    [
      'a duplicate id',
      (f) => (f.state.id = 'city-debt'),
      'funding ids must be unique, at most 31 characters of a-z, 0-9 and -, and not start u-'
    ],
    [
      'retiredIds state',
      (f) => (f.retiredIds = ['state']),
      'funding id state is retired and cannot be reused'
    ],
    [
      'debt on city-ocoh',
      (f) => (f.city.sources[1].debt = { ...f.city.sources[0].debt }),
      'debt must be set exactly for goBond and cop'
    ],
    [
      'debt null on city-debt',
      (f) => (f.city.sources[0].debt = null),
      'debt must be set exactly for goBond and cop'
    ],
    [
      'award year 2023',
      (f) => (f.awards.rows[0].year = 2023),
      "every award row's year must be in awards.years"
    ],
    [
      'years descending',
      (f) => (f.awards.years = [2025, 2024]),
      'awards.years must be non-empty, ascending and unique'
    ],
    [
      'years empty',
      (f) => (f.awards.years = []),
      'awards.years must be non-empty, ascending and unique'
    ],
    ['extra top-level key', (f) => (f.extra = 1), 'extra'],
    ['extra perHome key', (f) => (f.perHome.extra = 1), 'extra'],
    [
      'retrieved 2026-13-01',
      (f) => (f.perHome.cite.retrieved = '2026-13-01'),
      'must be a real calendar date'
    ],
    ['http url', (f) => (f.perHome.cite.url = 'http://example.com/x'), 'must be an https URL']
  ];
  it.each(mutations)('rejects %s', (_name, mutate, message) => {
    const f = load(LIVE);
    mutate(f);
    expect(() => parseFundingFile(f, 'funding.json')).toThrow(message);
  });

  it('cross-checks perHome against AFFORDABLE', () => {
    const msg = 'funding.json perHome disagrees with AFFORDABLE (src/lib/sim/finance)';
    const a = load(LIVE);
    a.perHome.total += 1;
    a.perHome.city += 1;
    expect(() => parseFundingFile(a, 'funding.json')).toThrow(msg);
    const b = load(LIVE);
    b.perHome.permanentLoans += 1;
    b.perHome.city -= 1;
    expect(() => parseFundingFile(b, 'funding.json')).toThrow(msg);
  });
});
