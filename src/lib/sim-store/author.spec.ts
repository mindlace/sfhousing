import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIM_NAME,
  LABEL_MAX,
  SHAPES_REVISION,
  diff,
  fold,
  rulesetText,
  toLogForm,
  type CommitDraft,
  type Restores,
  type RulesetContent
} from '$lib/sim-log';
import { doc, open, painted, ruleset, stroke, transit } from '$lib/sim-log/test/fixtures';
import { LIMITS, utf8Bytes } from '$lib/sim-stream/limits';
import { newId } from '$lib/ids/base58';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import {
  PENDING_BYTES_MAX,
  PENDING_MAX,
  SOURCES,
  authorEdit,
  authorMove,
  authorRestore,
  clampLabel,
  nextTarget,
  type Authored,
  type Meta
} from './author';
import { LocalLog } from './local-log';
import { DS, FakeObject, draftOf, nameChange, renamingAlign, stamped } from './test/commits';
import { MOVE_LABEL, MOVE_SOURCE, type Align } from './types';

const EMPTY = ruleset(DEFAULT_POLICY4);
const F1 = 'fixture-1';
const stamp = { datasetVersion: DS, build: 'test' };
const identity: Align = (c) => c;

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
const named = (r: RulesetContent, name: string): RulesetContent => ({ ...r, name });
const ids = (r: RulesetContent) => zoning(r).map((p) => p.id);
const text = (r: RulesetContent) => rulesetText(r);

const meta = (over: Partial<Meta> = {}): Meta => ({
  id: newId(),
  label: 'Edit',
  source: SOURCES.edit,
  stamp,
  ...over
});
const fresh = (init: Partial<ConstructorParameters<typeof LocalLog>[0]> = {}) =>
  new LocalLog({ confirmed: [], pending: [], ...init });

/** Authors an edit to `f` of the fold and requires it accepted. */
function edit(
  log: LocalLog,
  f: (r: RulesetContent) => RulesetContent,
  label = 'Edit'
): CommitDraft {
  const r = authorEdit(log, f(log.ruleset()), meta({ label }));
  if (!r.ok) throw new Error(`expected ok, got ${r.why}`);
  return r.pending.draft;
}

/** What a refusal must leave: the log as it was. */
const snapshot = (log: LocalLog) => [log.position, log.pending.length, log.pendingBytes];

