import type { Handle } from '@sveltejs/kit';

function setSecurityHeaders(response: Response) {
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-content-type-options', 'nosniff');
}

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  try {
    setSecurityHeaders(response);
    return response;
  } catch {
    // Immutable headers (e.g. redirects, fetched responses): re-wrap to get mutable ones.
    const wrapped = new Response(response.body, response);
    setSecurityHeaders(wrapped);
    return wrapped;
  }
};
