// The log store's persistence (Task 10): writes, reopening, claims, the current sim and the
// import hook, over the in-memory database (memorySimDb, the same contract as IndexedDB).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SHAPES_REVISION,
  diff,
  type Change,
  type Commit,
  type CommitDraft,
  type Ruleset,
  type RulesetContent
} from '$lib/sim-log';
import { doc, ruleset, transit, type J } from '$lib/sim-log/test/fixtures';
import { newId } from '$lib/ids/base58';
import { mockConsole } from '$lib/server/test/mock-console';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { SOURCES } from './author';
import { LocalLog } from './local-log';
import { LogStore, type ImportMarker, type LogStoreOptions } from './log-store.svelte';
import { CURRENT_KEY, memorySimDb, type SimDb } from './sim-db';
import { DS, FakeObject, draftOf, nameChange, renamingAlign } from './test/commits';
import { MOVE_SOURCE, type Align, type Pending } from './types';

const F1 = 'fixture-1';

afterEach(() => {
  vi.restoreAllMocks();
});

const zoning = (p: SimPolicy4) => p.kinds.zoning as J[];
const ids = (p: SimPolicy4) => zoning(p).map((z) => z.id as string);
const withZ =
  (id: string) =>
  (p: SimPolicy4): SimPolicy4 =>
    doc([...zoning(p), transit(id)], p.kinds.permitting as J[], p.kinds.money as J[]);
const addChanges = (id: string): Change[] => diff(ruleset(doc()), ruleset(doc([transit(id)])));
const stampOf = (ds: string) => () => ({ datasetVersion: ds, build: 'test' });
const labels = (s: LogStore) => s.pending.map((p) => p.draft.label);
const idsOf = (list: readonly Pending[]) => list.map((p) => p.draft.id);
const content = (id: string) => ruleset(doc([transit(id)]));

function store(db: SimDb | null, over: Partial<LogStoreOptions> = {}): LogStore {
  return new LogStore({ db, tabId: 'a', stamp: stampOf(DS), ...over });
}

async function opened(
  db: SimDb | null,
  over: Partial<LogStoreOptions> = {},
  simId: string | null = null
): Promise<LogStore> {
  const s = store(db, over);
  await s.open(simId);
  return s;
}

function accept(obj: FakeObject, d: CommitDraft): Commit {
  const r = obj.append(d);
  if (r.kind !== 'accepted') throw new Error(`expected accepted, got ${r.kind}`);
  return r.commit;
}

/** Another tab's commit, accepted by the object, then received. */
function foreign(s: LogStore, obj: FakeObject, changes: Change[], over: Partial<CommitDraft> = {}) {
  return s.receive([accept(obj, draftOf(obj.commits.length, changes, over))]);
}

/** Every write transaction of `db`, spied. */
function spyWrites(db: SimDb) {
  return (['createSim', 'write', 'claimPending', 'setRegistered', 'setMeta'] as const).map((m) =>
    vi.spyOn(db, m)
  );
}

/** What a fresh log built from the stored records of `tab` holds (the reopen check). */
async function reopened(
  db: SimDb,
  simId: string,
  tab: string,
  init: { serverDataset: string | null; page: string; align?: Align }
): Promise<LocalLog> {
  const r = await db.read(simId);
  return new LocalLog({
    confirmed: r.confirmed,
    pending: r.pending.filter((p) => p.owner === tab).map((p) => p.pending),
    build: 'test',
    ...init
  });
}

