// W7d: the host's generate memo is a bounded LRU. Evicting must never change output: a miss
// regenerates an equal (new) object, and every diff, score and stat must match an unbounded memo.
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import type { ParcelRecord } from '$lib/data/parcel';
import { generate } from '$lib/generator';
import type { Envelope, Plan, PlanOp } from '$lib/plan';
import { arbGridOps } from '$lib/plan/fixtures/arbitraries';
import { DEFAULT_MEMO_CAP } from './host';
import { FIXTURE_1, assertScores, makeHarness, serialise, stubGenerate } from './test/harness';

const NUM_RUNS = 40;
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

type Action =
  | { t: 'commit'; i: number }
  | { t: 'previewCommit'; i: number }
  | { t: 'previewCancel'; i: number }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'reload' }
  | { t: 'flush' };

const arbAction = (n: number): fc.Arbitrary<Action> => {
  const i = fc.integer({ min: 0, max: n - 1 });
  return fc.oneof(
    i.map((i) => ({ t: 'commit' as const, i })),
    i.map((i) => ({ t: 'previewCommit' as const, i })),
    i.map((i) => ({ t: 'previewCancel' as const, i })),
    fc.constant({ t: 'undo' as const }),
    fc.constant({ t: 'redo' as const }),
    fc.constant({ t: 'reload' as const }),
    fc.constant({ t: 'flush' as const })
  );
};

/** A pool of ops, a session of actions over them, a tiny cap and whether chunks preload. */
const arbSession = arbGridOps(4)
  .filter((ops) => ops.length > 0)
  .chain((ops) =>
    fc.record({
      ops: fc.constant(ops),
      actions: fc.array(arbAction(ops.length), { minLength: 1, maxLength: 14 }),
      cap: fc.integer({ min: 1, max: 8 }),
      preload: fc.boolean()
    })
  );

type Gen = (p: ParcelRecord, env: Envelope) => ReturnType<typeof stubGenerate>;

/** Runs a session on a fresh host; returns the harness and how many times generate ran. */
async function run(ops: PlanOp[], actions: Action[], preload: boolean, memoCap: number, gen: Gen) {
  let calls = 0;
  const h = makeHarness({
    memoCap,
    generate: (p, e) => {
      calls++;
      return gen(p, e);
    }
  });
  const rev = () => h.next();
  const planOf = (ops: PlanOp[]): Plan => ({ schema: 1, datasetVersion: 'fixture-1', ops });
  h.host.handle({ type: 'init', rev: rev(), manifest: FIXTURE_1.manifest, mode: 'max' });
  h.host.handle({ type: 'load', rev: rev(), plan: planOf([]) });
  if (preload) {
    h.host.handle({ type: 'prefetch', bbox: [-180, -90, 180, 90] });
    await h.flush();
  }
  const committed: PlanOp[] = [];
  const undone: PlanOp[] = [];
  let n = 0;
  const fresh = (op: PlanOp): PlanOp => ({ ...op, id: `a${n++}` });
  const commit = (op: PlanOp) => {
    h.host.handle({ type: 'commit', rev: rev(), op });
    committed.push(op);
  };
  for (const a of actions) {
    switch (a.t) {
      case 'commit':
        commit(fresh(ops[a.i]));
        undone.length = 0;
        break;
      case 'previewCommit': {
        const op = fresh(ops[a.i]);
        h.host.handle({ type: 'preview', rev: rev(), op });
        commit(op);
        undone.length = 0;
        break;
      }
      case 'previewCancel':
        h.host.handle({ type: 'preview', rev: rev(), op: fresh(ops[a.i]) });
        h.host.handle({ type: 'cancelPreview', rev: rev() });
        break;
      case 'undo': {
        const last = committed.pop();
        if (!last) break;
        h.host.handle({ type: 'undo', rev: rev(), opId: last.id });
        undone.push(last);
        break;
      }
      case 'redo': {
        const op = undone.pop();
        if (op) commit(fresh(op)); // the client re-commits an undone op under a new id
        break;
      }
      case 'reload':
        h.host.handle({ type: 'load', rev: rev(), plan: planOf(committed.slice()) });
        break;
      case 'flush':
        await h.flush();
        break;
    }
  }
  await h.flush();
  return { h, calls: () => calls };
}

describe('generate memo eviction (W7d)', () => {
  let evicting = 0; // non-vacuity: some runs must regenerate more than the unbounded memo
  afterAll(() => {
    expect(evicting).toBeGreaterThan(0);
  });

  it('defaults to a positive integer cap', () => {
    expect(Number.isInteger(DEFAULT_MEMO_CAP)).toBe(true);
    expect(DEFAULT_MEMO_CAP).toBeGreaterThan(0);
  });

  it('P-memo: a cap of 1–8 posts exactly what an unbounded memo posts', async () => {
    await fc.assert(
      fc.asyncProperty(arbSession, async ({ ops, actions, cap, preload }) => {
        const tiny = await run(ops, actions, preload, cap, stubGenerate);
        const full = await run(ops, actions, preload, UNBOUNDED, stubGenerate);
        if (tiny.calls() > full.calls()) evicting++;
        expect(tiny.h.sent.filter((m) => m.type === 'error')).toEqual([]);
        // Every message (diff renders, scores, stats, complete flags, chunk reports) is equal.
        expect(tiny.h.sent).toEqual(full.h.sent);
        expect(serialise(tiny.h.display())).toBe(serialise(full.h.display()));
        assertScores(tiny.h);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('P-memo-real: with the real generator, a cap of 1–8 posts exactly the same', async () => {
    const real: Gen = (p, e) => generate(p, e, 0, 'max');
    await fc.assert(
      fc.asyncProperty(arbSession, async ({ ops, actions, cap, preload }) => {
        const tiny = await run(ops, actions, preload, cap, real);
        const full = await run(ops, actions, preload, UNBOUNDED, real);
        if (tiny.calls() > full.calls()) evicting++;
        expect(tiny.h.sent).toEqual(full.h.sent);
      }),
      { numRuns: 15 }
    );
  });

  it('cap 1: preview, commit, undo and redo of the same stroke match an unbounded memo', async () => {
    const op: PlanOp = {
      kind: 'paint',
      id: 'x',
      stories: 6,
      radiusM: 60,
      path: [[-122.4183, 37.7607]]
    };
    const actions: Action[] = [
      { t: 'previewCommit', i: 0 },
      { t: 'undo' },
      { t: 'redo' },
      { t: 'commit', i: 1 },
      { t: 'undo' },
      { t: 'reload' }
    ];
    const ops = [op, { ...op, stories: 3, radiusM: 30 }];
    const tiny = await run(ops, actions, true, 1, stubGenerate);
    const full = await run(ops, actions, true, UNBOUNDED, stubGenerate);
    expect(tiny.calls()).toBeGreaterThan(full.calls());
    expect(tiny.h.sent).toEqual(full.h.sent);
    expect(serialise(tiny.h.display())).toBe(serialise(full.h.display()));
    expect(tiny.h.display().parcels.size).toBeGreaterThan(0);
    assertScores(tiny.h);
  });
});
