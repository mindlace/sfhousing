import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import { decodeParcelChunk, encodeParcelChunk } from '$lib/data/parcel-chunk';
import { resolveEnvelopes, validatePlan, type Plan, type PlanOp } from '$lib/plan';
import { gridId, gridIndex, gridLngLat, gridRecord } from '$lib/plan/fixtures/grid-20x20';
import type {
  ChunksResponse,
  ErrorResponse,
  OpStats,
  ParcelSummary,
  ReadyResponse
} from './protocol';
import {
  FIXTURE_1,
  FIXTURE_1_CELL_OF,
  MIDRISE,
  assertScores,
  makeHarness,
  serialise,
  stubGenerate,
  type Harness,
  type Reconstructed
} from './test/harness';

const url = (cellId: string, v = 'fixture-1') => `/data/${v}/parcels/${cellId}.json`;

function paint(id: string, stories: number, pts: [number, number][], radiusM = 5): PlanOp {
  return { kind: 'paint', id, stories, radiusM, path: pts.map(([i, j]) => gridLngLat(i, j)) };
}
function erase(id: string, pts: [number, number][], radiusM = 5): PlanOp {
  return { kind: 'erase', id, radiusM, path: pts.map(([i, j]) => gridLngLat(i, j)) };
}
function planOf(ops: PlanOp[], datasetVersion = 'fixture-1'): Plan {
  return { schema: 1, datasetVersion, ops };
}

/** Row j=2, columns 2..5 of quadrant 0_0. */
const SMALL = paint('small', 6, [
  [2, 2],
  [5, 2]
]);
/** The whole grid's diagonal, wide: touches all four chunks. */
const BIG = paint(
  'big',
  5,
  [
    [0, 0],
    [19, 19]
  ],
  40
);
const ALL_BBOX: [number, number, number, number] = [
  ...gridLngLat(-1, -1),
  ...gridLngLat(20, 20)
] as [number, number, number, number];

function init(h: Harness, manifest: Manifest = FIXTURE_1.manifest): number {
  const rev = h.next();
  h.host.handle({ type: 'init', rev, manifest, mode: 'max' });
  return rev;
}
function load(h: Harness, plan: Plan): number {
  const rev = h.next();
  h.host.handle({ type: 'load', rev, plan });
  return rev;
}
function commit(h: Harness, op: PlanOp): number {
  const rev = h.next();
  h.host.handle({ type: 'commit', rev, op });
  return rev;
}
function preview(h: Harness, op: PlanOp): number {
  const rev = h.next();
  h.host.handle({ type: 'preview', rev, op });
  return rev;
}
function cancel(h: Harness): number {
  const rev = h.next();
  h.host.handle({ type: 'cancelPreview', rev });
  return rev;
}
function undo(h: Harness, opId: string): number {
  const rev = h.next();
  h.host.handle({ type: 'undo', rev, opId });
  return rev;
}
/** init → ready, then load an empty plan → one revision-0 empty diff. */
function start(h: Harness): void {
  init(h);
  load(h, planOf([]));
  expect(h.diffs()).toHaveLength(1);
  expect(h.diffs()[0].render).toMatchObject({ revision: 0, cells: [], removedCells: [] });
}
async function prefetchAll(h: Harness): Promise<void> {
  h.host.handle({ type: 'prefetch', bbox: ALL_BBOX });
  await h.flush();
}
function summary(h: Harness, parcelId: string): ParcelSummary | null {
  const reqId = h.sent.length + 1000;
  h.host.handle({ type: 'parcelSummary', reqId, parcelId });
  const m = h.sent.at(-1)!;
  if (m.type !== 'parcelSummary' || m.reqId !== reqId) throw new Error('no summary reply');
  return m.summary;
}
const errors = (h: Harness) => h.sent.filter((m): m is ErrorResponse => m.type === 'error');
const chunkMsgs = (h: Harness) => h.sent.filter((m): m is ChunksResponse => m.type === 'chunks');