describe('authorEdit', () => {
  it('commits the diff of the editor output in log form (R9)', () => {
    const log = fresh();
    const brush = (id: string, strokes: (typeof stroke)[]) => ({
      id,
      kind: 'paint',
      strokes,
      stories: 5
    });
    const next = withZoning(EMPTY, [
      painted('p', [open({ tag: 'brushes', brushes: [brush('b1', []), brush('b2', [stroke])] })])
    ]);
    const logForm = { name: next.name, policy: toLogForm(next.policy) };
    const r = authorEdit(log, next, meta({ label: 'Paint' }));
    if (!r.ok) throw new Error(r.why);
    const d = r.pending.draft;
    expect(d.changes).toEqual(diff(EMPTY, logForm));
    expect(d).toMatchObject({
      parent: 0,
      kind: 'edit',
      label: 'Paint',
      restores: null,
      datasetVersion: DS,
      shapes: SHAPES_REVISION,
      build: 'test',
      source: 'sim.edit'
    });
    expect(r.pending.targetId).toBeNull();
    expect(log.pending).toEqual([r.pending]);
    expect(text(log.ruleset())).toBe(text(logForm));
  });

  it('authors a system commit when asked', () => {
    const log = fresh();
    const r = authorEdit(log, withZ(EMPTY, 'a'), meta({ source: SOURCES.import }), 'system');
    expect(r.ok && r.pending.draft.kind).toBe('system');
    expect(r.ok && r.pending.draft.source).toBe('sim.import');
  });

  it('answers unchanged for the same ruleset and pushes nothing', () => {
    const log = fresh();
    edit(log, (r) => withZ(r, 'a'));
    const before = snapshot(log);
    expect(authorEdit(log, log.ruleset(), meta())).toEqual({ ok: false, why: 'unchanged' });
    expect(snapshot(log)).toEqual(before);
  });

  it('answers invalid for two policies with one id and pushes nothing', () => {
    const log = fresh();
    const next = withZoning(EMPTY, [transit('a'), transit('a')]);
    expect(authorEdit(log, next, meta())).toEqual({ ok: false, why: 'invalid' });
    expect(snapshot(log)).toEqual([0, 0, 0]);
  });

  it('answers invalid for a source the parser refuses and pushes nothing', () => {
    const log = fresh();
    const r = authorEdit(log, withZ(EMPTY, 'a'), meta({ source: 'Bad Source' }));
    expect(r).toEqual({ ok: false, why: 'invalid' });
    expect(snapshot(log)).toEqual([0, 0, 0]);
  });

  it('answers too-large over the commit limit', () => {
    const log = fresh();
    const next = withZoning(
      EMPTY,
      Array.from({ length: 30 }, (_, i) => transit(`z${i}`))
    );
    const limits = { ...LIMITS, commitBytes: 2_000 };
    expect(authorEdit(log, next, meta({ limits }))).toEqual({ ok: false, why: 'too-large' });
    expect(snapshot(log)).toEqual([0, 0, 0]);
    // The same edit passes under the real limit, so the size was the reason.
    expect(authorEdit(log, next, meta()).ok).toBe(true);
  });

  it('caps the queue at 1,000 commits and 8 MiB by default', () => {
    expect([PENDING_MAX, PENDING_BYTES_MAX]).toEqual([1_000, 8_388_608]);
  });

  it('answers queue-full at the count cap', () => {
    const log = fresh();
    const caps = { count: 3, bytes: 1e9 };
    const results: Authored[] = [];
    for (let i = 0; i < 4; i++)
      results.push(authorEdit(log, named(log.ruleset(), `N${i}`), meta({ caps })));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ ok: false, why: 'queue-full' });
    expect(log.pending.length).toBe(3);
  });

  it('answers queue-full past the byte cap', () => {
    const log = fresh();
    const caps = { count: 1e6, bytes: 1_500 };
    let refused: Authored | null = null;
    const last = meta();
    for (let i = 0; i < 100 && !refused; i++) {
      const r = authorEdit(log, named(log.ruleset(), `N${i}`), { ...last, id: newId(), caps });
      if (!r.ok) refused = r;
      expect(log.pendingBytes).toBeLessThanOrEqual(1_500);
    }
    expect(refused).toEqual({ ok: false, why: 'queue-full' });
    expect(log.pending.length).toBeGreaterThan(1);
    // The refused commit would have passed the cap, and fits without it.
    const again = authorEdit(log, named(log.ruleset(), 'N-last'), meta());
    if (!again.ok) throw new Error(again.why);
    expect(log.pendingBytes - utf8Bytes(JSON.stringify(again.pending.draft))).toBeLessThanOrEqual(
      1_500
    );
    expect(log.pendingBytes).toBeGreaterThan(1_500);
  });
});

describe('clampLabel', () => {
  it('clamps a long label to LABEL_MAX without splitting a surrogate pair', () => {
    expect(LABEL_MAX).toBe(200);
    expect(clampLabel('a'.repeat(300))).toBe('a'.repeat(199) + '…');
    expect(clampLabel('short')).toBe('short');
    // The first 199 units end on a whole pair: kept, then the ellipsis.
    const clamped = clampLabel('x' + '\u{1F600}'.repeat(150));
    expect(clamped).toBe('x' + '\u{1F600}'.repeat(99) + '…');
    expect(clamped.isWellFormed()).toBe(true);
    const log = fresh();
    const r = authorEdit(log, withZ(EMPTY, 'a'), meta({ label: 'y'.repeat(500) }));
    expect(r.ok && r.pending.draft.label).toBe('y'.repeat(199) + '…');
  });

  it('keeps a label exactly at the limit, and cuts one over it to 199 units plus …', () => {
    const at = 'a'.repeat(LABEL_MAX);
    expect(clampLabel(at)).toBe(at);
    const over = clampLabel('b'.repeat(LABEL_MAX + 1));
    expect(over).toBe('b'.repeat(199) + '…');
    expect(over.length).toBe(LABEL_MAX);
  });

  it('never cuts inside a surrogate pair at the cut', () => {
    // Units 198 and 199 are one pair: cut at 199, the high half would be left alone.
    const label = 'x'.repeat(198) + '\u{1F600}' + 'yy';
    expect(label.length).toBe(202);
    const clamped = clampLabel(label);
    expect(clamped).toBe('x'.repeat(198) + '…');
    expect(clamped.isWellFormed()).toBe(true);
    // A pair that ends at unit 198 is kept whole.
    const before = 'x'.repeat(197) + '\u{1F600}' + 'yyy';
    expect(clampLabel(before)).toBe('x'.repeat(197) + '\u{1F600}' + '…');
  });
});

