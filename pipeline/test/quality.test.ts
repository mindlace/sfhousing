// T14 data-quality registry (scenario-data spec §4.12, §6 "quality.test.ts (T14)").
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { openDuck } from '../lib/duck';
import {
  MIN_GROSS_M2_PER_UNIT,
  QUALITY_DOC_BEGIN,
  QUALITY_DOC_END,
  QUALITY_RULES,
  checkQuality,
  createQualityTables,
  defaultShares,
  kindDefaultDepartures,
  makeQuality,
  qualityDocSection,
  qualityRule,
  recordQuality,
  replaceQualityDocSection,
  validateRules,
  writeQualityReport,
  type QualityRule
} from '../lib/quality';

const PIPELINE_MD = 'docs/dev/pipeline.md';

/** A valid scenario-data rule; `over` crafts a bad one. */
const rule = (over: Partial<QualityRule> = {}): QualityRule => ({
  id: 'sd.test.bound',
  owner: 'scenario-data',
  source: 'test-source',
  field: 'test_field',
  kind: 'bound',
  action: 'replace',
  tier: 4,
  valueTier: 2,
  maskBit: 0,
  label: 'A test bound',
  denominator: 'test rows',
  warnShare: 0.01,
  failShare: 0.1,
  unitsWeighted: false,
  ...over
});
/** A unit-weighted observation rule, a plain one, and a project-records one. */
const WEIGHTED = rule({
  id: 'sd.test.weighted',
  kind: 'outlier',
  action: 'none',
  valueTier: null,
  maskBit: null,
  unitsWeighted: true
});
const PLAIN = rule();
const PR = rule({
  id: 'pr.test.shape',
  owner: 'project-records',
  kind: 'shape',
  action: 'drop',
  valueTier: null,
  maskBit: null
});
const q = () => makeQuality([WEIGHTED, PLAIN, PR]);
const key = (id: string, k: string) => ['quality', id, k].join('.');

describe('QualityRule registry', () => {
  it('exports MIN_GROSS_M2_PER_UNIT = 10', () => {
    expect(MIN_GROSS_M2_PER_UNIT).toBe(10);
  });
  it('the real QUALITY_RULES passes and is sorted by id', () => {
    expect(() => validateRules(QUALITY_RULES)).not.toThrow();
    const ids = QUALITY_RULES.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });
  it('accepts a valid rule array and maskBit 6', () => {
    expect(() =>
      validateRules([PLAIN, WEIGHTED, PR, rule({ id: 'sd.test.six', maskBit: 6 })])
    ).not.toThrow();
  });
  it.each<[string, QualityRule[], RegExp]>([
    ['a duplicate id', [PLAIN, rule()], /duplicate/],
    ['a bad id pattern', [rule({ id: 'sd.Test.bound' })], /pattern/],
    ['an id with one segment after the prefix', [rule({ id: 'sd.bound' })], /pattern/],
    ['an unknown prefix', [rule({ id: 'xx.test.bound' })], /pattern/],
    ['an owner/prefix mismatch', [rule({ id: 'pr.test.bound', maskBit: null })], /owner/],
    [
      'valueTier with action none',
      [rule({ action: 'none', valueTier: 2, maskBit: null })],
      /valueTier/
    ],
    ['valueTier null with action replace', [rule({ valueTier: null })], /valueTier/],
    [
      'valueTier null with action default',
      [rule({ action: 'default', valueTier: null })],
      /valueTier/
    ],
    ['maskBit 7', [rule({ maskBit: 7 })], /maskBit/],
    ['maskBit -1', [rule({ maskBit: -1 })], /maskBit/],
    ['maskBit on a pr rule', [{ ...PR, maskBit: 1 }], /maskBit/],
    ['warnShare = failShare', [rule({ warnShare: 0.1, failShare: 0.1 })], /warnShare/],
    ['warnShare 0.1 > failShare 0', [rule({ warnShare: 0.1, failShare: 0 })], /warnShare/],
    ['warnShare > failShare', [rule({ warnShare: 0.2, failShare: 0.1 })], /warnShare/]
  ])('throws on %s', (_, rules, re) => {
    expect(() => validateRules(rules)).toThrow(re);
    expect(() => makeQuality(rules)).toThrow(re);
  });
});