/** Expected display: stubGenerate over resolveEnvelopes(plan, gridIndex()). */
function direct(plan: Plan): Reconstructed {
  const v = validatePlan(plan);
  if (!v.ok) throw new Error('bad plan');
  const index = gridIndex();
  const r: Reconstructed = { parcels: new Map(), hidden: new Set() };
  for (const [id, env] of resolveEnvelopes(v.value, index)) {
    const rec = index.get(id)!;
    const b = stubGenerate(rec, env);
    if (!b) continue;
    r.parcels.set(id, {
      cellId: FIXTURE_1_CELL_OF.get(id)!,
      units: b.units,
      existingUnits: rec.existingUnits,
      stories: b.stories,
      typology: MIDRISE
    });
    if (b.replacesExisting) r.hidden.add(id);
  }
  return r;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('init', () => {
  it('replies ready with the dataset version and chunk count', () => {
    const h = makeHarness();
    const rev = init(h);
    expect(h.sent).toEqual([
      { type: 'ready', rev, datasetVersion: 'fixture-1', chunkCount: 4 } satisfies ReadyResponse
    ]);
    assertScores(h);
  });

  it('rejects a malformed manifest with manifest-invalid', () => {
    const h = makeHarness();
    const rev = init(h, { ...FIXTURE_1.manifest, chunks: 'x' } as unknown as Manifest);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: 'error', rev, code: 'manifest-invalid' });
    assertScores(h);
  });

  it('before init: rev requests get bad-request, parcelSummary gets null, nothing throws', () => {
    const h = makeHarness();
    const r1 = load(h, planOf([]));
    const r2 = commit(h, SMALL);
    const r3 = undo(h, 'x');
    h.host.handle({ type: 'prefetch', bbox: ALL_BBOX });
    h.host.handle({ type: 'retryChunks' });
    expect(errors(h).map((e) => [e.rev, e.code])).toEqual([
      [r1, 'bad-request'],
      [r2, 'bad-request'],
      [r3, 'bad-request']
    ]);
    expect(errors(h)[0].message).toBe('not initialised');
    expect(summary(h, gridId(2, 2))).toBeNull();
    expect(h.fetches).toEqual([]);
    assertScores(h);
  });

  it('a failed re-init drops to un-inited', () => {
    const h = makeHarness();
    start(h);
    init(h, { ...FIXTURE_1.manifest, chunks: 'x' } as unknown as Manifest);
    const rev = load(h, planOf([]));
    expect(h.sent.at(-1)).toMatchObject({ type: 'error', rev, code: 'bad-request' });
    assertScores(h);
  });

  it('a re-init with another manifest drops the index and ignores late fixture-1 fetches', async () => {
    const v2 = 'fixture-2';
    const bodies: Record<string, unknown> = {};
    for (const c of FIXTURE_1.manifest.chunks) {
      bodies[url(c.cellId, v2)] = JSON.parse(
        encodeParcelChunk(v2, c.cellId, decodeParcelChunk(FIXTURE_1.chunks[c.cellId]))
      );
    }
    const m2 = JSON.parse(JSON.stringify(FIXTURE_1.manifest).replaceAll('fixture-1', v2));
    const h = makeHarness({ mode: 'manual', bodies });
    start(h);
    load(h, planOf([SMALL]));
    h.release('0_0');
    await h.flush();
    expect(summary(h, gridId(2, 2))).not.toBeNull();

    const far = paint('far', 6, [[15, 15]]);
    load(h, planOf([far]));
    expect(h.fetches.at(-1)).toBe(url('1_1'));
    const ready = init(h, m2);
    expect(h.sent.at(-1)).toMatchObject({ type: 'ready', rev: ready, datasetVersion: v2 });
    const before = h.sent.length;
    h.release('1_1');
    await h.flush();
    expect(h.sent.length).toBe(before);
    expect(summary(h, gridId(2, 2))).toBeNull();
    expect(summary(h, gridId(15, 15))).toBeNull();

    // Loading after the re-init fetches fixture-2's urls and renders on its data.
    const n = h.fetches.length;
    load(h, planOf([SMALL]));
    expect(h.fetches.slice(n)).toEqual([url('0_0', v2)]);
    h.release('0_0');
    await h.flush();
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'chunk', complete: true });
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL]))));
    expect(h.display().parcels.size).toBeGreaterThan(0);
    assertScores(h);
  });
});

