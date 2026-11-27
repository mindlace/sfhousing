// The record check (building-choice spec, Acceptance): the lines it gives a simulated statistic
// against a record target, its exit, the statistics of simulated starts, and one run on fixture-0.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RecordTargets, Target } from '../pipeline/lib/building-records';
import type { ProjectHistory } from '../src/lib/timelapse/types';
import { isoToDay } from '../pipeline/project-records/multiphase';
import {
  checkLines,
  emptySimStats,
  inLimitHeightRatio,
  main,
  recordExit,
  simStats,
  type CheckLine,
  type SimProject,
  type SimStats
} from './record-check';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for one 120-month run of the fixture; a test argument, not a wait. */
const RUN_MS = 300_000;

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const target = (stat: number, n: number, tol: number): Target => ({
  stat,
  n,
  se: tol / 2,
  tol,
  checked: n >= 30
});

/** Record targets with every check present: n 100 unless a test changes one. */
function targets(): RecordTargets {
  const bands = [4, 7, 12, 20, 999];
  return {
    schema: 1,
    asOf: 20_000,
    window: ['2016-01-01', '2026-01-01'],
    heightRatio: [4, 6, 8, 12, 999].map((upTo) => ({
      upTo,
      mean: target(0.72, 100, 0.1),
      nearLimit: target(0.5, 100, 0.1),
      overLimit: 0
    })),
    constructionType: {
      byBand: bands.map((upTo) => ({ upTo, n: 100, V: 50, III: 20, I: 30, other: 0 })),
      maxStories: { V: 6, III: 8 },
      recordsOver: { V: 0, III: 0 },
      typeIShare8to12: target(0.9, 142, 0.05)
    },
    stageMonths: {
      permitIssued: bands.map((upTo) => ({ upTo, ...target(6, 100, 2) })),
      construction: bands.map((upTo) => ({ upTo, ...target(25, 100, 3) }))
    },
    homesPerProject: bands.map((upTo) => ({ upTo, ...target(50, 100, 10) })),
    largeLotTypeI: target(0.6, 40, 0.15),
    cohort: {
      affordable: { mean: 1.2, n: 38, se: 0.1 },
      private: { mean: 1, n: 400, se: 0.03 },
      diff: 0.2,
      se: 0.1
    }
  };
}

/** Simulated statistics that meet every target of `targets()`. */
function meeting(): SimStats {
  const s = emptySimStats();
  for (const b of s.heightRatio) Object.assign(b, { n: 200, mean: 0.72, nearLimit: 0.5 });
  for (const b of s.typeByBand) Object.assign(b, { n: 100, V: 50, III: 20, I: 30 });
  s.typeI8to12 = { n: 100, k: 90 };
  for (const b of s.stageMonths.permitIssued) Object.assign(b, { n: 100, median: 6 });
  for (const b of s.stageMonths.construction) Object.assign(b, { n: 100, median: 25 });
  for (const b of s.stageMonths.issuedToComplete) Object.assign(b, { n: 100, median: 31 });
  for (const b of s.homesPerProject) Object.assign(b, { n: 100, median: 50 });
  s.largeLotTypeI = { n: 50, k: 30 };
  s.cohort = { affordable: { n: 10, mean: 1.1 }, private: { n: 300, mean: 0.9 } };
  return s;
}

const line = (lines: CheckLine[], check: string): CheckLine => {
  const l = lines.find((x) => x.check === check);
  if (l === undefined) throw new Error(`no line ${check}`);
  return l;
};

describe('checkLines', () => {
  it('passes every check the simulation meets, and gives one line per check', () => {
    const lines = checkLines(targets(), meeting());
    expect(lines.filter((l) => l.status === 'miss')).toEqual([]);
    expect(lines.filter((l) => l.status === 'pass').length).toBeGreaterThan(20);
    expect(new Set(lines.map((l) => l.check)).size).toBe(lines.length);
    expect(recordExit(lines)).toBe(0);
  });

  it('passes a sim mean of 0.80 against a target of 0.72 ± 0.10', () => {
    const sim = meeting();
    sim.heightRatio[1].mean = 0.8;
    const l = line(checkLines(targets(), sim), 'height ÷ limit ≤ 6: mean');
    expect(l).toMatchObject({
      status: 'pass',
      sim: 0.8,
      target: 0.72,
      tol: 0.1,
      n: 100,
      simN: 200
    });
  });

  it('misses a mean outside the tolerance', () => {
    const sim = meeting();
    sim.heightRatio[1].mean = 0.83;
    expect(line(checkLines(targets(), sim), 'height ÷ limit ≤ 6: mean').status).toBe('miss');
  });

  it('misses a Type V start above 6 stories whatever the n', () => {
    const sim = meeting();
    sim.over.V = 1;
    for (const b of sim.typeByBand) b.n = 1;
    const lines = checkLines(targets(), sim);
    expect(line(lines, 'Type V above 6 stories')).toMatchObject({ status: 'miss', sim: 1 });
    expect(line(lines, 'Type III above 8 stories').status).toBe('pass');
    expect(recordExit(lines)).toBe(1);
  });

  it('reports a bucket whose records number fewer than 30, whatever the simulation', () => {
    const t = targets();
    t.heightRatio[3].mean = target(1.1, 11, 0.1);
    t.heightRatio[3].nearLimit = target(0.36, 11, 0.29);
    const sim = meeting();
    sim.heightRatio[3].mean = 3;
    const lines = checkLines(t, sim);
    expect(line(lines, 'height ÷ limit ≤ 12: mean')).toMatchObject({ status: 'report', n: 11 });
    expect(recordExit(lines)).toBe(0);
  });

  it('misses a checked target the simulation has no project for', () => {
    const sim = meeting();
    sim.homesPerProject[2].n = 0;
    expect(line(checkLines(targets(), sim), 'homes per project ≤ 12 stories').status).toBe('miss');
  });

  it('reports the type shares by band, the summed stages and the cohort', () => {
    const lines = checkLines(targets(), meeting());
    expect(line(lines, 'Type I share ≤ 7 stories')).toMatchObject({
      status: 'report',
      sim: 0.3,
      target: 0.3
    });
    expect(line(lines, 'issued to completion ≤ 4 stories (months)')).toMatchObject({
      status: 'report',
      sim: 31,
      target: 28.4,
      n: null
    });
    expect(line(lines, 'height ÷ limit, affordable − private').status).toBe('report');
  });
});

