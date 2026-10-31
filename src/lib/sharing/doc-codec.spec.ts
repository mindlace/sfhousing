import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePlan, serializePlan, type Result } from '$lib/plan';
import { Autosave } from './autosave.svelte';
import { COPY, copyFor, tooLarge } from './copy';
import { PLAN_CODEC, type DocCodec } from './doc-codec';
import { MemoryStorage } from './fixtures/memory-storage';
import { readRecord } from './storage';

const small = readFileSync(new URL('./fixtures/plans/small.json', import.meta.url), 'utf8');

describe('PLAN_CODEC', () => {
  it('serializes as serializePlan; parse and load equal parsePlan', () => {
    const p = parsePlan(small);
    if (!p.ok) throw new Error('fixture');
    expect(PLAN_CODEC.serialize(p.value)).toBe(serializePlan(p.value));
    expect(PLAN_CODEC.parse(small)).toEqual(parsePlan(small));
    expect(PLAN_CODEC.load(small)).toEqual(parsePlan(small));
  });

  it('is empty only with no ops; publishable is identity', () => {
    const p = parsePlan(small);
    if (!p.ok) throw new Error('fixture');
    expect(PLAN_CODEC.isEmpty(p.value)).toBe(false);
    expect(PLAN_CODEC.isEmpty({ ...p.value, ops: [] })).toBe(true);
    expect(PLAN_CODEC.publishable(p.value)).toBe(p.value);
    expect(PLAN_CODEC.opCount(p.value)).toBe(p.value.ops.length);
  });

  it('has the plan keys and paths', () => {
    expect(PLAN_CODEC.kind).toBe('plan');
    expect(PLAN_CODEC.api).toBe('/api/plans');
    expect(PLAN_CODEC.storageKey).toBe('sfhousing:plan:v1');
    expect(PLAN_CODEC.path('abcdEFGH')).toBe('/p/abcdEFGH');
    expect(PLAN_CODEC.corruptKey('X')).toBe('sfhousing:plan:corrupt:X');
  });
});

describe('copyFor', () => {
  it('plan matches COPY', () => {
    const c = copyFor('plan');
    for (const k of Object.keys(COPY) as (keyof typeof COPY)[]) expect(c[k]).toEqual(COPY[k]);
    expect(c.tooLarge(300_000)).toBe(tooLarge(300_000));
  });

  it('sim says policy', () => {
    const c = copyFor('sim');
    expect(c.dialogHeading).toBe('Publish this policy');
    expect(c.disabledHint).toBe('Change the policy first.');
    expect(c.tooLarge(300_000)).toContain('Try fewer or shorter strokes, or fewer brushes.');
    expect(c.remixConfirm(3)).toBe(
      'Replace your current policy with a copy of this one? Your current policy will be lost unless you publish it first.'
    );
  });
});

type Doc = { n: number; v: string };
const TEST_CODEC: DocCodec<Doc> = {
  kind: 'sim',
  api: '/api/policies',
  path: (id) => `/s/${id}`,
  storageKey: 'test:doc:v1',
  corruptKey: (iso) => `test:doc:corrupt:${iso}`,
  parse: (t): Result<Doc> => ({ ok: true, value: JSON.parse(t) as Doc }),
  load: (t): Result<Doc> => ({ ok: true, value: JSON.parse(t) as Doc }),
  serialize: (d) => JSON.stringify(d),
  publishable: (d) => d,
  schema: () => 1,
  datasetVersion: (d) => d.v,
  rebase: (d, v) => ({ ...d, v }),
  empty: (v) => ({ n: 0, v }),
  isEmpty: (d) => d.n === 0,
  opCount: (d) => d.n,
  title: () => undefined,
  withTitle: (d) => d
};

describe('Autosave with a custom codec', () => {
  it('writes under the codec storageKey and readRecord reads it back', () => {
    const s = new MemoryStorage();
    const a = new Autosave<Doc>({ currentVersion: 'v1', codec: TEST_CODEC, storage: () => s });
    const r = a.restore();
    expect(r.plan).toEqual({ n: 0, v: 'v1' });
    a.setLastPublished({ id: 'x', hash: 'h' }, { n: 2, v: 'v1' });
    expect(s.getItem('sfhousing:plan:v1')).toBeNull();
    expect(s.getItem('test:doc:v1')).not.toBeNull();
    const read = readRecord(s, TEST_CODEC);
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.plan).toEqual({ n: 2, v: 'v1' });
  });
});