describe('load', () => {
  it('fetches only the chunks that intersect the plan', async () => {
    const h = makeHarness();
    start(h);
    load(h, planOf([SMALL]));
    await h.flush();
    expect(h.fetches).toEqual([url('0_0')]);
    assertScores(h);
  });

  it('renders the same display as the direct computation', async () => {
    const h = makeHarness();
    start(h);
    const plan = planOf([BIG, erase('e', [[10, 10]], 30), SMALL]);
    load(h, plan);
    await h.flush();
    expect([...h.fetches].sort()).toEqual(['0_0', '0_1', '1_0', '1_1'].map((c) => url(c)));
    const want = direct(plan);
    expect(want.parcels.size).toBeGreaterThan(20);
    expect(serialise(h.display())).toBe(serialise(want));
    assertScores(h);
  });

  it('accepts a plan from another datasetVersion and renders it on the manifest data', async () => {
    const ops = [BIG, SMALL];
    const a = makeHarness();
    start(a);
    load(a, planOf(ops, 'fixture-0'));
    await a.flush();
    const b = makeHarness();
    start(b);
    load(b, planOf(ops));
    await b.flush();
    expect(errors(a)).toEqual([]);
    expect(serialise(a.display())).toBe(serialise(b.display()));
    expect(a.display().parcels.size).toBeGreaterThan(0);
    assertScores(a);
    assertScores(b);
  });

  it('rejects an invalid plan with bad-request', () => {
    const h = makeHarness();
    start(h);
    const rev = load(h, { schema: 1, datasetVersion: 'nope', ops: [] } as Plan);
    expect(h.sent.at(-1)).toMatchObject({ type: 'error', rev, code: 'bad-request' });
    expect(h.diffs()).toHaveLength(1);
    assertScores(h);
  });
});

describe('load on unloaded chunks', () => {
  it('is incomplete until the chunk diffs bring the buildings', async () => {
    const h = makeHarness();
    init(h);
    const plan = planOf([BIG]);
    const rev = load(h, plan);
    expect(h.diffs()).toHaveLength(1);
    expect(h.diffs()[0]).toMatchObject({ phase: 'load', rev, complete: false });
    await h.flush();
    const chunk = h.diffs().slice(1);
    expect(chunk.length).toBe(4);
    expect(chunk.every((d) => d.phase === 'chunk')).toBe(true);
    expect(chunk.slice(0, -1).every((d) => !d.complete)).toBe(true);
    expect(chunk.at(-1)).toMatchObject({ complete: true, rev });
    expect(serialise(h.display())).toBe(serialise(direct(plan)));
    assertScores(h);
  });
});

