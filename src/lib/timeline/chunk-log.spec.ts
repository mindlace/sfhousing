import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewOf } from '$lib/sim/world/score/view';
import type { MoneyRow, SeriesChunk } from '$lib/sim/world/score/types';
import {
  EMPTY_LOG,
  logCompiled,
  logFilled,
  logRefill,
  nextMonth,
  viewOfLog,
  type ChunkLog
} from './chunk-log';
import { chunk, poolRow, statics } from './test/fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

const zeroPool = (id: string): MoneyRow['pools'][number] => ({
  ...poolRow(id, 0),
  received: 0,
  committed: 0,
  out: 0,
  spent: 0,
  repaid: 0,
  lost: 0,
  lostCredit: 0
});

describe('chunk log', () => {
  it('builds nothing before the first compiled, then joins the early chunks', () => {
    let log = logFilled(EMPTY_LOG, chunk(0, 3));
    expect(viewOfLog(log)).toBeNull();
    log = logCompiled(log, statics());
    expect(viewOfLog(log)!.filledThrough).toBe(2);
  });

  it('tags a chunk with the statics of the last compiled delivered before it', () => {
    const a = statics(),
      b = statics();
    let log = logFilled(logCompiled(EMPTY_LOG, a), chunk(0, 2));
    log = logFilled(logCompiled(log, b), chunk(2, 2));
    expect(log.entries.map((e) => e.statics)).toEqual([a, b]);
    expect(log.entries[0].statics).toBe(a);
    expect(log.entries[1].statics).toBe(b);
  });

  it('keeps the statics of entries that already have one on a later compiled', () => {
    const a = statics(),
      b = statics();
    let log = logFilled(EMPTY_LOG, chunk(0, 2));
    log = logFilled(logCompiled(log, a), chunk(2, 2));
    log = logCompiled(log, b);
    expect(log.statics).toBe(b);
    expect(log.entries[0].statics).toBe(a);
    expect(log.entries[1].statics).toBe(a);
  });

  it('applies refill then filled in arrival order whatever the rev', () => {
    let log = logFilled(logFilled(logCompiled(EMPTY_LOG, statics()), chunk(0, 5)), chunk(5, 5));
    log = logRefill(log, 7);
    expect(nextMonth(log)).toBe(7);
    log = logFilled(log, chunk(7, 3, { base: 100 }));
    expect(viewOfLog(log)!.rows[8].completedNet).toBe(
      chunk(7, 3, { base: 100 }).rows[1].completedNet
    );
    expect(viewOfLog(log)!.rows[6]).toEqual(chunk(5, 5).rows[1]);
  });

  it('refill keeps each kept entry its statics and trims the straddling chunk', () => {
    const a = statics(),
      b = statics();
    let log = logFilled(logCompiled(EMPTY_LOG, a), chunk(0, 4));
    log = logFilled(logCompiled(log, b), chunk(4, 4));
    log = logFilled(log, chunk(8, 4));
    const cut = logRefill(log, 6);
    expect(cut.entries).toHaveLength(2);
    expect(cut.entries[0]).toBe(log.entries[0]);
    expect(cut.entries[1].statics).toBe(b);
    expect(cut.entries[1].chunk.rows).toHaveLength(2);
    expect(cut.statics).toBe(b);
    expect(log.entries[1].chunk.rows).toHaveLength(4);
    expect(nextMonth(logRefill(log, 0))).toBe(0);
    expect(nextMonth(logRefill(log, 40))).toBe(12);
  });

  it('drops a chunk that does not follow and logs it', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = logFilled(logCompiled(EMPTY_LOG, statics()), chunk(0, 3));
    const after = logFilled(log, chunk(4, 2));
    expect(after).toBe(log);
    expect(after.entries).toHaveLength(1);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('viewOfLog with a pool added by an edit', () => {
    const S0 = statics({ finance: true });
    const S = statics({ finance: true });
    let log: ChunkLog = logCompiled(EMPTY_LOG, S0);
    log = logFilled(log, chunk(0, 5, { pools: ['b1'] }));
    log = logFilled(log, chunk(5, 5, { pools: ['b1'] }));
    log = logRefill(log, 6);
    log = logCompiled(log, S);
    log = logFilled(log, chunk(6, 4, { pools: ['b1', 'u-new'], base: 50 }));

    const early = chunk(0, 5, { pools: ['b1'] });
    const mid = chunk(5, 1, { pools: ['b1'] });
    const add = (c: SeriesChunk): SeriesChunk => ({
      ...c,
      money: c.money!.map((r) => ({ ...r, pools: [...r.pools, zeroPool('u-new')] }))
    });
    const alignedByHand = [add(early), add(mid), chunk(6, 4, { pools: ['b1', 'u-new'], base: 50 })];

    const v = viewOfLog(log)!;
    expect(v.money!.pools.map((p) => p.id)).toEqual(['b1', 'u-new']);
    expect(v.money!.pools[1].received.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(v.money!.pools[1].label).toBe(poolRow('u-new', 0).label);
    expect(v.money!.pools[0].received.slice(0, 6)).toEqual(
      early.money!.map((r) => r.pools[0].received).concat(mid.money![0].pools[0].received)
    );
    expect(v.money!.perAddedHome).toEqual(viewOf(alignedByHand, S).money!.perAddedHome);
    expect(v).toEqual(viewOf(alignedByHand, S));
    expect(log.entries[0].chunk.money![0].pools).toHaveLength(1);
  });

  it('drops a pool the newest money lacks and gives a chunk without money zero rows', () => {
    const S = statics({ finance: true });
    let log = logCompiled(EMPTY_LOG, S);
    log = logFilled(log, chunk(0, 2, { pools: ['b1', 'old'] }));
    log = logFilled(log, chunk(2, 2));
    log = logFilled(log, chunk(4, 2, { pools: ['b1'] }));
    const v = viewOfLog(log)!;
    expect(v.money!.pools.map((p) => p.id)).toEqual(['b1']);
    expect(v.money!.pools[0].received.slice(2, 4)).toEqual([0, 0]);
    expect(v.money!.fundedHomes.slice(2, 4)).toEqual([0, 0]);
    expect(v.money!.fundedHomes).toHaveLength(6);
  });

  it('strips money when the newest statics has no finance', () => {
    let log = logFilled(EMPTY_LOG, chunk(0, 3, { pools: ['b1'] }));
    log = logCompiled(log, statics());
    expect(() => viewOfLog(log)).not.toThrow();
    expect(viewOfLog(log)!.money).toBeNull();

    let edited = logFilled(
      logCompiled(EMPTY_LOG, statics({ finance: true })),
      chunk(0, 3, { pools: ['b1'] })
    );
    edited = logRefill(logCompiled(edited, statics()), 2);
    edited = logFilled(edited, chunk(2, 2));
    expect(viewOfLog(edited)!.money).toBeNull();
    expect(viewOfLog(edited)!.filledThrough).toBe(3);
  });

  it('an empty log after compiled is an empty view with null money and tiers', () => {
    const v = viewOfLog(logCompiled(EMPTY_LOG, statics({ finance: true })))!;
    expect([v.filledThrough, v.money, v.tiers]).toEqual([-1, null, null]);
  });

  it('nextMonth is 0 for the empty log and one past the last month held', () => {
    expect(nextMonth(EMPTY_LOG)).toBe(0);
    expect(nextMonth(logFilled(EMPTY_LOG, chunk(0, 7)))).toBe(7);
  });
});
