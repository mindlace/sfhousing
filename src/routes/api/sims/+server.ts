import { isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SIMS_COPY } from '$lib/members/copy';
import { startSim } from '$lib/server/sims/start-sim';

export const POST: RequestHandler = async (event) => {
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: SIMS_COPY.titleRequired }, { status: 400 });
  }
  const title = (body as { title?: unknown } | null)?.title;
  try {
    const result = await startSim(event, typeof title === 'string' ? title : '');
    if ('simId' in result) return json({ simId: result.simId }, { status: 201 });
    return json(result.data, { status: result.status });
  } catch (e) {
    // A signed-out visitor on a known device is told to sign in, not redirected.
    if (isRedirect(e)) return json({ error: SIMS_COPY.signInRequired }, { status: 401 });
    throw e;
  }
};