describe('commit (no preview)', () => {
  it('adds exactly the built parcels under the stroke', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    expect(h.display().parcels.size).toBe(0);
    const rev = commit(h, SMALL);
    const d = h.diffs().at(-1)!;
    expect(d).toMatchObject({ phase: 'commit', rev, complete: true });
    expect(d.stats).toMatchObject({ opId: 'small', kind: 'paint', stories: 6 });
    const ids = [...h.display().parcels.keys()].sort();
    const want = [2, 3, 4, 5].filter((i) => (2 * 20 + i) % 7 !== 0).map((i) => gridId(i, 2));
    expect(ids).toEqual(want.sort());
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL]))));
    assertScores(h);
  });

  it('rejects a duplicate op id with no diff and no state change', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    commit(h, SMALL);
    const n = h.diffs().length;
    const before = serialise(h.display());
    const rev = commit(h, { ...SMALL, stories: 9 } as PlanOp);
    expect(h.sent.at(-1)).toMatchObject({ type: 'error', rev, code: 'bad-request' });
    expect(h.diffs()).toHaveLength(n);
    expect(serialise(h.display())).toBe(before);
    expect(summary(h, gridId(3, 2))?.envelope).toEqual({ maxStories: 6 });
    // The plan is unchanged too: SMALL is still the last op.
    undo(h, 'small');
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'undo' });
    expect(h.display().parcels.size).toBe(0);
    assertScores(h);
  });

  it('rejects radiusM 4.5 with bad-request', () => {
    const h = makeHarness();
    start(h);
    const rev = commit(h, { ...SMALL, radiusM: 4.5 });
    expect(h.sent.at(-1)).toMatchObject({ type: 'error', rev, code: 'bad-request' });
    expect(h.diffs()).toHaveLength(1);
    assertScores(h);
  });
});

describe('(b) undo', () => {
  it('commit A, commit B, undo B equals load(plan with only A)', async () => {
    const A = paint(
      'A',
      4,
      [
        [1, 1],
        [8, 8]
      ],
      12
    );
    const B = paint(
      'B',
      7,
      [
        [5, 0],
        [5, 15]
      ],
      12
    );
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    commit(h, A);
    commit(h, B);
    undo(h, 'B');
    expect(h.diffs().at(-1)!.phase).toBe('undo');

    const fresh = makeHarness();
    start(fresh);
    load(fresh, planOf([A]));
    await fresh.flush();
    expect(fresh.display().parcels.size).toBeGreaterThan(0);
    expect(serialise(h.display())).toBe(serialise(fresh.display()));
    assertScores(h);
    assertScores(fresh);
  });

  it('(f) undo of a non-last op is bad-request', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    commit(h, SMALL);
    commit(h, BIG);
    const n = h.diffs().length;
    const rev = undo(h, 'small');
    expect(h.sent.at(-1)).toMatchObject({ type: 'error', rev, code: 'bad-request' });
    expect(h.diffs()).toHaveLength(n);
    const rev2 = undo(h, 'nothing');
    expect(h.sent.at(-1)).toMatchObject({ type: 'error', rev: rev2, code: 'bad-request' });
    assertScores(h);
  });
});

describe('(i) revisions', () => {
  it('are gap-free across load/commit/undo/chunk, and a resync load restarts at 0', async () => {
    const h = makeHarness();
    start(h);
    commit(h, SMALL); // chunk 0_0 not loaded yet
    await h.flush();
    commit(h, BIG);
    await h.flush();
    undo(h, 'big');
    const phases = new Set(h.diffs().map((d) => d.phase));
    expect([...phases].sort()).toEqual(['chunk', 'commit', 'load', 'undo']);
    const revs = h.diffs().map((d) => d.render.revision);
    expect(revs).toEqual(revs.map((_, k) => k));
    load(h, planOf([SMALL]));
    expect(h.diffs().at(-1)!.render.revision).toBe(0);
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL]))));
    assertScores(h);
  });
});

