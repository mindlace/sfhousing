import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { getSimTitle } from '$lib/server/sims/sim-index';
import { leaveSim } from '$lib/server/sims/sims';
import { memberErrorCode } from '$lib/server/invites/error-code';

export const load: PageServerLoad = async (event) => {
  // The shared data comes from the layout load; this only gates the page itself.
  await requireSimRole(event, event.params.simId, 'viewer');
  return {};
};

export const actions: Actions = {
  leaveSim: async (event) => {
    const simId = event.params.simId;
    if (!event.locals.user) throw redirect(303, '/sims');
    const { actor } = await requireSimRole(event, simId, 'viewer');

    const form = await event.request.formData();
    const confirmTitle = (form.get('confirmTitle') ?? '').toString();
    const successorUserId = (form.get('successorUserId') ?? '').toString();

    const db = getDb(event.platform!);
    const simTitle = await getSimTitle({ db, simId });
    if (simTitle === null) return fail(404, { code: 'sim_not_found' as const });

    try {
      await leaveSim({
        db,
        env: event.platform?.env,
        simId,
        userId: actor.actorId,
        simTitle,
        confirmTitle,
        successorUserId
      });
    } catch (e) {
      const code = memberErrorCode(e);
      if (code === 'failed') console.error('leave sim failed', e);
      return fail(400, { code });
    }

    throw redirect(303, '/sims');
  }
};