describe('LogStore persistence', () => {
  it('writes nothing for a store that opened and did not edit (I6)', async () => {
    const db = memorySimDb();
    const writes = spyWrites(db);
    const mintId = vi.fn(newId);
    const s = await opened(db, { mintId });
    s.setServerDataset(DS);
    void [s.policy, s.canUndo, s.pendingCount, s.head()];
    s.settle();
    // A draft is not a commit.
    s.apply(withZ('d'), 'Drag', 'k');
    await s.written();
    // A known sim read and received, never edited.
    const obj = new FakeObject();
    const k = await opened(db, { tabId: 'k' }, newId());
    k.setServerDataset(DS);
    k.receive([accept(obj, draftOf(0, [nameChange('Start')]))]);
    await k.written();
    expect(writes.every((w) => w.mock.calls.length === 0)).toBe(true);
    expect(mintId).not.toHaveBeenCalled();
    expect(await db.getMeta(CURRENT_KEY)).toBeUndefined();
    expect((await db.read(k.simId!)).sim).toBeNull();
  });

  it('offers a commit to send only once stored (R15, I2)', async () => {
    const db = memorySimDb();
    const s = await opened(db);
    s.setServerDataset(DS);
    s.apply(withZ('a'), 'A');
    expect(s.head()).toBeNull();
    expect(s.local).toBe('writing');
    await s.written();
    expect(s.local).toBe('idle');
    expect(s.head()).toBe(s.pending[0].draft);
    const r = await db.read(s.simId!);
    expect(r.sim?.simId).toBe(s.simId);
    expect(r.pending.map((p) => [p.owner, p.id])).toEqual([['a', s.pending[0].draft.id]]);
    expect(await db.getMeta(CURRENT_KEY)).toBe(s.simId);
    // A re-applied version is offered only once that version is stored.
    const obj = new FakeObject();
    foreign(s, obj, addChanges('z9'));
    expect(s.pending[0].draft.parent).toBe(1);
    expect(s.head()).toBeNull();
    await s.written();
    expect(s.head()).toBe(s.pending[0].draft);
    expect((await db.read(s.simId!)).pending[0].pending.draft.parent).toBe(1);
  });

  it('writes a burst made while one write is in flight as one following batch', async () => {
    const db = memorySimDb();
    const createSim = vi.spyOn(db, 'createSim');
    const write = vi.spyOn(db, 'write');
    const s = await opened(db);
    s.apply(withZ('a'), 'A');
    s.apply(withZ('b'), 'B');
    s.apply(withZ('c'), 'C');
    await s.written();
    expect(createSim).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1].put.map((p) => p.pending.draft.label)).toEqual(['B', 'C']);
    const r = await db.read(s.simId!);
    expect(r.pending.map((p) => p.pending.draft.label)).toEqual(['A', 'B', 'C']);
  });

  it('a failed write sends the edit and never reports it stored (decision 17)', async () => {
    const { error } = mockConsole('error');
    const db = memorySimDb({ abortWrites: () => true });
    const s = await opened(db);
    s.setServerDataset(DS);
    s.apply(withZ('a'), 'A');
    await s.written();
    expect(s.local).toBe('failed');
    expect(ids(s.policy)).toEqual(['a']);
    expect(s.head()).toBe(s.pending[0].draft);
    // Usable in memory, failed for the rest of its life, and logged once.
    s.apply(withZ('b'), 'B');
    await s.written();
    expect(s.local).toBe('failed');
    expect(s.pendingCount).toBe(2);
    expect(await s.importContent(content('i'), { key: 'k', value: 1, expect: undefined })).toBe(
      'imported'
    );
    expect(error).toHaveBeenCalledExactlyOnceWith('[sim-store] write failed', 'Error');
  });

  it('a write failing after earlier ones succeeded hands out what was not stored', async () => {
    const { error } = mockConsole('error');
    let abort = false;
    const db = memorySimDb({ abortWrites: () => abort });
    const s = await opened(db);
    s.setServerDataset(DS);
    s.apply(withZ('a'), 'A');
    await s.written();
    abort = true;
    const obj = new FakeObject();
    s.receive([accept(obj, s.head()!)]);
    s.apply(withZ('b'), 'B');
    expect(s.head()).toBeNull();
    await s.written();
    expect(s.local).toBe('failed');
    expect(s.head()?.label).toBe('B');
    expect(error).toHaveBeenCalledExactlyOnceWith('[sim-store] write failed', 'Error');
  });

  it('starts in the failed state without a database, and sends', async () => {
    const s = await opened(null);
    expect(s.local).toBe('failed');
    s.setServerDataset(DS);
    s.apply(withZ('a'), 'A');
    expect(s.head()).toBe(s.pending[0].draft);
    await s.written();
    expect(s.local).toBe('failed');
    expect(await s.claim(['b'])).toBe(0);
  });

  it('reopens with its pending commits and its undo label (R13, R17)', async () => {
    const db = memorySimDb();
    const a = await opened(db);
    a.apply(withZ('a'), 'A');
    a.apply(withZ('b'), 'B');
    await a.written();
    const b = store(db, { tabId: 'b' });
    await b.open(a.simId, { claim: ['a'] });
    expect(b.simId).toBe(a.simId);
    expect(idsOf(b.pending)).toEqual(idsOf(a.pending));
    expect(ids(b.policy)).toEqual(['a', 'b']);
    expect(b.undoLabel).toBe('B');
    const r = await db.read(a.simId!);
    expect(r.pending.map((p) => p.owner)).toEqual(['b', 'b']);
    expect(b.undo()).toBe('B');
    expect(ids(b.policy)).toEqual(['a']);
    b.setServerDataset(DS);
    await b.written();
    // Opened records are stored as they are: the head is offered without another write.
    expect(b.head()?.label).toBe('A');
  });

  it('deletes, on open, pending commits that are already confirmed (I5)', async () => {
    const db = memorySimDb();
    const obj = new FakeObject();
    const a = await opened(db);
    a.setServerDataset(DS);
    a.apply(withZ('a'), 'A');
    a.apply(withZ('b'), 'B');
    await a.written();
    const sim = a.simId!;
    // The server confirmed A, and the tab that sent it closed before it heard.
    const c = accept(obj, a.head()!);
    await db.write(sim, { owner: 'z', confirmed: [c], put: [], remove: [] });
    const b = store(db, { tabId: 'b' });
    await b.open(sim, { claim: ['a'] });
    expect(labels(b)).toEqual(['B']);
    expect(ids(b.policy)).toEqual(['a', 'b']);
    await b.written();
    const r = await db.read(sim);
    expect(r.pending.map((p) => [p.owner, p.pending.draft.label])).toEqual([['b', 'B']]);
  });

  it('forgets pending commits another tab took, and does not send them', async () => {
    const db = memorySimDb();
    const obj = new FakeObject();
    const sim = newId();
    const a = await opened(db, {}, sim);
    a.setServerDataset(DS);
    a.receive([accept(obj, draftOf(0, [nameChange('Start')]))]);
    a.apply(withZ('a'), 'A');
    a.apply(withZ('b'), 'B');
    await a.written();
    const taken = idsOf(a.pending);
    const stored = (await db.read(sim)).pending;
    await db.claimPending(sim, ['a'], 'b');
    // A foreign commit re-applies them with new parents: the next write of them is lost.
    foreign(a, obj, addChanges('z9'));
    expect(a.head()).toBeNull();
    a.apply(withZ('c'), 'C');
    await a.written();
    expect(labels(a)).toEqual(['C']);
    expect(a.drops).toEqual([]);
    expect(taken).not.toContain(a.head()!.id);
    const r = await db.read(sim);
    expect(r.pending.map((p) => [p.owner, p.pending.draft.label])).toEqual([
      ['b', 'A'],
      ['b', 'B'],
      ['a', 'C']
    ]);
    // The taken records are as the other tab took them.
    expect(r.pending.slice(0, 2).map((p) => p.pending)).toEqual(stored.map((p) => p.pending));
  });

  it("claim takes another tab's pending commits after its own", async () => {
    const db = memorySimDb();
    const obj = new FakeObject();
    const sim = newId();
    const a = await opened(db, {}, sim);
    a.receive([accept(obj, draftOf(0, [nameChange('Start')]))]);
    a.apply(withZ('a'), 'A');
    await a.written();
    const b = await opened(db, { tabId: 'b' }, sim);
    expect(b.pendingCount).toBe(0);
    b.apply(withZ('b'), 'B');
    await b.written();
    expect(await b.claim(['a'])).toBe(1);
    expect(labels(b)).toEqual(['B', 'A']);
    expect(ids(b.policy).sort()).toEqual(['a', 'b']);
    await b.written();
    const r = await db.read(sim);
    expect(r.pending.map((p) => [p.owner, p.pending.draft.label])).toEqual([
      ['b', 'B'],
      ['b', 'A']
    ]);
    const again = await reopened(db, sim, 'b', { serverDataset: null, page: DS });
    expect(idsOf(again.pending)).toEqual(idsOf(b.pending));
    expect(await b.claim(['a'])).toBe(0);
  });

  it('two fresh stores over one database make one current sim (decision 28)', async () => {
    const db = memorySimDb();
    const a = await opened(db);
    const b = await opened(db, { tabId: 'b' });
    a.apply(withZ('a'), 'A');
    b.apply(withZ('b'), 'B');
    await Promise.all([a.written(), b.written()]);
    expect(b.simId).toBe(a.simId);
    expect(await db.getMeta(CURRENT_KEY)).toBe(a.simId);
    const r = await db.read(a.simId!);
    expect(r.pending.map((p) => [p.owner, p.pending.draft.label])).toEqual([
      ['a', 'A'],
      ['b', 'B']
    ]);
    // Each tab shows the confirmed commits and its own pending ones (decision 22).
    expect(ids(b.policy)).toEqual(['b']);
    b.setServerDataset(DS);
    expect(b.head()?.label).toBe('B');
  });

  it('settles an open draft before opening another sim, and writes it to its own sim', async () => {
    const db = memorySimDb();
    const s = await opened(db);
    s.apply(withZ('d'), 'Drag', 'k');
    const other = newId();
    await s.open(other);
    expect(s.simId).toBe(other);
    expect(s.pendingCount).toBe(0);
    const first = (await db.getMeta(CURRENT_KEY)) as string;
    expect(first).not.toBe(other);
    const r = await db.read(first);
    expect(r.pending.map((p) => p.pending.draft.label)).toEqual(['Drag']);
  });

  it('imports once: a second import with the same expectation answers marker', async () => {
    const db = memorySimDb();
    const m: ImportMarker = { key: 'autosave', value: 1, expect: undefined };
    const a = await opened(db);
    expect(await a.importContent(content('i1'), m)).toBe('imported');
    expect(await db.getMeta('autosave')).toBe(1);
    expect(await db.getMeta(CURRENT_KEY)).toBe(a.simId);
    expect(a.pending.map((p) => [p.draft.kind, p.draft.source])).toEqual([
      ['system', SOURCES.import]
    ]);
    const before = a.policy;
    expect(await a.importContent(content('i2'), m)).toBe('marker');
    expect(a.policy).toEqual(before);
    expect(ids(a.policy)).toEqual(['i1']);
    expect(a.pendingCount).toBe(1);
    // Another fresh tab with the same expectation: nothing written, no sim made.
    const b = await opened(db, { tabId: 'b' });
    expect(await b.importContent(content('i3'), m)).toBe('marker');
    expect(b.pendingCount).toBe(0);
    expect(b.simId).toBeNull();
    await Promise.all([a.written(), b.written()]);
    const r = await db.read(a.simId!);
    expect(r.pending.map((p) => [p.owner, p.pending.draft.source])).toEqual([
      ['a', SOURCES.import]
    ]);
    expect(await db.getMeta('autosave')).toBe(1);
  });

  it('re-imports when the expectation matches the stored marker', async () => {
    const db = memorySimDb();
    const a = await opened(db);
    expect(await a.importContent(content('i1'), { key: 'k', value: 1, expect: undefined })).toBe(
      'imported'
    );
    expect(await a.importContent(content('i2'), { key: 'k', value: 2, expect: 1 })).toBe(
      'imported'
    );
    expect(await db.getMeta('k')).toBe(2);
    expect(ids(a.policy)).toEqual(['i2']);
    a.setServerDataset(DS);
    expect(a.head()?.source).toBe(SOURCES.import);
    const r = await db.read(a.simId!);
    expect(r.pending.map((p) => p.pending.draft.source)).toEqual([SOURCES.import, SOURCES.import]);
  });

  it('a withdrawn import leaves the policy and the pending queue as they were', async () => {
    const db = memorySimDb();
    const a = await opened(db);
    a.apply(withZ('a'), 'A');
    await a.written();
    const before = { policy: a.policy, pending: idsOf(a.pending), canUndo: a.canUndo };
    expect(await a.importContent(content('i'), { key: 'k', value: 1, expect: 'other' })).toBe(
      'marker'
    );
    // Content-equal: the fold is the same (decision 4 keeps the object only while it is shown).
    expect({ policy: a.policy, pending: idsOf(a.pending), canUndo: a.canUndo }).toEqual(before);
    expect(a.undoLabel).toBe('A');
    expect(a.drops).toEqual([]);
    await a.written();
    expect((await db.read(a.simId!)).pending.map((p) => p.id)).toEqual(before.pending);
    expect(await db.getMeta('k')).toBeUndefined();
  });

  it('a withdrawn import takes the move it needed with it', async () => {
    const db = memorySimDb();
    const obj = new FakeObject();
    const s = await opened(db, { stamp: stampOf(F1), align: renamingAlign([DS, F1]) }, newId());
    s.receive([accept(obj, draftOf(0, [nameChange('Start')]))]);
    s.setServerDataset(F1);
    expect(await s.importContent(content('i'), { key: 'k', value: 1, expect: 'other' })).toBe(
      'marker'
    );
    expect(s.pendingCount).toBe(0);
    expect(s.name).toBe('Start');
    expect(s.head()).toBeNull();
    await s.written();
    expect((await db.read(s.simId!)).pending).toEqual([]);
  });

  it('a write refused for its marker leaves the rest of the dirty state to the next write', async () => {
    const db = memorySimDb();
    const s = await opened(db);
    s.apply(withZ('a'), 'A');
    const imported = s.importContent(content('i'), { key: 'k', value: 1, expect: 'other' });
    s.apply(withZ('b'), 'B');
    expect(await imported).toBe('marker');
    await s.written();
    expect(labels(s)).toEqual(['A', 'B']);
    expect(ids(s.policy)).toEqual(['a', 'b']);
    const r = await db.read(s.simId!);
    expect(r.pending.map((p) => p.pending.draft.label)).toEqual(['A', 'B']);
    expect(r.pending.map((p) => p.pending)).toEqual([...s.pending]);
  });

  it('an import that finds another current sim is written there with its marker', async () => {
    const db = memorySimDb();
    const a = await opened(db);
    a.apply(withZ('a'), 'A');
    await a.written();
    const b = await opened(db, { tabId: 'b' });
    expect(await b.importContent(content('i'), { key: 'k', value: 1, expect: undefined })).toBe(
      'imported'
    );
    expect(b.simId).toBe(a.simId);
    expect(await db.getMeta('k')).toBe(1);
    expect(await db.getMeta(CURRENT_KEY)).toBe(a.simId);
    const r = await db.read(a.simId!);
    expect(r.pending.map((p) => [p.owner, p.pending.draft.source])).toEqual([
      ['a', SOURCES.edit],
      ['b', SOURCES.import]
    ]);
  });

  it('leaves a pending commit from a newer build untouched and opens read-only (I9)', async () => {
    const db = memorySimDb();
    const sim = newId();
    const draft = draftOf(0, addChanges('f'), { shapes: SHAPES_REVISION + 1 });
    await db.createSim(
      { simId: sim, createdAt: 1, registered: false },
      {
        batch: {
          owner: 'a',
          confirmed: [],
          put: [{ id: draft.id, pending: { draft, targetId: null } }],
          remove: []
        }
      }
    );
    const before = JSON.stringify(await db.read(sim));
    const writes = spyWrites(db);
    const s = await opened(db, {}, sim);
    s.setServerDataset(DS);
    expect([s.ready, s.simId, s.stopped]).toEqual([true, sim, 'future']);
    expect(s.apply(withZ('a'), 'A')).toBe(false);
    s.rename('X');
    await s.written();
    expect(s.head()).toBeNull();
    expect(JSON.stringify(await db.read(sim))).toBe(before);
    expect(writes.every((w) => w.mock.calls.length === 0)).toBe(true);
  });

  it("opens on the store's server dataset, and stores a log-authored lead move first", async () => {
    const db = memorySimDb();
    const obj = new FakeObject();
    const sim = newId();
    const x = await opened(db, { tabId: 'x' }, sim);
    x.receive([accept(obj, draftOf(0, [nameChange('Start')]))]);
    x.apply(withZ('a'), 'A');
    await x.written();
    const align = renamingAlign([DS, F1]);
    const a = store(db, { stamp: stampOf(F1), align });
    a.setServerDataset(F1);
    await a.open(sim, { claim: ['x'] });
    // The log was built on the known server dataset: the page is current, so it moves first.
    expect(a.pending.map((p) => [p.draft.source, p.draft.datasetVersion])).toEqual([
      [MOVE_SOURCE, F1],
      [SOURCES.edit, F1]
    ]);
    expect(a.stopped).toBeNull();
    await a.written();
    expect(a.head()?.source).toBe(MOVE_SOURCE);
    const again = await reopened(db, sim, 'a', { serverDataset: F1, page: F1, align });
    expect(idsOf(again.pending)).toEqual(idsOf(a.pending));
    expect(again.held).toEqual([]);
  });

  it('stores held commits and their order, before and after they are retried', async () => {
    const db = memorySimDb();
    const obj = new FakeObject();
    const sim = newId();
    let blocked = false;
    const base = renamingAlign([DS, F1]);
    // The log hands align a Ruleset, which carries its dataset.
    const on = (c: RulesetContent) => (c as Ruleset).datasetVersion;
    const align: Align = (c, to) => (blocked && on(c) !== to ? null : base(c, to));
    const s = await opened(db, { stamp: stampOf(F1), align }, sim);
    s.receive([accept(obj, draftOf(0, [nameChange('Start')]))]);
    s.setServerDataset(F1);
    s.apply(withZ('a'), 'A');
    await s.written();
    const all = idsOf(s.pending);
    expect(s.pending[0].draft.source).toBe(MOVE_SOURCE);
    // align cannot reach F1 for now: the move and what follows are held.
    blocked = true;
    foreign(s, obj, addChanges('z9'));
    expect(s.pendingCount).toBe(0);
    expect(s.stopped).toBe('stale');
    await s.written();
    const held = await reopened(db, sim, 'a', { serverDataset: F1, page: F1, align });
    expect(idsOf(held.pending)).toEqual([]);
    expect(idsOf(held.held)).toEqual(all);
    // Retried at the next commit applied, now that align can reach it.
    blocked = false;
    foreign(s, obj, addChanges('z8'));
    expect(idsOf(s.pending)).toEqual(all);
    expect(s.head()).toBeNull();
    await s.written();
    expect(s.head()?.id).toBe(all[0]);
    const back = await reopened(db, sim, 'a', { serverDataset: F1, page: F1, align });
    expect(idsOf(back.pending)).toEqual(idsOf(s.pending));
    expect(idsOf(back.pending)).toEqual(all);
    expect(back.held).toEqual([]);
  });

  it('never re-creates a record another tab claimed and removed, even to re-order it', async () => {
    const db = memorySimDb();
    const obj = new FakeObject();
    const sim = newId();
    const x = await opened(db, { tabId: 'x' }, sim);
    x.receive([accept(obj, draftOf(0, [nameChange('Start')]))]);
    x.apply(withZ('a'), 'A');
    await x.written();
    const taken = x.pending[0].draft.id;
    const a = store(db, { stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    await a.open(sim, { claim: ['x'] });
    expect(labels(a)).toEqual(['A']);
    // Another tab takes it, sends it and deletes it.
    await db.claimPending(sim, ['a'], 'c');
    await db.write(sim, { owner: 'c', confirmed: [], put: [], remove: [taken] });
    // The hello: the log puts a move first, so the record would have to move behind it.
    a.setServerDataset(F1);
    await a.written();
    expect(a.pendingCount).toBe(0);
    expect(a.head()).toBeNull();
    expect((await db.read(sim)).pending).toEqual([]);
  });

  it('keeps a refusal from the draft that open settles', async () => {
    let page = DS;
    const s = await opened(memorySimDb(), {
      stamp: () => ({ datasetVersion: page, build: 'test' })
    });
    s.apply(withZ('a'), 'A');
    s.apply(withZ('d'), 'Drag', 'k');
    page = F1;
    await s.open(newId());
    expect(s.refusal).toBe('stopped');
  });

  it('a hello with the server dataset it already has leaves an open draft open', async () => {
    const s = await opened(memorySimDb());
    s.setServerDataset(DS);
    s.apply(withZ('d'), 'Drag', 'k');
    s.setServerDataset(DS);
    expect(s.drafting).toBe(true);
    expect(s.pendingCount).toBe(0);
  });
});