describe('(j) parcelSummary', () => {
  it('returns record fields, envelope and generated result; null for an unloaded parcel', async () => {
    const h = makeHarness();
    start(h);
    load(h, planOf([SMALL]));
    await h.flush();
    expect(summary(h, gridId(3, 2))).toEqual({
      parcelId: gridId(3, 2),
      neighborhood: 'Mission',
      landUse: 'RESIDENT',
      eligible: true,
      existingUnits: 1,
      envelope: { maxStories: 6 },
      generated: { typology: 'midrise', stories: 6, units: 6 }
    } satisfies ParcelSummary);
    expect(summary(h, gridId(3, 5))).toMatchObject({ envelope: null, generated: null });
    const n = h.fetches.length;
    expect(summary(h, gridId(15, 15))).toBeNull();
    expect(h.fetches.length).toBe(n);
    assertScores(h);
  });

  it('passes a landUse UNKNOWN record through verbatim', async () => {
    const recs = decodeParcelChunk(FIXTURE_1.chunks['0_0']).map((r) =>
      r.id === gridId(3, 2) ? { ...r, landUse: 'UNKNOWN' } : r
    );
    const h = makeHarness({
      bodies: { [url('0_0')]: JSON.parse(encodeParcelChunk('fixture-1', '0_0', recs)) }
    });
    start(h);
    load(h, planOf([SMALL]));
    await h.flush();
    expect(summary(h, gridId(3, 2))).toMatchObject({ landUse: 'UNKNOWN', eligible: true });
    assertScores(h);
  });
});

describe('(d) chunk retry at host level', () => {
  it('retries a failing chunk after 1 s, 4 s, 16 s, then reports it failed', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness();
    h.fail('0_0', 1000);
    start(h);
    load(h, planOf([SMALL]));
    await vi.advanceTimersByTimeAsync(0);
    expect(chunkMsgs(h).at(-1)).toMatchObject({ status: { '0_0': 'loading' }, failed: [] });
    expect(h.fetches).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.fetches).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.fetches).toHaveLength(3);
    expect(chunkMsgs(h).every((m) => m.failed.length === 0)).toBe(true);
    await vi.advanceTimersByTimeAsync(16000);
    expect(h.fetches).toHaveLength(4);
    expect(chunkMsgs(h).at(-1)).toMatchObject({ failed: ['0_0'], pending: 0 });
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.fetches).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(4);

    h.host.handle({ type: 'retryChunks' });
    expect(h.fetches).toHaveLength(5);
    expect(chunkMsgs(h).at(-1)).toMatchObject({ status: { '0_0': 'loading' }, failed: [] });
    await vi.advanceTimersByTimeAsync(0);
    assertScores(h);
  });
});

const emptyRender = { cells: [], removedCells: [], hide: { add: [], remove: [] } };

describe('(a) preview then commit', () => {
  it('preview X then commit X equals commit X alone, with an empty commit render', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    const rev = preview(h, BIG);
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'preview', rev, complete: true });
    expect(h.display().parcels.size).toBeGreaterThan(0);
    const crev = commit(h, BIG);
    const d = h.diffs().at(-1)!;
    expect(d).toMatchObject({ phase: 'commit', rev: crev, render: emptyRender });
    expect(d.stats).toMatchObject({ opId: 'big', kind: 'paint', stories: 5 });

    const fresh = makeHarness();
    start(fresh);
    await prefetchAll(fresh);
    commit(fresh, BIG);
    expect(serialise(h.display())).toBe(serialise(fresh.display()));
    expect(serialise(h.display())).toBe(serialise(direct(planOf([BIG]))));
    assertScores(h);
    assertScores(fresh);
  });

  it('preview X then commit Y equals commit Y alone', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    preview(h, BIG);
    commit(h, SMALL);
    expect(h.diffs().at(-1)!.phase).toBe('commit');
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL]))));
    assertScores(h);
  });

  it('a preview whose path differs only in a later point is not the committed op', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    preview(h, paint('small', 6, [[2, 2]]));
    commit(h, SMALL);
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL]))));
    assertScores(h);
  });

  it('rejects an invalid preview op with bad-request; a duplicate id is allowed', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    commit(h, SMALL);
    const n = h.diffs().length;
    const rev = preview(h, { ...SMALL, id: 'p', radiusM: 4.5 });
    expect(h.sent.at(-1)).toMatchObject({ type: 'error', rev, code: 'bad-request' });
    expect(h.diffs()).toHaveLength(n);
    const rev2 = preview(h, { ...SMALL, stories: 9 } as PlanOp);
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'preview', rev: rev2 });
    expect(summary(h, gridId(3, 2))?.envelope).toEqual({ maxStories: 9 });
    assertScores(h);
  });
});

