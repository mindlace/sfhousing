import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIM_NAME,
  LogError,
  LogState,
  SHAPES_REVISION,
  diff,
  fold,
  parseCommitDraft,
  rulesetText,
  undoRedo,
  type Commit,
  type CommitDraft,
  type Restores,
  type Ruleset,
  type RulesetContent
} from '$lib/sim-log';
import { doc, ruleset, transit, twoVersionRegistry } from '$lib/sim-log/test/fixtures';
import { LIMITS, STAMP_MAX, fitsCommit, utf8Bytes } from '$lib/sim-stream/limits';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { CHECKPOINTS_MAX, CHECKPOINT_SPACING, LocalLog, PENDING_CHECKPOINT } from './local-log';
import { DS, FakeObject, draftOf, nameChange, renamingAlign, stamped } from './test/commits';
import { MOVE_LABEL, MOVE_SOURCE, type Align, type DropReport, type Pending } from './types';
import { datasetDecision } from './dataset';

const EMPTY = ruleset(DEFAULT_POLICY4);
const F1 = 'fixture-1';
const F2 = 'fixture-2';
const FUTURE = SHAPES_REVISION + 1;

type Z = ReturnType<typeof transit>;
const zoning = (r: RulesetContent): Z[] => r.policy.kinds.zoning as Z[];
const withZoning = (r: RulesetContent, z: Z[]): RulesetContent => ({
  name: r.name,
  policy: doc(z, r.policy.kinds.permitting, r.policy.kinds.money)
});
const withZ = (r: RulesetContent, id: string) => withZoning(r, [...zoning(r), transit(id)]);
const withoutZ = (r: RulesetContent, id: string) =>
  withZoning(
    r,
    zoning(r).filter((p) => p.id !== id)
  );
const relabel = (r: RulesetContent, id: string, label: string) =>
  withZoning(
    r,
    zoning(r).map((p) => (p.id === id ? { ...p, label } : p))
  );
const addZ = (r: RulesetContent, id: string) => diff(r, withZ(r, id));
const ids = (r: RulesetContent) => zoning(r).map((p) => p.id);
const own = (draft: CommitDraft, targetId: string | null = null): Pending => ({ draft, targetId });
const text = (r: RulesetContent) => rulesetText(r);
const MOVE = { kind: 'system', source: MOVE_SOURCE, label: MOVE_LABEL } as const;

/** The object's fold. */
const objR = (o: FakeObject): Ruleset => fold(o.commits);

/** Appends a draft the object must accept. */
function accept(o: FakeObject, d: CommitDraft): Commit {
  const r = o.append(d);
  if (r.kind !== 'accepted') throw new Error(`expected accepted, got ${JSON.stringify(r)}`);
  return r.commit;
}

/** A foreign commit at the object's tip: `f` of its fold. */
function foreign(
  o: FakeObject,
  f: (r: RulesetContent) => RulesetContent,
  over: Partial<CommitDraft> = {}
): Commit {
  const r = objR(o);
  return accept(o, draftOf(o.commits.length, diff(r, f(r)), over));
}

/** Pushes an edit on the log taking its fold to `f` of it. */
function editOn(
  log: LocalLog,
  f: (r: RulesetContent) => RulesetContent,
  over: Partial<CommitDraft> = {}
): CommitDraft {
  const r = log.ruleset();
  const d = draftOf(log.position, diff(r, f(r)), over);
  log.push(own(d));
  return d;
}

/** The ruleset at `position`, aligned to the fold's dataset with `align` when given. */
function restoreTarget(log: LocalLog, position: number, align?: Align): RulesetContent {
  const s = log.ruleset().datasetVersion ?? DS;
  const at = log.rulesetAt(position);
  return align && at.datasetVersion !== null && at.datasetVersion !== s ? align(at, s)! : at;
}

/** True when a restore of `position` would change the fold. */
const restores = (log: LocalLog, position: number, align?: Align) =>
  text(restoreTarget(log, position, align)) !== text(log.ruleset());

/** Pushes a restore of `position`, aligned to the fold's dataset with `align` when given. */
function restoreOn(
  log: LocalLog,
  position: number,
  as: Restores['as'],
  align?: Align,
  over: Partial<CommitDraft> = {}
): CommitDraft {
  const cur = log.ruleset();
  const s = cur.datasetVersion ?? DS;
  const target = restoreTarget(log, position, align);
  const d = draftOf(log.position, diff(cur, target), {
    kind: 'restore',
    restores: { position, as },
    label: `restore ${position}`,
    datasetVersion: s,
    ...over
  });
  log.push(own(d, log.idAt(position)));
  return d;
}

/** A log over a fresh object holding one commit that adds policy `a` (on `ds`). */
function start(init: Partial<ConstructorParameters<typeof LocalLog>[0]> = {}, ds = DS) {
  const o = new FakeObject();
  const c1 = accept(o, draftOf(0, addZ(EMPTY, 'a'), { label: 'A', datasetVersion: ds }));
  const log = new LocalLog({ confirmed: [c1], pending: [], ...init });
  return { o, c1, log };
}

