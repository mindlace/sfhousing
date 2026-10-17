import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HeightParseError,
  normaliseHeight,
  parseHeightDistrict,
  storiesFromFt
} from '../lib/heights';

type Expected =
  { kind: 'none' } | { kind: 'height'; baseFt: number; lpFt: number | null; r4: boolean };
type Row = { height: string; gen_hght: string; expected: Expected };

// Live snapshot of DataSF h9wh-cg3m (269 distinct strings, 2026-10-16). The `expected` fields were
// written by hand against spec §4.2, not copied from the parser's output.
const rows: Row[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/height-strings-2026-10-16.json', import.meta.url)),
    'utf8'
  )
);

const SENTINELS = [
  'OS',
  'CP',
  'HP',
  'HP-RA',
  'MB-RA',
  'Special Height District',
  'None Stated',
  'USCG/Caltrans',
  'Job Corps'
];

const parse = (s: string) => {
  const d = parseHeightDistrict(s);
  if (d.kind !== 'height') throw new Error(`expected a height district for ${s}`);
  return d;
};

describe('parseHeightDistrict against the live snapshot', () => {
  it('snapshot has 269 distinct strings', () => {
    expect(rows).toHaveLength(269);
    expect(new Set(rows.map((r) => r.height)).size).toBe(269);
  });

  it('parses every live string', () => {
    for (const r of rows) {
      const got = parseHeightDistrict(r.height);
      if (r.expected.kind === 'none') {
        expect(got, r.height).toEqual({ kind: 'none' });
      } else {
        expect(got.kind, r.height).toBe('height');
        if (got.kind !== 'height') continue;
        expect({ baseFt: got.baseFt, lpFt: got.lpFt, r4: got.r4 }, r.height).toEqual({
          baseFt: r.expected.baseFt,
          lpFt: r.expected.lpFt,
          r4: r.expected.r4
        });
        expect(got.normalised, r.height).toBe(normaliseHeight(r.height));
      }
    }
  });

  it('max height equals gen_hght for every non-sentinel', () => {
    let checked = 0;
    for (const r of rows) {
      const d = parseHeightDistrict(r.height);
      if (d.kind === 'none') continue;
      expect(Math.max(d.lpFt ?? -Infinity, d.baseFt), r.height).toBe(Number(r.gen_hght));
      checked++;
    }
    expect(checked).toBe(260);
  });

  it('sentinels are none', () => {
    const none = rows.filter((r) => parseHeightDistrict(r.height).kind === 'none');
    expect(none.map((r) => r.height).sort()).toEqual([...SENTINELS].sort());
    for (const s of SENTINELS) expect(parseHeightDistrict(s)).toEqual({ kind: 'none' });
  });

  it('the four non-R-4 // strings are not r4', () => {
    const dbl = [
      '120/400-R-2  //  140/590-R-2',
      '120/400-R-2 / 120-R-2  //  140/590-R-2',
      '120/400-R-2  //  140/520-R-2',
      '85-X // 120/400-R-2'
    ];
    for (const s of dbl) {
      expect(parse(s).r4, s).toBe(false);
      expect(parse(s).lpFt, s).not.toBeNull();
    }
    // every other live `//` string is Local Program
    const others = rows.filter((r) => r.height.includes('//') && !dbl.includes(r.height));
    expect(others).toHaveLength(47);
    for (const r of others) expect(parse(r.height).r4, r.height).toBe(true);
  });
});

describe('parseHeightDistrict worked examples (spec §4.2)', () => {
  it('40//65-R-4 is base 40, Local Program 65, R-4', () => {
    expect(parse('40//65-R-4')).toMatchObject({ baseFt: 40, lpFt: 65, r4: true });
  });

  it('140/400//140/450-R-4 takes the podium/tower maxima', () => {
    expect(parse('140/400//140/450-R-4')).toMatchObject({ baseFt: 400, lpFt: 450, r4: true });
  });

  it('55/65-X is 65 with no Local Program side', () => {
    expect(parse('55/65-X')).toMatchObject({ baseFt: 65, lpFt: null, r4: false });
  });

  it('80-T-130-T is 130', () => {
    expect(parse('80-T-130-T')).toMatchObject({ baseFt: 130, lpFt: null });
  });

  it('65-TI/240 Flex Zone-TI is 240', () => {
    expect(parse('65-TI/240 Flex Zone-TI')).toMatchObject({ baseFt: 240, lpFt: null });
  });

  it('bulk suffix digits are never heights', () => {
    expect(parse('85-R-2')).toMatchObject({ baseFt: 85, lpFt: null, r4: false });
    expect(parse('35-2Y YBI')).toMatchObject({ baseFt: 35 });
  });

  it('an R-4 string without // has lpFt = baseFt', () => {
    expect(parse('85-R-4')).toMatchObject({ baseFt: 85, lpFt: 85, r4: true });
  });

  it('120/400//120/650-R4 normalises to -R-4 and is r4', () => {
    const d = parse('120/400//120/650-R4');
    expect(d.normalised).toBe('120/400//120/650-R-4');
    expect(d).toMatchObject({ baseFt: 400, lpFt: 650, r4: true });
  });
});

describe('normaliseHeight', () => {
  it('trims, collapses whitespace, and rewrites a trailing R4 or -R4', () => {
    expect(normaliseHeight('  85-X   //  120/400-R-2 ')).toBe('85-X // 120/400-R-2');
    expect(normaliseHeight('65//85-R4')).toBe('65//85-R-4');
    expect(normaliseHeight('65//85R4')).toBe('65//85-R-4');
    expect(normaliseHeight('65//85-R-4')).toBe('65//85-R-4');
  });

  it('keeps the normalised string for sentinels (used for none districts)', () => {
    expect(normaliseHeight('  Special   Height District ')).toBe('Special Height District');
  });
});

describe('parseHeightDistrict failures', () => {
  it('two // throws HeightParseError', () => {
    expect(() => parseHeightDistrict('40//65//85-R-4')).toThrow(HeightParseError);
  });

  it('a // string with an empty side throws HeightParseError', () => {
    expect(() => parseHeightDistrict('//65-R-4')).toThrow(HeightParseError);
    expect(() => parseHeightDistrict('40//-R-4')).toThrow(HeightParseError);
  });

  it('arbitrary strings never throw anything but HeightParseError', () => {
    const alphabet = fc.constantFrom(...'0123456789-/ RXT4abE'.split(''));
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.array(alphabet, { maxLength: 24 }).map((a) => a.join(''))
        ),
        (s) => {
          try {
            const d = parseHeightDistrict(s);
            expect(['none', 'height']).toContain(d.kind);
          } catch (e) {
            expect(e).toBeInstanceOf(HeightParseError);
          }
        }
      ),
      { numRuns: 2000 }
    );
  });
});

describe('storiesFromFt', () => {
  it('is floor(ft / 10), clamped at 80', () => {
    expect(storiesFromFt(40)).toBe(4);
    expect(storiesFromFt(65)).toBe(6);
    expect(storiesFromFt(9)).toBe(0);
    expect(storiesFromFt(800)).toBe(80);
    expect(storiesFromFt(900)).toBe(80);
  });
});