describe('kind defaults', () => {
  it('missing defaults to warn 0.05, every other kind to 0.01; fail 0.10 for all', () => {
    expect(defaultShares('missing')).toEqual({ warnShare: 0.05, failShare: 0.1 });
    for (const k of ['bound', 'outlier', 'shape', 'gap', 'observe'] as const) {
      expect(defaultShares(k)).toEqual({ warnShare: 0.01, failShare: 0.1 });
    }
  });
  it('lists the rules that depart from their kind default', () => {
    const missingOk = rule({
      id: 'sd.test.missing',
      kind: 'missing',
      action: 'default',
      warnShare: 0.05
    });
    const missingAt01 = rule({ id: 'sd.test.missing-low', kind: 'missing', action: 'default' });
    const boundAt05 = rule({ id: 'sd.test.bound-high', warnShare: 0.05 });
    const failAt20 = rule({ id: 'sd.test.fail-high', failShare: 0.2 });
    expect(kindDefaultDepartures([PLAIN, missingOk, missingAt01, boundAt05, failAt20])).toEqual([
      'sd.test.missing-low',
      'sd.test.bound-high',
      'sd.test.fail-high'
    ]);
  });
  it('every registered sd.* rule takes its kind default but the seven approved overrides', () => {
    // Partner DQ-4 share overrides, 2026-10-17 (design RA1 "Share overrides approved") and
    // 2026-10-18 (sd.zoning.named-no-cap), and the 2026-10-20 final review (sd.parcels.outside-tiles:
    // any firing fails a live build); each states its reason at its entry in
    // quality-rules/sd.ts.
    expect(kindDefaultDepartures(QUALITY_RULES.filter((r) => r.owner === 'scenario-data'))).toEqual(
      [
        'sd.parcels.clip-yield-loss',
        'sd.parcels.outside-tiles',
        'sd.roll.floor-area-missing',
        'sd.roll.units-capacity',
        'sd.yield.zero-hostable',
        'sd.zoning.generic-nc',
        'sd.zoning.named-no-cap'
      ]
    );
  });
});

describe('qualityRule', () => {
  it('returns the registered rule and throws on an unknown id', () => {
    expect(q().qualityRule('sd.test.bound')).toBe(PLAIN);
    expect(() => q().qualityRule('sd.test.unknown')).toThrow(/unregistered/);
    expect(() => qualityRule('sd.test.unknown')).toThrow(/unregistered/);
  });
});

