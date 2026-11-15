// The log store's editing half (Task 9), with no database (db: null: storage unavailable).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SHAPES_REVISION,
  diff,
  rulesetText,
  toLogForm,
  type Change,
  type Commit,
  type CommitDraft
} from '$lib/sim-log';
import { doc, ruleset, transit, type J } from '$lib/sim-log/test/fixtures';
import { newId } from '$lib/ids/base58';
import { mockConsole } from '$lib/server/test/mock-console';
import { PolicyStore } from '$lib/sim-page/policy-store.svelte';
import { spanLens } from '$lib/timeline/lens';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import { SOURCES } from './author';
import { History } from './history';
import { LogStore, type DocStore, type LogStoreOptions } from './log-store.svelte';
import { DS, FakeObject, draftOf, nameChange, renamingAlign, stamped } from './test/commits';
import { MOVE_LABEL, MOVE_SOURCE, type Align, type Stopped } from './types';

const F1 = 'fixture-1';
const F2 = 'fixture-2';

afterEach(() => {
  vi.restoreAllMocks();
});

const zoning = (p: SimPolicy4) => p.kinds.zoning as J[];
const ids = (p: SimPolicy4) => zoning(p).map((z) => z.id as string);
const sorted = (p: SimPolicy4) => ids(p).sort();
const withZ =
  (id: string) =>
  (p: SimPolicy4): SimPolicy4 =>
    doc([...zoning(p), transit(id)], p.kinds.permitting as J[], p.kinds.money as J[]);
/** Two policies with one id: diff refuses it, so the edit is refused 'invalid'. */
const twice = (p: SimPolicy4): SimPolicy4 =>
  doc([transit('d'), transit('d')], p.kinds.permitting as J[], p.kinds.money as J[]);
/** The changes that add policy `id` to a ruleset without it (another tab's edit). */
const addChanges = (id: string): Change[] => diff(ruleset(doc()), ruleset(doc([transit(id)])));
const text = (p: SimPolicy4) => rulesetText({ name: '', policy: p });
const stampOf = (ds: string) => () => ({ datasetVersion: ds, build: 'test' });

/**
 * renamingAlign, and the policy calibrated too: a zoning policy `cal-<to>` first, in place of
 * any other `cal-` one. Idempotent.
 */
function calibratingAlign(known: readonly string[]): Align {
  const rename = renamingAlign(known);
  return (content, to) => {
    const r = rename(content, to);
    if (r === null) return null;
    const want = `cal-${to}`;
    const all = zoning(r.policy);
    const rest = all.filter((z) => !String(z.id).startsWith('cal-'));
    if (all[0]?.id === want && rest.length === all.length - 1) return r;
    const p = r.policy;
    return {
      ...r,
      policy: doc([transit(want), ...rest], p.kinds.permitting as J[], p.kinds.money as J[])
    };
  };
}

function opts(over: Partial<LogStoreOptions> = {}): LogStoreOptions {
  return { db: null, tabId: 'a', stamp: stampOf(DS), ...over };
}

/** A store opened on a new sim. */
async function fresh(over: Partial<LogStoreOptions> = {}): Promise<LogStore> {
  const s = new LogStore(opts(over));
  await s.open(null);
  return s;
}

function accept(obj: FakeObject, d: CommitDraft): Commit {
  const r = obj.append(d);
  if (r.kind !== 'accepted') throw new Error(`expected accepted, got ${r.kind}`);
  return r.commit;
}

/** A store on a known sim whose object holds a start commit on `ds` named 'Start'. */
async function onSim(over: Partial<LogStoreOptions> = {}, ds = DS) {
  const obj = new FakeObject();
  const s = new LogStore(opts(over));
  await s.open(newId());
  accept(obj, draftOf(0, [nameChange('Start')], { datasetVersion: ds }));
  s.receive(s.simId!, obj.commits);
  return { s, obj };
}

/** Another tab's commit, accepted by the object, then received. */
function foreign(s: LogStore, obj: FakeObject, changes: Change[], over: Partial<CommitDraft> = {}) {
  return s.receive(s.simId!, [accept(obj, draftOf(obj.commits.length, changes, over))]);
}

/** A move to `ds` by another tab. */
const moveTo = (ds: string): Partial<CommitDraft> => ({
  kind: 'system',
  source: MOVE_SOURCE,
  label: MOVE_LABEL,
  datasetVersion: ds
});

/** Sends every pending commit in order, as the socket would, and returns what was sent. */
function drain(s: LogStore, obj: FakeObject): CommitDraft[] {
  const sent: CommitDraft[] = [];
  for (let d = s.head(); d !== null; d = s.head()) {
    sent.push(d);
    s.receive(s.simId!, [accept(obj, d)]);
  }
  return sent;
}

