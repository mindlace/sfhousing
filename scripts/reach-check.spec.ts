// The reach check (closing spec, "The check's own test"): current law and the full tree asked of
// the fixture dataset at several amounts, the lines and exit it gives, and the ways it is refused.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { RUNGS, ladder } from '../src/lib/game/ladder';
import { fullTree } from '../src/lib/game/catalogue/play';
import { defaultGoal } from '../src/lib/goal/goal';
import type { TimelineView } from '../src/lib/sim/world/score/types';
import type { Day } from '../src/lib/timelapse/time';
import { DEFAULT_POLICY4 } from '../src/lib/timeline/policy4';
import { openEngine, type Engine } from './reach-measure';
import { main, reachExit, reachLines, readReach, type CheckIo, type Reach } from './reach-check';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for one fill of the fixture's window; a hook argument, not a wait. */
const FILL_HOOK_MS = 600_000;
const USAGE =
  'reach-check: usage: npx tsx scripts/reach-check.ts <datasetDir> | --version <v> ' +
  '[--from <origin>] [--amount <homes>]';

const temps: string[] = [];

let engine: Engine;
let asOf: Day;
let current: TimelineView;
let full: TimelineView;

beforeAll(async () => {
  engine = await openEngine({ dir: FIXTURE });
  asOf = engine.asOf;
  current = await engine.view(DEFAULT_POLICY4);
  full = await engine.view(fullTree(engine.cal).doc);
}, FILL_HOOK_MS);

afterAll(() => {
  engine?.close();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const viewOf = (who: 'current' | 'full') => (who === 'current' ? current : full);

/** An io that records what is printed. */
function recorder(open?: CheckIo['open']): { io: CheckIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l), open }, out, err };
}

describe('readReach on the fixture', () => {
  it('amount 1: both questions are reached in the first month', () => {
    const r = [readReach(current, asOf, 'current', 1), readReach(full, asOf, 'full', 1)];
    for (const x of r) expect(x.reachedOn).toBe(current.months[0]);
    expect(reachExit(r)).toBe(0);
  });

  it("the goal's own amount: current law misses on the fixture", () => {
    const c = readReach(current, asOf, 'current');
    expect(c.amount).toBe(defaultGoal(asOf).amount);
    expect(c.reachedOn).toBeNull();
    expect(c.marginMonths).toBeNull();
    expect(reachLines('fixture-0', [c, readReach(full, asOf, 'full')])[2]).toMatch(
      /^Current law by [A-Z][a-z]{2} \d{4}: missed, [\d,]+ homes, [\d,]+ short$/
    );
    expect(reachExit([c])).toBe(1);
  });

  it.each(['current', 'full'] as const)(
    '%s: homesAtDeadline is reached, one more misses by 1',
    (who) => {
      const h = readReach(viewOf(who), asOf, who).homesAtDeadline;
      const other = who === 'current' ? 'full' : 'current';
      const lineOf = (r: Reach) =>
        reachLines(
          'fixture-0',
          who === 'current'
            ? [r, readReach(viewOf(other), asOf, other)]
            : [readReach(viewOf(other), asOf, other), r]
        )[who === 'current' ? 2 : 3];
      const at = readReach(viewOf(who), asOf, who, h);
      expect(at.reachedOn).not.toBeNull();
      expect(at.reachedOn! <= at.deadline).toBe(true);
      expect(reachExit([at])).toBe(0);
      const over = readReach(viewOf(who), asOf, who, h + 1);
      expect(over.reachedOn).toBeNull();
      expect(lineOf(over).endsWith(', 1 short')).toBe(true);
      expect(reachExit([over])).toBe(1);
    }
  );

  it('rungs: full reads rung RUNGS - 1, current rung 0', () => {
    expect(readReach(full, asOf, 'full').deadline).toBe(ladder(asOf)[RUNGS - 1].deadline);
    expect(readReach(current, asOf, 'current').deadline).toBe(ladder(asOf)[0].deadline);
  });
});

