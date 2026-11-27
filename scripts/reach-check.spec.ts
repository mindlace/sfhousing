// The reach check: one rule (every policy on, at its fixed values, reaches the goal inside the
// window) and a printed report of each policy's and each round's effect. The runs use a stub engine
// whose numbers are synthetic; one run uses the fixture dataset at an amount of 1.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { dayFromUtc } from '../src/lib/fzp/time';
import { CATALOGUE, POLICY_KEYS, type PolicyKey } from '../src/lib/game/catalogue/rounds';
import { onKeys } from '../src/lib/game/offer';
import { defaultGoal } from '../src/lib/goal/goal';
import { baselineFixture } from '../src/lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '../src/lib/sim/world/fixtures/mini-calibration.json';
import { miniMarket } from '../src/lib/sim/world/fixtures/mini-market';
import type { TimelineView } from '../src/lib/sim/world/score/types';
import { parseCalibration } from '../src/lib/timelapse/model';
import type { Calibration } from '../src/lib/timelapse/types';
import type { Day } from '../src/lib/timelapse/time';
import { openEngine, type Engine } from './lib/engine-runner';
import {
  main,
  measure,
  parseAmount,
  parseCheckArgs,
  readReading,
  reachExit,
  reportLines,
  type CheckIo,
  type Reading,
  type Report
} from './reach-check';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for one fill of the fixture's window; a test timeout, not a wait. */
const FILL_HOOK_MS = 600_000;
const USAGE =
  'reach-check: usage: npx tsx scripts/reach-check.ts <datasetDir> | --version <v> ' +
  '[--from <origin>] [--amount <homes>] [--cars on|off]';

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const asOf: Day = cal.asOf;
const WINDOW = 480;
const goal = defaultGoal(asOf);
const AMOUNT = goal.amount;

/** Calendar month i of the window, as the first day of that month. */
const monthDay = (i: number): Day => {
  const first = new Date(Date.UTC(1970, 0, 1) + asOf * 86_400_000);
  const m = first.getUTCMonth() + i;
  return dayFromUtc(first.getUTCFullYear() + Math.floor(m / 12), (m % 12) + 1, 1);
};
const months: Day[] = Array.from({ length: WINDOW }, (_, i) => monthDay(i));
const mon = (i: number): string => formatShortMonthYear(months[i]);
const END = mon(WINDOW - 1);

/** Synthetic: the month index current law reaches the goal, and what each key takes off it. */
const LAW_AT = 120;
const SHIFT: Record<PolicyKey, number> = {
  'transit-rail': 5,
  'sb423-clock': 2,
  'housing-bond': 1,
  'transit-metro': 4,
  'benchmark-permits': 1,
  'general-revenue': 0,
  'transit-bus': 0,
  'revolving-fund': 0,
  'federal-support': 0,
  'no-discretionary': 2,
  'public-bank': 1,
  'state-double': 0
};

/** A view that reaches the amount in month `at` (never, for null) and ends on `end` homes. */
function stubView(at: number | null, end: number): TimelineView {
  const rows = months.map((_, i) => ({ completedNet: at !== null && i >= at ? end : 0 }));
  return {
    months,
    lastIndex: WINDOW - 1,
    filledThrough: WINDOW - 1,
    rows,
    baseline: { completedNet: 0 }
  } as unknown as TimelineView;
}

/** Homes at the window's end: 111 per policy on, and 333 fewer for general revenue after rail. */
function stubHomes(keys: Set<PolicyKey>, amount = AMOUNT): number {
  const penalty = keys.has('general-revenue') && keys.has('transit-rail') ? 333 : 0;
  return amount + 111 * keys.size - penalty;
}

function stubEngine(opts: { miss?: boolean; fillMs?: number } = {}): Engine & { closed: number } {
  const out = {
    datasetVersion: 'test-1',
    asOf,
    cal,
    fillMs: opts.fillMs ?? 1234,
    closed: 0,
    view: async (doc: Parameters<Engine['view']>[0]) => {
      const keys = onKeys(doc);
      let at: number | null = LAW_AT;
      for (const k of keys) at -= SHIFT[k];
      return stubView(opts.miss === true ? null : at, stubHomes(keys));
    },
    close: () => {
      out.closed += 1;
    }
  };
  return out;
}