const last = (s: LogStore) => s.pending.at(-1)!.draft;

describe('LogStore', () => {
  it('meets DocStore, as PolicyStore<SimPolicy4> does', () => {
    const a: DocStore = new PolicyStore<SimPolicy4>(DEFAULT_POLICY4);
    const b: DocStore = new LogStore(opts());
    const c: Parameters<typeof spanLens>[0] = b;
    expect([a, b, c].every(Boolean)).toBe(true);
  });

  it('does nothing before it is open', () => {
    const s = new LogStore(opts());
    expect(s.ready).toBe(false);
    expect(s.apply(withZ('a'), 'A')).toBe(false);
    expect(s.undo()).toBeNull();
    s.rename('X');
    s.undoTo(doc([transit('r')]), 'R');
    expect(s.pendingCount).toBe(0);
    expect(s.local).toBe('failed');
  });

  it('mints no id before the first edit (I6)', async () => {
    const mintId = vi.fn(newId);
    const s = await fresh({ mintId });
    s.setServerDataset(DS);
    s.settle();
    expect(s.undo()).toBeNull();
    expect(s.apply((p) => p, 'Nothing')).toBe(false);
    expect(s.simId).toBeNull();
    expect(mintId).not.toHaveBeenCalled();
    // A draft is not a commit: still no id.
    expect(s.apply(withZ('a'), 'A', 'k')).toBe(true);
    expect(s.simId).toBeNull();
    expect(mintId).not.toHaveBeenCalled();
    s.settle();
    expect(s.simId).not.toBeNull();
    expect(mintId).toHaveBeenCalled();
  });

  it("shows an edit at once, with the fold's content (I1)", async () => {
    const s = await fresh();
    const before = s.policy;
    const next = withZ('z1')(before);
    expect(s.apply(() => next, 'Add z1')).toBe(true);
    expect(s.policy).not.toBe(before);
    expect(text(s.policy)).toBe(text(toLogForm(next)));
    expect(s.pendingCount).toBe(1);
    expect(s.undoLabel).toBe('Add z1');
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
  });

  it('keeps a coalesced run as one draft until the key changes (R1)', async () => {
    const s = await fresh();
    s.setServerDataset(DS);
    const obj = new FakeObject();
    expect(s.apply(withZ('a'), 'Drag 1', 'k')).toBe(true);
    expect(s.apply(withZ('b'), 'Drag 2', 'k')).toBe(true);
    expect(s.pendingCount).toBe(0);
    expect(s.drafting).toBe(true);
    expect(ids(s.policy)).toEqual(['a', 'b']);
    expect([s.canUndo, s.undoLabel, s.canRedo]).toEqual([true, 'Drag 2', false]);
    expect(s.head()).toBeNull();
    expect(s.apply(withZ('c'), 'Other', 'k2')).toBe(true);
    expect(s.pendingCount).toBe(1);
    expect(s.undoLabel).toBe('Other');
    s.settle();
    const sent = drain(s, obj);
    expect(sent.map((d) => d.label)).toEqual(['Drag 2', 'Other']);
    expect(ids(s.policy)).toEqual(['a', 'b', 'c']);
  });

  it('settles before running a new change, so a refused draft leaves nothing behind (F4)', async () => {
    const { error } = mockConsole('error');
    const s = await fresh();
    expect(s.apply(twice, 'Bad', 'k')).toBe(true);
    expect(ids(s.policy)).toEqual(['d', 'd']);
    const seen: SimPolicy4[] = [];
    const ok = s.apply((p) => {
      seen.push(p);
      return withZ('z1')(p);
    }, 'Good');
    expect(ok).toBe(true);
    expect(error).toHaveBeenCalledExactlyOnceWith('[sim-store] edit refused');
    expect(ids(seen[0])).toEqual([]);
    expect(s.pendingCount).toBe(1);
    expect(ids(s.policy)).toEqual(['z1']);
    expect(s.undoLabel).toBe('Good');
  });

  it('commits an open draft on settle (R1)', async () => {
    const s = await fresh();
    s.apply(withZ('a'), 'A', 'k');
    const shown = s.policy;
    s.settle();
    expect(s.drafting).toBe(false);
    expect(s.pendingCount).toBe(1);
    expect(s.pending[0].draft.label).toBe('A');
    // Decision 4: the object shown is kept when the fold equals it.
    expect(s.policy).toBe(shown);
    s.settle();
    expect(s.pendingCount).toBe(1);
  });

  it('undoes and redoes with restore commits named for the change (R10, R11)', async () => {
    const s = await fresh();
    s.setServerDataset(DS);
    const obj = new FakeObject();
    s.apply(withZ('z1'), 'A');
    const pA = s.policy;
    s.apply(withZ('z2'), 'B');
    expect(s.undoLabel).toBe('B');
    expect(s.undo()).toBe('B');
    expect(text(s.policy)).toBe(text(pA));
    expect([s.canRedo, s.redoLabel, s.undoLabel]).toEqual([true, 'B', 'A']);
    expect(s.redo()).toBe('B');
    expect(ids(s.policy)).toEqual(['z1', 'z2']);
    expect(s.canRedo).toBe(false);
    const sent = drain(s, obj);
    expect(sent.map((d) => [d.kind, d.label, d.source, d.restores])).toEqual([
      ['edit', 'A', SOURCES.edit, null],
      ['edit', 'B', SOURCES.edit, null],
      ['restore', 'B', SOURCES.undo, { position: 1, as: 'undo' }],
      ['restore', 'B', SOURCES.redo, { position: 2, as: 'redo' }]
    ]);
    // Over confirmed commits too.
    expect(s.undo()).toBe('B');
    expect(ids(s.policy)).toEqual(['z1']);
  });

  it('skips an undo target that, aligned, is what is shown, and undoes the next one', async () => {
    const { s, obj } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    foreign(s, obj, addChanges('a'), { label: 'A' });
    // Another tab's edit on F1 names the sim as align would: undoing it, aligned, is no change.
    foreign(s, obj, [nameChange('Start @fixture-1')], { datasetVersion: F1, label: 'Rename' });
    s.setServerDataset(F1);
    expect([s.canUndo, s.undoLabel]).toEqual([true, 'A']);
    expect(s.undo()).toBe('A');
    expect(s.pending.map((p) => [p.draft.kind, p.draft.restores])).toEqual([
      ['restore', { position: 1, as: 'undo' }]
    ]);
    expect([ids(s.policy), s.name, s.refusal]).toEqual([[], 'Start @fixture-1', null]);
  });

  it('has no undo when the only target, aligned, is what is shown', async () => {
    const s = new LogStore(opts({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) }));
    const sim = newId();
    await s.open(sim);
    const obj = new FakeObject();
    // A system commit empties the undo stack: the rename on F1 is the only change to undo.
    const start = { kind: 'system', source: SOURCES.import } as const;
    accept(obj, draftOf(0, [nameChange('Start'), ...addChanges('a')], start));
    accept(obj, draftOf(1, [nameChange('Start @fixture-1')], { datasetVersion: F1 }));
    s.receive(sim, obj.commits);
    s.setServerDataset(F1);
    expect([s.canUndo, s.undoLabel, s.undo()]).toEqual([false, null, null]);
    expect(s.pendingCount).toBe(0);
  });

  it('undo commits an open draft, then undoes it', async () => {
    const s = await fresh();
    s.apply(withZ('a'), 'A');
    s.apply(withZ('d'), 'Drag', 'k');
    expect(s.undoLabel).toBe('Drag');
    expect(s.undo()).toBe('Drag');
    expect(s.drafting).toBe(false);
    expect(ids(s.policy)).toEqual(['a']);
    expect(s.pending.map((p) => p.draft.kind)).toEqual(['edit', 'edit', 'restore']);
    expect(s.redoLabel).toBe('Drag');
  });

  it('undoTo a document it showed is a jump, and clears redo (R14)', async () => {
    const s = await fresh();
    s.apply(withZ('z1'), 'A');
    const pA = s.policy;
    s.apply(withZ('z2'), 'B');
    s.apply(withZ('z3'), 'C');
    s.undo();
    expect(s.canRedo).toBe(true);
    s.undoTo(pA, 'Back');
    expect(s.canRedo).toBe(false);
    expect(ids(s.policy)).toEqual(['z1']);
    const d = last(s);
    expect([d.kind, d.label, d.source, d.restores]).toEqual([
      'restore',
      'Back',
      SOURCES.revert,
      { position: 1, as: 'jump' }
    ]);
    // A document shown now is where the log is: nothing to do.
    const n = s.pendingCount;
    s.undoTo(s.policy, 'Again');
    expect(s.pendingCount).toBe(n);
  });

  it('undoTo a document whose commit was dropped is an edit', async () => {
    const s = await fresh();
    s.setServerDataset(DS);
    s.apply(withZ('z1'), 'A');
    const pA = s.policy;
    s.apply(withZ('z2'), 'B');
    s.dropPending(s.head()!.id);
    expect(ids(s.policy)).toEqual(['z2']);
    s.undoTo(pA, 'Back');
    expect(ids(s.policy)).toEqual(['z1']);
    expect([last(s).kind, last(s).source, last(s).label]).toEqual(['edit', SOURCES.revert, 'Back']);
  });

  it('undoTo an unknown document is an edit', async () => {
    const s = await fresh();
    s.apply(withZ('z1'), 'A');
    s.undoTo(doc([transit('q')]), 'Set');
    expect(ids(s.policy)).toEqual(['q']);
    expect([last(s).kind, last(s).label, last(s).restores]).toEqual(['edit', 'Set', null]);
  });

  it('renames with a name commit', async () => {
    const s = await fresh();
    s.apply(withZ('z1'), 'A');
    const before = s.policy;
    s.rename('Harbor');
    expect(s.name).toBe('Harbor');
    expect(s.policy).toBe(before);
    expect([last(s).kind, last(s).label, last(s).source]).toEqual(['edit', 'Rename', SOURCES.name]);
    expect(last(s).changes).toEqual([nameChange('Harbor')]);
    expect(s.undo()).toBe('Rename');
    expect(s.name).not.toBe('Harbor');
  });

  it('runs normalize on every apply', async () => {
    const normalize = vi.fn((next: SimPolicy4) => withZ('n')(next));
    const s = await fresh({ normalize });
    const p0 = s.policy;
    expect(s.apply(withZ('a'), 'A')).toBe(true);
    expect(normalize).toHaveBeenLastCalledWith(expect.anything(), p0);
    expect(ids(s.policy)).toEqual(['a', 'n']);
    s.apply(withZ('b'), 'B', 'k');
    s.apply(withZ('c'), 'C', 'k');
    expect(normalize).toHaveBeenCalledTimes(3);
    expect(ids(s.policy)).toEqual(['a', 'n', 'b', 'n', 'c', 'n']);
    // A normalize that gives back the document shown is no change.
    const keep = await fresh({ normalize: (_next, prev) => prev });
    expect(keep.apply(withZ('a'), 'A')).toBe(false);
    expect(keep.pendingCount).toBe(0);
  });

  it('returns false and keeps the object when an edit after a draft is refused', async () => {
    const { error } = mockConsole('error');
    const s = await fresh();
    s.apply(withZ('a'), 'A', 'k');
    const shown = s.policy;
    expect(s.apply(twice, 'Bad')).toBe(false);
    expect(s.policy).toBe(shown);
    expect(s.refusal).toBe('invalid');
    expect(s.pendingCount).toBe(1);
    expect(error).toHaveBeenCalledExactlyOnceWith('[sim-store] edit refused');
    // The next edit that is not refused clears it.
    expect(s.apply(withZ('b'), 'B')).toBe(true);
    expect(s.refusal).toBeNull();
  });

  it('shows the fold after a foreign commit, its own pending on top (R16)', async () => {
    const { s, obj } = await onSim();
    s.apply(withZ('z1'), 'A');
    foreign(s, obj, addChanges('z9'));
    expect(sorted(s.policy)).toEqual(['z1', 'z9']);
    expect(s.name).toBe('Start');
    expect(s.pendingCount).toBe(1);
    expect(s.pending[0].draft.parent).toBe(2);
  });

  it('a foreign commit ends an open draft', async () => {
    const { s, obj } = await onSim();
    s.setServerDataset(DS);
    s.apply(withZ('a'), 'A');
    s.apply(withZ('d'), 'Drag', 'k');
    // Its own commit coming back does not end the draft.
    s.receive(s.simId!, [accept(obj, s.head()!)]);
    expect(s.drafting).toBe(true);
    foreign(s, obj, addChanges('z9'));
    expect(s.drafting).toBe(false);
    expect(s.pendingCount).toBe(1);
    expect(s.pending[0].draft.label).toBe('Drag');
    expect(sorted(s.policy)).toEqual(['a', 'd', 'z9']);
  });

  it('drops a refused pending commit and reports it', async () => {
    const s = await fresh();
    s.setServerDataset(DS);
    s.apply(withZ('z1'), 'A');
    s.apply(withZ('z2'), 'B');
    const a = s.head()!;
    s.dropPending(a.id);
    expect(s.drops).toEqual([{ id: a.id, label: 'A', whole: true, why: 'invalid', dropped: [] }]);
    expect(s.pendingCount).toBe(1);
    expect(ids(s.policy)).toEqual(['z2']);
    s.clearDrops();
    expect(s.drops).toEqual([]);
    // An id in neither pending nor held: nothing at all.
    const shown = s.policy;
    s.dropPending('not-pending');
    expect(s.pendingCount).toBe(1);
    expect([s.drops, s.policy, s.stopped]).toEqual([[], shown, null]);
  });

  it('refuses an edit past the pending cap with queue-full', async () => {
    const s = await fresh({ caps: { count: 2, bytes: 1e9 } });
    expect(s.apply(withZ('a'), 'A')).toBe(true);
    expect(s.apply(withZ('b'), 'B')).toBe(true);
    const before = s.policy;
    expect(s.apply(withZ('c'), 'C')).toBe(false);
    expect(s.refusal).toBe('queue-full');
    expect(s.policy).toBe(before);
    expect(s.pendingCount).toBe(2);
  });

  it('refuses an edit that does not fold and keeps the policy', async () => {
    const { error } = mockConsole('error');
    const s = await fresh();
    const before = s.policy;
    expect(s.apply(twice, 'Bad')).toBe(false);
    expect(s.policy).toBe(before);
    expect(s.refusal).toBe('invalid');
    expect(s.pendingCount).toBe(0);
    expect(s.simId).toBeNull();
    expect(error).toHaveBeenCalledExactlyOnceWith('[sim-store] edit refused');
  });

  it('moves the sim before the first edit when the page is known current (R55)', async () => {
    const align = calibratingAlign([DS, F1]);
    const { s, obj } = await onSim({ stamp: stampOf(F1), align });
    expect(s.stopped).toBe('unknown-dataset');
    s.setServerDataset(F1);
    expect(s.stopped).toBeNull();
    expect(s.pendingCount).toBe(0);
    expect(s.canUndo).toBe(false);
    const seen: SimPolicy4[] = [];
    expect(
      s.apply((p) => {
        seen.push(p);
        return withZ('z1')(p);
      }, 'Add')
    ).toBe(true);
    // The change ran on the aligned policy, and the alignment survives the edit.
    expect(seen.map(ids)).toEqual([['cal-fixture-1']]);
    expect(s.name).toBe('Start @fixture-1');
    expect(ids(s.policy)).toEqual(['cal-fixture-1', 'z1']);
    expect(s.pending.map((p) => [p.draft.kind, p.draft.source, p.draft.datasetVersion])).toEqual([
      ['system', MOVE_SOURCE, F1],
      ['edit', SOURCES.edit, F1]
    ]);
    const sent = drain(s, obj);
    expect(sent).toHaveLength(2);
    expect([s.canUndo, s.undoLabel, s.name]).toEqual([true, 'Add', 'Start @fixture-1']);
    expect(ids(s.policy)).toEqual(['cal-fixture-1', 'z1']);
  });

  it('reads without moving: a hello on another dataset authors nothing (R55, I6)', async () => {
    const { s } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    s.setServerDataset(F1);
    expect(s.pendingCount).toBe(0);
    expect(s.name).toBe('Start');
  });

  it('a refused move refuses the edit', async () => {
    const { error } = mockConsole('error');
    const { s } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS]) });
    s.setServerDataset(F1);
    const before = s.policy;
    expect(s.apply(withZ('z1'), 'Add')).toBe(false);
    expect(s.refusal).toBe('invalid');
    expect(s.pendingCount).toBe(0);
    expect(s.policy).toBe(before);
    expect(error).toHaveBeenCalledExactlyOnceWith('[sim-store] move refused');
  });

  it('a bare move is neither sent nor kept', async () => {
    const { error } = mockConsole('error');
    const { s } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    s.setServerDataset(F1);
    const before = s.policy;
    // A change that changes nothing after the move.
    expect(s.apply((p) => p, 'Nothing')).toBe(false);
    expect(s.pendingCount).toBe(0);
    expect(s.policy).toBe(before);
    expect(s.name).toBe('Start');
    // A refused edit after the move.
    expect(s.apply(twice, 'Bad')).toBe(false);
    expect(s.pendingCount).toBe(0);
    expect(error).toHaveBeenCalledExactlyOnceWith('[sim-store] edit refused');
    // A draft: the move waits behind it, unsent, and goes when the draft changes nothing.
    expect(s.apply((p) => structuredClone(p), 'Same', 'k')).toBe(true);
    expect(s.pendingCount).toBe(1);
    expect(s.pending[0].draft.source).toBe(MOVE_SOURCE);
    expect(s.head()).toBeNull();
    s.settle();
    expect(s.pendingCount).toBe(0);
    expect(s.name).toBe('Start');
    expect(s.head()).toBeNull();
    // A draft that changes something takes the move with it.
    s.apply(withZ('z1'), 'Add', 'k');
    s.settle();
    expect(s.pending.map((p) => p.draft.source)).toEqual([MOVE_SOURCE, SOURCES.edit]);
    expect(s.head()!.source).toBe(MOVE_SOURCE);
  });

  it('a refused move stops the store until a commit is applied', async () => {
    const { s, obj } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    s.setServerDataset(F1);
    s.apply(withZ('z1'), 'Add');
    const move = s.head()!;
    expect(move.source).toBe(MOVE_SOURCE);
    s.dropPending(move.id);
    expect(s.stopped).toBe('stale');
    expect(s.drops).toEqual([]);
    expect(s.head()).toBeNull();
    expect(s.apply(withZ('z2'), 'More')).toBe(false);
    expect(s.pending.every((p) => p.draft.id !== move.id)).toBe(true);
    foreign(s, obj, addChanges('z9'));
    expect(s.stopped).toBeNull();
    expect(s.head()).not.toBeNull();
  });

  it('a refused move stops the store until the server dataset changes', async () => {
    const { s } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    s.setServerDataset(F1);
    s.apply(withZ('z1'), 'Add');
    s.dropPending(s.head()!.id);
    expect(s.stopped).toBe('stale');
    s.setServerDataset(F1);
    expect(s.stopped).toBe('stale');
    s.setServerDataset(F2);
    s.setServerDataset(F1);
    expect(s.stopped).toBeNull();
  });

  it('never authors while the log holds anything', async () => {
    let page = DS;
    const { s, obj } = await onSim({
      stamp: () => ({ datasetVersion: page, build: 'test' }),
      align: renamingAlign([DS])
    });
    s.apply(withZ('z1'), 'A');
    expect(s.undo()).toBe('A');
    expect(s.pendingCount).toBe(2);
    // The undo's target, the start commit, is on DS; the fold moves to F1, which align cannot
    // reach: the undo is held. The decision alone would be edit (page and fold on F1).
    page = F1;
    foreign(s, obj, [nameChange('Moved')], moveTo(F1));
    expect(s.pendingCount).toBe(1);
    expect(s.stopped).toBe('unknown-dataset');
    expect(s.apply(withZ('z2'), 'B')).toBe(false);
    s.rename('R');
    expect(s.pendingCount).toBe(1);
    s.setServerDataset(F2);
    expect(s.stopped).toBe('stale');
    expect(s.apply(withZ('z2'), 'B')).toBe(false);
    expect(s.pendingCount).toBe(1);
  });

  it('stops as unknown-dataset on another dataset before a hello, and edits after it', async () => {
    const { s } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    expect(s.stopped).toBe('unknown-dataset');
    expect(s.apply(withZ('z1'), 'Add')).toBe(false);
    expect(s.pendingCount).toBe(0);
    s.setServerDataset(F1);
    expect(s.stopped).toBeNull();
    expect(s.apply(withZ('z1'), 'Add')).toBe(true);
    expect(s.pendingCount).toBe(2);
  });

  it('stops as stale after a foreign move to another dataset, keeping its pending unsent', async () => {
    const { s, obj } = await onSim();
    s.apply(withZ('z1'), 'A');
    s.setServerDataset(F1);
    expect(s.stopped).toBeNull();
    foreign(s, obj, [nameChange('Moved')], moveTo(F1));
    expect(s.stopped).toBe('stale');
    expect(s.head()).toBeNull();
    expect(s.pendingCount).toBe(1);
    expect(s.pending[0].draft.datasetVersion).toBe(F1);
  });

  it('appends one alignment commit when re-applied pending would still change under align', async () => {
    const { s, obj } = await onSim({ align: renamingAlign([DS]) });
    s.setServerDataset(DS);
    expect(s.pendingCount).toBe(0);
    s.apply(withZ('z1'), 'A');
    expect(s.pendingCount).toBe(1);
    foreign(s, obj, addChanges('z9'));
    expect(s.pending.map((p) => [p.draft.kind, p.draft.source, p.draft.datasetVersion])).toEqual([
      ['edit', SOURCES.edit, DS],
      ['system', MOVE_SOURCE, DS]
    ]);
    expect(s.name).toBe('Start @fixture-0');
    foreign(s, obj, addChanges('z8'));
    expect(s.pendingCount).toBe(2);
    expect(drain(s, obj).map((d) => d.source)).toEqual([SOURCES.edit, MOVE_SOURCE]);
    expect(s.name).toBe('Start @fixture-0');
    expect(sorted(s.policy)).toEqual(['z1', 'z8', 'z9']);
  });

  it('settles an open draft before an alignment commit, so the draft cannot undo it', async () => {
    const { s, obj } = await onSim({ align: calibratingAlign([DS]) });
    s.setServerDataset(DS);
    s.apply(withZ('a'), 'A');
    s.apply(withZ('b'), 'B');
    s.apply(withZ('d'), 'Drag', 'k');
    // A's echo leaves B pending: the alignment step runs, with the draft open.
    s.receive(s.simId!, [accept(obj, s.head()!)]);
    expect(s.drafting).toBe(false);
    expect(s.pending.map((p) => p.draft.label)).toEqual(['B', 'Drag', MOVE_LABEL]);
    expect(ids(s.policy)).toEqual(['cal-fixture-0', 'a', 'b', 'd']);
    expect(s.name).toBe('Start @fixture-0');
  });

  it('makes no move commit when align changes nothing, and stamps the edit (R55)', async () => {
    const { s, obj } = await onSim({ stamp: stampOf(F1) });
    s.setServerDataset(F1);
    expect(s.apply(withZ('z1'), 'Add')).toBe(true);
    expect(s.pending.map((p) => [p.draft.source, p.draft.datasetVersion])).toEqual([
      [SOURCES.edit, F1]
    ]);
    expect(drain(s, obj)).toHaveLength(1);
    expect(s.canUndo).toBe(true);
  });

  it("edits offline a sim on the page's dataset, and a sim with no commits", async () => {
    const { s } = await onSim();
    expect(s.stopped).toBeNull();
    expect(s.apply(withZ('z1'), 'A')).toBe(true);
    expect(s.pendingCount).toBe(1);
    expect(s.head()).toBeNull();
    const n = await fresh();
    expect(n.stopped).toBeNull();
    expect(n.apply(withZ('z1'), 'A')).toBe(true);
    expect(n.pendingCount).toBe(1);
  });

  it("offers nothing to send before the server's dataset is known", async () => {
    const s = await fresh();
    s.apply(withZ('z1'), 'A');
    expect(s.head()).toBeNull();
    s.setServerDataset(DS);
    expect(s.head()).toBe(s.pending[0].draft);
    expect(s.local).toBe('failed');
  });

  async function stoppedStore(why: Stopped): Promise<LogStore> {
    if (why === 'unknown-dataset') {
      return (await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) })).s;
    }
    const { s, obj } = await onSim();
    s.setServerDataset(DS);
    s.apply(withZ('z1'), 'A');
    s.apply(withZ('z2'), 'B');
    s.undo();
    expect([s.canUndo, s.canRedo]).toEqual([true, true]);
    if (why === 'future') {
      const seq = obj.commits.length + 1;
      s.receive(s.simId!, [
        stamped(draftOf(seq - 1, addChanges('z9'), { shapes: SHAPES_REVISION + 1 }), seq)
      ]);
    } else {
      s.setServerDataset(F1);
      foreign(s, obj, [nameChange('Moved')], moveTo(F1));
    }
    return s;
  }

  it.each(['future', 'stale', 'unknown-dataset'] as const)(
    'authors nothing while stopped (%s)',
    async (why) => {
      const s = await stoppedStore(why);
      expect(s.stopped).toBe(why);
      const policy = s.policy;
      const n = s.pendingCount;
      expect(s.apply(withZ('q'), 'Q')).toBe(false);
      expect(s.apply(withZ('q'), 'Q', 'k')).toBe(false);
      expect(s.drafting).toBe(false);
      expect(s.undo()).toBeNull();
      expect(s.redo()).toBeNull();
      s.undoTo(doc([transit('u')]), 'U');
      s.rename('R');
      s.settle();
      expect(s.pendingCount).toBe(n);
      expect(s.policy).toBe(policy);
      expect([s.canUndo, s.canRedo, s.undoLabel, s.redoLabel]).toEqual([false, false, null, null]);
      expect(s.head()).toBeNull();
    }
  );

  it('derives canUndo and undoLabel once per change, not per read', async () => {
    const s = await fresh();
    s.apply(withZ('a'), 'A');
    s.apply(withZ('b'), 'B');
    s.undo();
    const spy = vi.spyOn(History.prototype, 'undo', 'get');
    for (let i = 0; i < 100; i++) {
      void [s.canUndo, s.undoLabel, s.canRedo, s.redoLabel, s.policy, s.stopped];
    }
    expect(spy).toHaveBeenCalledTimes(0);
    s.apply(withZ('c'), 'C');
    expect(spy).toHaveBeenCalled();
    expect(s.undoLabel).toBe('C');
  });

  it('tells subscribers after every change', async () => {
    const s = await fresh();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.apply(withZ('a'), 'A');
    s.setServerDataset(DS);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.apply(withZ('b'), 'B');
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(s.written()).resolves.toBeUndefined();
  });

  it('tells subscribers once per call, after the state is final', async () => {
    let page = DS;
    const { s } = await onSim({ stamp: () => ({ datasetVersion: page, build: 'test' }) });
    const seen: (Stopped | null)[] = [];
    s.subscribe(() => seen.push(s.stopped));
    s.apply(withZ('a'), 'A', 'k');
    expect(seen).toEqual([null]);
    // The page's dataset moves under it: the settle that finds the store stopped (and then
    // reports the draft) tells once, with the final state.
    page = F1;
    s.settle();
    expect(seen).toEqual([null, 'unknown-dataset']);
    expect(s.refusal).toBe('stopped');
  });
});

