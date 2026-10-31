import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { createTestD1, testPlatform } from './d1';
import { FakeRateLimiter } from './fake-rate-limiter';

const row = (id: string, contentHash: string) => ({
  id,
  schema: 1,
  datasetVersion: 'fixture-0',
  body: '{}',
  contentHash,
  opCount: 0,
  byteSize: 2,
  createdAt: new Date('2026-10-11T00:00:00Z')
});

describe('createTestD1', () => {
  it('applies the generated migration and round-trips a plan row through drizzle-orm/d1', async () => {
    const t = createTestD1();
    const db = drizzle(t.d1, { schema });
    const createdAt = new Date('2026-10-11T00:00:00Z');
    const res = await db
      .insert(schema.plan)
      .values(row('abcdefgh', 'h'))
      .onConflictDoNothing()
      .run();
    expect(res.meta.changes).toBe(1);
    const again = await db
      .insert(schema.plan)
      .values(row('zzzzzzzz', 'h'))
      .onConflictDoNothing()
      .run();
    expect(again.meta.changes).toBe(0);
    const found = await db.select().from(schema.plan).where(eq(schema.plan.id, 'abcdefgh')).get();
    expect(found?.createdAt).toEqual(createdAt);
    expect(found?.contentHash).toBe('h');
    const missing = await db.select().from(schema.plan).where(eq(schema.plan.id, 'nope')).get();
    expect(missing).toBeUndefined();
    const cols = (t.sqlite.prepare('PRAGMA table_info(plan)').all() as { name: string }[]).map(
      (c) => c.name
    );
    expect(cols.sort()).toEqual(
      [
        'body',
        'content_hash',
        'created_at',
        'dataset_version',
        'byte_size',
        'id',
        'kind',
        'op_count',
        'schema'
      ].sort()
    );
    t.close();
  });

  it('supports select().all(), batch() and first()', async () => {
    const t = createTestD1();
    const db = drizzle(t.d1, { schema });
    await db.batch([
      db.insert(schema.plan).values(row('aaaaaaaa', 'h1')),
      db.insert(schema.plan).values(row('bbbbbbbb', 'h2'))
    ]);
    const all = await db.select({ id: schema.plan.id }).from(schema.plan).all();
    expect(all.map((r) => r.id).sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    const first = await t.d1.prepare('SELECT count(*) AS n FROM plan').first<{ n: number }>();
    expect(first?.n).toBe(2);
    expect(await t.d1.prepare('SELECT count(*) AS n FROM plan').first('n')).toBe(2);
    t.close();
  });
});

describe('testPlatform', () => {
  it('exposes the shim as env.DB so getDb works, and passes other bindings through', async () => {
    const t = createTestD1();
    const limiter = new FakeRateLimiter({ allow: 1 });
    const platform = testPlatform({
      d1: t.d1,
      ENVIRONMENT: 'production',
      PUBLISH_RL: limiter as never
    });
    expect(platform.env.DB).toBe(t.d1);
    expect(platform.env.ENVIRONMENT).toBe('production');
    expect(platform.env.PUBLISH_RL).toBe(limiter);
    const db = getDb(platform);
    expect(await db.select().from(schema.plan).all()).toEqual([]);
    t.close();
  });

  it('yields no binding when PUBLISH_RL is explicitly undefined and no DB without d1', () => {
    const platform = testPlatform({ PUBLISH_RL: undefined });
    expect(platform.env.PUBLISH_RL).toBeUndefined();
    expect(() => getDb(platform)).toThrow(/DB unavailable/);
  });
});

describe('FakeRateLimiter', () => {
  it('records keys and denies once calls exceed allow', async () => {
    const rl = new FakeRateLimiter({ allow: 2 });
    expect(await rl.limit({ key: 'a' })).toEqual({ success: true });
    expect(await rl.limit({ key: 'b' })).toEqual({ success: true });
    expect(await rl.limit({ key: 'c' })).toEqual({ success: false });
    expect(rl.calls).toEqual(['a', 'b', 'c']);
  });
});