describe('(e) stale previews', () => {
  const A = paint('A', 7, [
    [12, 2],
    [16, 2]
  ]);
  const B = paint('B', 8, [
    [2, 14],
    [6, 14]
  ]);

  it('a newer preview supersedes the older one; cancel restores the committed display', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    commit(h, SMALL);
    preview(h, A);
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL, A]))));
    preview(h, B);
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL, B]))));
    const rev = cancel(h);
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'cancel', rev, complete: true });
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL]))));
    assertScores(h);
  });

  it('cancelPreview with no preview still posts exactly one diff', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    const n = h.diffs().length;
    const rev = cancel(h);
    expect(h.diffs()).toHaveLength(n + 1);
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'cancel', rev, render: emptyRender });
    assertScores(h);
  });
});

describe('(g) op stats', () => {
  // A stamp at (5,5): the centre and its 4 neighbours at 10 m (diagonals are at 14.1 m). The
  // brief's radius is 10, but quantising the stamp point to 1e-6° moves it ~0.05 m off the grid
  // point, so two neighbours land just past 10 m; radius 11 keeps the same 5 parcels.
  const STAMP: [number, number][] = [
    [5, 5],
    [4, 5],
    [6, 5],
    [5, 4],
    [5, 6]
  ];
  const eligible = STAMP.filter(([i, j]) => gridRecord(i, j).eligible).length; // 105 % 7 = 0 → 4
  const ineligible = STAMP.length - eligible; // 1
  const stamp = (id: string, stories: number) => paint(id, stories, [[5, 5]], 11);
  const statsOf = (h: Harness) => h.diffs().at(-1)!.stats!;

  it('covers the hand-checked parcels', () => {
    const v = validatePlan(planOf([stamp('s', 6)]));
    if (!v.ok) throw new Error('bad op');
    const covered = gridIndex().covered(v.value.ops[0]).sort();
    expect(covered).toEqual(STAMP.map(([i, j]) => gridId(i, j)).sort());
    expect([eligible, ineligible]).toEqual([4, 1]);
  });

  it('a paint stamp counts every covered eligible parcel as built', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    commit(h, stamp('s', 6));
    expect(statsOf(h)).toEqual({
      opId: 's',
      kind: 'paint',
      stories: 6,
      covered: eligible,
      ineligible,
      built: eligible,
      notBigger: 0,
      removed: 0,
      partial: false
    } satisfies OpStats);
    assertScores(h);
  });

  it('a 2-story paint over a 6-story building is notBigger and removes it', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    commit(h, paint('six', 6, [[4, 5]]));
    commit(h, paint('two', 2, [[4, 5]]));
    expect(statsOf(h)).toEqual({
      opId: 'two',
      kind: 'paint',
      stories: 2,
      covered: 1,
      ineligible: 0,
      built: 0,
      notBigger: 1,
      removed: 1,
      partial: false
    } satisfies OpStats);
    expect(h.display().parcels.size).toBe(0);
    assertScores(h);
  });

  it('an erase has no stories key and counts the removed buildings', async () => {
    const h = makeHarness();
    start(h);
    await prefetchAll(h);
    commit(h, stamp('s', 6));
    commit(h, erase('e', [[5, 5]], 11));
    const stats = statsOf(h);
    expect('stories' in stats).toBe(false);
    expect(stats).toEqual({
      opId: 'e',
      kind: 'erase',
      covered: eligible,
      ineligible,
      built: 0,
      notBigger: 0,
      removed: eligible,
      partial: false
    } satisfies OpStats);
    assertScores(h);
  });

  it('a commit over an unloaded chunk is partial; the chunk diff then fills it', async () => {
    const h = makeHarness();
    start(h);
    commit(h, stamp('s', 6));
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'commit', complete: false });
    expect(statsOf(h)).toMatchObject({ partial: true, covered: 0, built: 0 });
    await h.flush();
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'chunk', complete: true });
    expect(serialise(h.display())).toBe(serialise(direct(planOf([stamp('s', 6)]))));
    expect(h.display().parcels.size).toBe(eligible);
    assertScores(h);
  });
});

