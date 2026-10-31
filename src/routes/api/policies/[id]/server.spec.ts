import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import { paintedText } from '$lib/server/test/sim-docs';
import { POST as POST_PLAN } from '../../plans/+server';
import { GET as GET_PLAN } from '../../plans/[id]/+server';
import { POST } from '../+server';
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
  return testPlatform({
    d1: t.d1,
    BUCKET: bucket as never,
    ENVIRONMENT: 'production',
    PUBLISH_RL: new FakeRateLimiter({ allow: 100 }) as never
  });
}

const req = (path: string, body?: string) =>
  new Request('https://sfhousing.test' + path, {
    method: body === undefined ? 'GET' : 'POST',
    body,
    headers: { 'content-type': 'application/json' }
  });

async function publishBoth(platform: App.Platform) {
  const sim = await POST({ request: req('/api/policies', paintedText()), platform } as never);
  const plan = await POST_PLAN({ request: req('/api/plans', small), platform } as never);
  expect([sim.status, plan.status]).toEqual([201, 201]);
  return {
    simId: ((await sim.json()) as { id: string }).id,
    planId: ((await plan.json()) as { id: string }).id
  };
}

describe('GET /api/policies/:id', () => {
  it('serves a stored policy verbatim', async () => {
    const platform = setup();
    const { simId } = await publishBoth(platform);
    const res = await GET({
      params: { id: simId },
      request: req(`/api/policies/${simId}`),
      platform
    } as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(paintedText());
  });

  it('kind mismatch 404s the API both ways', async () => {
    const platform = setup();
    const { simId, planId } = await publishBoth(platform);
    const plan = await GET_PLAN({
      params: { id: simId },
      request: req(`/api/plans/${simId}`),
      platform
    } as never);
    expect(plan.status).toBe(404);
    const policy = await GET({
      params: { id: planId },
      request: req(`/api/policies/${planId}`),
      platform
    } as never);
    expect(policy.status).toBe(404);
  });
});
