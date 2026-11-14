import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SIMS_COPY } from '$lib/members/copy';
import { isKnownDevice } from '$lib/server/onboarding/known-device';
import { startSim } from '$lib/server/sims/start-sim';

export const POST: RequestHandler = async (event) => {
  // Cross-site defence, before anything is minted or created: a no-cors page can post a
  // body with no Content-Type, which request.json() would still parse.
  const contentType = event.request.headers.get('content-type') ?? '';
  if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: SIMS_COPY.jsonRequired }, { status: 415 });
  }
  const origin = event.request.headers.get('origin');
  if (origin !== null && origin !== event.url.origin) {
    return json({ error: SIMS_COPY.crossOrigin }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: SIMS_COPY.titleRequired }, { status: 400 });
  }
  // A signed-out visitor on a known device is told to sign in: 401, and nothing is stashed
  // (the form action stashes and redirects; a JSON client has no page to resume on).
  if (!event.locals.user && isKnownDevice(event.cookies)) {
    return json({ error: SIMS_COPY.signInRequired }, { status: 401 });
  }
  const title = (body as { title?: unknown } | null)?.title;
  const result = await startSim(event, typeof title === 'string' ? title : '');
  if ('simId' in result) return json({ simId: result.simId }, { status: 201 });
  return json(result.data, { status: result.status });
};
