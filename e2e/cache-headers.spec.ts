import { expect, test } from '@playwright/test';
import { smallText } from './helpers/sharing';

// HTML defaults to `private, no-cache` (hooks.server.ts) so adapter-cloudflare never edge-caches
// HTML that outlives a deploy. Explicit cache headers must be untouched.
const HTML_DEFAULT = 'private, no-cache';

for (const path of ['/', '/about', '/attribution']) {
  test(`${path} is private, no-cache`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe(HTML_DEFAULT);
  });
}

test('a 404 page is private, no-cache', async ({ request }) => {
  const res = await request.get('/no-such-page');
  expect(res.status()).toBe(404);
  expect(res.headers()['cache-control']).toBe(HTML_DEFAULT);
});

test('the /p/:id not-found error page is private, no-cache', async ({ request }) => {
  const res = await request.get('/p/zzzzzzzz');
  expect(res.status()).toBe(404);
  expect(res.headers()['cache-control']).toBe(HTML_DEFAULT);
});

test('data files keep their immutable cache header', async ({ request }) => {
  const res = await request.get('/data/fixture-0/manifest.json');
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('a stored plan keeps its explicit cache headers', async ({ request }) => {
  const created = await request.post('/api/plans', {
    data: smallText,
    headers: { 'content-type': 'application/json' }
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };

  const api = await request.get(`/api/plans/${id}`);
  expect(api.status()).toBe(200);
  expect(api.headers()['cache-control']).toBe('public, max-age=3600');

  const page = await request.get(`/p/${id}`);
  expect(page.status()).toBe(200);
  expect(page.headers()['cache-control']).toBe('private, max-age=300');
});
