import { describe, expect, it } from 'vitest';
import { GENESIS_HASH } from '$lib/sim-log';
import { SimStore, type StoredRow } from './store';
import { freshSimDb } from './test/harness';

const row = (seq: number, over: Partial<StoredRow> = {}): StoredRow => ({
  seq,
  id: `id-${seq}`,
  hash: String(seq).padStart(64, '0'),
  bytes: 10 * seq,
  body: `{"seq":${seq}}`,
  ...over
});

describe('SimStore', () => {
  it('an empty store is at seq 0 with the genesis hash', () => {
    const store = new SimStore(freshSimDb().db);
    expect(store.totals()).toEqual({ seq: 0, hash: GENESIS_HASH, bytes: 0 });
    expect(store.goneAt()).toBeNull();
    expect(store.indexedSeq()).toBe(0);
  });

  it('keeps positions gapless', () => {
    const store = new SimStore(freshSimDb().db);
    store.insert(row(1));
    store.insert(row(2));
    expect(() => store.insert(row(4))).toThrow(RangeError);
    expect(() => store.insert(row(2, { id: 'other' }))).toThrow(RangeError);
    expect(store.totals()).toEqual({ seq: 2, hash: row(2).hash, bytes: 30 });
  });

  it('tipSeq is the last position, 0 when empty', () => {
    const store = new SimStore(freshSimDb().db);
    expect(store.tipSeq()).toBe(0);
    store.insert(row(1));
    store.insert(row(2));
    expect(store.tipSeq()).toBe(2);
  });

  it('refuses a second row with one id', () => {
    const store = new SimStore(freshSimDb().db);
    store.insert(row(1));
    expect(() => store.insert(row(2, { id: 'id-1' }))).toThrow();
    expect(store.totals().seq).toBe(1);
  });

  it('finds stored ids', () => {
    const store = new SimStore(freshSimDb().db);
    store.insert(row(1));
    expect(store.hasId('id-1')).toBe(true);
    expect(store.hasId('id-2')).toBe(false);
  });

  it('pages rows after a position in order', () => {
    const store = new SimStore(freshSimDb().db);
    for (let s = 1; s <= 5; s++) store.insert(row(s));
    expect(store.rowsAfter(1, 2).map((r) => r.seq)).toEqual([2, 3]);
    expect(store.rowsAfter(3, 10).map((r) => r.seq)).toEqual([4, 5]);
    expect(store.rowsAfter(5, 10)).toEqual([]);
    expect(store.rowsAfter(0, 1)[0]).toEqual(row(1));
  });

  it('pages positions and stored sizes after a position, without bodies', () => {
    const store = new SimStore(freshSimDb().db);
    for (let s = 1; s <= 5; s++) store.insert(row(s));
    expect(store.sizesAfter(1, 2)).toEqual([
      { seq: 2, bytes: 20 },
      { seq: 3, bytes: 30 }
    ]);
    expect(store.sizesAfter(3, 10)).toEqual([
      { seq: 4, bytes: 40 },
      { seq: 5, bytes: 50 }
    ]);
    expect(store.sizesAfter(5, 10)).toEqual([]);
  });

  it('reads whole rows after one position through another', () => {
    const store = new SimStore(freshSimDb().db);
    for (let s = 1; s <= 5; s++) store.insert(row(s));
    expect(store.rowsThrough(1, 3)).toEqual([row(2), row(3)]);
    expect(store.rowsThrough(4, 9)).toEqual([row(5)]);
    expect(store.rowsThrough(3, 3)).toEqual([]);
  });

  it('keeps the index watermark across stores on one database', () => {
    const { db } = freshSimDb();
    new SimStore(db).setIndexedSeq(2);
    expect(new SimStore(db).indexedSeq()).toBe(2);
  });

  it('clear deletes every commit and leaves the mark', () => {
    const store = new SimStore(freshSimDb().db);
    store.insert(row(1));
    store.setIndexedSeq(1);
    store.clear(1234);
    expect(store.totals()).toEqual({ seq: 0, hash: GENESIS_HASH, bytes: 0 });
    expect(store.hasId('id-1')).toBe(false);
    expect(store.goneAt()).toBe(1234);
    expect(store.indexedSeq()).toBe(0);
  });
});