describe('(c) chunk arrival order', () => {
  const plan = planOf([BIG, erase('e', [[10, 10]], 30), SMALL, paint('far', 9, [[15, 15]], 20)]);
  const orders = [
    ['0_0', '1_0', '0_1', '1_1'],
    ['1_1', '0_1', '1_0', '0_0'],
    ['0_1', '0_0', '1_1', '1_0'],
    ['1_0', '1_1', '0_0', '0_1']
  ];

  it('the final display does not depend on the release order', async () => {
    const want = serialise(direct(plan));
    for (const order of orders) {
      const h = makeHarness({ mode: 'manual' });
      start(h);
      load(h, plan);
      for (const c of order) {
        h.release(c);
        await h.flush();
      }
      expect(h.diffs().at(-1)).toMatchObject({ phase: 'chunk', complete: true });
      expect(serialise(h.display())).toBe(want);
      assertScores(h);
    }
  });

  it('a chunk that lands mid-preview carries the preview; cancel then removes it', async () => {
    const h = makeHarness({ mode: 'manual' });
    start(h);
    load(h, planOf([SMALL]));
    h.release('0_0');
    await h.flush();
    const far = paint('far', 6, [[15, 15]], 11);
    preview(h, far);
    expect(h.diffs().at(-1)).toMatchObject({ phase: 'preview', complete: false });
    expect(h.fetches.at(-1)).toBe(url('1_1'));
    h.release('1_1');
    await h.flush();
    const d = h.diffs().at(-1)!;
    expect(d).toMatchObject({ phase: 'chunk', complete: true });
    expect(d.render.cells.map((c) => c.settled.cellId)).toEqual(['1_1']);
    expect(summary(h, gridId(16, 15))?.envelope).toEqual({ maxStories: 6 });
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL, far]))));
    cancel(h);
    expect(h.diffs().at(-1)!.render.removedCells).toEqual(['1_1']);
    expect(serialise(h.display())).toBe(serialise(direct(planOf([SMALL]))));
    expect(h.display().parcels.size).toBeGreaterThan(0);
    assertScores(h);
  });
});

describe('host hardening', () => {
  it('a throw while applying a landed chunk posts error internal with the latest rev', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = gridId(3, 2);
    const h = makeHarness({
      generate: (p, e) =>
        p.id === bad
          ? ({ ...stubGenerate(p, e)!, parts: null } as unknown as ReturnType<typeof stubGenerate>)
          : stubGenerate(p, e)
    });
    start(h);
    const rev = load(h, planOf([SMALL]));
    await h.flush();
    expect(errors(h)).toEqual([
      { type: 'error', rev, code: 'internal', message: expect.any(String) }
    ]);
    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining('onLoaded threw'),
      expect.anything()
    );
    assertScores(h);
  });

  it('a parcelSummary that throws still replies with summary null', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let boom = false;
    const h = makeHarness({
      generate: (p, e) => {
        const b = stubGenerate(p, e);
        if (!b) return b;
        return Object.defineProperty({ ...b }, 'typology', {
          get() {
            if (boom) throw new Error('boom');
            return 'midrise';
          },
          enumerable: true
        });
      }
    });
    start(h);
    load(h, planOf([SMALL]));
    await h.flush();
    expect(summary(h, gridId(3, 2))?.generated?.typology).toBe('midrise');
    boom = true;
    expect(summary(h, gridId(3, 2))).toBeNull();
    expect(errors(h)).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    boom = false;
    assertScores(h);
  });
});
