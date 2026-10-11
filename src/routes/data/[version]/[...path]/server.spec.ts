import { beforeEach, describe, expect, it } from 'vitest';
import { FakeR2Bucket } from '$lib/server/test/fake-r2';
import { GET, HEAD, OPTIONS } from './+server';

const BYTES = new Uint8Array(Array.from({ length: 200 }, (_, i) => i));
const IMMUTABLE = 'public, max-age=31536000, immutable';
let bucket: FakeR2Bucket;

function call(
  handler: typeof GET,
  version: string,
  path: string,
  headers: Record<string, string> = {},
  env: Record<string, unknown> | null = { BUCKET: bucket }
) {
  const url = `https://x.test/data/${version}/${path}`;
  const request = new Request(url, { method: handler === HEAD ? 'HEAD' : 'GET', headers });
  // Minimal RequestEvent; the route reads only params, request, platform.
  return handler({
    params: { version, path },
    request,
    platform: env ? { env } : undefined
  } as never);
}

async function bytesOf(res: Response) {
  return new Uint8Array(await res.arrayBuffer());
}

beforeEach(() => {
  bucket = new FakeR2Bucket();
  bucket.put('data/fixture-0/buildings.pmtiles', BYTES);
  bucket.put('data/fixture-0/manifest.json', '{"a":1}');
});

describe('GET /data/<version>/*', () => {
  it('200 full object with headers', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('200');
    expect(await bytesOf(res)).toEqual(BYTES);
    expect(res.headers.get('etag')).toBe('"etag1"');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(res.headers.get('last-modified')).toBe(new Date('2026-10-10T00:00:00Z').toUTCString());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-expose-headers')).toContain('Content-Range');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('206 for bytes=0-15', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { range: 'bytes=0-15' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-15/200');
    expect(res.headers.get('content-length')).toBe('16');
    expect(await bytesOf(res)).toEqual(BYTES.slice(0, 16));
  });

  it('206 for open-ended bytes=100-', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { range: 'bytes=100-' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/200');
    expect(res.headers.get('content-length')).toBe('100');
  });

  it('206 for suffix bytes=-20', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { range: 'bytes=-20' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 180-199/200');
    expect(res.headers.get('content-length')).toBe('20');
  });

  it('206 for oversized suffix bytes=-500 (clipped)', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { range: 'bytes=-500' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-199/200');
    expect(res.headers.get('content-length')).toBe('200');
  });

  it('206 for end past size bytes=150-999 (clipped)', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { range: 'bytes=150-999' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 150-199/200');
    expect(res.headers.get('content-length')).toBe('50');
  });

  it('416 for start at size bytes=200-', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { range: 'bytes=200-' });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */200');
  });

  it('416 for bytes=-0', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { range: 'bytes=-0' });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */200');
  });

  it('ignores multi-range and serves 200 full', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { range: 'bytes=0-1,5-6' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-range')).toBeNull();
    expect(await bytesOf(res)).toEqual(BYTES);
  });

  it('304 on matching If-None-Match', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { 'if-none-match': '"etag1"' });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe('"etag1"');
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
  });

  it('304 wins over Range when If-None-Match matches', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', {
      range: 'bytes=0-15',
      'if-none-match': '"etag1"'
    });
    expect(res.status).toBe(304);
  });

  it('412 on failing If-Match', async () => {
    const res = await call(GET, 'fixture-0', 'buildings.pmtiles', { 'if-match': '"nope"' });
    expect(res.status).toBe(412);
    expect(res.headers.get('etag')).toBe('"etag1"');
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
  });

  it('404 for a missing object with short cache', async () => {
    const res = await call(GET, 'fixture-0', 'nope.json');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.text()).toBe('Not found');
  });

  it('404 no-store for a bad path without touching R2', async () => {
    const res = await call(GET, 'fixture-0', 'a/../b');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(bucket.calls).toEqual([]);
  });

  it('rejects decoded traversal and invalid versions without touching R2', async () => {
    const decoded = decodeURIComponent('a%2F..%2Fb');
    const r1 = await call(GET, 'fixture-0', decoded);
    expect(r1.status).toBe(404);
    expect(r1.headers.get('cache-control')).toBe('no-store');
    const r2 = await call(GET, 'test-v1', 'manifest.json');
    expect(r2.status).toBe(404);
    expect(r2.headers.get('cache-control')).toBe('no-store');
    expect(bucket.calls).toEqual([]);
  });

  it('chooses content-type by extension, falling back to stored type', async () => {
    for (const f of ['x.json', 'x.geojson', 'x.pmtiles', 'x.pbf', 'x.bin']) {
      bucket.put(`data/fixture-0/${f}`, 'z', { contentType: 'text/plain' });
    }
    bucket.put('data/fixture-0/x.png', 'z', { contentType: 'image/png' });
    bucket.put('data/fixture-0/x.weird', 'z');
    const types: string[] = [];
    for (const f of ['x.json', 'x.geojson', 'x.pmtiles', 'x.pbf', 'x.bin', 'x.png', 'x.weird']) {
      types.push((await call(GET, 'fixture-0', f)).headers.get('content-type') ?? '');
    }
    expect(types).toEqual([
      'application/json',
      'application/geo+json',
      'application/vnd.pmtiles',
      'application/octet-stream',
      'application/octet-stream',
      'image/png',
      'application/octet-stream'
    ]);
  });

  it('503 when platform or BUCKET is missing', async () => {
    for (const res of [
      await call(GET, 'fixture-0', 'manifest.json', {}, null),
      await call(GET, 'fixture-0', 'manifest.json', {}, {})
    ]) {
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('Data storage unavailable');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('HEAD /data/<version>/*', () => {
  it('200 with GET headers and empty body', async () => {
    const res = await call(HEAD, 'fixture-0', 'buildings.pmtiles');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('200');
    expect(res.headers.get('etag')).toBe('"etag1"');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(res.headers.get('last-modified')).toBe(new Date('2026-10-10T00:00:00Z').toUTCString());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('');
  });

  it('404 for missing, and 404 no-store for bad path without R2 calls', async () => {
    const missing = await call(HEAD, 'fixture-0', 'nope.json');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('public, max-age=60');
    bucket.calls = [];
    const bad = await call(HEAD, 'fixture-0', 'a/../b');
    expect(bad.status).toBe(404);
    expect(bad.headers.get('cache-control')).toBe('no-store');
    expect(bucket.calls).toEqual([]);
  });
});

describe('OPTIONS /data/<version>/*', () => {
  it('204 with CORS preflight headers', async () => {
    const res = await OPTIONS({} as never);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('Range, If-None-Match, If-Match');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
