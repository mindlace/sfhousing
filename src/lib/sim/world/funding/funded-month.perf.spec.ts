// The funded month's cost bar (spec "`test:perf`"): one funded month for one world on the bench
// city (`synthCity`, bench baseline money), 90 µs. Perf project only (`npm run test:perf`), on an
// idle machine under the measurement lock. The bar is the mean over worlds and months (the 9 ms
// constraint is a sum over 96 worlds in one month); p50, p90 and max are printed beside it, with
// each hook's share and the whole-city replan month, unasserted.
import { describe, expect, it } from 'vitest';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import type { Due, FundingSystem, StepSink, World } from '../types';
import { withFunding } from '../world';
import { createFundingSystem } from './system';
import { benchFunded } from './test/cities.node';
import { moneyTimeline, replanAt } from './test/fixtures';

const NOWHERE: StepSink = { event() {} };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** Stepped untimed first. */
const WARM = 120;
/** Months `WARM + 1 .. LAST` are timed, one `step` at a time per world. */
const LAST = 240;
const BAR_US = 90;

const quantile = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (xs: readonly number[]) =>
  `p50 ${quantile(xs, 0.5).toFixed(1)}, p90 ${quantile(xs, 0.9).toFixed(1)}, ` +
  `mean ${mean(xs).toFixed(1)}, max ${Math.max(...xs).toFixed(1)} µs`;

interface Worlds {
  core: ReturnType<typeof withFunding>;
  worlds: World[];
  dues: Due[];
}

/** One world per seed, created, planned through `LAST` and stepped untimed through `WARM`. */
function warmWorlds(f: FundingSystem, statics: Statics, t: PolicyTimeline): Worlds {
  const core = withFunding(f);
  const worlds: World[] = [];
  const dues: Due[] = [];
  for (const seed of SEEDS) {
    const w = core.createWorld(statics, t, seed, NOWHERE);
    dues.push(core.planDue(w, statics, t, seed, LAST));
    worlds.push(w);
  }
  for (let m = 1; m <= WARM; m++)
    for (let i = 0; i < SEEDS.length; i++)
      core.step(worlds[i], dues[i], statics, t, SEEDS[i], NOWHERE);
  return { core, worlds, dues };
}

const HOOKS = ['policyChanged', 'moneyIn', 'onProjectEvent', 'apply', 'serve', 'planLot', 'shadow'];
type Hook = (typeof HOOKS)[number];

/** The funding system with each hook's time added to `spent` (µs). */
function timedSystem(spent: Record<Hook, number>): FundingSystem {
  const f = createFundingSystem() as unknown as Record<string, (...a: unknown[]) => unknown>;
  const out: Record<string, unknown> = { ...f };
  for (const h of HOOKS) {
    const inner = f[h];
    out[h] = (...a: unknown[]) => {
      const t0 = performance.now();
      const r = inner(...a);
      spent[h] += (performance.now() - t0) * 1000;
      return r;
    };
  }
  return out as unknown as FundingSystem;
}

describe('funded month cost, bench city (synthCity, baseline money)', () => {
  const { input, doc } = benchFunded('baseline');
  const statics = staticsOf(input);
  const timeline = moneyTimeline(input, doc);

  it('one funded world-month, mean at most 90 µs', () => {
    const { core, worlds, dues } = warmWorlds(createFundingSystem(), statics, timeline);
    const samples: number[] = [];
    for (let m = WARM + 1; m <= LAST; m++)
      for (let i = 0; i < SEEDS.length; i++) {
        const t0 = performance.now();
        core.step(worlds[i], dues[i], statics, timeline, SEEDS[i], NOWHERE);
        samples.push((performance.now() - t0) * 1000);
      }
    const changes = timeline.changes().filter((m) => m > WARM && m <= LAST);
    console.log(
      `funded month, synthCity baseline, ${SEEDS.length} worlds, months ${WARM + 1}..${LAST} ` +
        `(frame changes in them: ${changes.length === 0 ? 'none' : changes.join(', ')}): ` +
        `per world-month ${fmt(samples)}`
    );
    expect(worlds.every((w) => w.month === LAST)).toBe(true);
    expect(samples).toHaveLength(SEEDS.length * (LAST - WARM));
    expect(mean(samples)).toBeLessThanOrEqual(BAR_US);
  });

  it('each hook per world-month: printed', () => {
    const spent = Object.fromEntries(HOOKS.map((h) => [h, 0])) as Record<Hook, number>;
    const { core, worlds, dues } = warmWorlds(timedSystem(spent), statics, timeline);
    const per = Object.fromEntries(HOOKS.map((h) => [h, [] as number[]])) as Record<Hook, number[]>;
    const whole: number[] = [];
    for (let m = WARM + 1; m <= LAST; m++)
      for (let i = 0; i < SEEDS.length; i++) {
        for (const h of HOOKS) spent[h] = 0;
        const t0 = performance.now();
        core.step(worlds[i], dues[i], statics, timeline, SEEDS[i], NOWHERE);
        whole.push((performance.now() - t0) * 1000);
        for (const h of HOOKS) per[h].push(spent[h]);
      }
    const core1 = whole.map((w, j) => w - HOOKS.reduce((a, h) => a + per[h][j], 0));
    console.log(
      [
        'funded month by hook, synthCity baseline (hooks wrapped; shadow includes compaction):',
        `  step (wrapped)  ${fmt(whole)}`,
        ...HOOKS.map((h) => `  ${h.padEnd(15)} ${fmt(per[h])}`),
        `  core (rest)     ${fmt(core1)}`
      ].join('\n')
    );
    expect(whole).toHaveLength(SEEDS.length * (LAST - WARM));
  });

  it('the whole-city replan month (every free lot asked planLot): printed', () => {
    const at = WARM + 1;
    const t = replanAt(timeline, at);
    let asked = 0;
    const f = createFundingSystem();
    const inner = f.planLot;
    f.planLot = (ctx, lot) => {
      asked++;
      return inner(ctx, lot);
    };
    const { core, worlds, dues } = warmWorlds(f, statics, t);
    const ms: number[] = [];
    const calls: number[] = [];
    for (let i = 0; i < SEEDS.length; i++) {
      asked = 0;
      const t0 = performance.now();
      core.step(worlds[i], dues[i], statics, t, SEEDS[i], NOWHERE);
      ms.push(performance.now() - t0);
      calls.push(asked);
    }
    console.log(
      `whole-city replan month ${at}, synthCity baseline, one world: median ` +
        `${quantile(ms, 0.5).toFixed(2)} ms, max ${Math.max(...ms).toFixed(2)} ms; ` +
        `planLot calls per world median ${quantile(calls, 0.5)}`
    );
    expect(worlds.every((w) => w.month === at)).toBe(true);
    expect(Math.min(...calls)).toBeGreaterThan(0);
  });
});