describe('recordQuality', () => {
  it('writes four keys for a unit-weighted rule and two otherwise', () => {
    const r = q();
    const counts: Record<string, number> = { other: 1 };
    r.recordQuality(counts, 'sd.test.weighted', { fired: 2, of: 10, units: 30, unitsOf: 400 });
    r.recordQuality(counts, 'sd.test.bound', { fired: 0, of: 10 });
    expect(counts).toEqual({
      other: 1,
      [key('sd.test.weighted', 'fired')]: 2,
      [key('sd.test.weighted', 'of')]: 10,
      [key('sd.test.weighted', 'units')]: 30,
      [key('sd.test.weighted', 'unitsOf')]: 400,
      [key('sd.test.bound', 'fired')]: 0,
      [key('sd.test.bound', 'of')]: 10
    });
  });
  it.each<[string, string, Parameters<ReturnType<typeof q>['recordQuality']>[2], RegExp]>([
    ['an unregistered id', 'sd.test.unknown', { fired: 0, of: 1 }, /unregistered/],
    ['missing units on a weighted rule', 'sd.test.weighted', { fired: 0, of: 1 }, /units/],
    [
      'missing unitsOf on a weighted rule',
      'sd.test.weighted',
      { fired: 0, of: 1, units: 0 },
      /units/
    ],
    [
      'extra units on a plain rule',
      'sd.test.bound',
      { fired: 0, of: 1, units: 0, unitsOf: 0 },
      /units/
    ],
    ['a negative count', 'sd.test.bound', { fired: -1, of: 1 }, /non-negative integer/],
    ['a non-integer count', 'sd.test.bound', { fired: 0.5, of: 1 }, /non-negative integer/],
    [
      'a non-integer units',
      'sd.test.weighted',
      { fired: 0, of: 1, units: 1.5, unitsOf: 3 },
      /non-negative integer/
    ],
    ['NaN', 'sd.test.bound', { fired: NaN, of: 1 }, /non-negative integer/],
    // Runtime callers (recordSqlQuality, JS) can omit a required count despite the type.
    ['a missing fired', 'sd.test.bound', { of: 1 } as never, /fired must be/],
    ['a missing of', 'sd.test.bound', { fired: 0 } as never, /of must be/],
    ['an undefined fired', 'sd.test.bound', { fired: undefined, of: 1 } as never, /fired must be/],
    [
      'a null of on a weighted rule',
      'sd.test.weighted',
      { fired: 0, of: null, units: 0, unitsOf: 0 } as never,
      /of must be/
    ],
    ['fired > of', 'sd.test.bound', { fired: 2, of: 1 }, /fired 2 > of 1/],
    [
      'units > unitsOf',
      'sd.test.weighted',
      { fired: 1, of: 1, units: 5, unitsOf: 4 },
      /units 5 > unitsOf 4/
    ],
    [
      'a sample longer than fired',
      'sd.test.bound',
      { fired: 1, of: 5, sample: ['a', 'b'] },
      /sample/
    ]
  ])('throws on %s', (_, id, c, re) => {
    const counts: Record<string, number> = {};
    expect(() => q().recordQuality(counts, id, c)).toThrow(re);
    expect(counts).toEqual({});
  });
  it('throws on a second call for one id on the same counts', () => {
    const r = q();
    const counts: Record<string, number> = {};
    r.recordQuality(counts, 'sd.test.bound', { fired: 0, of: 1 });
    expect(() => r.recordQuality(counts, 'sd.test.bound', { fired: 0, of: 1 })).toThrow(/twice/);
    // A copy of a recorded counts object already carries the keys: recording again still throws.
    expect(() => r.recordQuality({ ...counts }, 'sd.test.bound', { fired: 0, of: 1 })).toThrow(
      /twice/
    );
  });
  it('the public recordQuality uses the real registry', () => {
    expect(() => recordQuality({}, 'sd.test.bound', { fired: 0, of: 1 })).toThrow(/unregistered/);
  });
  it('sorts a copy of sample in code-unit order and drops duplicates', () => {
    const r = q();
    const counts: Record<string, number> = {};
    const sample = ['b', 'a:2', 'B', 'a', 'b', 'a:10'];
    r.recordQuality(counts, 'sd.test.bound', { fired: 5, of: 9, sample });
    expect(sample).toEqual(['b', 'a:2', 'B', 'a', 'b', 'a:10']);
    expect(r.reportRows(counts).get('sd.test.bound')).toEqual({
      fired: 5,
      of: 9,
      sampleCount: 5,
      sample: ['B', 'a', 'a:10', 'a:2', 'b']
    });
  });
  it('keeps the first 25 sorted ids of the sample', () => {
    const r = q();
    const counts: Record<string, number> = {};
    const ids = Array.from({ length: 30 }, (_, i) => `p${String(29 - i).padStart(2, '0')}`);
    r.recordQuality(counts, 'sd.test.bound', { fired: 30, of: 30, sample: ids });
    const row = r.reportRows(counts).get('sd.test.bound')!;
    expect(row.sampleCount).toBe(30);
    expect(row.sample).toEqual([...ids].sort().slice(0, 25));
  });
  it('two counts objects keep separate report rows', () => {
    const r = q();
    const a: Record<string, number> = {};
    const b: Record<string, number> = {};
    r.recordQuality(a, 'sd.test.bound', { fired: 1, of: 2, sample: ['x'] });
    r.recordQuality(b, 'sd.test.bound', { fired: 0, of: 3 });
    r.recordQuality(b, 'pr.test.shape', { fired: 0, of: 3 });
    expect([...r.reportRows(a).keys()]).toEqual(['sd.test.bound']);
    expect(r.reportRows(a).get('sd.test.bound')).toMatchObject({ fired: 1, of: 2 });
    expect(r.reportRows(b).get('sd.test.bound')).toMatchObject({ fired: 0, of: 3 });
    expect(r.reportRows({}).size).toBe(0);
  });
});

/** Every pipeline source file (not tests, not build output), relative to the repo root. */
function pipelineSources(dir = 'pipeline'): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (['pipeline/test', 'pipeline/out', 'pipeline/.cache'].includes(p) || e === 'node_modules')
      continue;
    if (statSync(p).isDirectory()) out.push(...pipelineSources(p));
    else if (/\.(ts|js|mjs|sql)$/.test(e)) out.push(relative('.', p));
  }
  return out;
}

