import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SIMS_COPY } from '$lib/members/copy';
import type { RegisterError } from '$lib/sim-stream/register';
import { isValidId } from '$lib/server/ids/factory';
import { isKnownDevice } from '$lib/server/onboarding/known-device';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';
import { startSim } from '$lib/server/sims/start-sim';

const refuse = (status: number, body: RegisterError) => json(body, { status });

/**
 * Register a sim under a browser-minted id: `{ simId, title?: string | null }` (R51, R60).
 * 201 `{ simId, created: true }` when this call created it; 200 `{ simId, created: false }` when
 * the caller already writes it; otherwise a RegisterError, 409 `taken` for any other id in use.
 */
export const POST: RequestHandler = async (event) => {
  // Cross-site defence, before anything is minted or created.
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    body = null;
  }
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { simId, title } = fields;
  if (typeof simId !== 'string' || !isValidId(simId)) {
    return refuse(400, { error: SIMS_COPY.invalidId, code: 'invalid_id' });
  }
  if (title !== undefined && title !== null && typeof title !== 'string') {
    return refuse(400, { error: SIMS_COPY.titleRequired, code: 'title' });
  }
  // A signed-out visitor on a known device is told to sign in: 401, and nothing is stashed or
  // minted (the form action stashes and redirects; a JSON client has no page to resume on).
  if (!event.locals.user && isKnownDevice(event.cookies)) {
    return refuse(401, { error: SIMS_COPY.signInRequired, code: 'sign_in' });
  }
  const result = await startSim(event, { simId, title: title ?? undefined });
  if ('simId' in result) return json(result, { status: result.created ? 201 : 200 });
  return json(result.data, { status: result.status });
};
