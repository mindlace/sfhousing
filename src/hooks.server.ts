import type { Handle } from '@sveltejs/kit';

function setDefaultHeaders(response: Response) {
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-content-type-options', 'nosniff');
  // adapter-cloudflare's worker puts any cacheable GET into caches.default, so HTML with no
  // explicit cache-control would outlive a deploy and reference dead asset hashes.
  if (
    response.headers.get('content-type')?.startsWith('text/html') &&
    !response.headers.has('cache-control')
  ) {
    response.headers.set('cache-control', 'private, no-cache');
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  try {
    setDefaultHeaders(response);
    return response;
  } catch {
    // Immutable headers (e.g. redirects, fetched responses): re-wrap to get mutable ones.
    const wrapped = new Response(response.body, response);
    setDefaultHeaders(wrapped);
    return wrapped;
  }
};