describe('quality.* writers', () => {
  it('no pipeline source other than pipeline/lib/quality.ts has a quality.* string literal', () => {
    const files = pipelineSources();
    expect(files).toContain('pipeline/lib/quality.ts');
    expect(files).toContain('pipeline/steps/build.ts');
    // A string literal (quote, double quote or backtick) that starts `quality.`, outside comments.
    const re = /['"`]quality\./;
    const code = (f: string) =>
      readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(f.endsWith('.sql') ? /--.*$/gm : /\/\/.*$/gm, '');
    expect(re.test(code('pipeline/lib/quality.ts'))).toBe(true);
    const hits = files.filter((f) => f !== 'pipeline/lib/quality.ts' && re.test(code(f)));
    expect(hits).toEqual([]);
  });
});

describe('checkQuality', () => {
  /** Counts with every rule of q() reported, then `over` applied (undefined deletes a key). */
  const reported = (over: Record<string, number | undefined> = {}) => {
    const counts: Record<string, number> = {
      [key('sd.test.weighted', 'fired')]: 0,
      [key('sd.test.weighted', 'of')]: 100,
      [key('sd.test.weighted', 'units')]: 0,
      [key('sd.test.weighted', 'unitsOf')]: 1000,
      [key('sd.test.bound', 'fired')]: 0,
      [key('sd.test.bound', 'of')]: 100,
      [key('pr.test.shape', 'fired')]: 0,
      [key('pr.test.shape', 'of')]: 0,
      other: 7
    };
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) delete counts[k];
      else counts[k] = v;
    }
    return counts;
  };
  it('passes when every rule reports within its shares', () => {
    expect(q().checkQuality(reported(), { shares: true })).toEqual({
      ok: true,
      failures: [],
      warnings: []
    });
  });
  it('the public checkQuality uses the real registry: every sd.* and pr.* rule must report', () => {
    const c = checkQuality({ other: 1 }, { shares: true });
    expect(c.ok).toBe(false);
    expect(c.failures).toEqual(
      QUALITY_RULES.map((x) => expect.stringMatching(`^${x.id}: not reported`))
    );
    expect(c.failures).toContain(
      'sd.roll.units-capacity: not reported (no .fired, .of, .units, .unitsOf)'
    );
    expect(c.failures.some((f) => f.startsWith('pr.'))).toBe(true);
  });
  it('fails on a missing count', () => {
    for (const k of ['fired', 'of', 'units', 'unitsOf']) {
      const r = q().checkQuality(reported({ [key('sd.test.weighted', k)]: undefined }), {
        shares: false
      });
      expect(r.ok, k).toBe(false);
      expect(r.failures.join('\n')).toMatch(/sd\.test\.weighted.*not reported/);
    }
  });
  it('fails on a quality.* key that names no registered rule', () => {
    const r = q().checkQuality(reported({ [key('sd.test.gone', 'fired')]: 1 }), { shares: false });
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([`${key('sd.test.gone', 'fired')}: names no registered rule`]);
  });
  it('fails on a units key of a rule that is not unit-weighted', () => {
    const r = q().checkQuality(reported({ [key('sd.test.bound', 'units')]: 1 }), { shares: false });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/not a report key of sd\.test\.bound/);
  });
  it('a share above failShare fails with shares: true and passes with shares: false', () => {
    const c = reported({ [key('sd.test.bound', 'fired')]: 11 });
    const on = q().checkQuality(c, { shares: true });
    expect(on.ok).toBe(false);
    expect(on.failures).toEqual(['sd.test.bound: share 11.00% > failShare 10.00%']);
    expect(q().checkQuality(c, { shares: false })).toEqual({
      ok: true,
      failures: [],
      warnings: []
    });
  });
  it('a share of exactly failShare does not fail', () => {
    const c = reported({ [key('sd.test.bound', 'fired')]: 10 });
    expect(q().checkQuality(c, { shares: true })).toMatchObject({ ok: true, failures: [] });
  });
  it('a share above warnShare warns', () => {
    const r = q().checkQuality(reported({ [key('sd.test.bound', 'fired')]: 2 }), { shares: true });
    expect(r).toEqual({
      ok: true,
      failures: [],
      warnings: ['sd.test.bound: share 2.00% > warnShare 1.00%']
    });
  });
  it('of = 0 gives share 0', () => {
    const r = q().checkQuality(
      reported({ [key('sd.test.bound', 'of')]: 0, [key('sd.test.bound', 'fired')]: 0 }),
      {
        shares: true
      }
    );
    expect(r).toEqual({ ok: true, failures: [], warnings: [] });
  });
  it('a unit-weighted rule fails on its units share alone', () => {
    const r = q().checkQuality(
      reported({
        [key('sd.test.weighted', 'fired')]: 1,
        [key('sd.test.weighted', 'units')]: 200
      }),
      { shares: true }
    );
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual(['sd.test.weighted: units share 20.00% > failShare 10.00%']);
  });
  it('fails on a count that is not a non-negative integer or exceeds its denominator', () => {
    expect(
      q().checkQuality(reported({ [key('sd.test.bound', 'fired')]: 101 }), { shares: false })
        .failures
    ).toEqual(['sd.test.bound: fired 101 > of 100']);
    expect(
      q().checkQuality(reported({ [key('sd.test.bound', 'of')]: 1.5 }), { shares: false }).ok
    ).toBe(false);
  });
});

