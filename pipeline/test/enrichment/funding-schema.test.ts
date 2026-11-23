import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fiscalYearWindow,
  parseFundingFile,
  type Bound,
  type FundingFile
} from '../../enrichment/funding-schema';

const LIVE = resolve(__dirname, '../../enrichment/funding.json');
const FIXTURE = resolve(__dirname, '../fixtures/mini/enrichment/funding.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>;

const POOL_IDS = [
  'city-debt',
  'city-ocoh',
  'city-general-fund',
  'city-housing-stability-fund',
  'city-impact-fees',
  'city-housing-trust-fund',
  'city-redevelopment'
];

/** The Housing Trust Fund's end: the Charter's last fiscal year (spec, the data). */
const HTF_PIN = ['ends', '2043-06-30', 2];
/** The state bound: none found in a primary (spec, the data). */
const STATE_PIN = ['none', null, 2];

function pages(v: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) v.forEach((x) => pages(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('label' in o && 'url' in o && 'retrieved' in o) out.push(o.page);
    Object.values(o).forEach((x) => pages(x, out));
  }
  return out;
}

/** Every source's id and bound, City sources first, then state and federal. */
function boundsOf(f: FundingFile): [string, Bound][] {
  return [
    ...f.city.sources.map((s): [string, Bound] => [s.id, s.bound]),
    [f.state.id, f.state.bound],
    [f.federal.id, f.federal.bound]
  ];
}

/** [kind, on | dollars | null, tier]: the parts of a bound the bounds table pins. */
const pinOf = (b: Bound): [string, string | number | null, number] => [
  b.kind,
  b.kind === 'ends' ? b.on : b.kind === 'remaining' ? b.dollars : null,
  b.tier
];

describe('funding.json', () => {
  it('parses at schema 2 with the nine pinned ids, in order, and a page on every cite, bound cites included', () => {
    const f = parseFundingFile(load(LIVE), 'funding.json');
    expect(f.schema).toBe(2);
    expect(f.retiredIds).toEqual([]);
    expect(f.city.sources.map((s) => s.id)).toEqual(POOL_IDS);
    expect(f.state.id).toBe('state');
    expect(f.federal.id).toBe('federal-tax-credits');
    expect(boundsOf(f).map(([id]) => id)).toEqual([...POOL_IDS, 'state', 'federal-tax-credits']);
    const all = pages(f);
    expect(all.length).toBeGreaterThan(20);
    for (const p of all) expect(typeof p === 'string' && p.length > 0).toBe(true);
    for (const [, b] of boundsOf(f)) {
      expect(typeof b.cite.page === 'string' && b.cite.page.length > 0).toBe(true);
      expect(all).toContain(b.cite.page);
    }
    expect(f.federal.method).toContain("'includes the Low-Income Housing Tax Credit' (p. 6)");
  });

  it('gives each live source the bound of the bounds table', () => {
    const f = parseFundingFile(load(LIVE), 'funding.json');
    const pins = Object.fromEntries(boundsOf(f).map(([id, b]) => [id, pinOf(b)]));
    expect(pins['city-debt']).toEqual(['remaining', 260_310_000, 2]);
    expect(pins['city-ocoh']).toEqual(['none', null, 2]);
    expect(pins['city-general-fund']).toEqual(['none', null, 2]);
    expect(pins['city-housing-stability-fund']).toEqual(['remaining', 0, 1]);
    expect(pins['city-housing-trust-fund']).toEqual(HTF_PIN);
    expect(pins['city-redevelopment']).toEqual(['remaining', 0, 1]);
    expect(pins['state']).toEqual(STATE_PIN);
    expect(pins['federal-tax-credits']).toEqual(['none', null, 2]);
    const [kind, amount, tier] = pins['city-impact-fees'];
    expect(tier).toBe(2);
    if (kind === 'none') expect(amount).toBeNull();
    else {
      expect(kind).toBe('remaining');
      expect(Number.isInteger(amount)).toBe(true);
    }
    expect(f.city.sources.map((s) => s.dollarsPerYear)).toEqual([
      80_500_000, 48_600_000, 21_800_000, 14_900_000, 34_800_000, 27_400_000, 6_000_000
    ]);
    expect(f.state.dollarsPerYear).toBe(150_000_000);
    expect(f.state.tier).toBe(2);
    for (const s of f.city.sources) expect(s.note.endsWith('Held level (OD-F3).')).toBe(false);
  });

  it('sets the federal ceiling to 1,274 homes times 443,108', () => {
    const f = parseFundingFile(load(LIVE), 'funding.json');
    expect(f.federal.dollarsPerYear).toBe(1274 * 443_108);
    expect(f.federal.dollarsPerYear).toBe(564_519_592);
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

  it('fixture twin parses at schema 2 with the live ids and kinds, every kind of bound and Fixture: labels', () => {
    const live = parseFundingFile(load(LIVE), 'funding.json');
    const fx = parseFundingFile(load(FIXTURE), 'funding.json');
    expect(fx.schema).toBe(2);
    const fxBounds = boundsOf(fx).map(([, b]) => b);
    expect([...new Set(fxBounds.map((b) => b.kind))].sort()).toEqual(['ends', 'none', 'remaining']);
    for (const b of fxBounds) {
      expect(b.tier).toBe(2);
      expect(b.kind === 'none' ? b.reason : b.method).toMatch(/^Fixture: invented/);
    }
    expect(boundsOf(fx).map(([, b]) => pinOf(b).slice(0, 2))).toEqual([
      ['remaining', 3_500_000],
      ['none', null],
      ['none', null],
      ['remaining', 0],
      ['remaining', 2_000_000],
      ['ends', '2043-06-30'],
      ['remaining', 0],
      ['none', null],
      ['none', null]
    ]);
    expect([...fx.city.sources.map((s) => s.dollarsPerYear), fx.state.dollarsPerYear]).toEqual([
      1_500_000, 1_200_000, 600_000, 400_000, 1_000_000, 800_000, 500_000, 3_000_000
    ]);
    expect(fx.federal.dollarsPerYear).toBe(13_293_240);
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
    [
      'schema 1',
      (f) => (f.schema = 1),
      'funding.json: $.schema: funding.json is schema 1: every source needs a bound (schema 2)'
    ],
    [
      'a City source with no bound',
      (f) => delete f.city.sources[0].bound,
      '$.city.sources[0].bound'
    ],
    ['a state with no bound', (f) => delete f.state.bound, '$.state.bound'],
    ['a federal with no bound', (f) => delete f.federal.bound, '$.federal.bound'],
    [
      'bound tier 4',
      (f) => (f.city.sources[0].bound.tier = 4),
      "a bound's tier is 1, 2 or 3: an end nobody has read in a source is not written"
    ],
    ['bound kind later', (f) => (f.city.sources[0].bound.kind = 'later'), '.bound.kind'],
    [
      'an extra key in a bound',
      (f) => (f.city.sources[0].bound.extra = 1),
      '$.city.sources[0].bound: '
    ],
    [
      'ends.on 2043-02-30',
      (f) =>
        (f.city.sources[0].bound = {
          kind: 'ends',
          on: '2043-02-30',
          method: 'm',
          tier: 2,
          cite: f.city.sources[0].cite
        }),
      'must be a real calendar date'
    ],
    [
      'remaining.dollars -1',
      (f) => (f.city.sources[0].bound.dollars = -1),
      '$.city.sources[0].bound.dollars'
    ],
    [
      'money remaining with no yearly amount',
      (f) => {
        f.city.sources[1].dollarsPerYear += f.city.sources[0].dollarsPerYear;
        f.city.sources[0].dollarsPerYear = 0;
        f.city.sources[0].bound.dollars = 1;
      },
      '$.city.sources[0].bound: a source with money remaining needs a yearly amount'
    ],
    [
      'federal.dollarsPerYear + 1',
      (f) => (f.federal.dollarsPerYear += 1),
      'federal.dollarsPerYear must be the most new-construction homes awarded in one year times ' +
        'perHome.federal'
    ],
    ['a federal.uncapped key', (f) => (f.federal.uncapped = {}), '$.federal: '],
    ['state tier 4', (f) => (f.state.tier = 4), '$.state.tier'],
    ['federal tier 0', (f) => (f.federal.tier = 0), '$.federal.tier'],
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
