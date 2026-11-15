import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { newId } from '$lib/server/ids/factory';
import { clearPendingSim, readPendingSim } from '$lib/server/onboarding/pending-sim';
import { listSimsForUser } from '$lib/server/sims/sim-index';
import { simQuotaExceeded } from '$lib/server/sims/sim-quota';
import { createSim } from '$lib/server/sims/sims';
import { checkSimTitle, simStartAllowed, startSim } from '$lib/server/sims/start-sim';

export const load: PageServerLoad = async (event) => {
  const { locals, platform } = event;
  if (!locals.user) return { sims: [], invitations: [] };
  const db = getDb(platform!);

  // Resume a sim the visitor typed before being routed to sign-in: create it now, clear
  // the cookie, and drop them in. Over the creation rate or the quota the cookie is already
  // cleared, so the load falls through to the list (a load cannot fail()).
  const pendingTitle = readPendingSim(event.cookies);
  if (pendingTitle) {
    clearPendingSim(event.cookies);
    // The cookie is user-controlled: it gets the same checks as a typed title, and the same
    // creation rate as any other registration.
    const checked = checkSimTitle(pendingTitle);
    if (
      'title' in checked &&
      (await simStartAllowed(platform!, locals.user.id)) &&
      !(await simQuotaExceeded(db, locals.user))
    ) {
      // There is no browser store on this path: the server mints the sim's id.
      const { simId } = await createSim({
        db,
        env: platform?.env,
        simId: newId(),
        title: checked.title,
        managerId: locals.user.id
      });
      throw redirect(303, `/sims/${simId}`);
    }
  }

  const sims = await listSimsForUser({ db, userId: locals.user.id });
  sims.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  // The /sims layout already read them (each read scans every pending invite).
  const { recipientInvites: invitations } = await event.parent();
  return { sims, invitations };
};

export const actions: Actions = {
  create: async (event) => {
    const form = await event.request.formData();
    const raw = form.get('title');
    // There is no browser store on this path: the server mints the sim's id. The form still
    // requires a title.
    const result = await startSim(event, {
      simId: newId(),
      title: typeof raw === 'string' ? raw : ''
    });
    if ('simId' in result) throw redirect(303, `/sims/${result.simId}`);
    return result;
  }
};
