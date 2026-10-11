import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PLAN_BYTES, parsePlan, serializePlan, type Plan } from '$lib/plan';
import { handlePublish, type PublishDeps } from '$lib/server/sharing/publish';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import type { ShareError } from '$lib/sharing/api';
import { sha256Hex } from '$lib/sharing/hash';
import { PLAN_ID_RE } from '$lib/sharing/ids';
import { normalizeTitle, withTitle } from '$lib/sharing/title';
import { POST } from './+server';

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../lib/sharing/fixtures/plans/${name}`, import.meta.url)),
    'utf8'
  );
const small = fixture('small.json');
const oversizeBytes = new TextEncoder().encode(fixture('oversize.json'));

const opened: TestD1[] = [];

afterEach(() => {
  for (const t of opened.splice(0)) t.close();
  vi.restoreAllMocks();
});

function setup(opts: { allow?: number; env?: string; noLimiter?: boolean; d1?: D1Database } = {}) {
  const t = createTestD1();
  opened.push(t);
  const bucket = new FakeR2Bucket();
  bucket.put('data/fixture-0/manifest.json', '{}');
  const limiter = new FakeRateLimiter({ allow: opts.allow ?? 100 });
  const platform = testPlatform({
    d1: opts.d1 ?? t.d1,
    BUCKET: bucket as never,
    ENVIRONMENT: opts.env ?? 'production',
    PUBLISH_RL: opts.noLimiter ? undefined : (limiter as never)
  });
  return { t, bucket, limiter, platform };
}

const post = (
  body: BodyInit | null,
  headers: Record<string, string> = { 'content-type': 'application/json' }
) =>
  new Request('https://sfhousing.test/api/plans', {
    method: 'POST',
    body,
    headers,
    duplex: 'half'
  } as RequestInit);

const streamOf = (bytes: Uint8Array, chunk = 16_384) => {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    }
  });
};

const NOW = new Date('2026-10-11T12:34:56.789Z');

async function publish(
  platform: App.Platform | undefined,
  request: Request,
  deps: PublishDeps = {}
) {
  return handlePublish({ request, platform }, { now: () => NOW, ...deps });
}

function expectJsonHeaders(res: Response) {
  expect(res.headers.get('content-type')).toBe('application/json');
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('access-control-allow-origin')).toBeNull();
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expectJsonHeaders(res);
  const body = (await res.json()) as ShareError;
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  expect(body.error.message.length).toBeGreaterThan(0);
  return body;
}

type DbRow = {
  id: string;
  schema: number;
  dataset_version: string;
  body: string;
  content_hash: string;
  op_count: number;
  byte_size: number;
  created_at: number;
};
const rows = (t: TestD1) => t.sqlite.prepare('SELECT * FROM plan').all() as DbRow[];

function insertRaw(t: TestD1, id: string, contentHash: string) {
  t.sqlite
    .prepare(
      'INSERT INTO plan (id, schema, dataset_version, body, content_hash, op_count, byte_size, created_at) VALUES (?, 1, ?, ?, ?, 0, 0, 0)'
    )
    .run(id, 'fixture-0', '{}', contentHash);
}

describe('POST /api/plans', () => {
  it('201 with a fresh id, Location and a correct row for small.json', async () => {
    const { t, platform } = setup();
    const res = await publish(platform, post(small));
    expect(res.status).toBe(201);
    expectJsonHeaders(res);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(PLAN_ID_RE);
    expect(res.headers.get('location')).toBe(`/p/${id}`);

    const parsed = parsePlan(small);
    if (!parsed.ok) throw new Error('fixture must parse');
    const body = serializePlan(parsed.value);
    const all = rows(t);
    expect(all).toHaveLength(1);
    const [row] = all;
    expect(row.id).toBe(id);
    expect(row.schema).toBe(1);
    expect(row.dataset_version).toBe('fixture-0');
    expect(row.body).toBe(body);
    expect(row.content_hash).toBe(await sha256Hex(body));
    expect(row.op_count).toBe(3);
    expect(row.byte_size).toBe(new TextEncoder().encode(body).byteLength);
    expect(row.created_at).toBe(NOW.getTime());
  });

  it('the route module POST delegates to handlePublish', async () => {
    const { platform } = setup();
    const res = await POST({ request: post(small), platform } as never);
    expect(res.status).toBe(201);
  });

  it('same body again → 200 with the same id and one row', async () => {
    const { t, platform } = setup();
    const first = (await (await publish(platform, post(small))).json()) as { id: string };
    const again = await publish(platform, post(small));
    expect(again.status).toBe(200);
    expectJsonHeaders(again);
    expect(again.headers.get('location')).toBeNull();
    expect(((await again.json()) as { id: string }).id).toBe(first.id);
    expect(t.sqlite.prepare('SELECT count(*) AS n FROM plan').get()).toEqual({ n: 1 });
  });

  it('a non-canonical equivalent body (extra field, whitespace) → the same id', async () => {
    const { t, platform } = setup();
    const first = (await (await publish(platform, post(small))).json()) as { id: string };
    const loose = JSON.stringify({ ...JSON.parse(small), extra: 1 }, null, 2);
    const res = await publish(platform, post(loose));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(first.id);
    expect(rows(t)).toHaveLength(1);
  });

  it('Review Focus 1: a padded title publishes trimmed and hashes the normalised plan', async () => {
    const { t, platform } = setup();
    const res = await publish(
      platform,
      post(JSON.stringify({ ...JSON.parse(small), title: '  My plan  ' }))
    );
    expect(res.status).toBe(201);
    const [row] = rows(t);
    expect(row.body).toContain('"title":"My plan"');
    const parsed = parsePlan(small);
    if (!parsed.ok) throw new Error('fixture must parse');
    const plan: Plan = parsed.value;
    expect(row.content_hash).toBe(
      await sha256Hex(serializePlan(withTitle(plan, normalizeTitle('  My plan  '))))
    );
  });

  it('Review Focus 4: application/json with params is accepted', async () => {
    const { platform } = setup();
    const res = await publish(
      platform,
      post(small, { 'content-type': 'Application/JSON; charset=utf-8' })
    );
    expect(res.status).toBe(201);
  });

  it('Review Focus 4: text/plain → 415 unsupported_media_type, limiter untouched', async () => {
    const { limiter, platform } = setup();
    await expectError(
      await publish(platform, post(small, { 'content-type': 'text/plain' })),
      415,
      'unsupported_media_type'
    );
    expect(limiter.calls).toEqual([]);
  });

  it('no content-type → 415 unsupported_media_type', async () => {
    const { platform } = setup();
    const req = post(null, {});
    expect(req.headers.get('content-type')).toBeNull();
    await expectError(await publish(platform, req), 415, 'unsupported_media_type');
  });

  it('413 by Content-Length header, after the rate limit', async () => {
    const { limiter, platform } = setup();
    const req = post('{}', {
      'content-type': 'application/json',
      'content-length': String(MAX_PLAN_BYTES + 1)
    });
    expect(req.headers.get('content-length')).toBe('262145');
    await expectError(await publish(platform, req), 413, 'too_large');
    expect(limiter.calls.length).toBe(1);
  });

  it('413 by streamed body without Content-Length (oversize.json)', async () => {
    const { platform } = setup();
    expect(oversizeBytes.byteLength).toBe(262_145);
    const req = post(streamOf(oversizeBytes));
    expect(req.headers.get('content-length')).toBeNull();
    await expectError(await publish(platform, req), 413, 'too_large');
  });

  it('413 for a 5001-op plan: too_many_ops is unreachable over HTTP (ruling 3)', async () => {
    const { platform } = setup();
    const ops = Array.from({ length: 5001 }, (_, i) => ({
      id: 'o' + i,
      kind: 'erase',
      radiusM: 5,
      path: [[-122.42, 37.76]]
    }));
    const text = JSON.stringify({ schema: 1, datasetVersion: 'fixture-0', ops });
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(MAX_PLAN_BYTES);
    await expectError(await publish(platform, post(text)), 413, 'too_large');
  });

  it('400 invalid_json for a non-JSON body', async () => {
    const { platform } = setup();
    await expectError(await publish(platform, post('not json')), 400, 'invalid_json');
  });

  it('422 unsupported_schema for schema 2', async () => {
    const { platform } = setup();
    await expectError(
      await publish(platform, post(fixture('schema2.json'))),
      422,
      'unsupported_schema'
    );
  });

  it('422 empty_plan for a plan with no ops', async () => {
    const { t, platform } = setup();
    await expectError(
      await publish(platform, post('{"schema":1,"datasetVersion":"fixture-0","ops":[]}')),
      422,
      'empty_plan'
    );
    expect(rows(t)).toHaveLength(0);
  });

  it('422 invalid_plan with details for stories: 0', async () => {
    const { platform } = setup();
    const bad = JSON.parse(small);
    bad.ops[0].stories = 0;
    const body = await expectError(
      await publish(platform, post(JSON.stringify(bad))),
      422,
      'invalid_plan'
    );
    const details = body.error.details;
    expect(Array.isArray(details)).toBe(true);
    expect(details!.length).toBeGreaterThan(0);
    expect(details!.length).toBeLessThanOrEqual(20);
    for (const d of details!) {
      expect(typeof d.path).toBe('string');
      expect(typeof d.code).toBe('string');
      expect(typeof d.message).toBe('string');
    }
  });

  it('422 unknown_dataset_version when the manifest is absent from R2', async () => {
    const { bucket, platform } = setup();
    await expectError(
      await publish(platform, post(fixture('old-version.json'))),
      422,
      'unknown_dataset_version'
    );
    expect(bucket.calls).toContainEqual({
      method: 'head',
      key: 'data/fixture-0000/manifest.json'
    });
  });

  it('429 with Retry-After: 60 when the limiter denies, and the body is never read', async () => {
    const { limiter, platform } = setup({ allow: 0 });
    let pulled = false;
    // highWaterMark 0: the stream pulls only when a reader asks, not eagerly on construction.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled = true;
          c.enqueue(new TextEncoder().encode(small));
          c.close();
        }
      },
      { highWaterMark: 0 }
    );
    const req = post(body, { 'content-type': 'application/json' });
    const res = await publish(platform, req);
    await expectError(res, 429, 'rate_limited');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(limiter.calls).toEqual(['publish:unknown']);
    expect(pulled).toBe(false);
    // Control: the flag does flip once the body is actually read.
    expect(await req.text()).toBe(small);
    expect(pulled).toBe(true);
  });

  it('keys the limiter on cf-connecting-ip', async () => {
    const { limiter, platform } = setup();
    await publish(
      platform,
      post(small, { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' })
    );
    expect(limiter.calls).toEqual(['publish:203.0.113.9']);
  });

  it('PK collision twice then a fresh id → 201 with the fresh id', async () => {
    const { t, platform } = setup();
    insertRaw(t, 'AAAAAAAA', 'other-hash');
    const ids = ['AAAAAAAA', 'AAAAAAAA', 'BBBBBBBB'];
    const newId = vi.fn(() => ids.shift()!);
    const res = await publish(platform, post(small), { newId });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'BBBBBBBB' });
    expect(res.headers.get('location')).toBe('/p/BBBBBBBB');
    expect(newId).toHaveBeenCalledTimes(3);
  });

  it('PK collision on all 3 attempts → 500 server_error', async () => {
    const { t, platform } = setup();
    insertRaw(t, 'AAAAAAAA', 'other-hash');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const newId = vi.fn(() => 'AAAAAAAA');
    await expectError(await publish(platform, post(small), { newId }), 500, 'server_error');
    expect(newId).toHaveBeenCalledTimes(3);
    expect(err).toHaveBeenCalled();
    expect(rows(t)).toHaveLength(1);
  });

  it('Review Focus 5: an identical publish racing past dedupe → 200 with the first id', async () => {
    const base = createTestD1();
    opened.push(base);
    const parsed = parsePlan(small);
    if (!parsed.ok) throw new Error('fixture must parse');
    const hash = await sha256Hex(serializePlan(parsed.value));
    insertRaw(base, 'FIRST111', hash);

    // The first SELECT filtering on content_hash (the step-8 dedupe) sees no row, as if the
    // concurrent publish had not committed yet; later statements see the real table.
    let hidden = false;
    const empty = {
      bind: () => empty,
      all: async () => ({ results: [], success: true, meta: {} }),
      raw: async () => [],
      first: async () => null,
      run: async () => ({ results: [], success: true, meta: {} })
    };
    const d1 = new Proxy(base.d1, {
      get(target, prop, recv) {
        if (prop !== 'prepare') return Reflect.get(target, prop, recv);
        return (sql: string) => {
          const s = sql.trim().toLowerCase();
          if (!hidden && s.startsWith('select') && /where[^]*content_hash/.test(s)) {
            hidden = true;
            return empty;
          }
          return target.prepare(sql);
        };
      }
    });
    const { platform } = setup({ d1 });
    const res = await publish(platform, post(small), { newId: () => 'SECOND22' });
    expect(hidden).toBe(true);
    expect(res.status).toBe(200);
    expectJsonHeaders(res);
    expect(await res.json()).toEqual({ id: 'FIRST111' });
    expect(base.sqlite.prepare('SELECT id FROM plan').all()).toEqual([{ id: 'FIRST111' }]);
  });

  it('production with PUBLISH_RL undefined → 429 (fail closed)', async () => {
    const { platform } = setup({ noLimiter: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expectError(await publish(platform, post(small)), 429, 'rate_limited');
  });

  it('development with a denying limiter → 201', async () => {
    const { platform } = setup({ env: 'development', allow: 0 });
    const res = await publish(platform, post(small));
    expect(res.status).toBe(201);
  });

  it('missing DB binding → 500 server_error JSON, without logging the IP', async () => {
    const bucket = new FakeR2Bucket();
    bucket.put('data/fixture-0/manifest.json', '{}');
    const platform = testPlatform({
      BUCKET: bucket as never,
      ENVIRONMENT: 'production',
      PUBLISH_RL: new FakeRateLimiter({ allow: 100 }) as never
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expectError(
      await publish(
        platform,
        post(small, { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.7' })
      ),
      500,
      'server_error'
    );
    expect(err).toHaveBeenCalled();
    for (const call of err.mock.calls)
      for (const arg of call) expect(String(arg)).not.toContain('198.51.100.7');
  });
});
