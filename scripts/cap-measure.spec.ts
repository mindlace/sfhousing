// The homes-by-cap report (building-choice spec, Measurement to report): its table beside the
// taller-caps figures, its lines, and one run that agrees with the timeline engine's view.
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY4 } from '../src/lib/timeline/policy4';
import { CAPS, OLD_FIGURES, capLines, capTable, type CapRun } from './cap-measure';
import { openWorlds } from './record-check';
import { openEngine } from './lib/engine-runner';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for one fill of the fixture's window, twice; a test argument, not a wait. */
const RUN_MS = 600_000;

const run = (who: CapRun['who'], cap: number | null, at479: number): CapRun => ({
  who,
  cap,
  completedNet: { 168: at479 / 2, 479: at479 },
  starts: { n: 10, V: 5, III: 3, I: 2 }
});

describe('capTable', () => {
  it('orders the rows current law, then each policy by cap, beside the old figures', () => {
    const runs: CapRun[] = [];
    for (const cap of [...CAPS].reverse()) {
      runs.push(run('full', cap, 1000 + cap));
      runs.push(run('transit', cap, 500 + cap));
    }
    runs.push(run('current', null, 400));
    const rows = capTable(runs);
    expect(rows.map((r) => [r.who, r.cap])).toEqual([
      ['current', null],
      ...CAPS.map((c) => ['transit', c]),
      ...CAPS.map((c) => ['full', c])
    ]);
    const full = rows.filter((r) => r.who === 'full');
    expect(full.map((r) => r.cap)).toEqual([12, 13, 16, 20, 40, 80]);
    expect(full.map((r) => r.old[479])).toEqual([
      165_058, 157_445, 167_549, 171_072, 197_592, 222_488
    ]);
    expect(full.map((r) => r.now[479])).toEqual(CAPS.map((c) => 1000 + c));
    expect(rows[0].old).toEqual({ 168: 47_502, 479: 79_338 });
    expect(rows[1].old).toEqual(OLD_FIGURES.transit[12]);
  });

  it('throws when a run is missing', () => {
    expect(() => capTable([run('current', null, 1)])).toThrow(/no run for transit at 12/);
  });
});

describe('capLines', () => {
  it('prints each row with both figures and the share of starts by type', () => {
    const rows = capTable([
      run('current', null, 400),
      ...CAPS.flatMap((c) => [run('transit', c, 500), run('full', c, 1000)])
    ]);
    const lines = capLines('fixture-0', rows);
    expect(lines[0]).toBe('Dataset fixture-0; old figures from dataset 2026-11-25-76c90397');
    expect(lines).toContain(
      'Current law: 2040 200 (was 47,502), 2066 400 (was 79,338); starts V 50%, III 30%, I 20% (n 10)'
    );
    expect(lines.some((l) => l.startsWith('Every policy, 80 stories: 2040 500 (was 97,777)'))).toBe(
      true
    );
  });
});

describe('a run', () => {
  it(
    "gives current law the same completed homes as the timeline engine's view",
    async () => {
      const worlds = await openWorlds(FIXTURE);
      const engine = await openEngine({ dir: FIXTURE });
      try {
        const view = await engine.view(DEFAULT_POLICY4);
        const r = worlds.run(DEFAULT_POLICY4, { series: true });
        expect(r.rows.length).toBe(view.rows.length);
        // Not vacuous: homes complete in the window.
        expect(view.rows[view.lastIndex].completedNet).toBeGreaterThan(0);
        expect(r.rows.map((x) => x.completedNet)).toEqual(view.rows.map((x) => x.completedNet));
      } finally {
        engine.close();
      }
    },
    RUN_MS
  );
});
