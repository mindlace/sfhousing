import { describe, expect, it } from 'vitest';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { load } from './+page.server';

const KEY = 'data/fixture-0/manifest.json';
const manifest = {
  datasetVersion: 'fixture-0',
  builtAt: '2026-10-09T12:00:00Z',
  sources: [
    { id: 'b-src', url: 'https://example.com/b', retrievedAt: '2026-10-01', license: 'PDDL' },
    { id: 'a-src', url: 'https://example.com/a', retrievedAt: '2026-10-02', license: 'ODbL' }
  ]
};

function run(bucket: unknown) {
  return load({
    platform: { env: { BUCKET: bucket, PUBLIC_DATASET_VERSION: 'fixture-0' } },
    parent: async () => ({ datasetVersion: 'fixture-0' })
  } as never) as Promise<{
    datasetVersion: string;
    manifest: { sources: { id: string }[] } | null;
  }>;
}

describe('/attribution load', () => {
  it('returns sources in manifest order', async () => {
    const bucket = new FakeR2Bucket();
    bucket.put(KEY, JSON.stringify(manifest));
    const r = await run(bucket);
    expect(r.datasetVersion).toBe('fixture-0');
    expect(r.manifest?.sources.map((s) => s.id)).toEqual(['b-src', 'a-src']);
  });

  it('returns null when the manifest is missing', async () => {
    expect((await run(new FakeR2Bucket())).manifest).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    const bucket = new FakeR2Bucket();
    bucket.put(KEY, 'not json{');
    expect((await run(bucket)).manifest).toBeNull();
  });

  it('returns null when the schema fails', async () => {
    const bucket = new FakeR2Bucket();
    bucket.put(KEY, JSON.stringify({ ...manifest, sources: 'x' }));
    expect((await run(bucket)).manifest).toBeNull();
  });

  it('returns null when BUCKET is undefined', async () => {
    expect((await run(undefined)).manifest).toBeNull();
  });

  it('returns null when bucket.get rejects', async () => {
    const bucket = new FakeR2Bucket();
    bucket.get = async () => {
      throw new Error('boom');
    };
    expect((await run(bucket)).manifest).toBeNull();
  });

  it('reads exactly data/<version>/manifest.json', async () => {
    const bucket = new FakeR2Bucket();
    bucket.put(KEY, JSON.stringify(manifest));
    await run(bucket);
    expect(bucket.calls).toEqual([{ method: 'get', key: KEY }]);
  });
});