describe('LocalLog', () => {
  it('exports the checkpoint constants', () => {
    expect([CHECKPOINT_SPACING, CHECKPOINTS_MAX, PENDING_CHECKPOINT]).toEqual([256, 64, 32]);
  });

  it('folds confirmed then pending (R16)', () => {
    const { c1, log } = start();
    const p = editOn(log, (r) => withZ(r, 'b'));
    expect(ids(log.ruleset())).toEqual(['a', 'b']);
    expect(text(log.ruleset())).toBe(text(fold([c1, p])));
    expect([log.tipSeq, log.position, log.pending.length]).toEqual([1, 2, 1]);
    expect(log.pendingBytes).toBe(utf8Bytes(JSON.stringify(p)));
    expect(log.ruleset()).toBe(log.ruleset());
    const again = new LocalLog({ confirmed: [c1], pending: [own(p)] });
    expect(text(again.ruleset())).toBe(text(log.ruleset()));
    expect(again.initialDrops).toEqual([]);
    expect(again.initialConfirmed).toEqual([]);
    expect(again.pending[0]).toEqual(own(p));
  });

  it('confirms its own head without re-applying', () => {
    const { o, log } = start();
    const p = editOn(log, (r) => withZ(r, 'b'));
    const shown = log.ruleset();
    const back = accept(o, p);
    expect(log.receive([back])).toEqual({ kind: 'applied', changed: false, drops: [] });
    expect(log.pending).toEqual([]);
    expect(log.tipSeq).toBe(2);
    expect(log.pendingBytes).toBe(0);
    expect(log.ruleset()).toBe(shown);
  });

  it('re-applies when the commit with its head id carries other changes (decision 7)', () => {
    const { log } = start();
    const p = editOn(log, (r) => withZ(withZ(r, 'b'), 'c'));
    const q = editOn(log, (r) => withZ(r, 'd'));
    // Another tab sent an older version of the same record: only b.
    const other = stamped({ ...p, changes: addZ(log.rulesetAt(1), 'b') }, 2);
    expect(log.receive([other])).toEqual({ kind: 'applied', changed: true, drops: [] });
    expect(log.pending.map((x) => [x.draft.id, x.draft.parent])).toEqual([[q.id, 2]]);
    expect(ids(log.ruleset())).toEqual(['a', 'b', 'd']);
  });

  it('re-applies pending on a foreign commit (R18)', () => {
    const { o, log } = start();
    const p = editOn(log, (r) => withZ(r, 'b'));
    const f = foreign(o, (r) => withZ(r, 'c'));
    expect(log.receive([f])).toEqual({ kind: 'applied', changed: true, drops: [] });
    expect(log.pending[0].draft).toMatchObject({ id: p.id, parent: 2 });
    expect(ids(log.ruleset()).sort()).toEqual(['a', 'b', 'c']);
    expect(o.append(log.pending[0].draft).kind).toBe('accepted');
  });

  it('reports a pending change whose item is gone (R19)', () => {
    const { o, log } = start();
    const c2 = foreign(o, (r) => withZ(r, 'b'));
    log.receive([c2]);
    const p = editOn(log, (r) => relabel(relabel(r, 'a', 'A'), 'b', 'B'), { label: 'Labels' });
    const f = foreign(o, (r) => withoutZ(r, 'b'));
    const out = log.receive([f]);
    const index = p.changes.findIndex((c) => c.key === 'p:b');
    expect(out).toEqual({
      kind: 'applied',
      changed: true,
      drops: [
        {
          id: p.id,
          label: 'Labels',
          whole: false,
          why: null,
          dropped: [{ index, change: p.changes[index], why: 'gone' }]
        }
      ]
    });
    expect(log.pending[0].draft.changes).toHaveLength(1);
    expect(zoning(log.ruleset()).map((z) => z.label)).toEqual(['A']);
  });

  it('drops a pending commit left empty and reports it', () => {
    const { o, log } = start();
    const p = editOn(log, (r) => withoutZ(r, 'a'), { label: 'Remove a' });
    const f = foreign(o, (r) => withoutZ(r, 'a'));
    expect(log.receive([f])).toEqual({
      kind: 'applied',
      changed: false,
      drops: [
        {
          id: p.id,
          label: 'Remove a',
          whole: true,
          why: 'empty',
          dropped: [{ index: 0, change: p.changes[0], why: 'gone' }]
        }
      ]
    });
    expect(log.pending).toEqual([]);
    expect(log.position).toBe(2);
  });

  it('recomputes a pending restore against the new tip', () => {
    const { o, log } = start();
    const e1 = editOn(log, (r) => withZ(r, 'b'));
    const u = restoreOn(log, 1, 'undo');
    expect(ids(log.ruleset())).toEqual(['a']);
    const f = foreign(o, (r) => withZ(r, 'c'));
    expect(log.receive([f]).kind).toBe('applied');
    expect(log.pending.map((p) => p.draft.id)).toEqual([e1.id, u.id]);
    expect(log.pending[1].draft).toMatchObject({
      parent: 3,
      restores: { position: 1, as: 'undo' }
    });
    expect(text(log.ruleset())).toBe(text(log.rulesetAt(1)));
    expect(o.append(log.pending[0].draft).kind).toBe('accepted');
    expect(o.append(log.pending[1].draft).kind).toBe('accepted');
  });

  it('moves a restore whose target is pending', () => {
    const { o, log } = start();
    const e1 = editOn(log, (r) => withZ(r, 'b'));
    editOn(log, (r) => withZ(r, 'd'));
    const u = restoreOn(log, 2, 'undo');
    expect(log.pending[2].targetId).toBe(e1.id);
    log.receive([foreign(o, (r) => withZ(r, 'c'))]);
    expect(log.pending[2].draft.id).toBe(u.id);
    expect(log.pending[2].draft.restores).toEqual({ position: 3, as: 'undo' });
    expect(log.positionOf(e1.id)).toBe(3);
    expect(text(log.ruleset())).toBe(text(log.rulesetAt(3)));
    expect(ids(log.ruleset()).sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops a pending restore whose target was dropped', () => {
    const { o, log } = start();
    const e1 = editOn(log, (r) => withoutZ(r, 'a'));
    const e2 = editOn(log, (r) => withZ(r, 'b'));
    const u = restoreOn(log, 2, 'undo');
    const out = log.receive([foreign(o, (r) => withoutZ(r, 'a'))]);
    expect(out.kind === 'applied' && out.drops).toEqual([
      expect.objectContaining({ id: e1.id, whole: true, why: 'empty' }),
      { id: u.id, label: u.label, whole: true, why: 'target-gone', dropped: [] }
    ]);
    expect(log.pending.map((p) => p.draft.id)).toEqual([e2.id]);
    expect(ids(log.ruleset())).toEqual(['b']);
  });

  it('aligns a restore whose target is on another dataset', () => {
    const align = renamingAlign([DS, F1]);
    const o = new FakeObject();
    const c1 = accept(o, draftOf(0, addZ(EMPTY, 'a')));
    const r1 = objR(o);
    const c2 = accept(o, draftOf(1, diff(r1, align(r1, F1)!), { ...MOVE, datasetVersion: F1 }));
    const log = new LocalLog({ confirmed: [c1, c2], pending: [], align });
    editOn(log, (r) => withZ(r, 'b'), { datasetVersion: F1 });
    restoreOn(log, 1, 'jump', align);
    log.receive([foreign(o, (r) => withZ(r, 'c'), { datasetVersion: F1 })]);
    const r = log.ruleset();
    expect(ids(r)).toEqual(['a']);
    expect(r.name).toBe(`${DEFAULT_SIM_NAME} @${F1}`);
    expect(r.datasetVersion).toBe(F1);
    expect(log.pending[1].draft).toMatchObject({ datasetVersion: F1, parent: 4 });
    expect(log.pending[1].draft.restores).toEqual({ position: 1, as: 'jump' });
  });

  it("re-stamps a re-applied commit with the fold's dataset (I11)", () => {
    const { o, log } = start({}, F1);
    editOn(log, (r) => withZ(r, 'b'), { datasetVersion: F1 });
    log.receive([foreign(o, (r) => withZ(r, 'c'), { datasetVersion: F2 })]);
    expect(log.pending[0].draft.datasetVersion).toBe(F2);
    expect(log.ruleset().datasetVersion).toBe(F2);
  });

  it("never re-stamps a commit onto an older dataset than the fold's (I11)", () => {
    const align = renamingAlign([DS, F1, F2]);
    const { o, log } = start({ align, serverDataset: F2 });
    const m = editOn(log, (r) => align(r, F1)!, { ...MOVE, datasetVersion: F1 });
    const e = editOn(log, (r) => withZ(r, 'b'), { datasetVersion: F1 });
    expect(log.ruleset().datasetVersion).toBe(F1);
    const f = foreign(o, (r) => align(r, F2)!, { ...MOVE, datasetVersion: F2 });
    expect(log.receive([f])).toEqual({ kind: 'applied', changed: true, drops: [] });
    expect(log.pending.map((p) => p.draft.id)).toEqual([e.id]);
    expect(log.positionOf(m.id)).toBeNull();
    expect(log.pending[0].draft.datasetVersion).toBe(F2);
    expect(log.ruleset().datasetVersion).toBe(F2);
    expect(log.ruleset().name).toBe(`${DEFAULT_SIM_NAME} @${F2}`);
  });

  it("keeps a pending move while the server's dataset is unknown, drops it once known to differ", () => {
    const align = renamingAlign([DS, F1]);
    const { o, log } = start({ align });
    expect(log.serverDataset).toBeNull();
    const m = editOn(log, (r) => align(r, F1)!, { ...MOVE, datasetVersion: F1 });
    const e = editOn(log, (r) => withZ(r, 'b'), { datasetVersion: F1 });
    log.receive([foreign(o, (r) => withZ(r, 'c'))]);
    expect(log.pending.map((p) => p.draft.id)).toEqual([m.id, e.id]);
    expect(log.pending[0].draft).toMatchObject({ parent: 2, datasetVersion: F1 });
    expect(log.ruleset()).toMatchObject({ datasetVersion: F1, name: `${DEFAULT_SIM_NAME} @${F1}` });
    const shown = log.ruleset();
    expect(log.setServerDataset(F1)).toEqual({ changed: false, drops: [] });
    expect(log.ruleset()).toBe(shown);
    expect(log.setServerDataset(DS)).toEqual({ changed: true, drops: [] });
    expect(log.serverDataset).toBe(DS);
    expect(log.pending.map((p) => p.draft.id)).toEqual([e.id]);
    expect(log.pending[0].draft).toMatchObject({ parent: 2, datasetVersion: DS });
    expect(log.ruleset()).toMatchObject({ datasetVersion: DS, name: DEFAULT_SIM_NAME });
  });

  it("keeps an alignment on the fold's own dataset when the server's differs", () => {
    const align = renamingAlign([DS, F1]);
    const { o, log } = start({ align, serverDataset: F2 }, F1);
    const a = editOn(log, (r) => align(r, F1)!, { ...MOVE, datasetVersion: F1 });
    log.receive([foreign(o, (r) => withZ(r, 'c'), { datasetVersion: F1 })]);
    expect(log.pending.map((p) => p.draft.id)).toEqual([a.id]);
    expect(log.setServerDataset(DS).drops).toEqual([]);
    expect(log.pending.map((p) => p.draft.id)).toEqual([a.id]);
    expect(log.ruleset()).toMatchObject({ datasetVersion: F1, name: `${DEFAULT_SIM_NAME} @${F1}` });
  });

  it('recomputes a pending move over a foreign commit, and drops it when empty', () => {
    const align = renamingAlign([DS, F1]);
    const { o, log } = start({ align });
    const m = editOn(log, (r) => align(r, F1)!, { ...MOVE, datasetVersion: F1 });
    log.receive([foreign(o, (r) => withZ(r, 'c'))]);
    expect(log.pending[0].draft).toMatchObject({
      id: m.id,
      parent: 2,
      datasetVersion: F1,
      changes: m.changes
    });
    const out = log.receive([foreign(o, (r) => align(r, F1)!, { ...MOVE, datasetVersion: F1 })]);
    expect(out).toEqual({ kind: 'applied', changed: false, drops: [] });
    expect(log.pending).toEqual([]);
    expect(log.ruleset().datasetVersion).toBe(F1);
  });

  it("stamps a recomputed restore or move with this build's shapes and build", () => {
    // Revision 2 is current; a delete or a name set reads the same under revision 1.
    const registry = twoVersionRegistry();
    const align = renamingAlign([DS, F1]);
    const c1 = stamped(draftOf(0, addZ(EMPTY, 'a'), { shapes: 2 }), 1);
    const log = new LocalLog({ confirmed: [c1], pending: [], registry, align, build: 'b2' });
    const old = { shapes: 1, build: 'b1' };
    const e0 = editOn(log, (r) => withZ(r, 'b'), { shapes: 2, build: 'b1' });
    const u = restoreOn(log, 1, 'undo', undefined, old);
    const m = editOn(log, (r) => align(r, F1)!, { ...MOVE, datasetVersion: F1, ...old });
    expect(log.pending.map((p) => p.draft.shapes)).toEqual([2, 1, 1]);
    const f = stamped(draftOf(1, addZ(log.rulesetAt(1), 'c'), { shapes: 2 }), 2);
    expect(log.receive([f]).kind).toBe('applied');
    const [e, u2, m2] = log.pending.map((p) => p.draft);
    expect(e).toMatchObject({ shapes: 2, build: 'b1' });
    expect(u2).toMatchObject({ id: u.id, shapes: 2, build: 'b2' });
    expect(m2).toMatchObject({ id: m.id, shapes: 2, build: 'b2' });
    // Without a build the draft keeps its own.
    const loaded = [own(e0), own(u, c1.id), own(m)];
    const plain = new LocalLog({ confirmed: [c1, f], pending: loaded, registry, align });
    expect(plain.pending.map((p) => [p.draft.shapes, p.draft.build])).toEqual([
      [2, 'b1'],
      [2, 'b1'],
      [2, 'b1']
    ]);
  });

  it('drops a re-applied commit that has grown past fitsCommit', () => {
    const limits = { ...LIMITS, commitBytes: STAMP_MAX + 2_000 };
    const { o, log } = start({ limits });
    editOn(log, (r) => withZ(r, 'b'));
    restoreOn(log, 0, 'jump');
    const u = restoreOn(log, 2, 'undo');
    expect(fitsCommit(u, limits)).toBe(true);
    // The undo now re-adds a, b and the foreign policies (five come to 1,917 bytes; six pass).
    const f = foreign(o, (r) => withZ(withZ(withZ(withZ(r, 'w'), 'x'), 'y'), 'z'));
    const out = log.receive([f]);
    expect(out.kind === 'applied' && out.drops).toEqual([
      { id: u.id, label: u.label, whole: true, why: 'too-large', dropped: [] }
    ]);
    expect(log.pending).toHaveLength(2);
    expect(ids(log.ruleset())).toEqual([]);
  });

  it('drops a re-applied commit that no longer parses', () => {
    const { c1 } = start();
    const p = draftOf(1, addZ(fold([c1]), 'b'), { source: 'Bad Source' });
    const log = new LocalLog({ confirmed: [c1], pending: [own(p)] });
    expect(log.initialDrops).toEqual([
      { id: p.id, label: p.label, whole: true, why: 'invalid', dropped: [] }
    ]);
    expect(log.pending).toEqual([]);
  });

  it('answers gap with the in-order prefix applied and its drops (R27)', () => {
    const { o, log } = start();
    const p = editOn(log, (r) => withoutZ(r, 'a'));
    const f2 = foreign(o, (r) => withZ(withoutZ(r, 'a'), 'c'));
    const f3 = foreign(o, (r) => withZ(r, 'd'));
    const f4 = foreign(o, (r) => withZ(r, 'e'));
    expect(log.receive([f2, f4])).toEqual({
      kind: 'gap',
      after: 2,
      changed: true,
      drops: [expect.objectContaining({ id: p.id, whole: true, why: 'empty' })]
    });
    expect(log.tipSeq).toBe(2);
    expect(log.confirmed.map((c) => c.id)).toEqual(o.commits.slice(0, 2).map((c) => c.id));
    expect(log.receive([f3, f4])).toEqual({ kind: 'applied', changed: true, drops: [] });
    expect(ids(log.ruleset())).toEqual(['c', 'd', 'e']);
  });

  it('answers stale for commits it holds', () => {
    const { o, c1, log } = start();
    const c2 = foreign(o, (r) => withZ(r, 'b'));
    log.receive([c2]);
    const shown = log.ruleset();
    expect(log.receive([c1, c2])).toEqual({ kind: 'stale' });
    expect(log.receive([])).toEqual({ kind: 'stale' });
    expect(log.ruleset()).toBe(shown);
    expect(log.receive([c2, foreign(o, (r) => withZ(r, 'c'))]).kind).toBe('applied');
  });

  it('stops at a confirmed commit from a newer build, with its drops (I9)', () => {
    const { o, c1, log } = start();
    const p = editOn(log, (r) => withoutZ(r, 'a'));
    const f2 = foreign(o, (r) => withZ(withoutZ(r, 'a'), 'c'));
    const f3 = stamped(draftOf(2, addZ(objR(o), 'd'), { shapes: FUTURE }), 3);
    const f4 = stamped(draftOf(3, [nameChange('x')]), 4);
    expect(log.future).toBe(false);
    expect(log.receive([f2, f3, f4])).toEqual({
      kind: 'future',
      changed: true,
      drops: [expect.objectContaining({ id: p.id, why: 'empty' })]
    });
    expect([log.tipSeq, log.future]).toEqual([2, true]);
    expect(ids(log.ruleset())).toEqual(['c']);
    expect(log.receive([f3, f4])).toEqual({ kind: 'future', changed: false, drops: [] });
    const loaded = new LocalLog({ confirmed: [c1, f2, f3, f4], pending: [] });
    expect([loaded.tipSeq, loaded.future, loaded.confirmed.length]).toEqual([2, true, 2]);
  });

  it('holds a pending commit from a newer build and those after it, untouched (I9)', () => {
    const { o, c1 } = start();
    const r1 = objR(o);
    const p1 = own(draftOf(1, addZ(r1, 'b')));
    const r2 = withZ(r1, 'b');
    const pf = own(draftOf(2, addZ(r2, 'c'), { shapes: FUTURE }));
    const p3 = own(draftOf(3, addZ(withZ(r2, 'c'), 'd')));
    const log = new LocalLog({ confirmed: [c1], pending: [p1, pf, p3] });
    expect(log.future).toBe(true);
    expect(log.held).toEqual([pf, p3]);
    expect(log.held[0]).toBe(pf);
    expect(log.held[1]).toBe(p3);
    expect(log.pending.map((p) => p.draft.id)).toEqual([p1.draft.id]);
    expect(ids(log.ruleset())).toEqual(['a', 'b']);
    expect(log.initialDrops).toEqual([]);
    log.receive([foreign(o, (r) => withZ(r, 'x'))]);
    expect(log.held[0]).toBe(pf);
    expect(log.held[1]).toBe(p3);
    expect(log.pending[0].draft.parent).toBe(2);
    expect(log.positionOf(pf.draft.id)).toBeNull();
  });

  it('holds a pending restore and a pending move from a newer build', () => {
    const { c1 } = start();
    const r1 = fold([c1]);
    const u = own(
      draftOf(1, diff(r1, EMPTY), {
        kind: 'restore',
        restores: { position: 0, as: 'jump' },
        shapes: FUTURE
      }),
      null
    );
    const a = new LocalLog({ confirmed: [c1], pending: [u] });
    expect([a.future, a.held[0], a.pending.length]).toEqual([true, u, 0]);
    const align = renamingAlign([DS, F1]);
    const m = own(
      draftOf(1, diff(r1, align(r1, F1)!), { ...MOVE, datasetVersion: F1, shapes: FUTURE })
    );
    const b = new LocalLog({ confirmed: [c1], pending: [m], align });
    expect([b.future, b.held[0], b.pending.length]).toEqual([true, m, 0]);
    expect(b.initialDrops).toEqual([]);
  });

  it('holds a re-applied restore whose align returns null, with what follows', () => {
    const align = renamingAlign([DS, F1]);
    const o = new FakeObject();
    const c1 = accept(o, draftOf(0, addZ(EMPTY, 'a')));
    const r1 = objR(o);
    const c2 = accept(o, draftOf(1, diff(r1, align(r1, F1)!), { ...MOVE, datasetVersion: F1 }));
    const full = new LocalLog({ confirmed: [c1, c2], pending: [], align });
    editOn(full, (r) => withZ(r, 'b'), { datasetVersion: F1 });
    restoreOn(full, 1, 'jump', align);
    editOn(full, (r) => withZ(r, 'd'), { datasetVersion: F1 });
    const [e1, j, e3] = full.pending;
    const log = new LocalLog({
      confirmed: [c1, c2],
      pending: [e1, j, e3],
      align: renamingAlign([DS])
    });
    expect(log.initialDrops).toEqual([]);
    expect(log.future).toBe(false);
    expect(log.pending).toEqual([e1]);
    expect(log.held).toEqual([j, e3]);
    expect(log.held[0]).toBe(j);
    expect(ids(log.ruleset())).toEqual(['a', 'b']);
  });

  it('removes loaded pending that are already confirmed (I5)', () => {
    const { o, c1 } = start();
    const p1 = draftOf(1, addZ(objR(o), 'b'));
    const c2 = accept(o, p1);
    const p2 = draftOf(2, addZ(objR(o), 'c'));
    const log = new LocalLog({ confirmed: [c1, c2], pending: [own(p1), own(p2)] });
    expect(log.initialConfirmed).toEqual([p1.id]);
    expect(log.initialDrops).toEqual([]);
    expect(log.pending).toEqual([own(p2)]);
    expect(ids(log.ruleset())).toEqual(['a', 'b', 'c']);
  });

  it('re-applies loaded pending made on an older tip', () => {
    const { o, c1 } = start();
    const p = draftOf(1, addZ(objR(o), 'b'));
    const f = foreign(o, (r) => withZ(r, 'c'));
    const log = new LocalLog({ confirmed: [c1, f], pending: [own(p)] });
    expect(log.pending[0].draft).toMatchObject({ id: p.id, parent: 2 });
    expect(ids(log.ruleset()).sort()).toEqual(['a', 'b', 'c']);
    expect(o.append(log.pending[0].draft).kind).toBe('accepted');
  });

  it('refuses confirmed commits that are not seq 1 to n in order', () => {
    const { o, c1 } = start();
    const c2 = foreign(o, (r) => withZ(r, 'b'));
    expect(() => new LocalLog({ confirmed: [c2], pending: [] })).toThrow(RangeError);
    expect(() => new LocalLog({ confirmed: [c2, c1], pending: [] })).toThrow(RangeError);
  });

  it('folds any confirmed position from checkpoints', () => {
    const t0 = performance.now();
    const commits = Array.from({ length: 600 }, (_, i) =>
      stamped(draftOf(i, [nameChange(`n${i + 1}`)]), i + 1)
    );
    const log = new LocalLog({ confirmed: commits, pending: [] });
    for (const k of [0, 1, 255, 256, 257, 511, 512, 600])
      expect(log.rulesetAt(k).name).toBe(k === 0 ? DEFAULT_SIM_NAME : `n${k}`);
    expect(() => log.rulesetAt(601)).toThrow(RangeError);
    expect(() => log.rulesetAt(-1)).toThrow(RangeError);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  it('folds any confirmed position once the spacing has doubled', () => {
    const t0 = performance.now();
    const n = CHECKPOINT_SPACING * CHECKPOINTS_MAX + 300;
    const commits = Array.from({ length: n }, (_, i) =>
      stamped(draftOf(i, [nameChange(`n${i + 1}`)]), i + 1)
    );
    const log = new LocalLog({ confirmed: commits.slice(0, n - 100), pending: [] });
    expect(log.receive(commits.slice(n - 100)).kind).toBe('applied');
    for (const k of [0, 255, 256, 257, 512, 513, 16_383, 16_384, 16_385, n - 1, n])
      expect(log.rulesetAt(k).name).toBe(k === 0 ? DEFAULT_SIM_NAME : `n${k}`);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });

  it('folds any pending position from pending checkpoints', () => {
    const t0 = performance.now();
    const o = new FakeObject();
    const log = new LocalLog({ confirmed: [], pending: [] });
    const drafts: CommitDraft[] = [];
    for (let k = 1; k <= 70; k++) {
      const d = draftOf(log.position, [nameChange(`n${k}`)]);
      log.push(own(d));
      drafts.push(d);
    }
    const name = (k: number) => (k === 0 ? DEFAULT_SIM_NAME : `n${k}`);
    for (let k = 0; k <= 70; k++) expect(log.rulesetAt(k).name).toBe(name(k));
    expect(() => log.rulesetAt(71)).toThrow(RangeError);
    // Its own first five come back: the checkpoints follow the shifted positions.
    const back = drafts.slice(0, 5).map((d) => accept(o, d));
    expect(log.receive(back)).toEqual({ kind: 'applied', changed: false, drops: [] });
    for (let k = 0; k <= 70; k++) expect(log.rulesetAt(k).name).toBe(name(k));
    // A foreign commit at 6: every pending is re-applied one place later.
    log.receive([foreign(o, (r) => withZ(r, 'a'))]);
    const shifted = (k: number) => (k <= 5 ? name(k) : name(k - 1));
    for (let k = 0; k <= 71; k++) expect(log.rulesetAt(k).name).toBe(shifted(k));
    expect(ids(log.rulesetAt(6))).toEqual(['a']);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  it('refuses a push whose parent is not the position', () => {
    const { log } = start();
    expect(() => log.push(own(draftOf(0, addZ(log.ruleset(), 'b'))))).toThrow(RangeError);
    expect(() => log.push(own(draftOf(2, addZ(log.ruleset(), 'b'))))).toThrow(RangeError);
    expect(log.position).toBe(1);
  });

  it('refuses a push that does not fold', () => {
    const { log } = start();
    editOn(log, (r) => withZ(r, 'b'));
    const shown = log.ruleset();
    const bytes = log.pendingBytes;
    const bad = draftOf(2, [{ op: 'delete', key: 'p:nope' }]);
    expect(() => log.push(own(bad))).toThrow(LogError);
    expect([log.position, log.pending.length, log.pendingBytes]).toEqual([2, 1, bytes]);
    expect(log.ruleset()).toBe(shown);
    expect(log.history().position).toBe(2);
  });

  it('drop re-applies the pending after the dropped one', () => {
    const { log } = start();
    const p1 = editOn(log, (r) => withZ(r, 'b'), { label: 'Add b' });
    const p2 = editOn(log, (r) => withZ(r, 'c'));
    expect(log.drop(p1.id)).toEqual([
      { id: p1.id, label: 'Add b', whole: true, why: 'invalid', dropped: [] }
    ]);
    expect(log.pending.map((p) => p.draft.id)).toEqual([p2.id]);
    expect(log.pending[0].draft.parent).toBe(1);
    expect(ids(log.ruleset())).toEqual(['a', 'c']);
    expect(log.drop('unknown')).toEqual([]);
    expect(log.pending).toHaveLength(1);
  });

  it('forget removes without a report; adopt appends after its own', () => {
    const { o, log } = start();
    const p1 = editOn(log, (r) => withZ(r, 'b'));
    // Another tab's two commits, made on the confirmed tip.
    const r1 = objR(o);
    const q1 = draftOf(1, addZ(r1, 'c'));
    const q2 = draftOf(2, addZ(withZ(r1, 'c'), 'd'));
    expect(log.adopt([own(q1), own(q2)])).toEqual({ changed: true, drops: [], confirmed: [] });
    expect(log.pending.map((p) => [p.draft.id, p.draft.parent])).toEqual([
      [p1.id, 1],
      [q1.id, 2],
      [q2.id, 3]
    ]);
    expect(ids(log.ruleset()).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(log.forget([p1.id])).toEqual({ changed: true, drops: [] });
    expect(log.pending.map((p) => [p.draft.id, p.draft.parent])).toEqual([
      [q1.id, 1],
      [q2.id, 2]
    ]);
    expect(ids(log.ruleset())).toEqual(['a', 'c', 'd']);
  });

  it('adopt names the adopted commits it discarded as already confirmed', () => {
    const { o, log } = start();
    const p1 = editOn(log, (r) => withZ(r, 'b'));
    const q1 = draftOf(1, addZ(objR(o), 'c'));
    const done = accept(o, q1);
    const q2 = draftOf(1, addZ(objR(o), 'd'));
    log.receive([done]);
    expect(log.adopt([own(q1), own(q2)])).toEqual({
      changed: true,
      drops: [],
      confirmed: [q1.id]
    });
    expect(log.pending.map((p) => p.draft.id)).toEqual([p1.id, q2.id]);
    expect(log.adopt([own(q1)])).toEqual({ changed: false, drops: [], confirmed: [q1.id] });
  });

  it('restores on the dataset the target is on without align, then moves to the current page first', () => {
    // Confirmed on A; three commits from a session on A; the page is on B.
    const [A, B] = [F1, F2];
    const o = new FakeObject();
    const c1 = accept(o, draftOf(0, addZ(EMPTY, 'a'), { datasetVersion: A }));
    const old = new LocalLog({ confirmed: [c1], pending: [], serverDataset: A });
    const e1 = editOn(old, (r) => withZ(r, 'b'), { datasetVersion: A });
    const u = restoreOn(old, 1, 'undo');
    const e2 = editOn(old, (r) => withZ(r, 'd'), { datasetVersion: A });
    const calls: string[] = [];
    const reachB = renamingAlign([B]);
    const align: Align = (c, to) => {
      calls.push(to);
      return reachB(c, to);
    };
    const log = new LocalLog({ confirmed: [c1], pending: old.pending, align, page: B });
    expect(calls).toEqual([]);
    expect(log.held).toEqual([]);
    expect(log.pending.map((p) => p.draft.id)).toEqual([e1.id, u.id, e2.id]);
    expect(log.ruleset().datasetVersion).toBe(A);
    expect(log.setServerDataset(B)).toEqual({ changed: true, drops: [] });
    const [m, ...rest] = log.pending.map((p) => p.draft);
    expect(m).toMatchObject({
      kind: 'system',
      source: MOVE_SOURCE,
      label: MOVE_LABEL,
      datasetVersion: B,
      parent: 1
    });
    expect(rest.map((d) => [d.id, d.parent, d.datasetVersion])).toEqual([
      [e1.id, 2, B],
      [u.id, 3, B],
      [e2.id, 4, B]
    ]);
    expect(rest[1].restores).toEqual({ position: 1, as: 'undo' });
    expect(log.ruleset()).toMatchObject({ datasetVersion: B, name: `${DEFAULT_SIM_NAME} @${B}` });
    expect(ids(log.ruleset())).toEqual(['a', 'd']);
    for (const p of log.pending) expect(o.append(p.draft).kind).toBe('accepted');
    expect(text(objR(o))).toBe(text(log.ruleset()));
  });

  it('retries a restore held for an unreachable dataset once the page is known current', () => {
    // Confirmed on A0 (DS) then moved to A; a session on A jumped back to A0's position; the page
    // is on B.
    const [A, B] = [F1, F2];
    const o = new FakeObject();
    const c1 = accept(o, draftOf(0, addZ(EMPTY, 'a')));
    const toA = renamingAlign([A]);
    const r1 = objR(o);
    const c2 = accept(o, draftOf(1, diff(r1, toA(r1, A)!), { ...MOVE, datasetVersion: A }));
    const old = new LocalLog({ confirmed: [c1, c2], pending: [], align: toA, serverDataset: A });
    const e1 = editOn(old, (r) => withZ(r, 'b'), { datasetVersion: A });
    const j = restoreOn(old, 1, 'jump', toA);
    const e2 = editOn(old, (r) => withZ(r, 'd'), { datasetVersion: A });
    const records = old.pending;
    const log = new LocalLog({
      confirmed: [c1, c2],
      pending: records,
      align: renamingAlign([B]),
      page: B
    });
    expect(log.pending.map((p) => p.draft.id)).toEqual([e1.id]);
    expect(log.held).toEqual([records[1], records[2]]);
    // Known stale (the server is on another dataset than the page): as before, held.
    expect(log.setServerDataset(A).drops).toEqual([]);
    expect(log.held).toEqual([records[1], records[2]]);
    expect(log.setServerDataset(B).drops).toEqual([]);
    expect(log.held).toEqual([]);
    const [m, ...rest] = log.pending.map((p) => p.draft);
    expect(m).toMatchObject({ source: MOVE_SOURCE, datasetVersion: B, parent: 2 });
    expect(rest.map((d) => [d.id, d.parent, d.datasetVersion])).toEqual([
      [e1.id, 3, B],
      [j.id, 4, B],
      [e2.id, 5, B]
    ]);
    expect(log.ruleset()).toMatchObject({ datasetVersion: B, name: `${DEFAULT_SIM_NAME} @${B}` });
    expect(ids(log.ruleset())).toEqual(['a', 'd']);
    for (const p of log.pending) expect(o.append(p.draft).kind).toBe('accepted');
  });

  it('retries a lone held jump at hello and sends it after the move', () => {
    // The release property's first counterexample: one jump to before a move, nothing else.
    const o = new FakeObject();
    accept(o, draftOf(0, addZ(EMPTY, 'a')));
    const toF1 = renamingAlign([F1]);
    const r1 = objR(o);
    accept(o, draftOf(1, diff(r1, toF1(r1, F1)!), { ...MOVE, datasetVersion: F1 }));
    const old = new LocalLog({ confirmed: o.commits.slice(), pending: [], align: toF1 });
    const j = restoreOn(old, 1, 'jump', toF1);
    const log = new LocalLog({
      confirmed: o.commits.slice(),
      pending: old.pending,
      align: renamingAlign([F2]),
      page: F2
    });
    expect(log.held.map((p) => p.draft.id)).toEqual([j.id]);
    log.setServerDataset(F2);
    expect(log.held).toEqual([]);
    expect(log.pending.map((p) => p.draft.datasetVersion)).toEqual([F2, F2]);
    for (const p of log.pending) expect(o.append(p.draft).kind).toBe('accepted');
    log.receive(o.commits.slice(log.tipSeq));
    expect(log.pending).toEqual([]);
    expect(text(log.ruleset())).toBe(text(objR(o)));
  });

  it('retries a held jump at hello when another writer already moved the tip to the page', () => {
    const o = new FakeObject();
    accept(o, draftOf(0, addZ(EMPTY, 'a')));
    const toF1 = renamingAlign([F1]);
    const r1 = objR(o);
    accept(o, draftOf(1, diff(r1, toF1(r1, F1)!), { ...MOVE, datasetVersion: F1 }));
    const old = new LocalLog({ confirmed: o.commits.slice(), pending: [], align: toF1 });
    editOn(old, (r) => withoutZ(r, 'a'), { datasetVersion: F1 });
    const j = restoreOn(old, 1, 'jump', toF1);
    const toF2 = renamingAlign([F2]);
    const log = new LocalLog({
      confirmed: o.commits.slice(),
      pending: old.pending,
      align: toF2,
      page: F2
    });
    expect(log.held.map((p) => p.draft.id)).toEqual([j.id]);
    // A current writer's move to F2 lands while the server's dataset is still unknown.
    const r2 = objR(o);
    log.receive([accept(o, draftOf(2, diff(r2, toF2(r2, F2)!), { ...MOVE, datasetVersion: F2 }))]);
    expect(log.held.map((p) => p.draft.id)).toEqual([j.id]);
    log.setServerDataset(F2);
    expect(log.held).toEqual([]);
    expect(log.pending.map((p) => [p.draft.id, p.draft.datasetVersion])).toContainEqual([j.id, F2]);
    expect(ids(log.ruleset())).toEqual(['a']);
    for (const p of log.pending) expect(o.append(p.draft).kind).toBe('accepted');
  });

  it('lets go of a held commit once the server confirms it', () => {
    // An earlier page sent the jump; this page opened before hearing it back.
    const o = new FakeObject();
    accept(o, draftOf(0, addZ(EMPTY, 'a')));
    const toF1 = renamingAlign([F1]);
    const r1 = objR(o);
    accept(o, draftOf(1, diff(r1, toF1(r1, F1)!), { ...MOVE, datasetVersion: F1 }));
    const old = new LocalLog({ confirmed: o.commits.slice(), pending: [], align: toF1 });
    editOn(old, (r) => withoutZ(r, 'a'), { datasetVersion: F1 });
    old.receive([accept(o, old.pending[0].draft)]);
    const j = restoreOn(old, 1, 'jump', toF1);
    accept(o, j);
    const log = new LocalLog({
      confirmed: o.commits.slice(0, 3),
      pending: old.pending,
      align: renamingAlign([F2]),
      page: F2
    });
    expect(log.held.map((p) => p.draft.id)).toEqual([j.id]);
    log.receive(o.commits.slice(3));
    expect([log.held, log.pending]).toEqual([[], []]);
    expect(text(log.ruleset())).toBe(text(objR(o)));
  });

  it('moves nothing for a reader with nothing pending', () => {
    const { log } = start({ page: F2, align: renamingAlign([F2]) });
    expect(log.setServerDataset(F2)).toEqual({ changed: false, drops: [] });
    expect([log.pending.length, log.position, log.ruleset().datasetVersion]).toEqual([0, 1, DS]);
  });

  it('maps ids and positions both ways', () => {
    const { c1, log } = start();
    const p1 = editOn(log, (r) => withZ(r, 'b'));
    expect([log.idAt(0), log.idAt(1), log.idAt(2)]).toEqual([null, c1.id, p1.id]);
    expect(() => log.idAt(3)).toThrow(RangeError);
    expect(() => log.idAt(-1)).toThrow(RangeError);
    expect(log.positionOf(null)).toBe(0);
    expect(log.positionOf(c1.id)).toBe(1);
    expect(log.positionOf(p1.id)).toBe(2);
    expect(log.positionOf('unknown')).toBeNull();
  });

  it('gives the history of confirmed then pending', () => {
    const { o, log } = start();
    editOn(log, (r) => withZ(r, 'b'), { label: 'B' });
    expect(log.history().undo).toEqual({ position: 1, label: 'B' });
    expect(log.history().position).toBe(2);
    log.receive([foreign(o, (r) => withZ(r, 'c'), { label: 'C' })]);
    expect(log.history().undo).toEqual({ position: 2, label: 'B' });
    expect(log.history().position).toBe(3);
  });
});

/** One step of the property's script. */
type Step = {
  op: 'edit' | 'undo' | 'foreign' | 'send' | 'recv' | 'skip' | 'one' | 'drop';
  k: number;
};

/** The k-th edit of `r`: add a missing transit policy or remove a present one; some rename too. */
function editOf(r: RulesetContent, k: number): RulesetContent {
  const pick = ['a', 'b', 'c'][k % 3];
  const next = ids(r).includes(pick) ? withoutZ(r, pick) : withZ(r, pick);
  return k % 4 === 3 ? { ...next, name: `N${k}` } : next;
}

/** Every invariant that holds after any public call. */
function checkInvariants(log: LocalLog, o: FakeObject): void {
  const confirmed = log.confirmed;
  expect(confirmed.map((c) => c.id)).toEqual(o.commits.slice(0, log.tipSeq).map((c) => c.id));
  // I3: pending sit on the tip; a restore names its target's current position.
  log.pending.forEach((p, i) => {
    expect(p.draft.parent).toBe(log.tipSeq + i);
    if (p.draft.kind === 'restore')
      expect(p.draft.restores?.position).toBe(log.positionOf(p.targetId));
  });
  // I7: only sendable commits are pending: they parse, fit and fold with check on the tip.
  const s = LogState.empty();
  for (const c of confirmed) s.apply(c);
  expect(text(s.ruleset())).toBe(text(log.rulesetAt(log.tipSeq)));
  for (const p of log.pending) {
    expect(parseCommitDraft(structuredClone(p.draft))).toEqual(p.draft);
    expect(fitsCommit(p.draft)).toBe(true);
    s.apply(p.draft, { check: true });
  }
  // R16: the fold of confirmed then pending.
  expect(text(log.ruleset())).toBe(text(s.ruleset()));
  expect(log.ruleset().datasetVersion).toBe(s.ruleset().datasetVersion);
  expect(log.position).toBe(log.tipSeq + log.pending.length);
  expect(log.pendingBytes).toBe(
    log.pending.reduce((n, p) => n + utf8Bytes(JSON.stringify(p.draft)), 0)
  );
  for (let k = 0; k <= log.position; k++) expect(log.positionOf(log.idAt(k))).toBe(k);
  const entries = [
    ...confirmed,
    ...log.pending.map((p, i) => ({ ...p.draft, seq: log.tipSeq + i + 1 }))
  ];
  const want = undoRedo(entries);
  expect([log.history().undo?.position ?? null, log.history().redo?.position ?? null]).toEqual([
    want.undo,
    want.redo
  ]);
}

describe('LocalLog under any script', () => {
  it('keeps its invariants through edits, undos, foreign commits, echoes and gaps', () => {
    const seen = { partial: 0, whole: 0, targetGone: 0, restoreMoved: 0, echoed: 0, gap: 0 };
    // Edits, undos and foreign commits weighted up, so pending restores meet foreign commits.
    const ops: Step['op'][] = [
      ...['edit', 'edit', 'edit', 'undo', 'undo', 'foreign', 'foreign'],
      ...['send', 'recv', 'skip', 'one', 'drop', 'drop']
    ] as Step['op'][];
    const step = fc.record({ op: fc.constantFrom(...ops), k: fc.nat({ max: 40 }) });
    expect(() =>
      fc.assert(
        fc.property(fc.array(step, { maxLength: 24 }), (script) => {
          const o = new FakeObject();
          const log = new LocalLog({ confirmed: [], pending: [] });
          const counted = new Set<keyof typeof seen>();
          const count = (drops: readonly DropReport[]) => {
            for (const d of drops) {
              counted.add(d.whole ? 'whole' : 'partial');
              if (d.why === 'target-gone') counted.add('targetGone');
            }
          };
          const deliver = (commits: readonly Commit[]) => {
            const before = log.pending.filter((p) => p.draft.kind === 'restore');
            const positions = before.map((p) => p.draft.restores!.position);
            const out = log.receive(commits);
            if (out.kind !== 'stale') count(out.drops);
            if (out.kind === 'gap') counted.add('gap');
            if (out.kind === 'applied' && !out.changed && out.drops.length === 0)
              counted.add('echoed');
            before.forEach((p, i) => {
              const now = log.pending.find((q) => q.draft.id === p.draft.id);
              if (now && now.draft.restores!.position !== positions[i]) counted.add('restoreMoved');
            });
          };
          /** Sends the head; a log caught up with the object only ever has it accepted. */
          const send = () => {
            if (log.pending.length === 0) return;
            const caughtUp = log.tipSeq === o.commits.length;
            const r = o.append(log.pending[0].draft);
            if (caughtUp) expect(r.kind).toBe('accepted');
            // Behind, or sent before and not yet received.
            else
              expect(r.kind === 'duplicate' || (r.kind === 'refused' && r.why === 'behind')).toBe(
                true
              );
          };
          for (const { op, k } of script) {
            if (op === 'edit') {
              const next = editOf(log.ruleset(), k);
              if (text(next) !== text(log.ruleset())) editOn(log, () => next, { label: `E${k}` });
            } else if (op === 'undo') {
              const t = log.history().undo;
              if (t && text(log.rulesetAt(t.position)) !== text(log.ruleset()))
                restoreOn(log, t.position, 'undo', undefined, { label: t.label });
            } else if (op === 'foreign') {
              const r = objR(o);
              const next = editOf(r, k + 1);
              if (text(next) !== text(r)) foreign(o, () => next, { label: `F${k}` });
            } else if (op === 'send') send();
            else if (op === 'recv') deliver(o.commits.slice(log.tipSeq));
            else if (op === 'skip') deliver(o.commits.slice(log.tipSeq + 1));
            else if (op === 'one') deliver(o.commits.slice(log.tipSeq, log.tipSeq + 1));
            else if (op === 'drop' && log.pending.length > 0)
              count(log.drop(log.pending[k % log.pending.length].draft.id));
            checkInvariants(log, o);
          }
          // Drain: send and receive until nothing is pending.
          for (let round = 0; round < 200 && log.pending.length > 0; round++) {
            send();
            deliver(o.commits.slice(log.tipSeq));
          }
          deliver(o.commits.slice(log.tipSeq));
          checkInvariants(log, o);
          expect(log.pending).toEqual([]);
          expect(text(log.ruleset())).toBe(text(objR(o)));
          for (const key of counted) seen[key]++;
        }),
        { numRuns: 1200 }
      )
    ).not.toThrow();
    // Unseeded; over 6 runs of 1,200: echoed 555-595, whole drops 335-393, partial 34-50,
    // gap 24-33, restore moved 13-31, target gone 8-19.
    for (const n of Object.values(seen)) expect(n).toBeGreaterThan(0);
  });

  it('follows a release: pending work from an older page moves to the current page', () => {
    // The sim starts on fixture-0 and was moved to fixture-1; an old page on fixture-1 leaves
    // pending work (jumps included); a release makes fixture-2 current; a new page on
    // fixture-2 opens the records with the server's dataset unknown.
    const [D0, D1, D2] = [DS, F1, F2];
    const oldAlign = renamingAlign([D1]);
    const newAlign = renamingAlign([D2]);
    const seen = { heldAtOpen: 0, restoreAtHello: 0, retried: 0, moved: 0, released: 0 };
    const oldOps = ['edit', 'edit', 'undo', 'jump', 'jump', 'foreign', 'send', 'recv'] as const;
    const newOps = [
      ...['edit', 'edit', 'undo', 'foreign', 'release', 'hello'],
      ...['send', 'recv', 'skip', 'drop']
    ] as const;
    const script = <T>(ops: readonly T[]) =>
      fc.array(fc.record({ op: fc.constantFrom(...ops), k: fc.nat({ max: 40 }) }), {
        maxLength: 12
      });
    expect(() =>
      fc.assert(
        fc.property(script(oldOps), script(newOps), (before, after) => {
          const counted = new Set<keyof typeof seen>();
          const o = new FakeObject();
          accept(o, draftOf(0, addZ(EMPTY, 'a'), { datasetVersion: D0 }));
          const r1 = objR(o);
          accept(o, draftOf(1, diff(r1, oldAlign(r1, D1)!), { ...MOVE, datasetVersion: D1 }));
          const foreignStep = (k: number) => {
            const r = objR(o);
            const next = editOf(r, k + 1);
            const ds = r.datasetVersion ?? D0;
            if (text(next) !== text(r)) foreign(o, () => next, { datasetVersion: ds });
          };
          // The old page: fold, page and server on fixture-1.
          const old = new LocalLog({
            confirmed: o.commits.slice(),
            pending: [],
            align: oldAlign,
            page: D1,
            serverDataset: D1
          });
          for (const { op, k } of before) {
            if (op === 'edit') {
              const next = editOf(old.ruleset(), k);
              if (text(next) !== text(old.ruleset()))
                editOn(old, () => next, { datasetVersion: D1 });
            } else if (op === 'undo' || op === 'jump') {
              const t = op === 'undo' ? old.history().undo?.position : k % 3 === 0 ? 1 : k;
              const pos = t === undefined ? null : t % (old.position + 1);
              if (pos !== null && restores(old, pos, oldAlign)) restoreOn(old, pos, op, oldAlign);
            } else if (op === 'foreign') foreignStep(k);
            else if (op === 'send' && old.pending.length > 0) o.append(old.pending[0].draft);
            else if (op === 'recv') old.receive(o.commits.slice(old.tipSeq));
            checkInvariants(old, o);
          }
          // The new page opens what was stored: the confirmed commits it had, its pending.
          const log = new LocalLog({
            confirmed: o.commits.slice(0, old.tipSeq),
            pending: old.pending,
            align: newAlign,
            page: D2
          });
          if (log.held.length > 0) counted.add('heldAtOpen');
          const tipDataset = () => log.rulesetAt(log.tipSeq).datasetVersion;
          const current = () => log.serverDataset === D2 && tipDataset() !== D2;
          const hello = () => {
            const heldBefore = log.held.length;
            if (tipDataset() !== D2 && log.pending.some((p) => p.draft.kind === 'restore'))
              counted.add('restoreAtHello');
            log.setServerDataset(D2);
            if (heldBefore > 0 && log.held.length === 0) counted.add('retried');
          };
          const check = () => {
            checkInvariants(log, o);
            // I11 and ruling (b): the fold is on the tip's dataset, or (page current) the page's.
            const ds = log.ruleset().datasetVersion;
            expect(ds === tipDataset() || (log.serverDataset === D2 && ds === D2)).toBe(true);
            if (current()) {
              expect(log.held).toEqual([]);
              const head = log.pending[0]?.draft;
              if (head) expect(head).toMatchObject({ source: MOVE_SOURCE, datasetVersion: D2 });
              if (head) counted.add('moved');
            }
          };
          const send = () => {
            // head() sends nothing before the server's dataset is known (I11).
            if (log.pending.length === 0 || log.serverDataset === null) return;
            const caughtUp = log.tipSeq === o.commits.length;
            const r = o.append(log.pending[0].draft);
            if (caughtUp) expect(r.kind).toBe('accepted');
          };
          let released = false;
          for (const { op, k } of after) {
            const fold = log.ruleset().datasetVersion;
            const decision = datasetDecision(D2, fold, log.serverDataset).kind;
            if (op === 'edit' && decision !== 'stop') {
              if (decision === 'move') {
                const r = log.ruleset();
                const changes = diff(r, newAlign(r, D2)!);
                if (changes.length > 0)
                  log.push(own(draftOf(log.position, changes, { ...MOVE, datasetVersion: D2 })));
              }
              const next = editOf(log.ruleset(), k);
              if (text(next) !== text(log.ruleset()))
                editOn(log, () => next, { datasetVersion: D2 });
            } else if (op === 'undo' && decision === 'edit') {
              const t = log.history().undo;
              if (t && restores(log, t.position, newAlign))
                restoreOn(log, t.position, 'undo', newAlign, { datasetVersion: D2 });
            } else if (op === 'foreign') foreignStep(k);
            else if (op === 'release' && !released) {
              // A current writer moves the sim to fixture-2.
              released = true;
              counted.add('released');
              const r = objR(o);
              const changes = diff(r, newAlign(r, D2)!);
              if (changes.length > 0)
                accept(o, draftOf(o.commits.length, changes, { ...MOVE, datasetVersion: D2 }));
            } else if (op === 'hello') hello();
            else if (op === 'send') send();
            else if (op === 'recv') log.receive(o.commits.slice(log.tipSeq));
            else if (op === 'skip') log.receive(o.commits.slice(log.tipSeq + 1));
            else if (op === 'drop' && log.pending.length > 0)
              log.drop(log.pending[k % log.pending.length].draft.id);
            check();
          }
          hello();
          check();
          for (let round = 0; round < 200 && log.pending.length > 0; round++) {
            send();
            log.receive(o.commits.slice(log.tipSeq));
            check();
          }
          log.receive(o.commits.slice(log.tipSeq));
          check();
          expect([log.pending, log.held]).toEqual([[], []]);
          expect(text(log.ruleset())).toBe(text(objR(o)));
          for (const key of counted) seen[key]++;
        }),
        { numRuns: 300 }
      )
    ).not.toThrow();
    // Unseeded; over 6 runs of 300: a commit held at open 49-68 (every one retried at hello),
    // a pending restore at hello on a tip off fixture-2 75-92, the move first 170-186, a
    // release by another writer 97-117.
    for (const n of Object.values(seen)) expect(n).toBeGreaterThan(0);
  });
});
