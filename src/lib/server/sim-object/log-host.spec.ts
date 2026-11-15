import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_SIM_NAME,
  GENESIS_HASH,
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
import { commitsFrame } from '$lib/sim-stream/protocol';
import { LIMITS, utf8Bytes } from './limits';
import { LogHost, type AppendOutcome, type Author, type LogHostOptions } from './log-host';
import { SimStore, type StoredRow } from './store';
import { draftTo, nameDraft } from './test/drafts';
import { freshSimDb } from './test/harness';

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

  it('enforces the length cap and the rate', async () => {
    const short = make({ limits: { ...LIMITS, simCommits: 2 } });
    await append(short.host, nameDraft(0, 'A'));
    await append(short.host, nameDraft(1, 'B'));
    expect(await append(short.host, nameDraft(2, 'C'))).toMatchObject({ why: 'limit' });
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

  type Op =
    | { kind: 'edit'; target: RulesetContent }
    | { kind: 'invalid' | 'stale' | 'repeat' | 'newer' }
    | { kind: 'resume'; at: number };
  const arbOp: fc.Arbitrary<Op> = fc.oneof(
    { weight: 6, arbitrary: arbRuleset.map((target) => ({ kind: 'edit' as const, target })) },
    {
      weight: 4,
      arbitrary: fc.constantFrom(
        { kind: 'invalid' as const },
        { kind: 'stale' as const },
        { kind: 'repeat' as const },
        { kind: 'newer' as const }
      )
    },
    { weight: 1, arbitrary: fc.nat({ max: 20 }).map((at) => ({ kind: 'resume' as const, at })) }
  );

  it('keeps I1 to I7 and I9 after every operation of any sequence', async () => {
    let accepted = 0;
    let refused = 0;
    await expect(
      fc.assert(
        fc.asyncProperty(fc.array(arbOp, { maxLength: 12 }), async (ops) => {
          const sentBodies: string[] = [];
          const { host, store } = make({ onCommit: (body) => sentBodies.push(body) });
          const sent: CommitDraft[] = [];
          let now = T0;
          for (const op of ops) {
            now += 1000;
            const tip = store.totals().seq;
            const rowsBefore = store.rowsAfter(0, ALL);
            if (op.kind === 'resume') {
              const frames = await resumeOf(host, op.at);
              if (op.at > tip) expect(frames).toBeNull();
              else
                expect(seqsOf(frames ?? [])).toEqual(
                  rowsBefore.filter((r) => r.seq > op.at).map((r) => r.seq)
                );
              continue;
            }
            let d: CommitDraft | null = null;
            if (op.kind === 'edit') d = draftTo(host.ruleset(), op.target, tip);
            if (op.kind === 'invalid')
              d = { ...nameDraft(tip, 'X'), changes: [{ op: 'delete', key: 'p:nope' }] };
            if (op.kind === 'stale') d = nameDraft(tip + 1, 'Stale');
            if (op.kind === 'repeat') d = sent.at(-1) ?? null;
            if (op.kind === 'newer') d = nameDraft(tip, 'New', { shapes: SHAPES_REVISION + 1 });
            if (!d) continue;
            const before = snapshot(store, host);
            const out = await append(host, d, now);
            if (out.kind === 'accepted') {
              accepted++;
              sent.push(d);
              expect(op.kind).toBe('edit');
            } else {
              refused++;
              // I5: nothing moved.
              expect(snapshot(store, host)).toEqual(before);
              if (op.kind === 'repeat') expect(out).toEqual({ kind: 'duplicate', id: d.id });
              if (op.kind === 'newer') expect(out).toMatchObject({ why: 'newer' });
              if (op.kind === 'invalid') expect(out).toMatchObject({ why: 'invalid' });
              if (op.kind === 'stale') expect(out).toMatchObject({ why: 'behind' });
            }
            const rowsAfter = store.rowsAfter(0, ALL);
            // I9: what was stored is still stored, unchanged.
            expect(rowsAfter.slice(0, rowsBefore.length)).toEqual(rowsBefore);
            // I4, I7: every stored commit was sent once, in order, after it was stored.
            expect(sentBodies).toEqual(rowsAfter.map((r) => r.body));
            await expectInvariants(store, host);
          }
        }),
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
});
