import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_SIM_NAME,
  GENESIS_HASH,
  LogError,
  SHAPES_REVISION,
  chainHash,
  fold,
  parseCommit,
  rulesetText,
  verifyChain,
  type CommitDraft,
  type RulesetContent
} from '$lib/sim-log';
import { arbRuleset } from '$lib/sim-log/test/arbitraries';
import { newId } from '$lib/ids/base58';
import { commitsFrame, type RefusedWhy } from '$lib/sim-stream/protocol';
import { LIMITS, STAMP_MAX, fitsCommit, utf8Bytes } from './limits';
import {
  LogHost,
  type AppendOutcome,
  type Author,
  type LogHostOptions,
  type ServerAppend
} from './log-host';
import { IDENTITY_MAX } from './open-params';
import { SimStore, type StoredRow } from './store';
import { draftTo, nameDraft, serverDraft } from './test/drafts';
import { freshSimDb, storeWithRow } from './test/harness';

const T0 = 1_700_000_000_000;
const WRITER: Author = { identity: 'u1', write: true };
const ALL = Number.MAX_SAFE_INTEGER;

function make(opts: LogHostOptions = {}) {
  const { db } = freshSimDb();
  const store = new SimStore(db);
  return { db, store, host: new LogHost(store, opts) };
}

const append = (host: LogHost, d: unknown, now = T0, author = WRITER): Promise<AppendOutcome> =>
  host.append(d, (d as CommitDraft).id ?? null, utf8Bytes(JSON.stringify(d)), author, now);

/** Every frame a resume delivers, page after page; null when it is answered gone. */
async function resumeOf(host: LogHost, after: number): Promise<string[] | null> {
  const pages: (string[] | null)[] = [];
  await host.resume(after, (frames) => {
    pages.push(frames);
  });
  expect(pages.length).toBeGreaterThan(0);
  if (pages.includes(null)) {
    expect(pages).toEqual([null]);
    return null;
  }
  return pages.flat() as string[];
}

const seqsOf = (frames: string[]): number[] =>
  frames.flatMap((f) => JSON.parse(f).commits.map((c: { seq: number }) => c.seq));

const snapshot = (store: SimStore, host: LogHost) => ({
  totals: store.totals(),
  tip: host.tip(),
  rows: store.rowsAfter(0, ALL),
  text: rulesetText(host.ruleset())
});

/** I1, I2, I3 and I6 (#sec-invariants). */
async function expectInvariants(store: SimStore, host: LogHost) {
  const rows = store.rowsAfter(0, ALL);
  const commits = rows.map((r) => parseCommit(JSON.parse(r.body)));
  expect(commits.map((c) => c.seq)).toEqual(commits.map((_, i) => i + 1));
  expect(commits.map((c) => c.parent)).toEqual(commits.map((_, i) => i));
  expect(await verifyChain(commits)).toBeNull();
  expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  expect(host.tip()).toBe(rows.length);
  const folded = rulesetText(fold(commits));
  expect(rulesetText(host.ruleset())).toBe(folded);
  expect(rulesetText(new LogHost(store).ruleset())).toBe(folded);
}

