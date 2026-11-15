import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestD1, testPlatform, type TestD1 } from '$lib/server/test/d1';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { painted4Text, paintedText, tampered4Text } from '$lib/server/test/sim-docs';
import { sha256Hex } from '$lib/sharing/hash';
import { PLAN_CODEC } from '$lib/sharing/doc-codec';
import { SIM_SERVER_CODEC4 as SIM_CODEC } from '$lib/timeline/server-codec';
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
    const platform = await seedRow('sim', 'Abcdefg2', painted4Text());
    const data = await loadSharedDoc(SIM_CODEC, { id: 'Abcdefg2', platform, current: 'fixture-0' });
    expect(data.doc.kind).toBe('sim');
    expect(data.doc.text).toBe(painted4Text());
    expect(data.datasetNotice).toBe('none');
    expect(data).not.toHaveProperty('upgradedFrom');
  });

  it('stored schema 2 and 3 bodies load as their text, with upgradedFrom', async () => {
    const stored = readFileSync(
      new URL('../../sim-page/fixtures/schema2/painted.json', import.meta.url),
      'utf8'
    );
    const platform = await seedRow('sim', 'Abcdefg2', stored);
    const data = await loadSharedDoc(SIM_CODEC, { id: 'Abcdefg2', platform, current: 'fixture-0' });
    expect(data.upgradedFrom).toBe(2);
    expect(data.doc.schema).toBe(2);
    expect(data.doc.text).toBe(stored);

    const platform3 = await seedRow('sim', 'Bcdefgh3', paintedText());
    const data3 = await loadSharedDoc(SIM_CODEC, {
      id: 'Bcdefgh3',
      platform: platform3,
      current: 'fixture-0'
    });
    expect(data3.upgradedFrom).toBe(3);
    expect(data3.doc.text).toBe(paintedText());
  });

  it('kind mismatch redirects 308 to the other page, both ways', async () => {
    const platform = await seedRow('sim', 'Abcdefg2', painted4Text());
    await expect(
      loadSharedDoc(PLAN_CODEC, { id: 'Abcdefg2', platform, current: 'fixture-0' })
    ).rejects.toMatchObject({ status: 308, location: '/s/Abcdefg2' });

    const planPlatform = await seedRow('plan', 'Bcdefgh3', '{}');
    await expect(
      loadSharedDoc(SIM_CODEC, { id: 'Bcdefgh3', platform: planPlatform, current: 'fixture-0' })
    ).rejects.toMatchObject({ status: 308, location: '/p/Bcdefgh3' });
  });

  it('a stored policy that fails strict parsing still loads', async () => {
    expect(SIM_CODEC.parse(tampered4Text()).ok).toBe(false);
    const platform = await seedRow('sim', 'Abcdefg2', tampered4Text());
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
