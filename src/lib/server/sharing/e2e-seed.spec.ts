import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePlan, serializePlan } from '$lib/plan';
import { handleE2eSeed } from '$lib/server/sharing/e2e-seed';
import { handleGetPlan } from '$lib/server/sharing/get-plan';
import { handlePublish } from '$lib/server/sharing/publish';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { paintedText } from '$lib/server/test/sim-docs';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import type { ShareError } from '$lib/sharing/api';
import { PLAN_CODEC } from '$lib/sharing/doc-codec';
import { sha256Hex } from '$lib/sharing/hash';
import { PLAN_ID_RE } from '$lib/sharing/ids';
import { POST } from '../../../routes/api/e2e/plans/+server';

const small = readFileSync(
  fileURLToPath(new URL('../../sharing/fixtures/plans/small.json', import.meta.url)),
  'utf8'
);

const opened: TestD1[] = [];

afterEach(() => {
  for (const t of opened.splice(0)) t.close();
  vi.unstubAllEnvs();
});

function setup(env = 'development') {
  const t = createTestD1();
  opened.push(t);
  return { t, platform: testPlatform({ d1: t.d1, ENVIRONMENT: env }) };
}

const post = (payload: unknown) =>
  new Request('http://localhost:4173/api/e2e/plans', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' }
  });

type DbRow = {
  id: string;
  kind: string;
  schema: number;
  dataset_version: string;
  body: string;
  content_hash: string;
  op_count: number;
  byte_size: number;
  created_at: number;
};
const rows = (t: TestD1) => t.sqlite.prepare('SELECT * FROM plan').all() as DbRow[];

async function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  expect(((await res.json()) as ShareError).error.code).toBe('not_found');
}