describe('writeQualityReport', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sfh-quality-'));
  const recorded = () => {
    const r = q();
    const counts: Record<string, number> = {};
    const ids = Array.from(
      { length: 30 },
      (_, i) => `08720${String(30 - i).padStart(2, '0')}:2015`
    );
    r.recordQuality(counts, 'sd.test.weighted', {
      fired: 30,
      of: 1000,
      units: 50,
      unitsOf: 9000,
      sample: ids
    });
    r.recordQuality(counts, 'sd.test.bound', { fired: 0, of: 12 });
    return { r, counts, ids };
  };
  it('is byte-identical across two calls', () => {
    const { r, counts } = recorded();
    r.writeQualityReport(join(dir, 'a', 'quality-report.md'), 'fixture-0', counts);
    r.writeQualityReport(join(dir, 'b', 'quality-report.md'), 'fixture-0', counts);
    const a = readFileSync(join(dir, 'a', 'quality-report.md'));
    expect(a.equals(readFileSync(join(dir, 'b', 'quality-report.md')))).toBe(true);
    expect(a.toString()).toContain('fixture-0');
  });
  it('lists the first 25 of a 30-id sample in sorted order', () => {
    const { r, counts, ids } = recorded();
    const file = join(dir, 'c.md');
    r.writeQualityReport(file, 'v', counts);
    const md = readFileSync(file, 'utf8');
    const sorted = [...ids].sort();
    expect(md).toContain(sorted.slice(0, 25).join(', '));
    for (const id of sorted.slice(25)) expect(md).not.toContain(id);
    expect(md).toMatch(/30 affected ids; the first 25 in sort order/);
  });
  it('has one row per registered rule in id order, and lists an unseen rule as not reported', () => {
    const { r, counts } = recorded();
    const file = join(dir, 'd.md');
    r.writeQualityReport(file, 'v', counts);
    const rows = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => /^\| `/.test(l));
    expect(rows.map((l) => l.split('|')[1].trim())).toEqual([
      '`pr.test.shape`',
      '`sd.test.bound`',
      '`sd.test.weighted`'
    ]);
    expect(rows[0]).toMatch(/not reported/);
    expect(rows[1]).toMatch(/\| 0 \/ 12 \| — \| 0\.00% \|/);
    expect(rows[2]).toMatch(/\| 30 \/ 1000 \| 50 \/ 9000 \| 3\.00% rows, 0\.56% units \|/);
  });
  it('the public writeQualityReport lists every registered rule, unreported with no counts', () => {
    const file = join(dir, 'e', 'quality-report.md');
    writeQualityReport(file, 'fixture-0', {});
    const md = readFileSync(file, 'utf8');
    expect(md).not.toMatch(/No rules are registered/);
    for (const r of QUALITY_RULES) {
      expect(md, r.id).toContain(`| \`${r.id}\` |`);
      expect(md, r.id).toContain(`### ${r.id}\n\nNot reported.`);
    }
    expect(md).toMatch(/`sd\.roll\.units-capacity` \|.*\| not reported \|/);
    expect(md).toMatch(/`pr\.units\.capacity` \|.*\| not reported \|/);
  });
});