/** An io that records what is printed. */
function recorder(open?: CheckIo['open']): { io: CheckIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l), open }, out, err };
}

const label = (k: PolicyKey): string => CATALOGUE.find((e) => e.key === k)!.label;
const n = (x: number): string => x.toLocaleString('en-US');

describe('main on a stub engine', () => {
  it('prints the report exactly and exits 0', async () => {
    const stub = stubEngine();
    const { io, out, err } = recorder(async () => stub);
    expect(await main(['x'], io)).toBe(0);
    const lawAt = LAW_AT;
    const allAt = LAW_AT - 16;
    const aloneLine = (k: PolicyKey): string => {
      const s = SHIFT[k];
      const change = s === 0 ? 'no change' : `${s} month${s === 1 ? '' : 's'} earlier`;
      return `  ${label(k)}: ${mon(lawAt - s)}, ${change}, +111 homes by ${END}`;
    };
    // Rounds before a key, plus the key; round 1 keys read against current law.
    const roundOf = (k: PolicyKey) => CATALOGUE.find((e) => e.key === k)!.round;
    const before = (k: PolicyKey) =>
      CATALOGUE.filter((e) => e.round < roundOf(k)).map((e) => e.key);
    const inRoundLine = (k: PolicyKey): string => {
      const b = before(k);
      const baseAt = lawAt - b.reduce((a, x) => a + SHIFT[x], 0);
      const s = SHIFT[k];
      const change = s === 0 ? 'no change' : `${s} month${s === 1 ? '' : 's'} earlier`;
      const baseHomes = stubHomes(new Set(b));
      const homes = stubHomes(new Set([...b, k]));
      const d = homes - baseHomes;
      return `  ${label(k)}: ${mon(baseAt - s)}, ${change}, ${d < 0 ? '-' : '+'}${n(Math.abs(d))} homes by ${END}`;
    };
    const roundTotals = [8, 5, 0, 3];
    let above = lawAt;
    const roundLines = roundTotals.map((t, i) => {
      const keys = new Set(CATALOGUE.filter((e) => e.round <= i + 1).map((e) => e.key));
      const at = above - t;
      const change = t === 0 ? 'no change' : `${t} months earlier`;
      const line = `  ${i + 1}: ${mon(at)}, ${change}, ${n(stubHomes(keys))} homes by ${END}`;
      above = at;
      return line;
    });
    expect(out).toEqual([
      'Dataset test-1',
      `Goal: ${n(AMOUNT)} homes`,
      `Every policy: reached ${mon(allAt)}`,
      `Current law: reached ${mon(lawAt)}`,
      'Alone, against current law:',
      ...POLICY_KEYS.map(aloneLine),
      'In its round, against the rounds before:',
      ...POLICY_KEYS.map(inRoundLine),
      'Rounds, all on:',
      ...roundLines,
      'To judge:',
      '  Round 3 gains nothing',
      `  ${label('general-revenue')} in its round: 222 fewer homes`,
      'Filled in 1.2 s (cars on)'
    ]);
    expect(err).toEqual([]);
    expect(stub.closed).toBe(1);
  });

  it('says to judge nothing when nothing needs judging', async () => {
    const stub = stubEngine();
    // Every policy brings one month and 1 home, so no round and no policy is flagged.
    stub.view = async (doc) => {
      const keys = onKeys(doc);
      return stubView(LAW_AT - keys.size, AMOUNT + keys.size);
    };
    const { io, out } = recorder(async () => stub);
    expect(await main(['x'], io)).toBe(0);
    expect(out.slice(out.indexOf('To judge: nothing'))).toEqual([
      'To judge: nothing',
      'Filled in 1.2 s (cars on)'
    ]);
  });

  it('exits 1 when every policy on misses, and still prints the report', async () => {
    const stub = stubEngine({ miss: true });
    const { io, out, err } = recorder(async () => stub);
    expect(await main(['x'], io)).toBe(1);
    expect(out[2]).toBe(`Every policy: not by ${END}`);
    expect(out[3]).toBe(`Current law: not by ${END}`);
    expect(out[5]).toBe(`  ${label('transit-rail')}: not by ${END}, n/a, +0 homes by ${END}`);
    expect(out.at(-1)).toBe('Filled in 1.2 s (cars on)');
    expect(err).toEqual([]);
    expect(stub.closed).toBe(1);
  });

  it('passes the cars switch to open and names it in the fill line', async () => {
    const seen: (string | undefined)[] = [];
    const { io, out } = recorder(async (_src, opts) => {
      seen.push(opts?.cars);
      return stubEngine();
    });
    expect(await main(['x', '--cars', 'off'], io)).toBe(0);
    expect(seen).toEqual(['off']);
    expect(out.at(-1)).toBe('Filled in 1.2 s (cars off)');
  });

  it('a view that rejects is exit 2 and the engine is closed', async () => {
    const stub = { ...stubEngine(), view: () => Promise.reject(new Error('boom')) };
    let closed = 0;
    stub.close = () => {
      closed += 1;
    };
    const { io, out, err } = recorder(async () => stub);
    expect(await main(['x'], io)).toBe(2);
    expect(err).toEqual(['reach-check: boom']);
    expect(out).toEqual([]);
    expect(closed).toBe(1);
  });
});