describe('LogHost append', () => {
  it('accepts appends on the tip with gapless positions', async () => {
    const { host, store } = make();
    expect(await append(host, nameDraft(0, 'A'))).toMatchObject({
      kind: 'accepted',
      commit: { seq: 1 }
    });
    expect(await append(host, nameDraft(1, 'B'))).toMatchObject({
      kind: 'accepted',
      commit: { seq: 2 }
    });
    expect(store.rowsAfter(0, ALL).map((r) => r.seq)).toEqual([1, 2]);
    expect(host.ruleset().name).toBe('B');
    await expectInvariants(store, host);
  });

  it('stamps seq, actor, at and the chained hash', async () => {
    const { host, store } = make();
    const out = await append(host, nameDraft(0, 'A'), T0 + 5);
    expect(out).toMatchObject({ kind: 'accepted', commit: { seq: 1, actor: 'u1', at: T0 + 5 } });
    const { commit, body } = out as Extract<AppendOutcome, { kind: 'accepted' }>;
    const { hash, ...rest } = commit;
    expect(hash).toBe(await chainHash(GENESIS_HASH, rest));
    expect(store.rowsAfter(0, 1)[0]).toEqual({
      seq: 1,
      id: commit.id,
      hash,
      bytes: utf8Bytes(body),
      body
    });
    expect(JSON.parse(body)).toEqual(commit);
  });

  it.each<[string, () => unknown, Author, string]>([
    ['a stale parent', () => nameDraft(0, 'X'), WRITER, 'behind'],
    [
      'a change that does not apply',
      () => ({ ...nameDraft(1, 'X'), changes: [{ op: 'delete', key: 'p:nope' }] }),
      WRITER,
      'invalid'
    ],
    [
      'a commit under a newer shape revision',
      () => nameDraft(1, 'X', { shapes: SHAPES_REVISION + 1 }),
      WRITER,
      'newer'
    ],
    [
      'a socket that may not write',
      () => nameDraft(1, 'X'),
      { identity: 'u2', write: false },
      'not-writer'
    ]
  ])('refuses %s and changes nothing (I5)', async (_, draft, author, why) => {
    const { host, store } = make();
    await append(host, nameDraft(0, 'G'));
    const before = snapshot(store, host);
    expect(await append(host, draft(), T0 + 1, author)).toMatchObject({ kind: 'refused', why });
    expect(snapshot(store, host)).toEqual(before);
  });

  it('refuses a stored body over the commit cap and changes nothing', async () => {
    const { host, store } = make({ limits: { ...LIMITS, commitBytes: 200 } });
    expect(await append(host, nameDraft(0, 'A'))).toMatchObject({ kind: 'refused', why: 'limit' });
    expect(store.totals().seq).toBe(0);
    expect(host.ruleset().name).toBe(DEFAULT_SIM_NAME);
  });

  it('never refuses a draft that fitsCommit for its size, even with the widest actor', async () => {
    const d = nameDraft(0, 'A');
    const commitBytes = utf8Bytes(JSON.stringify(d)) + STAMP_MAX;
    expect(fitsCommit(d, { ...LIMITS, commitBytes })).toBe(true);
    const { host } = make({ limits: { ...LIMITS, commitBytes } });
    const widest: Author = { identity: 'x'.repeat(64), write: true };
    expect(await append(host, d, Number.MAX_SAFE_INTEGER, widest)).toMatchObject({
      kind: 'accepted'
    });
  });

  it('appends an id once (I6)', async () => {
    const { host, store } = make();
    const a = nameDraft(0, 'A');
    await append(host, a);
    expect(await append(host, a)).toEqual({ kind: 'duplicate', id: a.id });
    expect(store.totals().seq).toBe(1);
  });

  it('two appends on one parent: one stored, one behind', async () => {
    const { host, store } = make();
    const [ra, rb] = await Promise.all([
      append(host, nameDraft(0, 'A')),
      append(host, nameDraft(0, 'B'))
    ]);
    expect(ra).toMatchObject({ kind: 'accepted', commit: { seq: 1 } });
    expect(rb).toMatchObject({ kind: 'refused', why: 'behind' });
    expect(store.totals().seq).toBe(1);
  });

  it('sends each commit after its row is stored, in order (I4)', async () => {
    const { db } = freshSimDb();
    const store = new SimStore(db);
    const sent: number[] = [];
    const host = new LogHost(store, {
      onCommit: (body, c) => {
        expect(store.totals().seq).toBe(c.seq);
        expect(JSON.parse(body)).toEqual(c);
        sent.push(c.seq);
      }
    });
    await append(host, nameDraft(0, 'A'));
    await append(host, nameDraft(1, 'B'));
    await append(host, nameDraft(0, 'C'));
    expect(sent).toEqual([1, 2]);
  });

  it('enforces the length cap (full) and the rate (limit)', async () => {
    const short = make({ limits: { ...LIMITS, simCommits: 2 } });
    await append(short.host, nameDraft(0, 'A'));
    await append(short.host, nameDraft(1, 'B'));
    expect(await append(short.host, nameDraft(2, 'C'))).toMatchObject({ why: 'full' });
    const slow = make({ limits: { ...LIMITS, burst: 2, perSecond: 1 } });
    await append(slow.host, nameDraft(0, 'A'), T0);
    await append(slow.host, nameDraft(1, 'B'), T0);
    expect(await append(slow.host, nameDraft(2, 'C'), T0)).toMatchObject({ why: 'limit' });
    expect(await append(slow.host, nameDraft(2, 'C'), T0 + 1000)).toMatchObject({
      kind: 'accepted'
    });
  });

  it('a refusal after the writer check takes a token; gone and not-writer take none (I5)', async () => {
    const limits = { ...LIMITS, burst: 1, perSecond: 1 };
    const reader = make({ limits });
    expect(
      await append(reader.host, nameDraft(0, 'A'), T0, { identity: null, write: false })
    ).toMatchObject({ why: 'not-writer' });
    expect(await append(reader.host, nameDraft(0, 'A'), T0)).toMatchObject({ kind: 'accepted' });

    const bad = make({ limits });
    expect(
      await append(bad.host, { ...nameDraft(0, 'A'), changes: [{ op: 'delete', key: 'p:x' }] }, T0)
    ).toMatchObject({ why: 'invalid' });
    expect(await append(bad.host, nameDraft(0, 'A'), T0)).toMatchObject({ why: 'limit' });

    const newer = make({ limits });
    expect(
      await append(newer.host, nameDraft(0, 'A', { shapes: SHAPES_REVISION + 1 }), T0)
    ).toMatchObject({ why: 'newer' });
    expect(await append(newer.host, nameDraft(0, 'A'), T0)).toMatchObject({ why: 'limit' });

    const gone = make({ limits });
    await gone.host.takeDown(T0);
    expect(await append(gone.host, nameDraft(0, 'A'), T0)).toMatchObject({ why: 'gone' });
  });

  it('a failed insert drops the held state', async () => {
    class FlakyStore extends SimStore {
      fail = true;
      override insert(row: StoredRow): void {
        if (this.fail) {
          this.fail = false;
          throw new Error('disk');
        }
        super.insert(row);
      }
    }
    const store = new FlakyStore(freshSimDb().db);
    const sent: number[] = [];
    const host = new LogHost(store, { onCommit: (_, c) => sent.push(c.seq) });
    expect(host.ruleset().name).toBe(DEFAULT_SIM_NAME);
    await expect(append(host, nameDraft(0, 'Lost'))).rejects.toThrow('disk');
    expect(sent).toEqual([]);
    expect(host.ruleset().name).toBe(DEFAULT_SIM_NAME);
    expect(host.tip()).toBe(0);
    expect(await append(host, nameDraft(0, 'Kept'))).toMatchObject({ kind: 'accepted' });
    expect(host.ruleset().name).toBe('Kept');
    await expectInvariants(store, host);
  });

  it('answers newer, storing nothing, when a stored row is under a newer shape revision', async () => {
    const store = await storeWithRow({ shapes: SHAPES_REVISION + 1 });
    const host = new LogHost(store);
    const rows = store.rowsAfter(0, ALL);
    const d = nameDraft(1, 'Mine');
    expect(await append(host, d)).toEqual({ kind: 'refused', id: d.id, why: 'newer' });
    expect(await append(host, nameDraft(1, 'Again'))).toMatchObject({ why: 'newer' });
    expect(store.rowsAfter(0, ALL)).toEqual(rows);
    expect(() => host.summary()).toThrow(LogError);
  });

  it('rejects as an internal error when a stored row fails to fold for another reason', async () => {
    const store = await storeWithRow({ changes: [{ op: 'delete', key: 'p:nope' }] });
    const host = new LogHost(store);
    await expect(append(host, nameDraft(1, 'Mine'))).rejects.toThrow(LogError);
    expect(store.totals().seq).toBe(1);
  });

  type Op =
    | { kind: 'edit'; target: RulesetContent }
    | { kind: 'pair'; a: RulesetContent; b: RulesetContent }
    | { kind: 'stale'; back: number }
    | { kind: 'invalid' | 'repeat' | 'newer' }
    | { kind: 'resume'; at: number };
  const arbOp: fc.Arbitrary<Op> = fc.oneof(
    { weight: 6, arbitrary: arbRuleset.map((target) => ({ kind: 'edit' as const, target })) },
    {
      weight: 2,
      arbitrary: fc.tuple(arbRuleset, arbRuleset).map(([a, b]) => ({ kind: 'pair' as const, a, b }))
    },
    { weight: 1, arbitrary: fc.nat({ max: 5 }).map((back) => ({ kind: 'stale' as const, back })) },
    {
      weight: 3,
      arbitrary: fc.constantFrom(
        { kind: 'invalid' as const },
        { kind: 'repeat' as const },
        { kind: 'newer' as const }
      )
    },
    { weight: 1, arbitrary: fc.nat({ max: 20 }).map((at) => ({ kind: 'resume' as const, at })) }
  );

  /** What the model says an append should get: accepted iff valid, unseen and on the tip. */
  type Expected = 'accepted' | 'duplicate' | RefusedWhy;
  const outcomeOf = (out: AppendOutcome): Expected => (out.kind === 'refused' ? out.why : out.kind);

  it('agrees with a model of accepted drafts after every operation of any sequence', async () => {
    let accepted = 0;
    let refused = 0;
    await expect(
      fc.assert(
        fc.asyncProperty(fc.array(arbOp, { minLength: 8, maxLength: 24 }), async (ops) => {
          const sentBodies: string[] = [];
          const { host, store } = make({ onCommit: (body) => sentBodies.push(body) });
          // The model: the drafts accepted so far, in order, and their ids.
          const model: CommitDraft[] = [];
          const ids = new Set<string>();
          const modelRuleset = () => ({ ...fold(model), datasetVersion: 'fixture-0' });
          const accept = (d: CommitDraft) => {
            model.push(d);
            ids.add(d.id);
          };
          const expectOf = (d: CommitDraft, valid: boolean): Expected => {
            if (ids.has(d.id)) return 'duplicate';
            if (!valid) return 'invalid';
            return d.parent === model.length ? 'accepted' : 'behind';
          };
          let now = T0;
          for (const op of ops) {
            now += 1000;
            const tip = model.length;
            const rowsBefore = store.rowsAfter(0, ALL);
            if (op.kind === 'resume') {
              const frames = await resumeOf(host, op.at);
              if (op.at > tip) expect(frames).toBeNull();
              else
                expect(seqsOf(frames ?? [])).toEqual(
                  Array.from({ length: tip - op.at }, (_, i) => op.at + i + 1)
                );
              continue;
            }
            if (op.kind === 'pair') {
              // Two appends on one parent, the second sent before the first is answered.
              const a = draftTo(modelRuleset(), op.a, tip) ?? nameDraft(tip, `Pa${tip}`);
              const b = draftTo(modelRuleset(), op.b, tip) ?? nameDraft(tip, `Pb${tip}`);
              const pa = append(host, a, now);
              const pb = append(host, b, now);
              const [ra, rb] = await Promise.all([pa, pb]);
              expect([outcomeOf(ra), outcomeOf(rb)]).toEqual(['accepted', 'behind']);
              accept(a);
              accepted++;
              refused++;
            } else {
              let d: CommitDraft | null = null;
              let valid = true;
              if (op.kind === 'edit') d = draftTo(modelRuleset(), op.target, tip);
              if (op.kind === 'invalid') {
                d = { ...nameDraft(tip, 'X'), changes: [{ op: 'delete', key: 'p:nope' }] };
                valid = false;
              }
              if (op.kind === 'stale') {
                // Behind the tip when there is one; ahead of it on an empty log.
                d = nameDraft(tip > 0 ? Math.max(0, tip - 1 - op.back) : 1, 'Stale');
              }
              if (op.kind === 'repeat') d = model.at(-1) ?? null;
              if (op.kind === 'newer') d = nameDraft(tip, 'New', { shapes: SHAPES_REVISION + 1 });
              if (!d) continue;
              const expected: Expected =
                op.kind === 'newer' && !ids.has(d.id) ? 'newer' : expectOf(d, valid);
              const before = snapshot(store, host);
              const out = await append(host, d, now);
              expect(outcomeOf(out)).toBe(expected);
              if (op.kind === 'edit') expect(out.kind).toBe('accepted');
              if (out.kind === 'accepted') {
                accept(d);
                accepted++;
              } else {
                refused++;
                // I5: nothing moved.
                expect(snapshot(store, host)).toEqual(before);
              }
            }
            const rowsAfter = store.rowsAfter(0, ALL);
            // The host holds exactly the model's drafts, and its state is their fold.
            expect(rowsAfter.map((r) => r.id)).toEqual(model.map((d) => d.id));
            expect(rulesetText(host.ruleset())).toBe(rulesetText(modelRuleset()));
            // I9: what was stored is still stored, unchanged.
            expect(rowsAfter.slice(0, rowsBefore.length)).toEqual(rowsBefore);
            // I4, I7: every stored commit was sent once, in order, after it was stored.
            expect(sentBodies).toEqual(rowsAfter.map((r) => r.body));
            await expectInvariants(store, host);
          }
        }),
        // Bounded so the property stays well inside the default 5 s test timeout under load.
        { numRuns: 40 }
      )
    ).resolves.toBeUndefined();
    // The generated edits mostly land, and the other kinds are refused.
    expect(accepted).toBeGreaterThan(refused / 4);
  });
});

