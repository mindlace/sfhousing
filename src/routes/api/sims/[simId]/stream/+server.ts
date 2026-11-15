import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';
import { isValidId } from '$lib/ids/base58';
import { devOverride, resolveDatasetVersion } from '$lib/server/config/dataset-version';
import { getDb } from '$lib/server/db';
import { canWrite } from '$lib/server/sim-object/access';
import { encodeOpenParams, OPEN_HEADER } from '$lib/server/sim-object/open-params';
import { simStub } from '$lib/server/sim-object/stub';
import { refuseForeignOrigin } from '$lib/server/security/same-origin-json';
import { getRole, getSimTitle } from '$lib/server/sims/sim-index';

/**
 * The sim's websocket. This route is the trust boundary: the object believes the open header
 * completely, so it is built here from the session and the role read, and replaces whatever
 * the browser sent. Reading needs only the link: a caller who may not write still gets a
 * socket, with write false.
 */
export const GET: RequestHandler = async ({ params, platform, locals, request, url }) => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'Expected a websocket upgrade.' }, { status: 426 });
  }
  const refused = refuseForeignOrigin({ request, url });
  if (refused) return refused;
  const simId = params.simId;
  if (!isValidId(simId)) return json({ error: 'Not found.' }, { status: 404 });
  const db = getDb(platform!);
  const title = await getSimTitle({ db, simId });
  if (title === null) return json({ error: 'Not found.' }, { status: 404 });
  const stub = simStub(platform?.env, simId);
  if (!stub) {
    return json({ error: 'Live sims need the sim object (npm run preview).' }, { status: 503 });
  }
  const identity = locals.user?.id ?? null;
  const write = identity !== null && canWrite(await getRole({ db, simId, userId: identity }));
  const headers = new Headers(request.headers);
  headers.delete(OPEN_HEADER);
  headers.set(
    OPEN_HEADER,
    encodeOpenParams({
      identity,
      write,
      title,
      datasetVersion: resolveDatasetVersion({
        built: __SFH_DATASET_VERSION__,
        override: devOverride(platform?.env) ?? publicEnv.PUBLIC_DATASET_VERSION,
        development: dev || platform?.env?.ENVIRONMENT === 'development'
      }),
      build: platform?.env?.PUBLIC_APP_RELEASE ?? publicEnv.PUBLIC_APP_RELEASE ?? 'dev'
    })
  );
  return stub.fetch(new Request(request, { headers }));
};
