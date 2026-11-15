import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidId } from '$lib/ids/base58';
import { getDb } from '$lib/server/db';
import { bearerMatches } from '$lib/server/operator/token';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';
import { loggable } from '$lib/server/sim-object/object-rules';
import { liveSimStub } from '$lib/server/sims/live-sim';
import { deleteSim } from '$lib/server/sims/sims';

/**
 * The operator takedown (R43): destructive and irreversible. It clears the sim's log in its
 * object, deletes its `sim_index` and `sim_commit` rows and its pending invitations, and bars
 * the id for ever. A valid id is taken down whether or not it has an index row.
 *
 * Off by default: the only credential is a bearer token equal to the secret
 * SIM_TAKEDOWN_TOKEN, which stays unset until a takedown is needed. An unset or short secret
 * denies every request (bearerMatches). No session, cookie or other header authorizes it, and
 * the path is not one the session gate resolves.
 *
 * Answers, in order: the shared same-origin JSON check's own (415, 403); 404 for a refused
 * token or an invalid id, with one body; 503 when the object cannot be reached (dev, or no
 * SIM binding), before anything is written; 200 { simId } once the takedown ran; 500 when it
 * threw, which a retry finishes (deleteSim).
 */
export const POST: RequestHandler = async ({ params, platform, request, url }) => {
  const refused = refuseUnlessSameOriginJson({ request, url });
  if (refused) return refused;
  const secret = (platform?.env as { SIM_TAKEDOWN_TOKEN?: string } | undefined)?.SIM_TAKEDOWN_TOKEN;
  const simId = params.simId;
  if (!(await bearerMatches(request.headers.get('authorization'), secret)) || !isValidId(simId)) {
    return json({ error: 'Not found.' }, { status: 404 });
  }
  if (!liveSimStub(platform?.env, simId)) {
    return json({ error: 'Takedown needs the sim object.' }, { status: 503 });
  }
  try {
    await deleteSim({ db: getDb(platform!), env: platform?.env, simId });
  } catch (e) {
    console.error('[takedown] failed', simId, loggable(e));
    return json({ error: 'Takedown failed.' }, { status: 500 });
  }
  return json({ simId });
};