describe('authorRestore and nextTarget', () => {
  it("undoes with a restore whose label is the undone change's (R10)", () => {
    const log = fresh();
    edit(log, (r) => withZ(r, 'a'), 'Add a');
    edit(log, (r) => withZ(r, 'b'), 'Add b');
    const t = nextTarget(log, 'undo', identity, stamp);
    expect(t).toEqual({ position: 1, label: 'Add b' });
    const r = authorRestore(
      log,
      t!.position,
      'undo',
      meta({ label: t!.label, source: SOURCES.undo }),
      identity
    );
    if (!r.ok) throw new Error(r.why);
    expect(r.pending.draft).toMatchObject({
      kind: 'restore',
      label: 'Add b',
      restores: { position: 1, as: 'undo' },
      source: 'sim.undo',
      parent: 2
    });
    expect(r.pending.targetId).toBe(log.idAt(1));
    expect(ids(log.ruleset())).toEqual(['a']);
    expect(text(log.ruleset())).toBe(text(log.rulesetAt(1)));
    expect(nextTarget(log, 'redo', identity, stamp)).toEqual({ position: 2, label: 'Add b' });
  });

  it('walks the spec table of undo and redo', () => {
    const log = fresh();
    for (const id of ['a', 'b', 'c', 'd', 'e']) edit(log, (r) => withZ(r, id), `Add ${id}`);
    expect(nextTarget(log, 'undo', identity, stamp)).toEqual({ position: 4, label: 'Add e' });
    expect(nextTarget(log, 'redo', identity, stamp)).toBeNull();
    const restore = (position: number, as: Restores['as']) => {
      const r = authorRestore(log, position, as, meta({ label: `${as} ${position}` }), identity);
      if (!r.ok) throw new Error(r.why);
    };
    restore(4, 'undo'); // position 6
    expect(ids(log.ruleset())).toEqual(['a', 'b', 'c', 'd']);
    expect(nextTarget(log, 'undo', identity, stamp)?.position).toBe(3);
    expect(nextTarget(log, 'redo', identity, stamp)?.position).toBe(5);
    restore(3, 'undo'); // position 7
    expect(ids(log.ruleset())).toEqual(['a', 'b', 'c']);
    expect(nextTarget(log, 'undo', identity, stamp)?.position).toBe(2);
    expect(nextTarget(log, 'redo', identity, stamp)?.position).toBe(6);
    restore(6, 'redo'); // position 8
    expect(ids(log.ruleset())).toEqual(['a', 'b', 'c', 'd']);
    expect(nextTarget(log, 'undo', identity, stamp)?.position).toBe(7);
    expect(nextTarget(log, 'redo', identity, stamp)?.position).toBe(5);
    edit(log, (r) => withZ(r, 'f'), 'Add f'); // position 9
    expect(ids(log.ruleset())).toEqual(['a', 'b', 'c', 'd', 'f']);
    expect(nextTarget(log, 'undo', identity, stamp)).toEqual({ position: 8, label: 'Add f' });
    expect(nextTarget(log, 'redo', identity, stamp)).toBeNull();
    restore(8, 'undo'); // position 10
    expect(ids(log.ruleset())).toEqual(['a', 'b', 'c', 'd']);
    expect(nextTarget(log, 'undo', identity, stamp)?.position).toBe(7);
  });

  it('skips an undo target equal to the current ruleset', () => {
    // The foreign commit sets the name the local edit set: undoing the local one changes nothing.
    const o = new FakeObject();
    const c1 = o.append(draftOf(0, diff(EMPTY, withZ(EMPTY, 'a')), { label: 'Add a' }));
    if (c1.kind !== 'accepted') throw new Error('c1');
    const log = fresh({ confirmed: [c1.commit] });
    edit(log, (r) => named(r, 'Same'), 'Local name');
    const c2 = o.append(draftOf(1, [nameChange('Same')], { label: 'Foreign name' }));
    if (c2.kind !== 'accepted') throw new Error('c2');
    log.receive([c2.commit]);
    expect(log.pending.length).toBe(1);
    expect(text(log.rulesetAt(2))).toBe(text(log.ruleset()));
    expect(log.history().undo).toEqual({ position: 2, label: 'Local name' });
    expect(nextTarget(log, 'undo', identity, stamp)).toEqual({
      position: 1,
      label: 'Foreign name'
    });
    expect(log.history().undo).toEqual({ position: 2, label: 'Local name' });
  });

  it('answers null when every target equals the current ruleset', () => {
    const log = fresh();
    expect(nextTarget(log, 'undo', identity, stamp)).toBeNull();
    expect(nextTarget(log, 'redo', identity, stamp)).toBeNull();
  });

  describe('a target on another dataset, compared as authorRestore would author it', () => {
    const align = renamingAlign([DS, F1]);
    const onF1 = { datasetVersion: F1, build: 'test' };
    /** DS: Add a, then Add b; then F1: a rename to what align gives (no move between). */
    const log = (): LocalLog => {
      const o = new FakeObject();
      const a = withZ(EMPTY, 'a');
      const ab = withZ(a, 'b');
      for (const [d, label] of [
        [diff(EMPTY, a), 'Add a'],
        [diff(a, ab), 'Add b']
      ] as const) {
        const r = o.append(draftOf(o.commits.length, d, { label }));
        if (r.kind !== 'accepted') throw new Error(label);
      }
      const rename = [nameChange(`${DEFAULT_SIM_NAME} @${F1}`)];
      const r = o.append(draftOf(2, rename, { datasetVersion: F1, label: 'Rename' }));
      if (r.kind !== 'accepted') throw new Error('rename');
      return fresh({ confirmed: o.commits, align });
    };

    it('skips a target whose aligned content is the current fold', () => {
      const l = log();
      // Raw, position 2 differs from the fold by its name; aligned to F1 it is the fold.
      expect(text(l.rulesetAt(2))).not.toBe(text(l.ruleset()));
      expect(nextTarget(l, 'undo', identity, onF1)).toEqual({ position: 2, label: 'Rename' });
      const t = nextTarget(l, 'undo', align, onF1);
      expect(t).toEqual({ position: 1, label: 'Add b' });
      // What it answers, authorRestore authors.
      const r = authorRestore(l, t!.position, 'undo', meta({ stamp: onF1 }), align);
      expect(r.ok).toBe(true);
      expect(ids(l.ruleset())).toEqual(['a']);
    });

    it('answers a target align cannot reach (authorRestore refuses it, visibly)', () => {
      const l = log();
      const onF9 = { datasetVersion: 'fixture-9', build: 'test' };
      expect(nextTarget(l, 'undo', align, onF9)).toEqual({ position: 2, label: 'Rename' });
      expect(authorRestore(l, 2, 'undo', meta({ stamp: onF9 }), align)).toEqual({
        ok: false,
        why: 'invalid'
      });
    });

    it('answers null when the only target, aligned, is the current fold', () => {
      const o = new FakeObject();
      const a = withZ(EMPTY, 'a');
      const s = { kind: 'system', source: SOURCES.import } as const;
      for (const d of [
        draftOf(0, diff(EMPTY, a), s),
        draftOf(1, [nameChange(`${DEFAULT_SIM_NAME} @${F1}`)], { datasetVersion: F1 })
      ]) {
        if (o.append(d).kind !== 'accepted') throw new Error('append');
      }
      const l = fresh({ confirmed: o.commits, align });
      expect(nextTarget(l, 'undo', identity, onF1)?.position).toBe(1);
      expect(nextTarget(l, 'undo', align, onF1)).toBeNull();
    });
  });

  it('restores a jump onto another dataset, aligned (decision 12)', () => {
    const align = renamingAlign([DS, F1]);
    const o = new FakeObject();
    const c1 = o.append(draftOf(0, diff(EMPTY, withZ(EMPTY, 'a')), { label: 'Add a' }));
    if (c1.kind !== 'accepted') throw new Error('c1');
    const moved = named(withZ(withZ(EMPTY, 'a'), 'b'), `${DEFAULT_SIM_NAME} @${F1}`);
    const c2 = o.append(
      draftOf(1, diff(withZ(EMPTY, 'a'), moved), { datasetVersion: F1, label: 'Edit on F1' })
    );
    if (c2.kind !== 'accepted') throw new Error('c2');
    const log = fresh({ confirmed: [c1.commit, c2.commit], align });
    expect(log.ruleset().datasetVersion).toBe(F1);
    const r = authorRestore(
      log,
      1,
      'jump',
      meta({ label: 'Jump', stamp: { datasetVersion: F1, build: 'test' } }),
      align
    );
    if (!r.ok) throw new Error(r.why);
    expect(r.pending.draft).toMatchObject({
      kind: 'restore',
      restores: { position: 1, as: 'jump' },
      datasetVersion: F1
    });
    expect(r.pending.targetId).toBe(c1.commit.id);
    expect(ids(log.ruleset())).toEqual(['a']);
    expect(log.ruleset().name).toBe(`${DEFAULT_SIM_NAME} @${F1}`);
    expect(text(log.ruleset())).toBe(text(align(log.rulesetAt(1), F1)!));
  });

  it('restores position 0: no target id, restores.position 0, the empty ruleset', () => {
    const log = fresh();
    edit(log, (r) => withZ(r, 'a'));
    edit(log, (r) => withZ(r, 'b'));
    const r = authorRestore(log, 0, 'jump', meta({ label: 'Start' }), identity);
    if (!r.ok) throw new Error(r.why);
    expect(r.pending.targetId).toBeNull();
    expect(r.pending.draft).toMatchObject({
      kind: 'restore',
      restores: { position: 0, as: 'jump' },
      parent: 2
    });
    expect(text(log.ruleset())).toBe(text(EMPTY));
  });

  it('does not call align for a target already on the stamp dataset', () => {
    const log = fresh();
    edit(log, (r) => withZ(r, 'a'));
    edit(log, (r) => withZ(r, 'b'));
    const never: Align = () => {
      throw new Error('align called');
    };
    const r = authorRestore(log, 1, 'jump', meta(), never);
    expect(r.ok).toBe(true);
  });

  it('refuses a jump whose target align cannot reach', () => {
    const o = new FakeObject();
    const c1 = o.append(draftOf(0, diff(EMPTY, withZ(EMPTY, 'a'))));
    if (c1.kind !== 'accepted') throw new Error('c1');
    const log = fresh({ confirmed: [c1.commit] });
    edit(log, (r) => withZ(r, 'b'));
    const before = snapshot(log);
    const r = authorRestore(
      log,
      1,
      'jump',
      meta({ stamp: { datasetVersion: F1, build: 'test' } }),
      renamingAlign([DS])
    );
    expect(r).toEqual({ ok: false, why: 'invalid' });
    expect(snapshot(log)).toEqual(before);
  });

  it('answers unchanged for a restore to the current ruleset, invalid out of range', () => {
    const log = fresh();
    edit(log, (r) => withZ(r, 'a'));
    expect(authorRestore(log, 1, 'jump', meta(), identity)).toEqual({
      ok: false,
      why: 'unchanged'
    });
    expect(authorRestore(log, 2, 'jump', meta(), identity)).toEqual({ ok: false, why: 'invalid' });
    expect(authorRestore(log, -1, 'jump', meta(), identity)).toEqual({ ok: false, why: 'invalid' });
    expect(log.position).toBe(1);
  });
});

