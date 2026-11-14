import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { getSimTitle } from '$lib/server/sims/sim-index';

export const load: PageServerLoad = async (event) => {
  const { simId } = event.params;
  await requireSimRole(event, simId, 'viewer');
  const title = await getSimTitle({ db: getDb(event.platform!), simId });
  if (title === null) throw error(404, 'Not found');
  return { simId, title };
};
