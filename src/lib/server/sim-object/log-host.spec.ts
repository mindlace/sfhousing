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
  RESUME_ROW_EXTRA,
  type AppendOutcome,
  type Author,
  type LogHostOptions,
  type ResumeAnswer,
  type ResumeBounds,
  type ServerAppend
} from './log-host';
import { answerResume, receivesLive } from './object-rules';
import { IDENTITY_MAX } from './open-params';
import { ResumeBudgets } from './resume-budget';
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

/** The one answer a resume delivers. */
async function answerOf(
  host: LogHost,
  after: number,
  bounds?: ResumeBounds
): Promise<ResumeAnswer> {
  const got: ResumeAnswer[] = [];
  await host.resume(
    after,
    (a) => {
      got.push(a);
    },
    bounds
  );
  expect(got).toHaveLength(1);
  return got[0];
}

/** The frames of a resume answer; null when it is answered gone. */
async function resumeOf(host: LogHost, after: number): Promise<string[] | null> {
  const a = await answerOf(host, after);
  if (a.kind === 'gone') return null;
  expect(a.kind).toBe('frames');
  return a.kind === 'frames' ? a.frames : [];
}

const lastMore = (frames: string[]) => JSON.parse(frames[frames.length - 1]).more;

/** What rows cost a resume: their stored bodies plus the frame room each is charged. */
const costOf = (rows: readonly StoredRow[]) =>
  rows.reduce((t, r) => t + r.bytes + RESUME_ROW_EXTRA, 0);

