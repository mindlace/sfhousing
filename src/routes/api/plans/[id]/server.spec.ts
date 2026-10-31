import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePlan, serializePlan } from '$lib/plan';
import { handleGetPlan } from '$lib/server/sharing/get-plan';
import { handlePublish } from '$lib/server/sharing/publish';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import type { ShareError } from '$lib/sharing/api';
import { PLAN_CODEC } from '$lib/sharing/doc-codec';
import { sha256Hex } from '$lib/sharing/hash';
import { GET } from './+server';

const small = readFileSync(
  fileURLToPath(new URL('../../../../lib/sharing/fixtures/plans/small.json', import.meta.url)),
  'utf8'
);

const opened: TestD1[] = [];

afterEach(() => {
  for (const t of opened.splice(0)) t.close();
  vi.restoreAllMocks();
});

function setup() {
  const t = createTestD1();
  opened.push(t);
  const bucket = new FakeR2Bucket();
  bucket.put('data/fixture-0/manifest.json', '{}');
  const platform = testPlatform({
    d1: t.d1,
    BUCKET: bucket as never,
    ENVIRONMENT: 'production',
    PUBLISH_RL: new FakeRateLimiter({ allow: 100 }) as never
  });
  return { t, platform };
}

async function publishSmall(platform: App.Platform): Promise<string> {
  const res = await handlePublish(
    {
      request: new Request('https://sfhousing.test/api/plans', {
        method: 'POST',
        body: small,
        headers: { 'content-type': 'application/json' }
      }),
      platform
    },
    PLAN_CODEC
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const get = (platform: App.Platform | undefined, id: string, headers: HeadersInit = {}) =>
  handleGetPlan(
    {
      params: { id },
      request: new Request(`https://sfhousing.test/api/plans/${id}`, { headers }),
      platform
    },
    PLAN_CODEC
  );

function canonicalSmall(): string {
  const parsed = parsePlan(small);
  if (!parsed.ok) throw new Error('small.json must parse');
  return serializePlan(parsed.value);
}

describe('GET /api/plans/:id', () => {
  it('returns the stored body verbatim with ETag and cache headers', async () => {
    const { platform } = setup();
    const id = await publishSmall(platform);
    const res = await get(platform, id);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(canonicalSmall());
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(res.headers.get('etag')).toBe(`"${await sha256Hex(body)}"`);
  });

  it('is wired as the route GET handler', async () => {
    const { platform } = setup();
    const id = await publishSmall(platform);
    const res = await GET({
      params: { id },
      request: new Request(`https://sfhousing.test/api/plans/${id}`),
      platform
    } as never);
    expect(res.status).toBe(200);
  });

  it('returns 304 with an empty body on a matching If-None-Match', async () => {
    const { platform } = setup();
    const id = await publishSmall(platform);
    const etag = (await get(platform, id)).headers.get('etag')!;
    for (const inm of [etag, `"other", ${etag}`, `W/${etag}`, '*']) {
      const res = await get(platform, id, { 'if-none-match': inm });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe('');
      expect(res.headers.get('etag')).toBe(etag);
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    }
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const { platform } = setup();
    const id = await publishSmall(platform);
    const res = await get(platform, id, { 'if-none-match': '"nope"' });
    expect(res.status).toBe(200);
  });

  it('404s a malformed id without touching the database', async () => {
    const prepare = vi.fn();
    const platform = testPlatform({ d1: { prepare } as unknown as D1Database });
    const res = await get(platform, '0OIl0OIl');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ShareError).error.code).toBe('not_found');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('404s a well-formed missing id with no-store', async () => {
    const { platform } = setup();
    const res = await get(platform, 'zzzzzzzz');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await res.json()) as ShareError).error.code).toBe('not_found');
  });

  it('500s with server_error when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const platform = testPlatform({
      d1: {
        prepare: () => {
          throw new Error('boom');
        }
      } as unknown as D1Database
    });
    const res = await get(platform, 'zzzzzzzz');
    expect(res.status).toBe(500);
    expect(((await res.json()) as ShareError).error.code).toBe('server_error');
  });
});
