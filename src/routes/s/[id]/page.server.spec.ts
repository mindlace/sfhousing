// The /s/[id] server load (plan 5, Task 6): a published policy through the sim codec, its dataset
// notice (I16, as /p), the kind redirect, and the policy's own error copy. Schema 4 (timeline-ui
// Task 15): the server validates a row and passes its text on; the page opens it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { month, painted4Text, paintedText } from '$lib/server/test/sim-docs';
import { copyFor } from '$lib/sharing/copy';
import { sha256Hex } from '$lib/sharing/hash';
import type { SharedDocData } from '$lib/server/sharing/shared-page';
import type { SharedSim } from '$lib/timeline/server-codec';
import { load as rawLoad } from './+page.server';

const load = async (e: Parameters<typeof rawLoad>[0]) =>
  (await rawLoad(e)) as SharedDocData<SharedSim>;

const SIM = copyFor('sim');
const opened: TestD1[] = [];

afterEach(() => {
  for (const t of opened.splice(0)) t.close();
  vi.restoreAllMocks();
});

/** One row of `kind` in a fresh database; `bucket` holds the manifests that still exist. */
async function seed(kind: string, id: string, body: string, version = 'fixture-0') {
  const t = createTestD1();
  opened.push(t);
  t.sqlite
    .prepare(
      'INSERT INTO plan (id, kind, schema, dataset_version, body, content_hash, op_count, byte_size, created_at) VALUES (?, ?, 1, ?, ?, ?, 1, ?, 0)'
    )
    .run(id, kind, version, body, await sha256Hex(body), body.length);
  const bucket = new FakeR2Bucket();
  const platform = testPlatform({ d1: t.d1, BUCKET: bucket as never, ENVIRONMENT: 'production' });
  return { platform, bucket };
}

function event(id: string, platform: App.Platform, setHeaders = vi.fn()) {
  return {
    params: { id },
    platform,
    parent: async () => ({ datasetVersion: 'fixture-0', appRelease: 'dev' }),
    setHeaders
  } as never;
}

describe('/s/[id] load', () => {
  it('loads a policy on the current data with no notice, and sets the cache header', async () => {
    const { platform } = await seed('sim', 'Abcdefg2', painted4Text());
    const setHeaders = vi.fn();
    const data = await load(event('Abcdefg2', platform, setHeaders));
    expect(data).toMatchObject({
      id: 'Abcdefg2',
      currentDatasetVersion: 'fixture-0',
      datasetNotice: 'none',
      createdAt: new Date(0).toISOString()
    });
    expect(data.doc.kind).toBe('sim');
    expect(data.doc.policy?.kinds.zoning).toHaveLength(1);
    expect(data.doc.text).toBe(painted4Text());
    expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, max-age=300' });
  });

  it("gives the remix notice when the policy's own dataset still exists", async () => {
    const body = painted4Text({ datasetVersion: 'fixture-1' });
    const { platform, bucket } = await seed('sim', 'Abcdefg2', body, 'fixture-1');
    bucket.put('data/fixture-1/manifest.json', '{}');
    const data = await load(event('Abcdefg2', platform));
    expect(data.datasetNotice).toBe('remix');
    expect(data.doc.datasetVersion).toBe('fixture-1');
  });

  it("gives the gone notice when the policy's dataset is no longer available", async () => {
    const body = painted4Text({ datasetVersion: 'fixture-1' });
    const { platform } = await seed('sim', 'Abcdefg2', body, 'fixture-1');
    const data = await load(event('Abcdefg2', platform));
    expect(data.datasetNotice).toBe('gone');
  });

  it('a stored schema 3 row loads on the server as text, upgradedFrom 3', async () => {
    const { platform } = await seed('sim', 'Abcdefg2', paintedText());
    const data = await load(event('Abcdefg2', platform));
    expect(data.upgradedFrom).toBe(3);
    expect(data.doc).toMatchObject({ schema: 3, policy: null, text: paintedText() });
  });

  it('a stored schema 4 row from an earlier dataset loads unaligned', async () => {
    const body = painted4Text({ datasetVersion: 'fixture-1' }, month(2) + 3);
    const { platform, bucket } = await seed('sim', 'Abcdefg2', body, 'fixture-1');
    bucket.put('data/fixture-1/manifest.json', '{}');
    const data = await load(event('Abcdefg2', platform));
    expect(data.doc.text).toBe(body);
    expect(data.doc.policy?.kinds.zoning[0].spans[0].from).toBe(month(2) + 3);
    expect(data).not.toHaveProperty('upgradedFrom');
  });

  it('a plan id throws a 308 to /p/<id>', async () => {
    const { platform } = await seed('plan', 'Bcdefgh3', '{}');
    const setHeaders = vi.fn();
    await expect(load(event('Bcdefgh3', platform, setHeaders))).rejects.toMatchObject({
      status: 308,
      location: '/p/Bcdefgh3'
    });
    expect(setHeaders).not.toHaveBeenCalled();
  });

  it('a malformed or missing id is a 404 in the policy wording', async () => {
    const { platform } = await seed('sim', 'Abcdefg2', painted4Text());
    await expect(load(event('0OIl0OIl', platform))).rejects.toMatchObject({
      status: 404,
      body: { message: SIM.notFoundHeading }
    });
    await expect(load(event('zzzzzzzz', platform))).rejects.toMatchObject({
      status: 404,
      body: { message: 'Policy not found' }
    });
  });

  it("an unparsable stored body is a 500 with the policy's unparsable copy", async () => {
    const { platform } = await seed('sim', 'Abcdefg2', '{"nope":1}');
    await expect(load(event('Abcdefg2', platform))).rejects.toMatchObject({
      status: 500,
      body: { message: SIM.unparsable }
    });
    expect(SIM.unparsable).toBe("This policy can't be shown by this version of the app.");
  });
});
