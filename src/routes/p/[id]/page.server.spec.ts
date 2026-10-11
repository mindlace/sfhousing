import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePlan } from '$lib/plan';
import { handlePublish } from '$lib/server/sharing/publish';
import { loadSharedPlan } from '$lib/server/sharing/shared-page';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import { COPY } from '$lib/sharing/copy';
import { load } from './+page.server';

const small = readFileSync(
  fileURLToPath(new URL('../../../lib/sharing/fixtures/plans/small.json', import.meta.url)),
  'utf8'
);
const NOW = new Date('2026-10-11T12:34:56.789Z');

const opened: TestD1[] = [];

afterEach(() => {
  for (const t of opened.splice(0)) t.close();
  vi.restoreAllMocks();
});

function platformFor(t: TestD1, bucket: FakeR2Bucket) {
  return testPlatform({
    d1: t.d1,
    BUCKET: bucket as never,
    ENVIRONMENT: 'production',
    PUBLISH_RL: new FakeRateLimiter({ allow: 100 }) as never
  });
}

async function seed(datasetVersion = 'fixture-0') {
  const t = createTestD1();
  opened.push(t);
  const publishBucket = new FakeR2Bucket();
  publishBucket.put(`data/${datasetVersion}/manifest.json`, '{}');
  const body = JSON.stringify({ ...JSON.parse(small), datasetVersion });
  const res = await handlePublish(
    {
      request: new Request('https://sfhousing.test/api/plans', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' }
      }),
      platform: platformFor(t, publishBucket)
    },
    { now: () => NOW }
  );
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return { t, id };
}

describe('loadSharedPlan', () => {
  it('returns the plan with no R2 call when its dataset version is current', async () => {
    const { t, id } = await seed('fixture-0');
    const bucket = new FakeR2Bucket();
    const data = await loadSharedPlan({
      id,
      platform: platformFor(t, bucket),
      current: 'fixture-0'
    });
    const parsed = parsePlan(small);
    expect(parsed.ok).toBe(true);
    expect(data).toEqual({
      id,
      plan: parsed.ok ? parsed.value : undefined,
      createdAt: NOW.toISOString(),
      currentDatasetVersion: 'fixture-0',
      datasetNotice: 'none'
    });
    expect(bucket.calls.filter((c) => c.method === 'head')).toEqual([]);
  });

  it("renders on the plan's version when its manifest still exists (remix notice)", async () => {
    const { t, id } = await seed('fixture-1');
    const bucket = new FakeR2Bucket();
    bucket.put('data/fixture-1/manifest.json', '{}');
    const data = await loadSharedPlan({
      id,
      platform: platformFor(t, bucket),
      current: 'fixture-0'
    });
    expect(data.datasetNotice).toBe('remix');
    expect(data.currentDatasetVersion).toBe('fixture-0');
    expect(bucket.calls).toEqual([{ method: 'head', key: 'data/fixture-1/manifest.json' }]);
  });

  it('renders on the current version when the plan version is gone', async () => {
    const { t, id } = await seed('fixture-1');
    const bucket = new FakeR2Bucket();
    const data = await loadSharedPlan({
      id,
      platform: platformFor(t, bucket),
      current: 'fixture-0'
    });
    expect(data.datasetNotice).toBe('gone');
    expect(data.plan.datasetVersion).toBe('fixture-1');
  });

  it('404s a malformed id without touching the database', async () => {
    const prepare = vi.fn();
    const platform = testPlatform({ d1: { prepare } as unknown as D1Database });
    await expect(
      loadSharedPlan({ id: '0OIl0OIl', platform, current: 'fixture-0' })
    ).rejects.toMatchObject({ status: 404, body: { message: COPY.notFoundHeading } });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('404s a missing id', async () => {
    const t = createTestD1();
    opened.push(t);
    await expect(
      loadSharedPlan({
        id: 'zzzzzzzz',
        platform: platformFor(t, new FakeR2Bucket()),
        current: 'fixture-0'
      })
    ).rejects.toMatchObject({ status: 404, body: { message: COPY.notFoundHeading } });
  });

  it('500s a stored body that parsePlan rejects', async () => {
    const t = createTestD1();
    opened.push(t);
    t.sqlite
      .prepare(
        'INSERT INTO plan (id, schema, dataset_version, body, content_hash, op_count, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('abcdefgh', 9, 'fixture-0', '{"schema":9}', 'deadbeef', 0, 12, NOW.getTime());
    await expect(
      loadSharedPlan({
        id: 'abcdefgh',
        platform: platformFor(t, new FakeR2Bucket()),
        current: 'fixture-0'
      })
    ).rejects.toMatchObject({ status: 500, body: { message: COPY.unparsable } });
  });
});

describe('/p/[id] load', () => {
  it('uses the layout dataset version and sets the cache header on success', async () => {
    const { t, id } = await seed('fixture-0');
    const setHeaders = vi.fn();
    const data = await load({
      params: { id },
      platform: platformFor(t, new FakeR2Bucket()),
      parent: async () => ({ datasetVersion: 'fixture-0', appRelease: 'dev' }),
      setHeaders
    } as never);
    expect(data).toMatchObject({ id, currentDatasetVersion: 'fixture-0', datasetNotice: 'none' });
    expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, max-age=300' });
  });

  it('does not set the cache header when the plan is not found', async () => {
    const t = createTestD1();
    opened.push(t);
    const setHeaders = vi.fn();
    await expect(
      load({
        params: { id: 'zzzzzzzz' },
        platform: platformFor(t, new FakeR2Bucket()),
        parent: async () => ({ datasetVersion: 'fixture-0', appRelease: 'dev' }),
        setHeaders
      } as never)
    ).rejects.toMatchObject({ status: 404 });
    expect(setHeaders).not.toHaveBeenCalled();
  });
});
