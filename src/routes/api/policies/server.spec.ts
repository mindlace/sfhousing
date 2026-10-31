import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import { manyStrokesText, paintedText, simDoc, tamperedText } from '$lib/server/test/sim-docs';
import type { ShareError } from '$lib/sharing/api';
import { PLAN_ID_RE } from '$lib/sharing/ids';
import { serializeSimDoc } from '$lib/sim-page/sim-doc';
import { POST as POST_PLAN } from '../plans/+server';
import { POST } from './+server';

const small = readFileSync(
  fileURLToPath(new URL('../../../lib/sharing/fixtures/plans/small.json', import.meta.url)),
  'utf8'
);

const opened: TestD1[] = [];

afterEach(() => {
  for (const t of opened.splice(0)) t.close();
  vi.restoreAllMocks();
});

function setup(opts: { allow?: number } = {}) {
  const t = createTestD1();
  opened.push(t);
  const bucket = new FakeR2Bucket();
  bucket.put('data/fixture-0/manifest.json', '{}');
  const limiter = new FakeRateLimiter({ allow: opts.allow ?? 100 });
  const platform = testPlatform({
    d1: t.d1,
    BUCKET: bucket as never,
    ENVIRONMENT: 'production',
    PUBLISH_RL: limiter as never
  });
  return { t, platform, limiter };
}

const post = (body: BodyInit, path = '/api/policies') =>
  new Request('https://sfhousing.test' + path, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' }
  });

const publish = (platform: App.Platform, body: BodyInit) =>
  POST({ request: post(body), platform } as never);

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = (await res.json()) as ShareError;
  expect(body.error.code).toBe(code);
  return body;
}

type DbRow = { id: string; kind: string; op_count: number; schema: number };
const rows = (t: TestD1) => t.sqlite.prepare('SELECT * FROM plan').all() as DbRow[];

describe('POST /api/policies', () => {
  it('201 with Location /s/<id> and a row of kind sim', async () => {
    const { t, platform } = setup();
    const res = await publish(platform, paintedText());
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(PLAN_ID_RE);
    expect(res.headers.get('location')).toBe(`/s/${id}`);
    const [row] = rows(t);
    expect(row.kind).toBe('sim');
    expect(row.id).toBe(id);
    expect(row.schema).toBe(1);
    expect(row.op_count).toBe(1);
  });

  it('a second publish of the same document returns 200 with the first id', async () => {
    const { t, platform } = setup();
    const first = (await (await publish(platform, paintedText())).json()) as { id: string };
    const again = await publish(platform, paintedText());
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(first.id);
    expect(rows(t)).toHaveLength(1);
  });

  it('the default policy gets 422 empty_plan', async () => {
    const { platform } = setup();
    await expectError(await publish(platform, serializeSimDoc(simDoc())), 422, 'empty_plan');
  });

  it('too_many_ops is reachable for policies', async () => {
    const { platform } = setup();
    const text = manyStrokesText();
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(262_144);
    await expectError(await publish(platform, text), 422, 'too_many_ops');
  });

  it('262,145 bytes gets 413 too_large', async () => {
    const { platform } = setup();
    const text = paintedText() + ' '.repeat(262_145 - paintedText().length);
    expect(new TextEncoder().encode(text).byteLength).toBe(262_145);
    await expectError(await publish(platform, text), 413, 'too_large');
  });

  it("kind: 'plan' in the body gets 422 unsupported_schema", async () => {
    const { platform } = setup();
    const text = JSON.stringify({ ...JSON.parse(paintedText()), kind: 'plan' });
    await expectError(await publish(platform, text), 422, 'unsupported_schema');
  });

  it('a tampered benchmarkPermits scale gets 422 invalid_plan with details', async () => {
    const { platform } = setup();
    const body = await expectError(await publish(platform, tamperedText()), 422, 'invalid_plan');
    expect(body.error.details?.length).toBeGreaterThan(0);
  });

  it('an unknown dataset version gets 422 unknown_dataset_version', async () => {
    const { platform } = setup();
    const text = paintedText({ datasetVersion: 'fixture-9999' });
    await expectError(await publish(platform, text), 422, 'unknown_dataset_version');
  });

  it('error bodies say policy, never plan', async () => {
    const { platform } = setup();
    for (const [text, status, code] of [
      [manyStrokesText(), 422, 'too_many_ops'],
      [paintedText() + ' '.repeat(262_200), 413, 'too_large']
    ] as const) {
      const body = await expectError(await publish(platform, text), status, code);
      expect(body.error.message).toMatch(/policy/i);
      expect(body.error.message).not.toMatch(/\bplans?\b/i);
    }
    const unknown = await expectError(
      await publish(platform, paintedText({ datasetVersion: 'fixture-9999' })),
      422,
      'unknown_dataset_version'
    );
    expect(unknown.error.message).not.toMatch(/\bplans?\b/i);
  });

  it('shares the publish rate limit with /api/plans under publish:<ip>', async () => {
    const { platform, limiter } = setup({ allow: 0 });
    await expectError(await publish(platform, paintedText()), 429, 'rate_limited');
    await expectError(
      await POST_PLAN({ request: post(small, '/api/plans'), platform } as never),
      429,
      'rate_limited'
    );
    expect(limiter.calls).toEqual(['publish:unknown', 'publish:unknown']);
  });
});