/** A completed permit-only history first recorded in 2018 at `stories` on a limit of `base`. */
function hist(id: string, stories: number, base: number): ProjectHistory {
  const issued = isoToDay('2018-03-01');
  return {
    id,
    pathway: 'permitOnly',
    parcelIds: [],
    entered: {
      permitFiled: isoToDay('2017-06-01'),
      permitIssued: issued,
      construction: issued + 100,
      complete: issued + 800
    },
    end: { kind: 'complete', day: issued + 800 },
    unitsAt: { permitFiled: 20 },
    existingUnits: 0,
    storiesProposed: stories,
    baseStoriesAtFiling: base,
    sources: [],
    quality: [],
    planningProposed: null
  } as ProjectHistory;
}

describe('the height ÷ limit checks on records at or under their limit', () => {
  // Base 4: 30 at 4 stories, 10 at 3, and 20 over their limit at 6 (density bonus).
  const hs = [
    ...Array.from({ length: 30 }, (_, i) => hist(`A${i}`, 4, 4)),
    ...Array.from({ length: 10 }, (_, i) => hist(`B${i}`, 3, 4)),
    ...Array.from({ length: 20 }, (_, i) => hist(`C${i}`, 6, 4))
  ];
  const inLimit = inLimitHeightRatio(hs, isoToDay('2026-09-30'));

  it('leaves out every record built over its limit', () => {
    const b = inLimit.find((x) => x.upTo === 4)!;
    expect(b.mean.n).toBe(40);
    expect(b.mean.stat).toBeCloseTo((30 + 10 * 0.75) / 40, 9);
    expect(b.nearLimit.stat).toBe(0.75);
    expect(b.overLimit).toBe(0);
  });

  it('checks against the in-limit targets and reports the share over the limit per bucket', () => {
    const t = targets();
    // all records: mean 1.3 with 25 of 100 over their limit
    for (const b of t.heightRatio) Object.assign(b, { mean: target(1.3, 100, 0.1), overLimit: 25 });
    const within = targets().heightRatio; // mean 0.72, as meeting() simulates
    const lines = checkLines(t, meeting(), within);
    expect(line(lines, 'height ÷ limit ≤ 6: mean')).toMatchObject({
      status: 'pass',
      target: 0.72,
      n: 100
    });
    expect(line(lines, 'height ÷ limit ≤ 6: records over their limit')).toMatchObject({
      status: 'report',
      sim: null,
      target: 0.25,
      n: 100
    });
    // without the in-limit targets the all-record mean of 1.3 misses
    expect(line(checkLines(t, meeting()), 'height ÷ limit ≤ 6: mean').status).toBe('miss');
  });
});

describe('recordExit', () => {
  it('is 1 with any miss and 0 with passes and reports only', () => {
    const l = (status: CheckLine['status']): CheckLine => ({
      check: status,
      status,
      sim: 0,
      simN: 0,
      target: 0,
      tol: 0,
      n: 0
    });
    expect(recordExit([l('pass'), l('report')])).toBe(0);
    expect(recordExit([l('pass'), l('miss'), l('report')])).toBe(1);
  });
});

