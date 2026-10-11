// Host properties (spec §6 "Properties (a)–(c) run under fast-check over random op sequences").
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Plan, PlanOp } from '$lib/plan';
import { arbGridOps } from '$lib/plan/fixtures/arbitraries';
import { FIXTURE_1, assertScores, makeHarness, serialise, type Harness } from './test/harness';

const NUM_RUNS = 30;
const CELLS = FIXTURE_1.manifest.chunks.map((c) => c.cellId);

const planOf = (ops: PlanOp[]): Plan => ({ schema: 1, datasetVersion: 'fixture-1', ops });

function started(mode: 'auto' | 'manual' = 'auto'): Harness {
  const h = makeHarness({ mode });
  h.host.handle({ type: 'init', rev: h.next(), manifest: FIXTURE_1.manifest, mode: 'max' });
  h.host.handle({ type: 'load', rev: h.next(), plan: planOf([]) });
  return h;
}
const commit = (h: Harness, op: PlanOp) => h.host.handle({ type: 'commit', rev: h.next(), op });
const preview = (h: Harness, op: PlanOp) => h.host.handle({ type: 'preview', rev: h.next(), op });
const undo = (h: Harness, opId: string) => h.host.handle({ type: 'undo', rev: h.next(), opId });
const load = (h: Harness, plan: Plan) => h.host.handle({ type: 'load', rev: h.next(), plan });
const errors = (h: Harness) => h.sent.filter((m) => m.type === 'error');

const EMPTY_RENDER = { cells: [], removedCells: [], hide: { add: [], remove: [] } };

/**
 * A non-empty op sequence; `preload` loads all 4 chunks before the first op, and `flushAfter[i]`
 * lets chunks land after op i, so loaded and unloaded paths mix.
 */
const arbRun = arbGridOps(6)
  .filter((ops) => ops.length > 0)
  .chain((ops) =>
    fc.record({
      ops: fc.constant(ops),
      preload: fc.boolean(),
      flushAfter: fc.array(fc.boolean(), { minLength: ops.length, maxLength: ops.length })
    })
  );

async function prepared(preload: boolean): Promise<Harness> {
  const h = started();
  if (preload) {
    h.host.handle({ type: 'prefetch', bbox: [-180, -90, 180, 90] });
    await h.flush();
  }
  return h;
}

/** Non-vacuity guard: across a property's runs, some commits must cover loaded parcels. */
let coveredSeen = 0;
const observe = (covered: number) => {
  if (covered > 0) coveredSeen++;
};

describe('host properties', () => {
  beforeEach(() => {
    coveredSeen = 0;
  });
  afterEach(() => {
    if (expect.getState().currentTestName?.includes('P-c')) return;
    expect(coveredSeen).toBeGreaterThan(0);
  });

  it('P-a: preview(op) then commit(op) for each op ≡ committing each op', async () => {
    await fc.assert(
      fc.asyncProperty(arbRun, async ({ ops, preload, flushAfter }) => {
        const a = await prepared(preload);
        for (let i = 0; i < ops.length; i++) {
          preview(a, ops[i]);
          const shown = a.diffs().at(-1)!;
          expect(shown.phase).toBe('preview');
          commit(a, ops[i]);
          const committed = a.diffs().at(-1)!;
          expect(committed.phase).toBe('commit');
          // Promotion: a preview that rendered over fully loaded chunks leaves nothing to redo.
          if (shown.complete) expect(committed.render).toMatchObject(EMPTY_RENDER);
          observe(committed.stats!.covered);
          if (flushAfter[i]) await a.flush();
        }
        await a.flush();
        const b = await prepared(preload);
        for (let i = 0; i < ops.length; i++) {
          commit(b, ops[i]);
          if (flushAfter[i]) await b.flush();
        }
        await b.flush();
        expect(errors(a)).toEqual([]);
        expect(serialise(a.display())).toBe(serialise(b.display()));
        assertScores(a);
        assertScores(b);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('P-b: commit all then undo the last k ≡ load(ops.slice(0, n - k))', async () => {
    const arb = arbRun.chain((run) =>
      fc.record({ run: fc.constant(run), k: fc.integer({ min: 0, max: run.ops.length }) })
    );
    await fc.assert(
      fc.asyncProperty(arb, async ({ run: { ops, preload, flushAfter }, k }) => {
        const a = await prepared(preload);
        for (let i = 0; i < ops.length; i++) {
          commit(a, ops[i]);
          observe(a.diffs().at(-1)!.stats!.covered);
          if (flushAfter[i]) await a.flush();
        }
        for (let i = 0; i < k; i++) undo(a, ops[ops.length - 1 - i].id);
        await a.flush();
        const b = started();
        load(b, planOf(ops.slice(0, ops.length - k)));
        await b.flush();
        expect(errors(a)).toEqual([]);
        expect(serialise(a.display())).toBe(serialise(b.display()));
        assertScores(a);
        assertScores(b);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('P-c: chunk release order does not change the final display', async () => {
    const order = fc.shuffledSubarray(CELLS, { minLength: CELLS.length, maxLength: CELLS.length });
    await fc.assert(
      fc.asyncProperty(arbGridOps(6), order, async (ops, cells) => {
        const a = started('manual');
        load(a, planOf(ops));
        // Hold a fetch for every cell (the plan alone may need fewer), then release in order.
        a.host.handle({ type: 'prefetch', bbox: [-180, -90, 180, 90] });
        for (const c of cells) {
          a.release(c);
          await a.flush();
        }
        const b = started();
        load(b, planOf(ops));
        await b.flush();
        expect(a.diffs().at(-1)!.complete).toBe(true);
        expect(serialise(a.display())).toBe(serialise(b.display()));
        assertScores(a);
        assertScores(b);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
