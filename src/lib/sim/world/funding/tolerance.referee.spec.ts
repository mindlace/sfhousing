// The tolerance test against today's engine with public money (spec "Tests that must pass", first
// bullet; global constraint OD-2): over seeds 1 to 200, on the bench city (`synthCity`) under its
// baseline money and with the bench funding set, and on the live city with baseline funding, at
// years 5, 10, 20 and 40, the mean of completed net homes within 1% of today's, its standard
// deviation within 15%, and the mean awards and funded homes within 3%. For the bench funding set
// the awards are printed and held only to their recorded values (see `BENCH_AWARDS_R`). The world
// checks the ledger identities after every step. Each seed is one case running both engines to
// month 480; the last case of each city prints its table and asserts.
//
// About 4 minutes: runs only with SFH_WORLD_FUNDING_REFEREE=1, never in signoff (signoff runs
// referee-ledger.spec.ts). The live case also needs SFH_WORLD_LIVE (a dataset directory).
import { beforeAll, describe, expect, it } from 'vitest';
import { runEngineWith } from '$lib/sim/scenario/engine';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { monthLastDay } from '../months';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { liveDir } from '../test/cities.node';
import { readAll } from '../test/run';
import { oldInputOf } from '../test/timeline';
import { benchFunded, liveFunded } from './test/cities.node';
import {
  metricsAt,
  moneyTimeline,
  oldFinanceOf,
  runFunded,
  sameMonthOrdinary,
  type Metrics
} from './test/fixtures';
import { checkStep, type StepSums } from './test/identities';

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const YEARS = [5, 10, 20, 40] as const;
/** Both engines run to month 480 (40 years). */
const MONTHS = 480;

const TOL = { netMean: 0.01, netSd: 0.15, awards: 0.03, funded: 0.03 };

/**
 * synthCity, bench funding set: the awards ratio |new - old| / old recorded 2026-11-13 after the
 * award-day fix, years 5, 10, 20, 40. Not held to `TOL.awards`: the line is served once a month in
 * month-then-key order (rule 9, R5, kept by the partner's ruling 2026-11-13), so a capped fund
 * opened to many lots in one month is taken by that month's applications in key order rather than
 * by application day. A regression guard only: each year stays within `BENCH_AWARDS_SLACK`.
 */
const BENCH_AWARDS_R = [0.275, 0.182, 0.089, 0.035] as const;
const BENCH_AWARDS_SLACK = 0.03;

const REFEREE = process.env.SFH_WORLD_FUNDING_REFEREE === '1';
if (!REFEREE) {
  console.log('tolerance referee skipped: set SFH_WORLD_FUNDING_REFEREE=1 to run it (about 4 min)');
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
};
const ratio = (mine: number, old: number) => Math.abs(mine - old) / old;

/** One engine's metrics by year and seed. */
type Series = Record<keyof Metrics, number[][]>;
const series = (): Series => ({
  net: YEARS.map(() => []),
  awards: YEARS.map(() => []),
  fundedHomes: YEARS.map(() => [])
});

interface Case {
  input: SimInput;
  statics: Statics;
  timeline: PolicyTimeline;
  old: SimInput;
  horizon: Day;
  days: Day[];
  mine: Series;
  them: Series;
  t3: number;
  seeds: number;
  steps: number;
}

function caseOf(input: SimInput, doc: SimPolicy4): Case {
  const asOf = input.asOf;
  return {
    input,
    statics: staticsOf(input),
    timeline: moneyTimeline(input, doc),
    old: { ...oldInputOf(input), finance: oldFinanceOf(input, doc) },
    horizon: monthLastDay(asOf, MONTHS),
    days: YEARS.map((y) => monthLastDay(asOf, 12 * y)),
    mine: series(),
    them: series(),
    t3: 0,
    seeds: 0,
    steps: 0
  };
}

function record(to: Series, schedules: readonly Schedule[], c: Case, seed: number): void {
  c.days.forEach((day, i) => {
    const m = metricsAt(schedules, c.input.asOf, day);
    to.net[i][seed - 1] = m.net;
    to.awards[i][seed - 1] = m.awards;
    to.fundedHomes[i][seed - 1] = m.fundedHomes;
  });
}

/** Seed `seed` on both engines to month 480, the world's ledger identities after every step. */
function runSeed(c: Case, seed: number): void {
  let prev: StepSums | null = null;
  const { world } = runFunded(c.statics, c.timeline, seed, MONTHS, {
    afterStep(w, m, ledger) {
      prev = checkStep(ledger, w, c.timeline.frameAt(m).finance!, prev);
      c.steps++;
    }
  });
  const mine = readAll(world, c.statics, c.horizon).schedules;
  const old: Schedule[] = [];
  runEngineWith(c.old, seed, c.horizon, { schedule: (s) => old.push(s), master() {} }, {});
  record(c.mine, mine, c, seed);
  record(c.them, old, c, seed);
  c.t3 += sameMonthOrdinary(mine, old, c.input.asOf);
  c.seeds++;
}