describe('POST /api/e2e/plans', () => {
  it('inserts a raw unparsable body and returns 201 with a plan id', async () => {
    const { t, platform } = setup();
    const body = '{"schema":1,"datasetVersion":"fixture-0","ops":"nope"}';
    const res = await handleE2eSeed({ request: post({ body }), platform }, { e2eEnabled: true });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(PLAN_ID_RE);
    expect(rows(t)).toEqual([
      {
        id,
        kind: 'plan',
        schema: 1,
        dataset_version: 'fixture-0000',
        body,
        content_hash: await sha256Hex('e2e-seed\nfixture-0000\n' + body),
        op_count: 0,
        byte_size: new TextEncoder().encode(body).byteLength,
        created_at: Date.UTC(2026, 9, 1)
      }
    ]);
  });

  it('honours datasetVersion and counts the ops of a parseable body', async () => {
    const { t, platform } = setup();
    const res = await handleE2eSeed(
      { request: post({ body: small, datasetVersion: 'fixture-0' }), platform },
      { e2eEnabled: true }
    );
    expect(res.status).toBe(201);
    const [row] = rows(t);
    expect(row.dataset_version).toBe('fixture-0');
    expect(row.op_count).toBe(3);
    expect(row.body).toBe(small);
  });

  it("kind: 'sim' seeds a policy row counted through the sim codec; a bad kind is 400", async () => {
    const { t, platform } = setup();
    const body = paintedText();
    const res = await handleE2eSeed(
      { request: post({ body, kind: 'sim', datasetVersion: 'fixture-0' }), platform },
      { e2eEnabled: true }
    );
    expect(res.status).toBe(201);
    const [row] = rows(t);
    expect(row.kind).toBe('sim');
    expect(row.op_count).toBe(1);
    expect(row.body).toBe(body);

    const bad = await handleE2eSeed(
      { request: post({ body, kind: 'nope' }), platform },
      { e2eEnabled: true }
    );
    expect(bad.status).toBe(400);
  });

  it('the same body again → 200 with the existing id and one row (idempotent re-seed)', async () => {
    const { t, platform } = setup();
    const seed = () =>
      handleE2eSeed({ request: post({ body: small }), platform }, { e2eEnabled: true });
    const first = await seed();
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    const again = await seed();
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id });
    expect(rows(t)).toHaveLength(1);
  });

  it('the same body under another dataset version → 201 with a new id and two rows', async () => {
    const { t, platform } = setup();
    const seed = async (datasetVersion: string) => {
      const res = await handleE2eSeed(
        { request: post({ body: small, datasetVersion }), platform },
        { e2eEnabled: true }
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const a = await seed('fixture-0');
    const b = await seed('fixture-0000');
    expect(b).not.toBe(a);
    expect(rows(t).map((r) => [r.id, r.dataset_version])).toEqual(
      expect.arrayContaining([
        [a, 'fixture-0'],
        [b, 'fixture-0000']
      ])
    );
  });

  it('a published body seeded again is a distinct row; publish still dedupes to its own', async () => {
    const { t, platform } = setup();
    const bucket = new FakeR2Bucket();
    bucket.put('data/fixture-0/manifest.json', '{}');
    platform.env.BUCKET = bucket as never;
    const publish = () =>
      handlePublish(
        {
          request: new Request('http://localhost:4173/api/plans', {
            method: 'POST',
            body: small,
            headers: { 'content-type': 'application/json' }
          }),
          platform
        },
        PLAN_CODEC
      );
    const pub = await publish();
    expect(pub.status).toBe(201);
    const publishedId = ((await pub.json()) as { id: string }).id;

    const parsed = parsePlan(small);
    if (!parsed.ok) throw new Error('small.json must parse');
    const canonical = serializePlan(parsed.value);
    const seeded = await handleE2eSeed(
      { request: post({ body: canonical }), platform },
      { e2eEnabled: true }
    );
    expect(seeded.status).toBe(201);
    const seededId = ((await seeded.json()) as { id: string }).id;
    expect(seededId).not.toBe(publishedId);

    const get = (id: string) =>
      handleGetPlan(
        {
          params: { id },
          request: new Request(`http://localhost:4173/api/plans/${id}`),
          platform
        },
        PLAN_CODEC
      );
    const seededGet = await get(seededId);
    expect(seededGet.status).toBe(200);
    expect(await seededGet.text()).toBe(canonical);
    expect(seededGet.headers.get('etag')).toBe(
      `"${await sha256Hex('e2e-seed\nfixture-0000\n' + canonical)}"`
    );
    const byId = Object.fromEntries(rows(t).map((r) => [r.id, r.dataset_version]));
    expect(byId).toEqual({ [publishedId]: 'fixture-0', [seededId]: 'fixture-0000' });

    const again = await publish();
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id: publishedId });
  });

  it('a non-string body → 400 and no row', async () => {
    const { t, platform } = setup();
    const res = await handleE2eSeed(
      { request: post({ body: 42 }), platform },
      { e2eEnabled: true }
    );
    expect(res.status).toBe(400);
    expect(rows(t)).toHaveLength(0);
  });

  it('ENVIRONMENT production → 404 without touching the database', async () => {
    const prepare = vi.fn();
    const platform = testPlatform({
      d1: { prepare } as unknown as D1Database,
      ENVIRONMENT: 'production'
    });
    await expectNotFound(
      await handleE2eSeed({ request: post({ body: small }), platform }, { e2eEnabled: true })
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it('e2e disabled → 404 even in development, without touching the database', async () => {
    const prepare = vi.fn();
    const platform = testPlatform({
      d1: { prepare } as unknown as D1Database,
      ENVIRONMENT: 'development'
    });
    await expectNotFound(
      await handleE2eSeed({ request: post({ body: small }), platform }, { e2eEnabled: false })
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it('the route 404s when VITE_E2E is unset', async () => {
    vi.stubEnv('VITE_E2E', '');
    const { t, platform } = setup();
    await expectNotFound(await POST({ request: post({ body: small }), platform } as never));
    expect(rows(t)).toHaveLength(0);
  });

  it('the route seeds when VITE_E2E is 1 in development', async () => {
    vi.stubEnv('VITE_E2E', '1');
    const { t, platform } = setup();
    const res = await POST({ request: post({ body: small }), platform } as never);
    expect(res.status).toBe(201);
    expect(rows(t)).toHaveLength(1);
  });
});
