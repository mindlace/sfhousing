import { json } from '@sveltejs/kit';
import { AUTH_COPY } from '$lib/account/copy';

/**
 * Cross-site defence for a JSON route that changes state. SvelteKit's origin check covers
 * only form content types, so such a route refuses on its own, before it does anything:
 * a no-cors page can post a body with no Content-Type, which `request.json()` would still
 * parse. Returns the refusing response (415 not JSON, 403 foreign Origin), or null.
 */
export function refuseUnlessSameOriginJson(event: { request: Request; url: URL }): Response | null {
  const contentType = event.request.headers.get('content-type') ?? '';
  if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: AUTH_COPY.jsonRequired }, { status: 415 });
  }
  return refuseForeignOrigin(event);
}

/**
 * 403 JSON for a request whose Origin header is present and not this origin; null otherwise.
 * An empty Origin header is present, so it is refused.
 */
export function refuseForeignOrigin(event: { request: Request; url: URL }): Response | null {
  const origin = event.request.headers.get('origin');
  if (origin !== null && origin !== event.url.origin) {
    return json({ error: AUTH_COPY.crossOrigin }, { status: 403 });
  }
  return null;
}
