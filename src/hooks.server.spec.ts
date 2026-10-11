import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';

describe('handle', () => {
  it('sets security headers', async () => {
    const response = await handle({
      event: {} as never,
      resolve: async () => new Response('ok')
    });
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets headers on responses with immutable headers', async () => {
    const response = await handle({
      event: {} as never,
      resolve: async () => Response.redirect('https://example.com/', 302)
    });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('location')).toBe('https://example.com/');
  });

  describe('cache-control default for HTML', () => {
    const run = (resolve: () => Response) =>
      handle({ event: {} as never, resolve: async () => resolve() });
    const html = (cc?: string) =>
      new Response('<p>x</p>', {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          ...(cc ? { 'cache-control': cc } : {})
        }
      });

    it('defaults text/html without cache-control to private, no-cache', async () => {
      expect((await run(() => html())).headers.get('cache-control')).toBe('private, no-cache');
    });

    it('leaves an explicit text/html cache-control unchanged', async () => {
      const r = await run(() => html('private, max-age=300'));
      expect(r.headers.get('cache-control')).toBe('private, max-age=300');
    });

    it('leaves application/json public caching unchanged', async () => {
      const r = await run(
        () =>
          new Response('{}', {
            headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' }
          })
      );
      expect(r.headers.get('cache-control')).toBe('public, max-age=3600');
    });

    it('leaves immutable binary responses unchanged', async () => {
      const cc = 'public, max-age=31536000, immutable';
      const r = await run(
        () =>
          new Response(new Uint8Array(2), {
            headers: { 'content-type': 'application/octet-stream', 'cache-control': cc }
          })
      );
      expect(r.headers.get('cache-control')).toBe(cc);
    });

    it('leaves a text/plain 404 with max-age=60 unchanged', async () => {
      const r = await run(
        () =>
          new Response('nf', {
            status: 404,
            headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=60' }
          })
      );
      expect(r.headers.get('cache-control')).toBe('public, max-age=60');
    });

    it('does not add cache-control to non-HTML responses without one', async () => {
      const r = await run(() => new Response('x', { headers: { 'content-type': 'text/plain' } }));
      expect(r.headers.get('cache-control')).toBeNull();
    });

    it('defaults HTML on the immutable-headers re-wrap path', async () => {
      const r = await run(() => {
        const res = html();
        // Emulate immutable headers: set() throws, so handle re-wraps the response.
        res.headers.set = () => {
          throw new TypeError('immutable');
        };
        return res;
      });
      expect(r.headers.get('cache-control')).toBe('private, no-cache');
    });
  });
});