describe('reachLines', () => {
  it('four lines, the first two fixed', () => {
    const lines = reachLines('fixture-0', [
      readReach(current, asOf, 'current'),
      readReach(full, asOf, 'full')
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Dataset fixture-0');
    expect(lines[1]).toBe(`Goal: ${defaultGoal(asOf).amount.toLocaleString('en-US')} homes`);
    expect(lines[2].startsWith('Current law by ')).toBe(true);
    expect(lines[3].startsWith('Full tree by ')).toBe(true);
  });

  const synthetic = (over: Partial<Reach>): Reach => ({
    who: 'current',
    rung: 0,
    amount: 100,
    deadline: ladder(asOf)[0].deadline,
    reachedOn: null,
    homesAtDeadline: 0,
    marginMonths: null,
    ...over
  });

  it('one month early is singular', () => {
    const reachedOn = ladder(asOf)[0].deadline;
    const line = reachLines('x', [
      synthetic({ reachedOn, marginMonths: 1 }),
      synthetic({ who: 'full', reachedOn, marginMonths: 2 })
    ]);
    expect(line[2]).toBe(
      `Current law by ${formatShortMonthYear(reachedOn)}: reached ${formatShortMonthYear(reachedOn)}, 1 month early`
    );
    expect(line[3].endsWith(', 2 months early')).toBe(true);
  });

  it('numbers are grouped', () => {
    const missed = synthetic({ amount: 1_234_567, homesAtDeadline: 1_000 });
    expect(reachLines('x', [missed, { ...missed, who: 'full' }])[2]).toContain(
      'missed, 1,000 homes, 1,233,567 short'
    );
  });
});

describe('main refuses', () => {
  const emptyDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'reach-check-'));
    temps.push(dir);
    return dir;
  };

  it('no argument is the usage line', async () => {
    const { io, out, err } = recorder();
    expect(await main([], io)).toBe(2);
    expect(err).toEqual([USAGE]);
    expect(out).toEqual([]);
  });

  it.each([
    [[FIXTURE, '--version', 'x']],
    [['--bogus']],
    [[FIXTURE, FIXTURE]],
    [['--from', 'http://x']],
    [[FIXTURE, '--amount', '0']],
    [[FIXTURE, '--amount', '1.5']],
    [[FIXTURE, '--amount']]
  ])('%j is exit 2 with one line', async (argv) => {
    const { io, out, err } = recorder();
    expect(await main(argv, io)).toBe(2);
    expect(err).toHaveLength(1);
    expect(err[0].startsWith('reach-check: ')).toBe(true);
    expect(out).toEqual([]);
  });

  it('an empty directory has no dataset', async () => {
    const dir = emptyDir();
    const { io, out, err } = recorder();
    expect(await main([dir], io)).toBe(2);
    expect(err).toHaveLength(1);
    expect(err[0]).toBe(`reach-check: no dataset at ${dir}`);
    expect(out).toEqual([]);
  });

  it('a version that cannot be fetched has no dataset', async () => {
    const { io, out, err } = recorder();
    expect(await main(['--version', 'fixture-0', '--from', 'http://127.0.0.1:9'], io)).toBe(2);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^reach-check: no dataset fixture-0 at /);
    expect(out).toEqual([]);
  });
});

describe('main runs', () => {
  it('amount 1 prints four lines and exits 0', async () => {
    const { io, out, err } = recorder();
    expect(await main([FIXTURE, '--amount', '1'], io)).toBe(0);
    expect(out).toHaveLength(4);
    expect(out[0]).toBe('Dataset fixture-0');
    expect(err).toEqual([]);
  });
});

it('a view that rejects is exit 2 and the engine is closed', async () => {
  let closed = 0;
  const stub: Engine = {
    datasetVersion: engine.datasetVersion,
    asOf: engine.asOf,
    cal: engine.cal,
    view: () => Promise.reject(new Error('boom')),
    close: () => {
      closed += 1;
    }
  };
  const { io, out, err } = recorder(async () => stub);
  expect(await main([FIXTURE], io)).toBe(2);
  expect(err).toEqual(['reach-check: boom']);
  expect(out).toEqual([]);
  expect(closed).toBe(1);
});
