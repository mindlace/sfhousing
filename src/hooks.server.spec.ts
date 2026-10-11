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
});