describe('LogHost start (R58)', () => {
  const start = (over: Partial<{ title: string }> = {}) => ({
    id: newId(),
    title: 'Garden',
    actor: 'u1',
    datasetVersion: 'fixture-0',
    build: 'b1',
    now: T0,
    ...over
  });

  it('appends one system commit holding the index name', async () => {
    const { host, store } = make();
    expect(await host.ensureStarted(start())).toMatchObject({
      kind: 'accepted',
      commit: {
        seq: 1,
        parent: 0,
        kind: 'system',
        label: 'Start',
        source: 'sim.start',
        restores: null,
        actor: 'u1',
        build: 'b1',
        datasetVersion: 'fixture-0',
        shapes: SHAPES_REVISION,
        changes: [{ op: 'set', key: 'sim', field: 'name', value: 'Garden' }]
      }
    });
    expect(host.ruleset()).toMatchObject({ name: 'Garden', datasetVersion: 'fixture-0' });
    expect(await host.ensureStarted(start())).toBeNull();
    expect(store.totals().seq).toBe(1);
  });

  it('ensureStarted with a title the name check refuses leaves the log empty', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { host, store } = make({ label: 'sim-7' });
    expect(await host.ensureStarted(start({ title: ' padded ' }))).toMatchObject({
      kind: 'refused',
      why: 'invalid'
    });
    expect(store.totals().seq).toBe(0);
    expect(err).toHaveBeenCalledOnce();
    const line = err.mock.calls[0].join(' ');
    expect(line).toContain('sim-7');
    expect(line).not.toContain('u1');
    expect(line).not.toContain('padded');
    err.mockRestore();
  });
});

