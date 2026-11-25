// The level 2 check (reach-check spec, "The check's own test"): the empty document on the fixture
// dataset, read at several amounts, and the two ways the run is refused.
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseManifest } from '../src/lib/data/manifest';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { defaultGoal } from '../src/lib/goal/goal';
import { scenarioUrls } from '../src/lib/sim/scenario/load';
import { WINDOW_MONTHS } from '../src/lib/sim/timeline-client';
import type { Day } from '../src/lib/timelapse/time';
import {
  fillLine,
  level2Exit,
  level2Lines,
  parseArgs,
  readLevel2,
  runEmptyDocument,
  type EmptyRun
} from './level2-check';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for one fill of the fixture's window; a hook argument, not a wait. */
const FILL_HOOK_MS = 600_000;

/** Calendar year and month of a day count. */
const ym = (day: Day) => {
  const d = new Date(day * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
};

const temps: string[] = [];

let run: EmptyRun;
let carsOff: EmptyRun;

beforeAll(async () => {
  run = await runEmptyDocument(FIXTURE);
  carsOff = await runEmptyDocument(FIXTURE, { cars: 'off' });
}, FILL_HOOK_MS);

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('runEmptyDocument on the fixture', () => {
  it('run covers the window', () => {
    expect(run.datasetVersion).toBe('fixture-0');
    expect(run.view.filledThrough).toBe(run.view.lastIndex);
    expect(run.view.lastIndex + 1).toBe(WINDOW_MONTHS);
  });

  it('runs the car system by default and times the fill', () => {
    expect(run.view.cars).not.toBeNull();
    expect(run.fillMs).toBeGreaterThan(0);
  });

  it("cars: 'off' runs without the car system", () => {
    expect(carsOff.view.filledThrough).toBe(carsOff.view.lastIndex);
    expect(carsOff.view.cars).toBeNull();
    expect(fillLine({ ...carsOff, fillMs: 12_340 }, 'off')).toBe('Filled in 12.3 s (cars off)');
  });
});

describe('parseArgs', () => {
  it('--cars on or off, default on', () => {
    expect(parseArgs(['d'])).toEqual({ dir: 'd', cars: 'on' });
    expect(parseArgs(['d', '--cars', 'off'])).toEqual({ dir: 'd', cars: 'off' });
    expect(parseArgs(['--cars', 'on', 'd', '--amount', '5'])).toEqual({
      dir: 'd',
      amount: 5,
      cars: 'on'
    });
    expect(parseArgs(['d', '--cars', 'maybe'])).toEqual({
      error: '--cars must be on or off, got maybe'
    });
  });
});

describe('readLevel2', () => {
  it("the fixture misses the goal's own amount", () => {
    const r = readLevel2(run);
    expect(r.amount).toBe(defaultGoal(run.asOf).amount);
    expect(r.reachedOn).toBeNull();
    expect(r.marginMonths).toBeNull();
    expect(level2Exit(r)).toBe(1);
    const line = level2Lines(r)[2];
    expect(line.startsWith('Missed: ')).toBe(true);
    expect(line.endsWith(`, ${(r.amount - r.homesAtDeadline).toLocaleString('en-US')} short`)).toBe(
      true
    );
  });

  it('reached at homesAtDeadline', () => {
    const h = readLevel2(run).homesAtDeadline;
    const r = readLevel2(run, h);
    expect(r.reachedOn).not.toBeNull();
    expect(r.reachedOn! <= r.deadline).toBe(true);
    expect(level2Exit(r)).toBe(0);
    expect(level2Lines(r)[2].startsWith('Reached: ')).toBe(true);
  });

  it('missed by one', () => {
    const h = readLevel2(run).homesAtDeadline;
    const r = readLevel2(run, h + 1);
    expect(r.reachedOn).toBeNull();
    expect(level2Lines(r)[2].endsWith(', 1 short')).toBe(true);
    expect(level2Exit(r)).toBe(1);
  });

  it('amount 1 is reached in the first month', () => {
    const r = readLevel2(run, 1);
    expect(r.reachedOn).toBe(run.view.months[0]);
    const a = ym(run.view.months[0]);
    const b = ym(r.deadline);
    expect(r.marginMonths).toBe((b.y - a.y) * 12 + (b.m - a.m));
    expect(level2Exit(r)).toBe(0);
  });

  it('lines', () => {
    const r = readLevel2(run);
    const lines = level2Lines(r);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Dataset fixture-0');
    expect(lines[1]).toBe(
      `Goal: ${r.amount.toLocaleString('en-US')} homes by ${formatShortMonthYear(r.deadline)}`
    );
  });
});

describe('runEmptyDocument refusals', () => {
  it('no manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'level2-'));
    temps.push(dir);
    const err = await runEmptyDocument(dir).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('no dataset at');
    expect(message).toContain(dir);
  });

  it('missing calibration', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'level2-'));
    temps.push(copy);
    cpSync(FIXTURE, copy, { recursive: true });
    const manifest = parseManifest(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8')));
    const url = scenarioUrls(manifest)!.calibration;
    rmSync(join(copy, url.slice(`/data/${manifest.datasetVersion}/`.length)));
    const err = await runEmptyDocument(copy).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message.startsWith('host error: ')).toBe(true);
  });
});