describe('authorMove', () => {
  const onDs = () => {
    const o = new FakeObject();
    const c1 = o.append(draftOf(0, diff(EMPTY, withZ(EMPTY, 'a'))));
    if (c1.kind !== 'accepted') throw new Error('c1');
    return fresh({ confirmed: [c1.commit] });
  };

  it("authors the move with align's changes, and unchanged when align changes nothing (R55)", () => {
    const align = renamingAlign([DS, F1]);
    const log = onDs();
    const to = { datasetVersion: F1, build: 'test' };
    const r = authorMove(log, align, { id: newId(), stamp: to });
    if (!r.ok) throw new Error(r.why);
    const aligned = align(
      { name: DEFAULT_SIM_NAME, policy: withZ(EMPTY, 'a').policy },
      F1
    ) as RulesetContent;
    expect(r.pending.draft).toMatchObject({
      kind: 'system',
      label: MOVE_LABEL,
      source: MOVE_SOURCE,
      restores: null,
      datasetVersion: F1,
      parent: 1
    });
    expect(r.pending.draft.changes).toEqual(diff(withZ(EMPTY, 'a'), aligned));
    expect(r.pending.targetId).toBeNull();
    expect(log.ruleset().datasetVersion).toBe(F1);
    expect(log.ruleset().name).toBe(`${DEFAULT_SIM_NAME} @${F1}`);
    // Already on F1: nothing to move.
    expect(authorMove(log, align, { id: newId(), stamp: to })).toEqual({
      ok: false,
      why: 'unchanged'
    });
    // Another dataset, with an align that changes nothing.
    const same = onDs();
    expect(authorMove(same, identity, { id: newId(), stamp: to })).toEqual({
      ok: false,
      why: 'unchanged'
    });
    expect(same.pending.length).toBe(0);
  });

  it('aligns the content of a fold already on the stamp dataset', () => {
    const align = renamingAlign([DS]);
    const log = onDs();
    const before = log.ruleset();
    const r = authorMove(log, align, { id: newId(), stamp });
    if (!r.ok) throw new Error(r.why);
    expect(r.pending.draft).toMatchObject({
      kind: 'system',
      label: MOVE_LABEL,
      source: MOVE_SOURCE,
      restores: null,
      datasetVersion: DS,
      parent: 1
    });
    expect(r.pending.draft.changes).toEqual(diff(before, align(before, DS)!));
    expect(log.pending.length).toBe(1);
    expect(log.ruleset().name).toBe(`${DEFAULT_SIM_NAME} @${DS}`);
    expect(authorMove(log, align, { id: newId(), stamp })).toEqual({
      ok: false,
      why: 'unchanged'
    });
  });

  it('answers unchanged on the stamp dataset when align changes nothing', () => {
    const log = onDs();
    expect(authorMove(log, identity, { id: newId(), stamp })).toEqual({
      ok: false,
      why: 'unchanged'
    });
    expect(log.pending.length).toBe(0);
  });

  it('answers invalid on the stamp dataset when align answers null', () => {
    const log = onDs();
    expect(authorMove(log, renamingAlign([F1]), { id: newId(), stamp })).toEqual({
      ok: false,
      why: 'invalid'
    });
    expect(log.pending.length).toBe(0);
  });

  it('refuses a move align cannot reach', () => {
    const log = onDs();
    const r = authorMove(log, renamingAlign([DS]), {
      id: newId(),
      stamp: { datasetVersion: F1, build: 'test' }
    });
    expect(r).toEqual({ ok: false, why: 'invalid' });
    expect(log.pending.length).toBe(0);
  });

  it('answers unchanged on a log with no commits', () => {
    const log = fresh();
    const r = authorMove(log, renamingAlign([DS, F1]), {
      id: newId(),
      stamp: { datasetVersion: F1, build: 'test' }
    });
    expect(r).toEqual({ ok: false, why: 'unchanged' });
  });
});

