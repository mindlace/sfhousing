import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { getSimTitle } from '$lib/server/sims/sim-index';
import { leaveSim } from '$lib/server/sims/sims';
import { memberErrorCode } from '$lib/server/invites/error-code';
import { SIMS_COPY } from '$lib/members/copy';
import { loggable, type ServerAppendResult } from '$lib/server/sim-object/object-rules';
import { liveSimStub } from '$lib/server/sims/live-sim';
import { renameSim, type RenameCode } from '$lib/server/sims/rename';
import { serverStamp } from '$lib/server/sims/stamp';
import { checkSimTitle } from '$lib/server/sims/start-sim';

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
  },

  /**
   * A rename is a name commit appended through the sim's object (never a D1 write here); the
   * object's index pass copies the name to the index before appendAs answers. Every failure is
   * `{ renameError }`, the one key the page reads.
   */
  rename: async (event) => {
    const simId = event.params.simId;
    await requireSimRole(event, simId, 'editor');
    // The session's identity, never anything the form sent.
    const actor = event.locals.user?.id;
    if (!actor) return fail(401, { renameError: SIMS_COPY.renameFailed });

    const form = await event.request.formData();
    const checked = checkSimTitle((form.get('name') ?? '').toString());
    if ('status' in checked) {
      return fail(checked.status, { renameError: checked.data.error });
    }

    const live = liveSimStub(event.platform?.env, simId);
    if (!live) return fail(RENAME_STATUS.unavailable, { renameError: RENAME_COPY.unavailable });
    let stamp: ReturnType<typeof serverStamp>;
    try {
      stamp = serverStamp(event.platform);
    } catch (e) {
      console.error('[rename] failed', simId, loggable(e));
      return fail(RENAME_STATUS.failed, { renameError: RENAME_COPY.failed });
    }
    const out = await renameSim({
      db: getDb(event.platform!),
      stub: { appendAs: (i) => live.appendAs(i) as Promise<ServerAppendResult> },
      simId,
      actor,
      name: checked.title,
      stamp
    });
    if (!out.ok) return fail(RENAME_STATUS[out.code], { renameError: RENAME_COPY[out.code] });
    throw redirect(303, `/sims/${simId}`);
  }
};

const RENAME_STATUS: Record<RenameCode, number> = {
  unavailable: 503,
  gone: 404,
  limit: 429,
  full: 409,
  failed: 500
};

const RENAME_COPY: Record<RenameCode, string> = {
  unavailable: SIMS_COPY.renameUnavailable,
  gone: SIMS_COPY.renameFailed,
  limit: SIMS_COPY.renameBusy,
  full: SIMS_COPY.renameFull,
  failed: SIMS_COPY.renameFailed
};