describe('recordSqlQuality', () => {
  it('turns quality_tally and quality_sample rows into the same counts and rows as direct calls', async () => {
    const r = q();
    const db = await openDuck();
    try {
      await createQualityTables(db);
      await db.run(`INSERT INTO quality_tally VALUES
        ('sd.test.weighted', 3, 40, 900, 5000),
        ('sd.test.bound', 2, 7, NULL, NULL),
        ('pr.test.shape', 1, 1, NULL, NULL)`);
      await db.run(`INSERT INTO quality_sample VALUES
        ('sd.test.weighted', 'b:2020'), ('sd.test.weighted', 'a:2021'), ('sd.test.weighted', 'a:2020'),
        ('sd.test.bound', 'z'), ('pr.test.shape', 'PRJ:1')`);
      const viaSql: Record<string, number> = {};
      await r.recordSqlQuality(db, 'scenario-data', viaSql);
      const direct: Record<string, number> = {};
      r.recordQuality(direct, 'sd.test.weighted', {
        fired: 3,
        of: 40,
        units: 900,
        unitsOf: 5000,
        sample: ['a:2020', 'a:2021', 'b:2020']
      });
      r.recordQuality(direct, 'sd.test.bound', { fired: 2, of: 7, sample: ['z'] });
      expect(viaSql).toEqual(direct);
      expect(r.reportRows(viaSql)).toEqual(r.reportRows(direct));
      expect([...r.reportRows(viaSql).keys()].sort()).toEqual([
        'sd.test.bound',
        'sd.test.weighted'
      ]);
      // The other owner's rows are recorded by its own call.
      await r.recordSqlQuality(db, 'project-records', viaSql);
      expect(viaSql[key('pr.test.shape', 'fired')]).toBe(1);
    } finally {
      db.close();
    }
  });
  it('throws on a tally row of an unregistered rule and on a sample without a tally row', async () => {
    const db = await openDuck();
    try {
      await createQualityTables(db);
      await db.run(`INSERT INTO quality_sample VALUES ('sd.test.bound', 'x')`);
      await expect(q().recordSqlQuality(db, 'scenario-data', {})).rejects.toThrow(/tally/);
      await db.run(`INSERT INTO quality_tally VALUES ('sd.test.gone', 0, 1, NULL, NULL)`);
      await expect(q().recordSqlQuality(db, 'scenario-data', {})).rejects.toThrow(/unregistered/);
    } finally {
      db.close();
    }
  });
});

describe('Data quality doc section', () => {
  it('the committed section of docs/dev/pipeline.md equals qualityDocSection()', () => {
    const doc = readFileSync(PIPELINE_MD, 'utf8');
    const begin = doc.indexOf(QUALITY_DOC_BEGIN);
    const end = doc.indexOf(QUALITY_DOC_END);
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(doc.slice(begin + QUALITY_DOC_BEGIN.length, end).trim()).toBe(
      qualityDocSection().trim()
    );
    expect(replaceQualityDocSection(doc)).toBe(doc);
  });
  it('lists every rule with its tiers, kind, action, mask bit and shares, in prettier form', async () => {
    const section = q().qualityDocSection();
    expect(section).toMatch(/^## Data quality\n/);
    expect(section).toMatch(
      /\| `sd\.test\.bound` +\| A test bound +\| 4 \/ 2 +\| bound +\| replace +\| 0 +\| 0\.01 \/ 0\.1 +\|/
    );
    expect(section).toMatch(
      /\| `pr\.test\.shape` +\| A test bound +\| 4 \/ — +\| shape +\| drop +\| — +\|/
    );
    expect(section).toMatch(/V30/);
    const wrapped = `${QUALITY_DOC_BEGIN}\n\n${section}\n\n${QUALITY_DOC_END}\n`;
    expect(await format(wrapped, { parser: 'markdown', printWidth: 100 })).toBe(wrapped);
    expect(await format(`${qualityDocSection()}\n`, { parser: 'markdown', printWidth: 100 })).toBe(
      `${qualityDocSection()}\n`
    );
  });
  it('replaceQualityDocSection rewrites only the text between the markers', () => {
    const doc = `# T\n\n${QUALITY_DOC_BEGIN}\n\nstale\n\n${QUALITY_DOC_END}\n\n## After\n`;
    expect(replaceQualityDocSection(doc)).toBe(
      `# T\n\n${QUALITY_DOC_BEGIN}\n\n${qualityDocSection()}\n\n${QUALITY_DOC_END}\n\n## After\n`
    );
    expect(() => replaceQualityDocSection('# no markers\n')).toThrow(/markers/);
  });
});
