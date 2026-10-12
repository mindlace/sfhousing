import { expect, test } from '@playwright/test';

test('fixture-0 manifest, every chunk and a buildings range are served', async ({ request }) => {
  const res = await request.get('/data/fixture-0/manifest.json');
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m.chunks.length).toBeGreaterThan(0);
  for (const c of m.chunks) {
    const r = await request.get(c.url);
    expect(r.status(), c.url).toBe(200);
    expect(r.headers()['content-type']).toContain('application/json');
    expect((await r.json()).format).toBe('sfh-parcels/1');
  }
  expect(m.buildingRoofs.schemaVersion).toBe(1);
  const roofIndex = await request.get(m.buildingRoofs.indexUrl);
  expect(roofIndex.status()).toBe(200);
  const index = await roofIndex.json();
  for (const chunk of index.chunks) {
    const header = await request.get(chunk.headerUrl);
    expect(header.status()).toBe(200);
    expect((await header.json()).pieces).toHaveLength(chunk.pieceCount);
    const mesh = await request.get(chunk.meshUrl);
    expect(mesh.status()).toBe(200);
    expect((await mesh.body()).byteLength).toBe(chunk.meshBytes);
  }
  const t = await request.get(m.buildingsTiles, { headers: { Range: 'bytes=0-15' } });
  expect(t.status()).toBe(206);
  const g = await request.get(
    m.glyphs.replace('{fontstack}', 'NotoSans-Regular').replace('{range}', '0-255')
  );
  expect(g.status()).toBe(200);
});
