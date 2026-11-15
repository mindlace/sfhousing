import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SHAPES_REVISION } from '$lib/sim-log';
import type { IndexSummary, IndexedCommit } from './index-sync';
import { IndexRunner, takeDownInOrder } from './index-runner';
import { LIMITS, utf8Bytes } from './limits';
import { LogHost, type Author } from './log-host';
import { SimStore } from './store';
import { nameDraft } from './test/drafts';
import { freshSimDb, storeWithRow } from './test/harness';

const T0 = 1_700_000_000_000;
const WRITER: Author = { identity: 'u1', write: true };

/** A promise the test resolves or rejects by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Call = { simId: string; seqs: number[]; summary: IndexSummary };

function setup(opts: { simId?: string | undefined; batch?: number } = {}) {
  const store = new SimStore(freshSimDb().db);
  const host = new LogHost(store, { limits: { ...LIMITS, burst: 1000 } });
  const calls: Call[] = [];
  let next: (() => Promise<void>) | null = null;
  const sync = vi.fn(
    async (simId: string, commits: readonly IndexedCommit[], summary: IndexSummary) => {
      calls.push({ simId, seqs: commits.map((c) => c.commit.seq), summary });
      if (next) await next();
    }
  );
  const armRetry = vi.fn(async () => {});
  const runner = new IndexRunner(host, {
    simId: 'simId' in opts ? opts.simId : 's1',
    sync,
    armRetry,
    batch: opts.batch
  });
  const append = (parent: number, now = T0) => {
    const d = nameDraft(parent, `N${parent}`);
    return host.append(d, d.id, utf8Bytes(JSON.stringify(d)), WRITER, now);
  };
  return {
    store,
    host,
    runner,
    calls,
    sync,
    armRetry,
    append,
    /** Each later sync call runs `fn` before it resolves. */
    onSync: (fn: (() => Promise<void>) | null) => {
      next = fn;
    }
  };
}

let err: MockInstance<typeof console.error>;
beforeEach(() => {
  err = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  err.mockRestore();
});

describe('IndexRunner', () => {
  it('copies unindexed commits in batches and moves the watermark', async () => {
    const t = setup({ batch: 2 });
    for (let s = 0; s < 5; s++) await t.append(s);
    await t.runner.kick();
    expect(t.calls.map((c) => c.seqs)).toEqual([[1, 2], [3, 4], [5]]);
    expect(t.calls.every((c) => c.simId === 's1')).toBe(true);
    expect(t.calls.at(-1)?.summary.positions).toBe(5);
    expect(t.store.indexedSeq()).toBe(5);
    expect(err).not.toHaveBeenCalled();
  });

  it('runs one pass at a time, and a pass picks up rows stored during its write', async () => {
    const t = setup();
    await t.append(0);
    const gate = deferred();
    t.onSync(() => gate.promise);
    const first = t.runner.kick();
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    await t.append(1);
    expect(t.runner.kick()).toBe(first);
    t.onSync(null);
    gate.resolve();
    await first;
    expect(t.calls.map((c) => c.seqs)).toEqual([[1], [2]]);
    expect(t.store.indexedSeq()).toBe(2);
  });

  it('a takedown during a write: no watermark write, no D1 write after takeDown returns', async () => {
    const t = setup();
    await t.append(0);
    await t.append(1);
    const gate = deferred();
    t.onSync(() => gate.promise);
    const pass = t.runner.kick();
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    const mark = vi.spyOn(t.host, 'markIndexed');
    const closeAll = vi.fn();
    let done = false;
    const down = takeDownInOrder(t.host, t.runner, T0 + 5, closeAll).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(t.host.gone()).toBe(true));
    // The sockets are not closed, and takeDown has not returned, while the write is open.
    expect(closeAll).not.toHaveBeenCalled();
    expect(done).toBe(false);
    gate.resolve();
    await down;
    await pass;
    expect(closeAll).toHaveBeenCalledOnce();
    expect(mark).not.toHaveBeenCalled();
    expect(t.store.indexedSeq()).toBe(0);
    const writes = t.sync.mock.calls.length;
    await t.runner.kick();
    expect(t.sync.mock.calls.length).toBe(writes);
  });

  it('takeDownInOrder with no pass in flight clears, then closes', async () => {
    const t = setup();
    await t.append(0);
    const order: string[] = [];
    await takeDownInOrder(t.host, t.runner, T0, () => order.push(`closed gone=${t.host.gone()}`));
    expect(order).toEqual(['closed gone=true']);
  });

  it('logs a failing D1 write once per outage and arms the retry each time', async () => {
    const t = setup();
    await t.append(0);
    t.onSync(async () => {
      throw new Error('D1 down');
    });
    await t.runner.kick();
    await t.append(1);
    await t.runner.kick();
    await t.runner.kick();
    expect(t.armRetry).toHaveBeenCalledTimes(3);
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0].join(' ')).toContain('s1');
    expect(err.mock.calls[0].join(' ')).toContain('D1 down');
    expect(t.store.indexedSeq()).toBe(0);
    // Recovery copies from the watermark; a later outage is logged again.
    t.onSync(null);
    await t.runner.kick();
    expect(t.store.indexedSeq()).toBe(2);
    await t.append(2);
    t.onSync(async () => {
      throw new Error('D1 down again');
    });
    await t.runner.kick();
    expect(err).toHaveBeenCalledTimes(2);
  });

  it('logs a retry it cannot schedule', async () => {
    const t = setup();
    await t.append(0);
    t.onSync(async () => {
      throw new Error('D1 down');
    });
    t.armRetry.mockRejectedValueOnce(new Error('no alarm'));
    await expect(t.runner.kick()).resolves.toBeUndefined();
    expect(err.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('no alarm');
  });

  it('a summary that does not fold logs once and arms no retry', async () => {
    const store = await storeWithRow({ shapes: SHAPES_REVISION + 1 });
    const host = new LogHost(store);
    const sync = vi.fn(async () => {});
    const armRetry = vi.fn(async () => {});
    const runner = new IndexRunner(host, { simId: 's9', sync, armRetry });
    await runner.kick();
    expect(sync).not.toHaveBeenCalled();
    expect(armRetry).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0].join(' ')).toContain('s9');
    expect(store.indexedSeq()).toBe(0);
  });

  it('logs once, and copies nothing, without a sim id', async () => {
    const t = setup({ simId: undefined });
    await t.append(0);
    await t.runner.kick();
    await t.runner.kick();
    expect(t.sync).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0].join(' ')).toMatch(/no sim id/);
  });

  it('settled resolves at once with no pass, and never rejects', async () => {
    const t = setup();
    await expect(t.runner.settled()).resolves.toBeUndefined();
    await t.append(0);
    t.onSync(async () => {
      throw new Error('D1 down');
    });
    const pass = t.runner.kick();
    await expect(t.runner.settled()).resolves.toBeUndefined();
    await expect(pass).resolves.toBeUndefined();
  });
});