describe('LogHost appendAs', () => {
  const start = (over = {}) => ({
    id: newId(),
    title: 'Old',
    datasetVersion: 'fixture-2',
    build: 'b1',
    ...over
  });

  it('on an empty log records the start commit, then the commit on it', async () => {
    const sent: number[] = [];
    const { host, store } = make({ onCommit: (_, c) => sent.push(c.seq) });
    const draft = serverDraft('New');
    const out = await host.appendAs({ actor: 'u1', draft, start: start(), now: T0 });
    expect(out).toMatchObject({
      kind: 'accepted',
      commit: { seq: 2, parent: 1, id: draft.id, actor: 'u1', datasetVersion: 'fixture-2' }
    });
    const rows = store.rowsAfter(0, ALL).map((r) => JSON.parse(r.body));
    expect(rows[0]).toMatchObject({
      seq: 1,
      parent: 0,
      kind: 'system',
      label: 'Start',
      source: 'sim.start',
      actor: 'u1',
      build: 'b1',
      datasetVersion: 'fixture-2',
      changes: [{ op: 'set', key: 'sim', field: 'name', value: 'Old' }]
    });
    expect(rows.map((r) => r.id)).toEqual([rows[0].id, draft.id]);
    expect(host.ruleset().name).toBe('New');
    expect(sent).toEqual([1, 2]);
    await expectInvariants(store, host);
  });

  it('takes parent and dataset version from the tip, never from the caller', async () => {
    const { host, store } = make();
    await append(host, nameDraft(0, 'A', { datasetVersion: 'fixture-1' }));
    await append(host, nameDraft(1, 'B', { datasetVersion: 'fixture-1' }));
    const out = await host.appendAs({
      actor: 'u2',
      draft: serverDraft('C'),
      start: start(),
      now: T0
    });
    expect(out).toMatchObject({
      kind: 'accepted',
      commit: { seq: 3, parent: 2, datasetVersion: 'fixture-1', actor: 'u2' }
    });
    expect(host.ruleset()).toMatchObject({ name: 'C', datasetVersion: 'fixture-1' });
    await expectInvariants(store, host);
  });

  it('is refused gone after a takedown and stores nothing', async () => {
    const { host, store } = make();
    await host.takeDown(T0);
    const d = serverDraft('X');
    expect(await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 })).toEqual({
      kind: 'refused',
      id: d.id,
      why: 'gone'
    });
    expect(store.totals().seq).toBe(0);
  });

  it('refuses a name the check refuses and keeps the tip', async () => {
    const { host, store } = make();
    await append(host, nameDraft(0, 'A'));
    const before = snapshot(store, host);
    const d = serverDraft(' padded ');
    expect(await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 })).toEqual({
      kind: 'refused',
      id: d.id,
      why: 'invalid'
    });
    expect(store.totals().seq).toBe(1);
    expect(snapshot(store, host)).toEqual(before);
  });

  it('on an empty log, a refused commit keeps the start commit stored before it', async () => {
    const { host, store } = make();
    const d = serverDraft(' padded ');
    expect(await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 })).toEqual({
      kind: 'refused',
      id: d.id,
      why: 'invalid'
    });
    expect(host.tip()).toBe(1);
    expect(host.ruleset().name).toBe('Old');
    expect(host.indexBehind()).toBe(true);
    await expectInvariants(store, host);
  });

  it('a start title the check refuses: refused under the draft id, logged, nothing stored', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { host, store } = make({ label: 'sim-7' });
    const d = serverDraft('New');
    expect(
      await host.appendAs({ actor: 'u1', draft: d, start: start({ title: ' padded ' }), now: T0 })
    ).toEqual({ kind: 'refused', id: d.id, why: 'invalid' });
    expect(store.totals().seq).toBe(0);
    expect(err).toHaveBeenCalledOnce();
    const line = err.mock.calls[0].join(' ');
    expect(line).toContain('sim-7');
    expect(line).not.toContain('u1');
    expect(line).not.toContain('padded');
    err.mockRestore();
  });

  it('spends the sim rate budget like any append', async () => {
    const { host } = make({ limits: { ...LIMITS, burst: 1, perSecond: 0 } });
    await append(host, nameDraft(0, 'A'));
    const d = serverDraft('B');
    expect(await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 })).toEqual({
      kind: 'refused',
      id: d.id,
      why: 'limit'
    });
  });

  it('appends an id once: a repeat is a duplicate and stores nothing', async () => {
    const { host, store } = make();
    await append(host, nameDraft(0, 'A'));
    const d = serverDraft('B');
    await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 });
    const before = snapshot(store, host);
    expect(await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 })).toEqual({
      kind: 'duplicate',
      id: d.id
    });
    expect(snapshot(store, host)).toEqual(before);
  });

  it('runs in turn: two calls made together both land, in order', async () => {
    const { host, store } = make();
    const [a, b] = await Promise.all([
      host.appendAs({ actor: 'u1', draft: serverDraft('A'), start: start(), now: T0 }),
      host.appendAs({ actor: 'u1', draft: serverDraft('B'), start: start(), now: T0 })
    ]);
    expect([a, b].map((o) => (o.kind === 'accepted' ? o.commit.seq : 0))).toEqual([2, 3]);
    expect(host.ruleset().name).toBe('B');
    await expectInvariants(store, host);
  });

  it('runs in turn with a socket append made together with it', async () => {
    const { host, store } = make();
    const [s, w] = await Promise.all([
      append(host, nameDraft(0, 'Socket')),
      host.appendAs({ actor: 'u2', draft: serverDraft('Server'), start: start(), now: T0 })
    ]);
    expect(s).toMatchObject({ kind: 'accepted', commit: { seq: 1 } });
    expect(w).toMatchObject({ kind: 'accepted', commit: { seq: 2, parent: 1, actor: 'u2' } });
    expect(host.ruleset().name).toBe('Server');
    await expectInvariants(store, host);
  });

  it('a stored row from a newer build: refused newer', async () => {
    const store = await storeWithRow({ shapes: SHAPES_REVISION + 1 });
    const host = new LogHost(store);
    const rows = store.rowsAfter(0, ALL);
    const d = serverDraft('X');
    expect(await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 })).toEqual({
      kind: 'refused',
      id: d.id,
      why: 'newer'
    });
    expect(store.rowsAfter(0, ALL)).toEqual(rows);
  });

  it('refuses an actor that is not 1 to IDENTITY_MAX characters: not-writer, no token, nothing stored', async () => {
    // Two tokens: exactly what a valid appendAs on an empty log spends (start commit, commit).
    const { host, store } = make({ limits: { ...LIMITS, burst: 2, perSecond: 0 } });
    for (const actor of ['', 'x'.repeat(IDENTITY_MAX + 1), undefined, null, 7]) {
      const d = serverDraft('X');
      expect(
        await host.appendAs({ actor: actor as string, draft: d, start: start(), now: T0 })
      ).toEqual({ kind: 'refused', id: d.id, why: 'not-writer' });
      expect(store.totals().seq).toBe(0);
    }
    const widest = 'x'.repeat(IDENTITY_MAX);
    expect(
      await host.appendAs({ actor: widest, draft: serverDraft('Y'), start: start(), now: T0 })
    ).toMatchObject({ kind: 'accepted', commit: { seq: 2, actor: widest } });
    await expectInvariants(store, host);
  });

  it('overwrites a parent and dataset version the draft carries with the tip values', async () => {
    const { host, store } = make();
    await append(host, nameDraft(0, 'A', { datasetVersion: 'fixture-1' }));
    const hostile = { ...serverDraft('B'), parent: 99, datasetVersion: 'fixture-9' };
    expect(
      await host.appendAs({ actor: 'u1', draft: hostile, start: start(), now: T0 })
    ).toMatchObject({
      kind: 'accepted',
      commit: { seq: 2, parent: 1, datasetVersion: 'fixture-1' }
    });
    await expectInvariants(store, host);
  });

  it.each(['seq', 'actor', 'at', 'hash'])(
    'refuses a draft carrying %s as invalid, storing nothing (no start commit either)',
    async (key) => {
      const { host, store } = make();
      const d = { ...serverDraft('X'), [key]: key === 'actor' || key === 'hash' ? 'z' : 1 };
      expect(await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 })).toEqual({
        kind: 'refused',
        id: d.id,
        why: 'invalid'
      });
      expect(store.totals().seq).toBe(0);
      await append(host, nameDraft(0, 'A'));
      const before = snapshot(store, host);
      expect(await host.appendAs({ actor: 'u1', draft: d, start: start(), now: T0 })).toEqual({
        kind: 'refused',
        id: d.id,
        why: 'invalid'
      });
      expect(snapshot(store, host)).toEqual(before);
    }
  );

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'draft'],
    ['an array', [1, 2]],
    ['a number', 3]
  ])('refuses a draft that is %s as invalid data, storing nothing', async (_, draft) => {
    const { host, store } = make();
    expect(
      await host.appendAs({
        actor: 'u1',
        draft: draft as ServerAppend['draft'],
        start: start(),
        now: T0
      })
    ).toEqual({ kind: 'refused', id: null, why: 'invalid' });
    expect(store.totals().seq).toBe(0);
  });
});