describe('two writers (I10)', () => {
  it('converges two writers on one order', () => {
    const seen = { behind: 0, invalid: 0, undone: 0, accepted: 0, foreignPending: 0 };
    const op = fc.constantFrom('edit', 'edit', 'edit', 'undo', 'send', 'send', 'recv');
    const step = fc.record({
      op,
      who: fc.constantFrom<'A' | 'B'>('A', 'B'),
      k: fc.nat({ max: 30 })
    });
    expect(() =>
      fc.assert(
        fc.property(fc.array(step, { maxLength: 12 }), (script) => {
          const object = new FakeObject();
          const make = () => ({
            log: fresh(),
            inbox: [] as ReturnType<typeof stamped>[]
          });
          const w = { A: make(), B: make() };
          const send = (x: 'A' | 'B') => {
            const { log } = w[x];
            const head = log.pending[0];
            if (!head) return;
            const r = object.append(head.draft);
            if (r.kind === 'accepted') {
              seen.accepted++;
              w.A.inbox.push(r.commit);
              w.B.inbox.push(r.commit);
            } else if (r.kind === 'refused' && r.why === 'behind') {
              seen.behind++;
              log.receive(object.commits.slice(log.tipSeq));
            } else if (r.kind === 'refused') {
              seen.invalid++;
              log.drop(head.draft.id);
            }
          };
          const recv = (x: 'A' | 'B') => {
            const batch = w[x].inbox.splice(0);
            if (batch.length > 0) w[x].log.receive(batch);
          };
          for (const s of script) {
            const { log } = w[s.who];
            if (s.op === 'edit') {
              const cur = log.ruleset();
              const present = ids(cur);
              const absent = ['a', 'b', 'c'].filter((i) => !present.includes(i));
              const m = s.k % 3;
              let next: RulesetContent;
              if (m === 0 && absent.length > 0) next = withZ(cur, absent[s.k % absent.length]);
              else if (m === 1 && present.length > 0)
                next = withoutZ(cur, present[s.k % present.length]);
              else next = named(cur, `N${s.k}`);
              if (w[s.who === 'A' ? 'B' : 'A'].log.pending.length > 0) seen.foreignPending++;
              authorEdit(log, next, meta());
            } else if (s.op === 'undo') {
              const t = nextTarget(log, 'undo', identity, stamp);
              if (t) {
                const r = authorRestore(
                  log,
                  t.position,
                  'undo',
                  meta({ label: t.label, source: SOURCES.undo }),
                  identity
                );
                if (r.ok) seen.undone++;
              }
            } else if (s.op === 'send') send(s.who);
            else recv(s.who);
          }
          for (let round = 0; round < 200; round++) {
            if (w.A.log.pending.length === 0 && w.B.log.pending.length === 0) break;
            send('A');
            send('B');
            recv('A');
            recv('B');
          }
          recv('A');
          recv('B');
          const order = (x: 'A' | 'B') => w[x].log.confirmed.map((c) => c.id);
          const objectIds = object.commits.map((c) => c.id);
          expect(w.A.log.pending.length + w.B.log.pending.length).toBe(0);
          expect(order('A')).toEqual(objectIds);
          expect(order('B')).toEqual(objectIds);
          expect(text(w.A.log.ruleset())).toBe(text(fold(object.commits)));
          expect(text(w.B.log.ruleset())).toBe(text(fold(object.commits)));
        }),
        { numRuns: 500 }
      )
    ).not.toThrow();
    // The property reaches rebases, refusals and undo, not only straight sends.
    expect(seen.accepted).toBeGreaterThan(0);
    expect(seen.behind).toBeGreaterThan(0);
    expect(seen.undone).toBeGreaterThan(0);
    expect(seen.foreignPending).toBeGreaterThan(0);
  });
});