describe('measure', () => {
  it('asks for 30 views at most, one per distinct list of keys', async () => {
    const seen: string[] = [];
    const stub = stubEngine();
    const view = stub.view;
    stub.view = async (doc) => {
      seen.push([...onKeys(doc)].sort().join(','));
      return view(doc);
    };
    const rep = await measure(stub);
    expect(rep.alone).toHaveLength(12);
    expect(rep.inRound).toHaveLength(12);
    expect(rep.rounds.map((r) => r.round)).toEqual([1, 2, 3, 4]);
    expect(rep.all).toEqual(rep.rounds[3].r);
    expect(seen.length).toBeLessThanOrEqual(30);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('reads an amount through to every reading', async () => {
    const rep = await measure(stubEngine(), 5);
    expect(rep.law.reachedOn).toBe(months[LAW_AT]);
    expect(rep.law.homesAtEnd).toBe(AMOUNT);
    expect((await measure(stubEngine(), AMOUNT + 1)).law.reachedOn).toBeNull();
  });
});

describe('readReading', () => {
  it('reads the first month the amount is met and the homes at the window end', () => {
    const r = readReading(stubView(7, 90_000), asOf);
    expect(r).toEqual({ reachedOn: months[7], homesAtEnd: 90_000 });
  });

  it('is null for a miss', () => {
    expect(readReading(stubView(null, 0), asOf).reachedOn).toBeNull();
  });

  it('takes an amount other than the goal', () => {
    expect(readReading(stubView(7, 90_000), asOf, 90_001).reachedOn).toBeNull();
    expect(readReading(stubView(7, 90_000), asOf, 90_000).reachedOn).toBe(months[7]);
  });
});

describe('reportLines', () => {
  const at = (i: number, homes: number): Reading => ({ reachedOn: months[i], homesAtEnd: homes });
  const miss = (homes: number): Reading => ({ reachedOn: null, homesAtEnd: homes });
  const rep = (over: Partial<Report>): Report => ({
    all: at(10, 1_000),
    law: at(10, 1_000),
    alone: [],
    inRound: [],
    rounds: [],
    ...over
  });
  const lines = (r: Report) => reportLines('v', 500, months[WINDOW - 1], r);

  it('words a policy later, the same, earlier and missed', () => {
    const out = lines(
      rep({
        alone: [
          { key: 'transit-rail', r: at(11, 1_000) },
          { key: 'sb423-clock', r: at(10, 1_000) },
          { key: 'housing-bond', r: at(9, 1_000) },
          { key: 'transit-metro', r: miss(900) }
        ]
      })
    );
    expect(out.slice(5, 9)).toEqual([
      `  Taller near BART and Caltrain: ${mon(11)}, 1 month later, +0 homes by ${END}`,
      `  SB 423 clock: ${mon(10)}, no change, +0 homes by ${END}`,
      `  Housing bond: ${mon(9)}, 1 month earlier, +0 homes by ${END}`,
      `  Taller near Muni Metro: not by ${END}, n/a, -100 homes by ${END}`
    ]);
    expect(out.slice(out.indexOf('To judge:'))).toEqual([
      'To judge:',
      '  Taller near Muni Metro alone: 100 fewer homes'
    ]);
  });

  it('flags a round that is missed, or not earlier than the row above', () => {
    const out = lines(
      rep({
        rounds: [
          { round: 1, r: at(8, 1_000) },
          { round: 2, r: at(8, 1_000) },
          { round: 3, r: at(9, 1_000) },
          { round: 4, r: miss(1_000) }
        ]
      })
    );
    expect(out.slice(out.indexOf('To judge:'))).toEqual([
      'To judge:',
      '  Round 2 gains nothing',
      '  Round 3 gains nothing',
      '  Round 4 gains nothing'
    ]);
  });
});

describe('reachExit', () => {
  const r = (reachedOn: Day | null): Reading => ({ reachedOn, homesAtEnd: 0 });
  const rep = (all: Reading): Report => ({
    all,
    law: r(null),
    alone: [],
    inRound: [],
    rounds: []
  });

  it('is 0 when every policy on reaches, whatever else misses', () => {
    expect(reachExit(rep(r(months[3])))).toBe(0);
  });

  it('is 1 when every policy on misses', () => {
    expect(reachExit(rep(r(null)))).toBe(1);
  });
});

describe('parseAmount', () => {
  it('is undefined when not given, a positive whole number or an error', () => {
    expect(parseAmount(undefined)).toBeUndefined();
    expect(parseAmount('5')).toBe(5);
    expect(parseAmount('0')).toEqual({ error: '--amount must be a positive integer, got 0' });
    expect(parseAmount('1.5')).toEqual({ error: '--amount must be a positive integer, got 1.5' });
    expect(parseAmount(true)).toEqual({
      error: '--amount must be a positive integer, got nothing'
    });
  });
});

describe('parseCheckArgs --cars', () => {
  it('defaults to on', () => {
    expect(parseCheckArgs([FIXTURE])).toEqual({ src: { dir: FIXTURE }, cars: 'on' });
  });

  it.each(['on', 'off'] as const)('accepts %s', (cars) => {
    expect(parseCheckArgs([FIXTURE, '--cars', cars, '--amount', '5'])).toEqual({
      src: { dir: FIXTURE },
      amount: 5,
      cars
    });
  });

  it('refuses another value', () => {
    expect(parseCheckArgs([FIXTURE, '--cars', 'maybe'])).toEqual({
      error: '--cars must be on or off, got maybe'
    });
  });
});

describe('main refuses', () => {
  it.each([
    [[FIXTURE, '--cars', 'maybe'], 'maybe'],
    [[FIXTURE, '--cars'], 'nothing']
  ])('%j is exit 2 with the cars line', async (argv, got) => {
    const { io, out, err } = recorder();
    expect(await main(argv, io)).toBe(2);
    expect(err).toEqual([`reach-check: --cars must be on or off, got ${got}`]);
    expect(out).toEqual([]);
  });

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
    expect(err).toEqual([`reach-check: no dataset at ${dir}`]);
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

describe('main on the fixture', () => {
  it(
    'amount 1 is reached by every policy on and exits 0',
    async () => {
      const { io, out, err } = recorder();
      expect(await main([FIXTURE, '--amount', '1'], io)).toBe(0);
      expect(out[0]).toBe('Dataset fixture-0');
      expect(out[1]).toBe('Goal: 1 homes');
      expect(out[2]).toMatch(/^Every policy: reached [A-Z][a-z]{2} \d{4}$/);
      expect(out.at(-1)).toMatch(/^Filled in \d+\.\d s \(cars on\)$/);
      expect(err).toEqual([]);
    },
    FILL_HOOK_MS
  );

  it(
    'opens an engine the check can close',
    async () => {
      const engine = await openEngine({ dir: FIXTURE });
      expect(engine.fillMs).toBeGreaterThan(0);
      engine.close();
    },
    FILL_HOOK_MS
  );
});