const WRITER_ATT = { identity: 'u1', write: true, resumed: false };
const READER_ATT = { identity: 'u2', write: false, resumed: false };

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
    expect(frames).toEqual([
      commitsFrame(
        store.rowsAfter(1, ALL).map((r) => r.body),
        false
      )
    ]);
  });

  it('chunks a long answer, marking only its last frame', async () => {
    const { host } = await three({ limits: { ...LIMITS, sendBytes: 1 } });
    const frames = (await resumeOf(host, 0)) ?? [];
    expect(frames.map((f) => seqsOf([f]))).toEqual([[1], [2], [3]]);
    expect(frames.map((f) => JSON.parse(f).more)).toEqual([undefined, undefined, false]);
  });

  it('answers one empty frame when there is nothing after', async () => {
    const { host } = await three();
    expect(await resumeOf(host, 3)).toEqual([commitsFrame([], false)]);
    expect(await resumeOf(make().host, 0)).toEqual([commitsFrame([], false)]);
  });

  it('resume past the tip or on a gone sim is null', async () => {
    const { host } = await three();
    expect(await resumeOf(host, 4)).toBeNull();
    await host.takeDown(T0);
    expect(await resumeOf(host, 0)).toBeNull();
  });

  it('caps an answer by stored bytes, says more, and the answers join to the whole log', async () => {
    const { host, store } = make({ limits: { ...LIMITS, burst: 2000 } });
    const n = 1203;
    for (let s = 0; s < n; s++) await append(host, nameDraft(s, `N${s}`));
    const cap = costOf(store.rowsAfter(0, 300));
    const seqs: number[] = [];
    let after = 0;
    let answers = 0;
    for (;;) {
      const a = await answerOf(host, after, { maxBytes: cap, take: () => true });
      if (a.kind !== 'frames') throw new Error(a.kind);
      answers++;
      expect(lastMore(a.frames)).toBe(a.more);
      for (const f of a.frames.slice(0, -1)) expect(JSON.parse(f).more).toBeUndefined();
      const got = seqsOf(a.frames);
      seqs.push(...got);
      if (!a.more) break;
      after = got[got.length - 1];
    }
    expect(seqs).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(answers).toBeGreaterThan(4);
    // The budget pays page by page: a refusal after the first page cuts the answer there.
    let calls = 0;
    const cut = await answerOf(host, 0, {
      maxBytes: LIMITS.resumeBytes,
      take: () => calls++ === 0
    });
    expect(cut).toMatchObject({ kind: 'frames', more: true });
    expect(seqsOf((cut as { frames: string[] }).frames)).toEqual(
      Array.from({ length: 500 }, (_, i) => i + 1)
    );
  });

  it('always sends one commit, even over the cap', async () => {
    const { host } = await three();
    const a = await answerOf(host, 0, { maxBytes: 1, take: () => true });
    expect(a).toMatchObject({ kind: 'frames', more: true });
    expect(seqsOf((a as { frames: string[] }).frames)).toEqual([1]);
  });

  it('pays each page for exactly the bytes it keeps', async () => {
    const { host, store } = await three();
    const rows = store.rowsAfter(0, ALL);
    const paid: number[] = [];
    const take = (n: number) => {
      paid.push(n);
      return true;
    };
    const cap = costOf(rows.slice(0, 2));
    expect(await answerOf(host, 0, { maxBytes: cap, take })).toMatchObject({ more: true });
    expect(paid).toEqual([cap]);
  });

  it('never puts more bytes on the wire than the answer paid for', async () => {
    for (const sendBytes of [1, LIMITS.sendBytes]) {
      const { host } = await three({ limits: { ...LIMITS, sendBytes } });
      for (const maxBytes of [1, LIMITS.resumeBytes]) {
        let paid = 0;
        const take = (n: number) => {
          paid += n;
          return true;
        };
        const a = await answerOf(host, 0, { maxBytes, take });
        if (a.kind !== 'frames') throw new Error(a.kind);
        expect(a.frames.reduce((t, f) => t + utf8Bytes(f), 0)).toBeLessThanOrEqual(paid);
      }
    }
  });

  it('refuses limit when the budget cannot pay for the first page', async () => {
    const { host } = await three();
    expect(await answerOf(host, 0, { maxBytes: LIMITS.resumeBytes, take: () => false })).toEqual({
      kind: 'limit'
    });
  });

  /** A store that records the reads a resume makes; `onBodies` runs inside the body read. */
  class SpyStore extends SimStore {
    bodyReads: [number, number][] = [];
    fullReads = 0;
    onBodies: (() => void) | null = null;
    override rowsThrough(after: number, last: number): StoredRow[] {
      this.bodyReads.push([after, last]);
      this.onBodies?.();
      return super.rowsThrough(after, last);
    }
    override rowsAfter(seq: number, limit: number): StoredRow[] {
      this.fullReads++;
      return super.rowsAfter(seq, limit);
    }
  }

  async function spied(n: number, opts: LogHostOptions = {}) {
    const store = new SpyStore(freshSimDb().db);
    const host = new LogHost(store, { limits: { ...LIMITS, burst: 2000 }, ...opts });
    for (let s = 0; s < n; s++) await append(host, nameDraft(s, `N${s}`));
    host.ruleset();
    store.bodyReads = [];
    store.fullReads = 0;
    return { store, host };
  }

  it('a resume refused limit reads no body', async () => {
    const { store, host } = await spied(600);
    expect(await answerOf(host, 0, { maxBytes: LIMITS.resumeBytes, take: () => false })).toEqual({
      kind: 'limit'
    });
    expect(store.bodyReads).toEqual([]);
    expect(store.fullReads).toBe(0);
  });

  it('reads the bodies of the rows it sends, once, and no others', async () => {
    const { store, host } = await spied(1203);
    let calls = 0;
    const cut = await answerOf(host, 10, {
      maxBytes: LIMITS.resumeBytes,
      take: () => calls++ === 0
    });
    expect(seqsOf((cut as { frames: string[] }).frames)).toHaveLength(500);
    expect(store.bodyReads).toEqual([[10, 510]]);
    store.bodyReads = [];
    const capped = await answerOf(host, 0, { maxBytes: 1, take: () => true });
    expect(seqsOf((capped as { frames: string[] }).frames)).toEqual([1]);
    expect(store.bodyReads).toEqual([[0, 1]]);
    store.bodyReads = [];
    await answerOf(host, 1203, { maxBytes: 1, take: () => true });
    expect(store.bodyReads).toEqual([]);
    expect(store.fullReads).toBe(0);
  });

  it('nothing runs between the size read and the body read: an append queued there waits', async () => {
    let subscribed = false;
    const live: number[] = [];
    const { store, host } = await spied(3, {
      onCommit: (_, c) => {
        if (subscribed) live.push(c.seq);
      }
    });
    let queued: Promise<AppendOutcome> | null = null;
    store.onBodies = () => {
      store.onBodies = null;
      queued = append(host, nameDraft(3, 'Between'));
    };
    const got: number[] = [];
    await host.resume(0, (a) => {
      if (a.kind !== 'frames') throw new Error(a.kind);
      got.push(...seqsOf(a.frames));
      if (!a.more) subscribed = true;
    });
    expect(queued).not.toBeNull();
    expect(await (queued as unknown as Promise<AppendOutcome>)).toMatchObject({
      kind: 'accepted',
      commit: { seq: 4 }
    });
    expect(got).toEqual([1, 2, 3]);
    expect(live).toEqual([4]);
  });

  it("readers spending their budget leave a writer's resume answered (F1)", async () => {
    const { host, store } = await three();
    const all = costOf(store.rowsAfter(0, ALL));
    const size = { burst: all, perSecond: 1 };
    const budgets = new ResumeBudgets(T0, { writers: size, readers: size });
    const at = () => T0;
    const reader = budgets.boundsFor(() => READER_ATT, at);
    const writer = budgets.boundsFor(() => WRITER_ATT, at);
    expect((await answerOf(host, 0, reader)).kind).toBe('frames');
    expect(await answerOf(host, 0, reader)).toEqual({ kind: 'limit' });
    expect(await answerOf(host, 0, writer)).toMatchObject({ kind: 'frames', more: false });
    expect(await answerOf(host, 0, writer)).toEqual({ kind: 'limit' });
  });

  it('a budget refills with the clock it is given', async () => {
    const { host, store } = await three();
    const all = costOf(store.rowsAfter(0, ALL));
    const size = { burst: all, perSecond: all };
    const budgets = new ResumeBudgets(T0, { writers: size, readers: size });
    let now = T0;
    const reader = budgets.boundsFor(
      () => READER_ATT,
      () => now
    );
    expect((await answerOf(host, 0, reader)).kind).toBe('frames');
    expect(await answerOf(host, 0, reader)).toEqual({ kind: 'limit' });
    now = T0 + 1000;
    expect(await answerOf(host, 0, reader)).toMatchObject({ more: false });
  });

  it('answers nothing-after with one empty frame, more false, without paying', async () => {
    const { host } = await three();
    expect(await answerOf(host, 3, { maxBytes: 1, take: () => false })).toEqual({
      kind: 'frames',
      frames: [commitsFrame([], false)],
      more: false
    });
  });

  it('answers gone past the tip and after a takedown', async () => {
    const { host } = await three();
    expect(await answerOf(host, 4)).toEqual({ kind: 'gone' });
    await host.takeDown(T0);
    expect(await answerOf(host, 0)).toEqual({ kind: 'gone' });
  });

  it('a paged catch-up with appends between answers sees every commit once, in order (I7)', async () => {
    // The object's rule: live commits only once an answer has more: false.
    let subscribed = false;
    const seen: number[] = [];
    const { host } = make({
      onCommit: (_, c) => {
        if (subscribed) seen.push(c.seq);
      }
    });
    for (let s = 0; s < 3; s++) await append(host, nameDraft(s, `N${s}`));
    let after = 0;
    let tip = 3;
    // One commit per answer; an append made together with each of the first three resumes and
    // with the one that reaches the tip (stored after it, so it must come live, once).
    for (;;) {
      const withAppend = tip < 6 || after === tip - 1;
      const [answers] = await Promise.all([
        (async () => {
          const got: ResumeAnswer[] = [];
          await host.resume(
            after,
            (a) => {
              got.push(a);
              if (a.kind === 'frames') {
                seen.push(...seqsOf(a.frames));
                if (!a.more) subscribed = true;
              }
            },
            { maxBytes: 1, take: () => true }
          );
          return got;
        })(),
        withAppend ? append(host, nameDraft(tip, `L${tip}`)) : Promise.resolve(null)
      ]);
      if (withAppend) tip++;
      expect(answers).toHaveLength(1);
      const a = answers[0];
      if (a.kind !== 'frames') throw new Error(a.kind);
      if (!a.more) break;
      after = seqsOf(a.frames).at(-1) as number;
    }
    expect(subscribed).toBe(true);
    await append(host, nameDraft(tip, 'Live'));
    await append(host, nameDraft(tip + 1, 'Live2'));
    expect(tip).toBe(7);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
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
      host.resume(1, (a) => {
        subscribed = true;
        seen.push(...seqsOf(a.kind === 'frames' ? a.frames : []));
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

describe("the object's resume rule (answerResume)", () => {
  /** A socket as the object sees it: its attachment and the frames sent to it. */
  interface Sock {
    att: unknown;
    frames: string[];
  }
  const ONE = { maxBytes: 1, take: () => true };

  /** A host whose live commits go, as the object's broadcast does, to marked sockets only. */
  function world() {
    const socks: Sock[] = [];
    const m = make({
      limits: { ...LIMITS, burst: 2000 },
      onCommit: (body) => {
        for (const s of socks) if (receivesLive(s.att)) s.frames.push(commitsFrame([body]));
      }
    });
    const open = (): Sock => {
      const s: Sock = { att: { identity: 'u1', write: true, resumed: false }, frames: [] };
      socks.push(s);
      return s;
    };
    // One per object, as in the object: the sockets with a resume queued or being answered.
    const outstanding = new WeakSet<object>();
    let resumes = 0;
    const counted = {
      resume: (...args: Parameters<LogHost['resume']>) => {
        resumes++;
        return m.host.resume(...args);
      }
    };
    const port = (s: Sock, key: object = s) => ({
      key,
      read: () => s.att,
      store: (a: unknown) => {
        s.att = a;
      },
      send: (f: string) => {
        s.frames.push(f);
      }
    });
    const resume = (s: Sock, after: number, bounds?: ResumeBounds, key?: object) =>
      answerResume(counted, after, port(s, key), outstanding, bounds);
    return { ...m, open, resume, port, outstanding, resumes: () => resumes };
  }

  /** Catches up from `after` the way the client does: next page only after the last frame. */
  async function catchUp(
    w: ReturnType<typeof world>,
    s: Sock,
    after: number,
    between: (answer: number) => Promise<unknown> = async () => null
  ) {
    for (let answer = 0; ; answer++) {
      const before = s.frames.length;
      await w.resume(s, after, ONE);
      const last = JSON.parse(s.frames[s.frames.length - 1]);
      expect(s.frames.length).toBeGreaterThan(before);
      if (last.more === false) return;
      after = seqsOf(s.frames.slice(before)).at(-1) as number;
      await between(answer);
    }
  }

  it('a re-resume on a caught-up socket sees each commit once, in order (concern 2)', async () => {
    const w = world();
    for (let i = 0; i < 6; i++) await append(w.host, nameDraft(i, `N${i}`));
    const s = w.open();
    await w.resume(s, 0);
    expect(receivesLive(s.att)).toBe(true);
    const from = s.frames.length;
    // The smallest example: resume from 0 again, one commit per answer, and a commit stored
    // together with the first answer (after it, in turn).
    const [, out] = await Promise.all([w.resume(s, 0, ONE), append(w.host, nameDraft(6, 'Late'))]);
    expect(out).toMatchObject({ kind: 'accepted', commit: { seq: 7 } });
    expect(receivesLive(s.att)).toBe(false);
    await catchUp(w, s, 1);
    expect(receivesLive(s.att)).toBe(true);
    expect(seqsOf(s.frames.slice(from))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await append(w.host, nameDraft(7, 'Live'));
    expect(seqsOf(s.frames.slice(from))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('a commit stored between two pages of a re-resume arrives once, in a page', async () => {
    const w = world();
    for (let i = 0; i < 4; i++) await append(w.host, nameDraft(i, `N${i}`));
    const s = w.open();
    await w.resume(s, 0);
    const from = s.frames.length;
    let tip = 4;
    await catchUp(w, s, 1, async (answer) => {
      if (answer < 2) await append(w.host, nameDraft(tip, `B${tip++}`));
    });
    expect(seqsOf(s.frames.slice(from))).toEqual([2, 3, 4, 5, 6]);
    // The answer reaching the tip, with a commit stored right after it: that one comes live.
    const mark = s.frames.length;
    await Promise.all([w.resume(s, 6), append(w.host, nameDraft(6, 'After'))]);
    expect(seqsOf(s.frames.slice(mark))).toEqual([7]);
  });

  it('a re-resume refused limit or gone stops live commits until an answer reaches the tip', async () => {
    const w = world();
    for (let i = 0; i < 2; i++) await append(w.host, nameDraft(i, `N${i}`));
    const s = w.open();
    await w.resume(s, 0);
    expect(receivesLive(s.att)).toBe(true);
    await w.resume(s, 0, { maxBytes: LIMITS.resumeBytes, take: () => false });
    expect(JSON.parse(s.frames.at(-1) as string)).toEqual({
      type: 'refused',
      id: null,
      why: 'limit'
    });
    expect(receivesLive(s.att)).toBe(false);
    const quiet = s.frames.length;
    await append(w.host, nameDraft(2, 'Unseen'));
    expect(s.frames).toHaveLength(quiet);
    await w.resume(s, 2);
    expect(seqsOf(s.frames.slice(quiet))).toEqual([3]);
    expect(receivesLive(s.att)).toBe(true);
    // Past the tip: refused gone, and the mark is clear too.
    await w.resume(s, 9);
    expect(JSON.parse(s.frames.at(-1) as string)).toMatchObject({ why: 'gone' });
    expect(receivesLive(s.att)).toBe(false);
    const after = s.frames.length;
    await append(w.host, nameDraft(3, 'Unseen2'));
    expect(s.frames).toHaveLength(after);
  });

  it('keeps a write changed by a concurrent rereadRoles when it clears and sets the mark', async () => {
    const w = world();
    await append(w.host, nameDraft(0, 'A'));
    const s = w.open();
    await w.resume(s, 0);
    s.att = { identity: 'u1', write: false, resumed: true };
    const p = w.resume(s, 0);
    expect(s.att).toEqual({ identity: 'u1', write: false, resumed: false });
    await p;
    expect(s.att).toEqual({ identity: 'u1', write: false, resumed: true });
  });

  it('one resume per socket: a second while one is queued is refused limit and queues nothing', async () => {
    const w = world();
    for (let i = 0; i < 3; i++) await append(w.host, nameDraft(i, `N${i}`));
    const s = w.open();
    const first = w.resume(s, 0);
    expect(s.att).toMatchObject({ resumed: false });
    // The second arrives while the first waits its turn: refused at once (before the first is
    // answered), queueing nothing, mark untouched.
    const second = w.resume(s, 0);
    expect(w.resumes()).toBe(1);
    expect(s.frames.map((f) => JSON.parse(f))).toEqual([
      { type: 'refused', id: null, why: 'limit' }
    ]);
    await Promise.all([first, second]);
    expect(w.resumes()).toBe(1);
    expect(seqsOf(s.frames.slice(1))).toEqual([1, 2, 3]);
    expect(receivesLive(s.att)).toBe(true);
    // Answered: the socket may resume again.
    await w.resume(s, 3);
    expect(w.resumes()).toBe(2);
    expect(JSON.parse(s.frames.at(-1) as string)).toEqual({
      type: 'commits',
      commits: [],
      more: false
    });
  });

  it('a second refused while one is outstanding leaves the mark the first sets', async () => {
    const w = world();
    for (let i = 0; i < 3; i++) await append(w.host, nameDraft(i, `N${i}`));
    const s = w.open();
    await w.resume(s, 0);
    const capped = w.resume(s, 0, ONE);
    await w.resume(s, 0);
    await capped;
    expect(receivesLive(s.att)).toBe(false);
    expect(w.resumes()).toBe(2);
  });

  it('frees the socket after a failed resume, and a closed socket with one queued is no trouble', async () => {
    const w = world();
    await append(w.host, nameDraft(0, 'A'));
    const s = w.open();
    const failing = { resume: () => Promise.reject(new Error('disk')) };
    await expect(answerResume(failing, 0, w.port(s), w.outstanding)).rejects.toThrow('disk');
    await w.resume(s, 0);
    expect(receivesLive(s.att)).toBe(true);
    // Closed while queued: its attachment can no longer be read and sends go nowhere.
    const closed: Sock = { att: s.att, frames: [] };
    const port = {
      key: closed,
      read: () => null,
      store: () => {
        throw new Error('stored on a closed socket');
      },
      send: () => {}
    };
    await expect(answerResume(w.host, 0, port, w.outstanding)).resolves.toBeUndefined();
    await expect(answerResume(w.host, 0, port, w.outstanding)).resolves.toBeUndefined();
  });

  it('the mark always says whether the most recent answer reached the tip', async () => {
    // Two resumes on one attachment that the one-per-socket rule would not see as one socket
    // (distinct keys): only the answer step can keep the mark right.
    const w = world();
    for (let i = 0; i < 3; i++) await append(w.host, nameDraft(i, `N${i}`));
    const s = w.open();
    const k1 = {};
    const k2 = {};
    await Promise.all([w.resume(s, 0, undefined, k1), w.resume(s, 0, ONE, k2)]);
    expect(receivesLive(s.att)).toBe(false);
    await Promise.all([
      w.resume(s, 0, undefined, k1),
      w.resume(s, 0, { maxBytes: LIMITS.resumeBytes, take: () => false }, k2)
    ]);
    expect(receivesLive(s.att)).toBe(false);
    await Promise.all([w.resume(s, 0, undefined, k1), w.resume(s, 9, undefined, k2)]);
    expect(receivesLive(s.att)).toBe(false);
    await Promise.all([w.resume(s, 0, ONE, k1), w.resume(s, 0, undefined, k2)]);
    expect(receivesLive(s.att)).toBe(true);
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
