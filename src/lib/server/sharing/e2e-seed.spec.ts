import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleE2eSeed } from '$lib/server/sharing/e2e-seed';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import type { ShareError } from '$lib/sharing/api';
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
        schema: 1,
        dataset_version: 'fixture-0000',
        body,
        content_hash: await sha256Hex(body),
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

  it('the same body under another dataset version → 500 and still one row', async () => {
    const { t, platform } = setup();
    const seed = (datasetVersion: string) =>
      handleE2eSeed(
        { request: post({ body: small, datasetVersion }), platform },
        { e2eEnabled: true }
      );
    expect((await seed('fixture-0')).status).toBe(201);
    const res = await seed('fixture-0000');
    expect(res.status).toBe(500);
    expect(((await res.json()) as ShareError).error.code).toBe('server_error');
    expect(rows(t)).toHaveLength(1);
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
