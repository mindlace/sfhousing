import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fiscalYearWindow, parseFundingFile } from '../../enrichment/funding-schema';

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

  it("carries the federal pool's three allocation records in federal.uncapped", () => {
    const f = parseFundingFile(load(LIVE), 'funding.json');
    expect(f.federal.uncapped.rounds).toBe(3);
    expect(f.federal.uncapped.window).toEqual(['2026-01-01', '2026-09-14']);
    expect(f.federal.uncapped.cites.map((c) => c.url)).toEqual([
      'https://www.treasurer.ca.gov/sites/default/files/2026-09/Allocation_by_Round_9-14-2026.pdf',
      'https://www.treasurer.ca.gov/sites/default/files/2026-03/2026-credit-estimates.pdf',
      'https://www.treasurer.ca.gov/sites/default/files/ctcac/2026_R1_Final_Recommendations.pdf'
    ]);
    expect(f.federal.uncapped.cites.map((c) => [c.label, c.page])).toEqual([
      [
        'California Debt Limit Allocation Committee, Exhibit A, "Pool and Set-Aside ' +
          'Recommendation of 2026 State Debt Ceiling", updated 2026-09-14',
        'Exhibit A, row Bay Area Region'
      ],
      [
        'California Tax Credit Allocation Committee, "CTCAC Allocation Process for Set Asides ' +
          'and Geographic Regions, Estimated for Calendar Year 2026", updated 2026-09-02',
        'p. 1, Step 3, row San Francisco County'
      ],
      [
        'California Tax Credit Allocation Committee, "CTCAC 2026 First Round 9% Final Approved ' +
          'Recommendations for the Geographic Regions", 2026-06-22',
        'p. 2, San Francisco County'
      ]
    ]);
    for (const c of f.federal.uncapped.cites) expect(c.retrieved).toBe('2026-11-10');
    expect(f.federal.method).not.toContain('is published for the City');
    expect(f.federal.method).toContain("'includes the Low-Income Housing Tax Credit' (p. 6)");
  });

  it('fixture twin carries an invented federal.uncapped', () => {
    const fx = parseFundingFile(load(FIXTURE), 'funding.json');
    expect(fx.federal.uncapped).toEqual({
      rounds: 1,
      window: ['2026-01-01', '2026-01-01'],
      cites: [
        {
          label: 'Fixture: invented allocation record (tier 4)',
          url: 'https://fixture.invalid/funding',
          page: 'fixture',
          retrieved: '2026-11-10'
        }
      ]
    });
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
    ['http url', (f) => (f.perHome.cite.url = 'http://example.com/x'), 'must be an https URL'],
    [
      'fiscalYear 2024-25',
      (f) => (f.city.fiscalYear = '2024-25'),
      'fiscalYear must be FYyyyy-yy, two consecutive years'
    ],
    [
      'fiscalYear FY2024-26',
      (f) => (f.city.fiscalYear = 'FY2024-26'),
      'fiscalYear must be FYyyyy-yy, two consecutive years'
    ],
    [
      'fiscalYear FY2099-01',
      (f) => (f.city.fiscalYear = 'FY2099-01'),
      'fiscalYear must be FYyyyy-yy, two consecutive years'
    ],
    ['no federal.uncapped', (f) => delete f.federal.uncapped, 'federal.uncapped'],
    [
      'federal.uncapped with no cites',
      (f) => (f.federal.uncapped.cites = []),
      'federal.uncapped needs at least one cite, a whole number of rounds and an ordered window'
    ],
    [
      'federal.uncapped with 0 rounds',
      (f) => (f.federal.uncapped.rounds = 0),
      'federal.uncapped needs at least one cite, a whole number of rounds and an ordered window'
    ],
    [
      'federal.uncapped with 1.5 rounds',
      (f) => (f.federal.uncapped.rounds = 1.5),
      'federal.uncapped needs at least one cite, a whole number of rounds and an ordered window'
    ],
    [
      'federal.uncapped with a backwards window',
      (f) => (f.federal.uncapped.window = ['2026-09-14', '2026-01-01']),
      'federal.uncapped needs at least one cite, a whole number of rounds and an ordered window'
    ],
    [
      'no city sources',
      (f) => {
        f.city.sources = [];
        f.city.total = 0;
      },
      'city.sources must list at least one source'
    ]
  ];

  it('reads FY1999-00 as consecutive years and windows a fiscal year July to June', () => {
    expect(fiscalYearWindow('FY2024-25')).toEqual(['2024-07-01', '2025-06-30']);
    expect(fiscalYearWindow('FY1999-00')).toEqual(['1999-07-01', '2000-06-30']);
    const f = load(LIVE);
    f.city.fiscalYear = 'FY1999-00';
    expect(parseFundingFile(f, 'funding.json').city.fiscalYear).toBe('FY1999-00');
  });
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