describe('LogHost resume', () => {
  async function three(opts: LogHostOptions = {}) {
    const m = make(opts);
    for (let s = 0; s < 3; s++) await append(m.host, nameDraft(s, `N${s}`));
    return m;
  }

  it('answers the commits after a position, as stored', async () => {
    const { host, store } = await three();
    const frames = await resumeOf(host, 1);
    expect(frames).toEqual([commitsFrame(store.rowsAfter(1, ALL).map((r) => r.body))]);
  });

  it('chunks a long answer', async () => {
    const { host } = await three({ limits: { ...LIMITS, sendBytes: 1 } });
    const frames = (await resumeOf(host, 0)) ?? [];
    expect(frames.map((f) => seqsOf([f]))).toEqual([[1], [2], [3]]);
  });

  it('answers one empty frame when there is nothing after', async () => {
    const { host } = await three();
    expect(await resumeOf(host, 3)).toEqual([commitsFrame([])]);
    expect(await resumeOf(make().host, 0)).toEqual([commitsFrame([])]);
  });

  it('resume past the tip or on a gone sim is null', async () => {
    const { host } = await three();
    expect(await resumeOf(host, 4)).toBeNull();
    await host.takeDown(T0);
    expect(await resumeOf(host, 0)).toBeNull();
  });

  it('delivers a log longer than one page page by page, in order and complete', async () => {
    const { host, store } = make({ limits: { ...LIMITS, burst: 2000 } });
    const n = 1203;
    for (let s = 0; s < n; s++) await append(host, nameDraft(s, `N${s}`));
    expect(store.totals().seq).toBe(n);
    const pages: string[][] = [];
    await host.resume(0, (frames) => {
      expect(frames).not.toBeNull();
      pages.push(frames ?? []);
    });
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(seqsOf(page).length).toBeLessThanOrEqual(500);
    expect(seqsOf(pages.flat())).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(seqsOf((await resumeOf(host, 700)) ?? [])).toEqual(
      Array.from({ length: n - 700 }, (_, i) => i + 701)
    );
  });

  it('a resumer is delivered every later commit exactly once, in order (I7)', async () => {
    let subscribed = false;
    const seen: number[] = [];
    const { host } = make({
      onCommit: (_, c) => {
        if (subscribed) seen.push(c.seq);
      }
    });
    const ops = [
      append(host, nameDraft(0, 'A')),
      append(host, nameDraft(1, 'B')),
      host.resume(1, (frames) => {
        subscribed = true;
        seen.push(...seqsOf(frames ?? []));
      }),
      append(host, nameDraft(2, 'C')),
      append(host, nameDraft(2, 'D')),
      append(host, nameDraft(3, 'E'))
    ];
    const outs = await Promise.all(ops);
    expect(outs[4]).toMatchObject({ kind: 'refused', why: 'behind' });
    expect(seen).toEqual([2, 3, 4]);
  });
});