describe('simStats', () => {
  const from = 1000;
  const to = 2000;
  const p = (o: Partial<SimProject>): SimProject => ({
    start: 1100,
    stories: 5,
    limit: 5,
    type: 'V',
    units: 20,
    lotAreaM2: 500,
    affordable: false,
    issued: 1200,
    construction: 1200 + 6 * 30.436875,
    complete: 1200 + 30 * 30.436875,
    ...o
  });

  it('divides stories by the limit at the start, by limit bucket, uncapped', () => {
    const s = simStats([p({}), p({ stories: 3 }), p({ stories: 6, limit: 4 })], [from, to]);
    expect(s.heightRatio[0]).toMatchObject({ upTo: 4, n: 1, mean: 1.5, nearLimit: 1 });
    expect(s.heightRatio[1]).toMatchObject({ upTo: 6, n: 2, mean: 0.8, nearLimit: 0.5 });
  });

  it('leaves out starts outside the window and counts types of permits issued in it', () => {
    const s = simStats(
      [
        p({ start: 900, issued: 1100 }),
        p({ start: 2100, issued: null }),
        p({ type: 'I', stories: 10, limit: 12, issued: 2100 })
      ],
      [from, to]
    );
    expect(s.heightRatio.reduce((a, b) => a + b.n, 0)).toBe(1);
    expect(s.typeByBand[1]).toMatchObject({ upTo: 7, n: 1, V: 1, III: 0, I: 0 });
    expect(s.typeI8to12).toEqual({ n: 0, k: 0 });
  });

  it('counts Type V above 6 and Type III above 8 among starts', () => {
    const s = simStats(
      [p({ stories: 7, limit: 8 }), p({ type: 'III', stories: 8, limit: 8 })],
      [from, to]
    );
    expect(s.over).toEqual({ V: 1, III: 0 });
  });

  it('times each stage on its own interval and sums them, completed spells only', () => {
    const s = simStats([p({}), p({ complete: null }), p({ complete: 3500 })], [from, 3000]);
    const band = (xs: { upTo: number; n: number; median: number }[]) => xs[1];
    expect(band(s.stageMonths.permitIssued).n).toBe(3);
    expect(band(s.stageMonths.permitIssued).median).toBeCloseTo(6, 9);
    expect(band(s.stageMonths.construction).n).toBe(1);
    expect(band(s.stageMonths.construction).median).toBeCloseTo(24, 9);
    expect(band(s.stageMonths.issuedToComplete).median).toBeCloseTo(30, 9);
  });

  it('takes large lots with a limit of 13 or more, and homes of projects of 10 or more', () => {
    const s = simStats(
      [
        p({ type: 'I', stories: 20, limit: 20, lotAreaM2: 2000, units: 300 }),
        p({ type: 'I', stories: 10, limit: 20, lotAreaM2: 2000, units: 100 }),
        p({ lotAreaM2: 2000, units: 8 })
      ],
      [from, to]
    );
    expect(s.largeLotTypeI).toEqual({ n: 2, k: 1 });
    expect(s.homesPerProject[3]).toMatchObject({ upTo: 20, n: 1, median: 300 });
    expect(s.homesPerProject[1].n).toBe(0);
  });
});

describe('main', () => {
  it(
    'runs current law on a dataset and prints a line per check, with --json',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'record-check-'));
      temps.push(dir);
      const file = join(dir, 'record-targets.json');
      writeFileSync(file, JSON.stringify(targets()));
      const histories = join(dir, 'project-histories.json');
      writeFileSync(
        histories,
        JSON.stringify({ schema: 1, asOf: 20_000, histories: [hist('H1', 3, 4)] })
      );
      const out: string[] = [];
      const err: string[] = [];
      const code = await main([FIXTURE, '--targets', file, '--histories', histories, '--json'], {
        out: (l) => out.push(l),
        err: (l) => err.push(l)
      });
      expect(err).toEqual([]);
      expect([0, 1]).toContain(code);
      const json = JSON.parse(out.join('\n'));
      expect(json.datasetVersion).toBe('fixture-0');
      expect(json.months).toBe(120);
      expect(json.lines.length).toBeGreaterThan(20);
      // Not vacuous: the fixture city starts projects in its first ten years.
      expect(
        json.sim.heightRatio.reduce((a: number, b: { n: number }) => a + b.n, 0)
      ).toBeGreaterThan(0);
      expect(code).toBe(recordExit(json.lines));
      // the height ÷ limit targets come from the histories at or under their limit: one record
      expect(
        json.lines.find((l: CheckLine) => l.check === 'height ÷ limit ≤ 4: mean')
      ).toMatchObject({ status: 'report', target: 0.75, n: 1 });
    },
    RUN_MS
  );

  it('refuses without a dataset directory, or with targets it cannot read', async () => {
    const err: string[] = [];
    const io = { out: () => {}, err: (l: string) => err.push(l) };
    expect(await main([], io)).toBe(2);
    expect(await main([FIXTURE, '--targets', '/nonexistent/record-targets.json'], io)).toBe(2);
    expect(err[0]).toMatch(/^record-check: usage/);
    expect(err[1]).toMatch(/^record-check: no record targets at /);
    const t = join(mkdtempSync(join(tmpdir(), 'record-check-')), 'record-targets.json');
    temps.push(join(t, '..'));
    writeFileSync(t, JSON.stringify(targets()));
    expect(await main([FIXTURE, '--targets', t, '--histories', '/nonexistent/h.json'], io)).toBe(2);
    expect(err[2]).toMatch(/^record-check: no project histories at /);
  });
});
