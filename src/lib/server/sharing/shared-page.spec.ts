import { afterEach, describe, expect, it } from 'vitest';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { paintedText, tamperedText } from '$lib/server/test/sim-docs';
import { sha256Hex } from '$lib/sharing/hash';
import { PLAN_CODEC } from '$lib/sharing/doc-codec';
import { SIM_CODEC } from '$lib/sim-page/sim-doc';
import { loadSharedDoc } from './shared-page';

const opened: TestD1[] = [];
afterEach(() => {
  for (const t of opened.splice(0)) t.close();
});

async function seedRow(kind: string, id: string, body: string) {
  const t = createTestD1();
  opened.push(t);
  const bucket = new FakeR2Bucket();
  bucket.put('data/fixture-0/manifest.json', '{}');
  const platform = testPlatform({ d1: t.d1, BUCKET: bucket as never, ENVIRONMENT: 'production' });
  t.sqlite
    .prepare(
      'INSERT INTO plan (id, kind, schema, dataset_version, body, content_hash, op_count, byte_size, created_at) VALUES (?, ?, 1, ?, ?, ?, 1, ?, 0)'
    )
    .run(id, kind, 'fixture-0', body, await sha256Hex(body), body.length);
  return platform;
}

describe('loadSharedDoc', () => {
  it('loads a sim row through the sim codec', async () => {
    const platform = await seedRow('sim', 'Abcdefg2', paintedText());
    const data = await loadSharedDoc(SIM_CODEC, { id: 'Abcdefg2', platform, current: 'fixture-0' });
    expect(data.doc.kind).toBe('sim');
    expect(data.datasetNotice).toBe('none');
  });

  it('kind mismatch redirects 308 to the other page, both ways', async () => {
    const platform = await seedRow('sim', 'Abcdefg2', paintedText());
    await expect(
      loadSharedDoc(PLAN_CODEC, { id: 'Abcdefg2', platform, current: 'fixture-0' })
    ).rejects.toMatchObject({ status: 308, location: '/s/Abcdefg2' });

    const planPlatform = await seedRow('plan', 'Bcdefgh3', '{}');
    await expect(
      loadSharedDoc(SIM_CODEC, { id: 'Bcdefgh3', platform: planPlatform, current: 'fixture-0' })
    ).rejects.toMatchObject({ status: 308, location: '/p/Bcdefgh3' });
  });

  it('a stored policy that fails strict parsing still loads', async () => {
    expect(SIM_CODEC.parse(tamperedText()).ok).toBe(false);
    const platform = await seedRow('sim', 'Abcdefg2', tamperedText());
    const data = await loadSharedDoc(SIM_CODEC, { id: 'Abcdefg2', platform, current: 'fixture-0' });
    expect(data.doc.kind).toBe('sim');
  });

  it('an unparsable stored policy is a 500 that says policy', async () => {
    const platform = await seedRow('sim', 'Abcdefg2', '{"nope":1}');
    await expect(
      loadSharedDoc(SIM_CODEC, { id: 'Abcdefg2', platform, current: 'fixture-0' })
    ).rejects.toMatchObject({ status: 500, body: { message: expect.stringMatching(/policy/) } });
  });
});
