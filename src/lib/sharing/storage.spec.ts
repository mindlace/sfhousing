import { describe, expect, it } from 'vitest';
import { serializePlan, type Plan } from '$lib/plan';
import { MemoryStorage } from './fixtures/memory-storage';
import {
  PLAN_KEY,
  corruptKey,
  getStorage,
  preserveCorrupt,
  readRecord,
  writeRecord,
  type LocalPlanRecord
} from './storage';

const plan: Plan = {
  schema: 1,
  datasetVersion: 'fixture-0',
  title: 'Mine',
  ops: [{ kind: 'erase', radiusM: 5, path: [[-122.41, 37.76]], id: 'a' }]
};
const record = (over: Partial<LocalPlanRecord> = {}): LocalPlanRecord => ({
  v: 1,
  savedAt: '2026-10-11T00:00:00.000Z',
  plan: serializePlan(plan),
  ...over
});

describe('storage keys', () => {
  it('uses the spec key names', () => {
    expect(PLAN_KEY).toBe('sfhousing:plan:v1');
    expect(corruptKey('2026-10-11T00:00:00.000Z')).toBe(
      'sfhousing:plan:corrupt:2026-10-11T00:00:00.000Z'
    );
  });
});

describe('getStorage', () => {
  it('returns null when localStorage is undefined (node/SSR)', () => {
    expect(getStorage()).toBeNull();
  });
});

describe('readRecord', () => {
  it('missing', () => {
    expect(readRecord(new MemoryStorage())).toEqual({ kind: 'missing' });
  });

  it('ok, with lastPublished', () => {
    const s = new MemoryStorage();
    const rec = record({ lastPublished: { id: 'abcdEFGH', hash: 'f'.repeat(64) } });
    s.setItem(PLAN_KEY, JSON.stringify(rec));
    const r = readRecord(s);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.record).toEqual(rec);
    expect(r.plan).toEqual(plan);
  });

  it.each([
    ['bad JSON', '{nope'],
    ['v: 2', JSON.stringify({ ...record(), v: 2 })],
    ['missing plan field', JSON.stringify({ v: 1, savedAt: 'x' })],
    ['missing savedAt', JSON.stringify({ v: 1, plan: serializePlan(plan) })],
    ['non-object', '42'],
    ['bad lastPublished', JSON.stringify({ ...record(), lastPublished: { id: 1 } })],
    ['parsePlan failure', JSON.stringify(record({ plan: '{"schema":1}' }))]
  ])('%s → corrupt with raw', (_name, raw) => {
    const s = new MemoryStorage();
    s.setItem(PLAN_KEY, raw);
    expect(readRecord(s)).toEqual({ kind: 'corrupt', raw });
  });

  it('schema: 2 plan → future', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify(
      record({ plan: JSON.stringify({ schema: 2, datasetVersion: 'fixture-0', ops: [] }) })
    );
    s.setItem(PLAN_KEY, raw);
    expect(readRecord(s)).toEqual({ kind: 'future', raw });
  });
});

describe('writeRecord', () => {
  it('writes JSON and returns true', () => {
    const s = new MemoryStorage();
    expect(writeRecord(s, record())).toBe(true);
    expect(JSON.parse(s.getItem(PLAN_KEY) as string)).toEqual(record());
  });

  it('returns false on QuotaExceededError', () => {
    const s = new MemoryStorage();
    s.failWrites = true;
    expect(writeRecord(s, record())).toBe(false);
    expect(s.getItem(PLAN_KEY)).toBeNull();
  });
});

describe('preserveCorrupt', () => {
  it('copies raw under the corrupt key for now', () => {
    const s = new MemoryStorage();
    const now = new Date('2026-10-11T01:02:03.000Z');
    expect(preserveCorrupt(s, '{nope', now)).toBe(true);
    expect(s.getItem(corruptKey(now.toISOString()))).toBe('{nope');
  });

  it('returns false when the write throws', () => {
    const s = new MemoryStorage();
    s.failWrites = true;
    expect(preserveCorrupt(s, '{nope', new Date())).toBe(false);
    expect(s.length).toBe(0);
  });
});