describe('LogHost takedown and index', () => {
  it('takeDown clears the log and refuses later appends as gone', async () => {
    const { host, store } = make();
    await append(host, nameDraft(0, 'A'));
    await host.takeDown(T0 + 9);
    expect(host.gone()).toBe(true);
    expect(host.tip()).toBe(0);
    expect(store.totals().seq).toBe(0);
    expect(host.indexBehind()).toBe(false);
    expect(await append(host, nameDraft(0, 'B'))).toMatchObject({ kind: 'refused', why: 'gone' });
    expect(
      await host.ensureStarted({
        id: newId(),
        title: 'G',
        actor: 'u1',
        datasetVersion: 'fixture-0',
        build: 'b',
        now: T0
      })
    ).toBeNull();
  });

  it('tracks what the index has not seen', async () => {
    const { db, host, store } = make();
    expect(host.summary()).toEqual({
      positions: 0,
      lastChangeAt: 0,
      datasetVersion: null,
      title: DEFAULT_SIM_NAME
    });
    await append(host, nameDraft(0, 'A'), T0 + 1);
    const b = await append(host, nameDraft(1, 'B'), T0 + 2);
    expect(host.indexBehind()).toBe(true);
    expect(host.unindexed(1).map((c) => c.commit.seq)).toEqual([1]);
    const { commit, body } = b as Extract<AppendOutcome, { kind: 'accepted' }>;
    expect(host.unindexed(10)[1]).toEqual({ commit, bytes: utf8Bytes(body) });
    host.markIndexed(1);
    expect(host.unindexed(10).map((c) => c.commit.seq)).toEqual([2]);
    expect(host.summary()).toEqual({
      positions: 2,
      lastChangeAt: T0 + 2,
      datasetVersion: 'fixture-0',
      title: 'B'
    });
    host.markIndexed(2);
    expect(host.indexBehind()).toBe(false);
    host.markIndexed(1);
    expect(new SimStore(db).indexedSeq()).toBe(2);
    expect(store.totals().seq).toBe(2);
  });

  it('markIndexed never moves the watermark past the tip, nor after a takedown', async () => {
    const { host, store } = make();
    await append(host, nameDraft(0, 'A'));
    await append(host, nameDraft(1, 'B'));
    host.markIndexed(9);
    expect(store.indexedSeq()).toBe(2);
    await host.takeDown(T0);
    host.markIndexed(2);
    expect(store.indexedSeq()).toBe(0);
  });
});