/**
 * The printed table, then the tolerances. With `awardsRecorded`, the awards ratio is not held to
 * `TOL.awards` but to within `BENCH_AWARDS_SLACK` of the recorded ratio of each year.
 */
function judge(name: string, c: Case, awardsRecorded?: readonly number[]): void {
  expect(c.seeds).toBe(SEEDS.length);
  expect(c.steps).toBe(SEEDS.length * MONTHS);
  const fmt = (x: number, d = 1) => x.toFixed(d).padStart(11);
  const rows: string[] = [
    `${name}: ${SEEDS.length} seeds, T3 (funded here, ordinary there in the same month) ${c.t3}`,
    '  year |    net new |     net sd |    net old |     old sd | mean r | sd r  ' +
      '| awards new | awards old | aw r  | funded new | funded old | fu r'
  ];
  const checks: { what: string; got: number; tol: number }[] = [];
  YEARS.forEach((y, i) => {
    const nn = mean(c.mine.net[i]);
    const no = mean(c.them.net[i]);
    const sn = sd(c.mine.net[i]);
    const so = sd(c.them.net[i]);
    const an = mean(c.mine.awards[i]);
    const ao = mean(c.them.awards[i]);
    const fn = mean(c.mine.fundedHomes[i]);
    const fo = mean(c.them.fundedHomes[i]);
    const r = {
      net: ratio(nn, no),
      sd: ratio(sn, so),
      awards: ratio(an, ao),
      funded: ratio(fn, fo)
    };
    rows.push(
      `  ${String(y).padStart(4)} |${fmt(nn)} |${fmt(sn)} |${fmt(no)} |${fmt(so)} | ` +
        `${r.net.toFixed(4)} | ${r.sd.toFixed(3)} |${fmt(an, 2)} |${fmt(ao, 2)} | ` +
        `${r.awards.toFixed(3)} |${fmt(fn)} |${fmt(fo)} | ${r.funded.toFixed(3)}`
    );
    checks.push(
      { what: `year ${y} net mean`, got: r.net, tol: TOL.netMean },
      { what: `year ${y} net sd`, got: r.sd, tol: TOL.netSd },
      awardsRecorded
        ? {
            what: `year ${y} awards ratio off its recorded ${awardsRecorded[i]}`,
            got: Math.abs(r.awards - awardsRecorded[i]),
            tol: BENCH_AWARDS_SLACK
          }
        : { what: `year ${y} awards mean`, got: r.awards, tol: TOL.awards },
      { what: `year ${y} funded homes mean`, got: r.funded, tol: TOL.funded }
    );
  });
  if (awardsRecorded) {
    rows.push(
      `  awards r not held to ${TOL.awards} (month-then-key line order); recorded ` +
        `${awardsRecorded.join(' / ')}, each held within ${BENCH_AWARDS_SLACK}`
    );
  }
  console.log(rows.join('\n'));
  // Not vacuous: today's engine awards money in this case by year 40.
  expect(mean(c.them.awards[YEARS.length - 1])).toBeGreaterThan(0);
  for (const k of checks) expect(k.got, `${name} ${k.what}`).toBeLessThanOrEqual(k.tol);
}

const benchCases: ['baseline' | 'bench'][] = [['baseline'], ['bench']];

const live = process.env.SFH_WORLD_LIVE ? liveDir() : null;
if (REFEREE && live === null) {
  console.log('tolerance referee, live case skipped: set SFH_WORLD_LIVE to a dataset directory');
}

describe.skipIf(!REFEREE)('tolerance referee (SFH_WORLD_FUNDING_REFEREE=1)', () => {
  describe.each(benchCases)('synthCity, %s money, against today’s engine', (set) => {
    let c: Case;
    beforeAll(() => {
      const { input, doc } = benchFunded(set);
      c = caseOf(input, doc);
    });

    it.each(SEEDS)(`synthCity ${set} seed %i: both engines to month 480`, (seed) => {
      runSeed(c, seed);
      expect(c.seeds).toBe(seed);
    });

    const what =
      set === 'bench'
        ? 'net homes and funded homes within the tolerances, awards near their record'
        : 'within the tolerances';
    it(`synthCity ${set}: ${what} at years 5, 10, 20 and 40`, () => {
      judge(`synthCity ${set}`, c, set === 'bench' ? BENCH_AWARDS_R : undefined);
    });
  });

  describe.skipIf(live === null)('live, baseline funding, against today’s engine', () => {
    let c: Case;
    let name = '';
    beforeAll(async () => {
      const { input, doc } = await liveFunded(live!);
      name = live!.split('/').pop()!;
      c = caseOf(input, doc);
    });

    it.each(SEEDS)('live seed %i: both engines to month 480', (seed) => {
      runSeed(c, seed);
      expect(c.seeds).toBe(seed);
    });

    it('live: within the tolerances at years 5, 10, 20 and 40', () => {
      judge(name, c);
    });
  });
});