describe('LogStore: a draft when the store stops (fix round 1)', () => {
  it('commits an open draft before a refused move stops the store, and keeps it', async () => {
    const { s } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    s.setServerDataset(F1);
    s.apply(withZ('a'), 'A');
    const move = s.head()!;
    s.apply(withZ('d'), 'Drag', 'k');
    s.dropPending(move.id);
    expect(s.stopped).toBe('stale');
    expect(s.drafting).toBe(false);
    expect(s.refusal).toBeNull();
    expect(s.pending.map((p) => p.draft.label)).toEqual(expect.arrayContaining(['A', 'Drag']));
    expect(sorted(s.policy)).toEqual(['a', 'd']);
  });

  it('commits an open draft before a hello that stops the store, and keeps it', async () => {
    const { s } = await onSim({ stamp: stampOf(F1), align: renamingAlign([DS, F1]) });
    s.setServerDataset(F1);
    s.apply(withZ('a'), 'A');
    s.apply(withZ('d'), 'Drag', 'k');
    s.setServerDataset(F2);
    expect(s.stopped).toBe('stale');
    expect(s.drafting).toBe(false);
    expect(s.refusal).toBeNull();
    expect(s.pending.map((p) => p.draft.label)).toEqual(['A', 'Drag']);
    expect(sorted(s.policy)).toEqual(['a', 'd']);
  });

  it('commits an open draft before a newer-build commit stops the store, and keeps it', async () => {
    const { s, obj } = await onSim();
    s.setServerDataset(DS);
    s.apply(withZ('d'), 'Drag', 'k');
    const seq = obj.commits.length + 1;
    s.receive(s.simId!, [
      stamped(draftOf(seq - 1, addChanges('z9'), { shapes: SHAPES_REVISION + 1 }), seq)
    ]);
    expect(s.stopped).toBe('future');
    expect(s.drafting).toBe(false);
    expect(s.pending.map((p) => p.draft.label)).toEqual(['Drag']);
    expect(ids(s.policy)).toEqual(['d']);
  });

  it('reports a draft it can only settle once stopped, and shows the fold', async () => {
    let page = DS;
    const { s } = await onSim({ stamp: () => ({ datasetVersion: page, build: 'test' }) });
    s.apply(withZ('d'), 'Drag', 'k');
    page = F1;
    s.settle();
    expect(s.drafting).toBe(false);
    expect(s.refusal).toBe('stopped');
    expect(s.pendingCount).toBe(0);
    expect(ids(s.policy)).toEqual([]);
  });

  it('settles an open draft before opening another sim', async () => {
    const mintId = vi.fn(newId);
    const s = await fresh({ mintId });
    s.apply(withZ('d'), 'Drag', 'k');
    expect(mintId).not.toHaveBeenCalled();
    await s.open(newId());
    // The draft became a commit of the new sim it was made on (its id and the sim's minted).
    expect(mintId).toHaveBeenCalledTimes(2);
    expect(s.drafting).toBe(false);
  });

  it('opens another sim unstopped after a newer-build stop', async () => {
    const { s, obj } = await onSim();
    const seq = obj.commits.length + 1;
    s.receive(s.simId!, [
      stamped(draftOf(seq - 1, addChanges('z9'), { shapes: SHAPES_REVISION + 1 }), seq)
    ]);
    expect(s.stopped).toBe('future');
    await s.open(newId());
    expect(s.stopped).toBeNull();
    expect(s.apply(withZ('a'), 'A')).toBe(true);
  });
});

describe('LogStore: undo over a draft that does not land (fix round 1)', () => {
  it('a draft that changes nothing is undone by itself; the change before it stays', async () => {
    const s = await fresh();
    s.apply(withZ('z1'), 'Zoning');
    s.apply((p) => structuredClone(p), 'Height', 'k');
    expect(s.undoLabel).toBe('Height');
    expect(s.undo()).toBe('Height');
    expect(s.drafting).toBe(false);
    expect(s.pendingCount).toBe(1);
    expect(ids(s.policy)).toEqual(['z1']);
    expect(s.undoLabel).toBe('Zoning');
  });

  it('a refused draft stops the undo there, with the refusal', async () => {
    const s = await fresh();
    s.apply(withZ('z1'), 'Zoning');
    const big = { ...transit('big'), preset: 'x'.repeat(1_100_000) };
    s.apply(
      (p) => doc([...zoning(p), big], p.kinds.permitting as J[], p.kinds.money as J[]),
      'Height',
      'k'
    );
    expect(s.undo()).toBeNull();
    expect(s.refusal).toBe('too-large');
    expect(s.pendingCount).toBe(1);
    expect(ids(s.policy)).toEqual(['z1']);
  });

  it('redo while a draft is open does nothing (the draft is an edit that clears redo)', async () => {
    const s = await fresh();
    s.apply(withZ('z1'), 'A');
    s.undo();
    s.apply(withZ('d'), 'Drag', 'k');
    expect(s.canRedo).toBe(false);
    expect(s.redo()).toBeNull();
    expect(s.drafting).toBe(true);
  });
});
