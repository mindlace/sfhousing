import { fail, redirect, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { SIM_TITLE_MAX, SIMS_COPY, titleTooLong } from '$lib/members/copy';
import { isKnownDevice } from '$lib/server/onboarding/known-device';
import { stashPendingSim } from '$lib/server/onboarding/pending-sim';
import { mintPseudonymousSession } from '$lib/server/onboarding/pseudonymous-mint';
import { reseedHandleFromSim } from '$lib/server/user-store/identity';
import { listSimsForUser } from './sim-index';
import { simQuotaExceeded } from './sim-quota';
import { createSim } from './sims';

export type StartSimFailure = ActionFailure<{ error: string }>;

/** The one title check: typed, posted, or read back from the pending-sim cookie. */
export function checkSimTitle(raw: string): { title: string } | StartSimFailure {
  const title = raw.trim();
  if (!title) return fail(400, { error: SIMS_COPY.titleRequired });
  if (title.length > SIM_TITLE_MAX) return fail(400, { error: titleTooLong(SIM_TITLE_MAX) });
  return { title };
}

/**
 * Create a sim for the person at this request, minting a pseudonymous account first when
 * they are signed out. A signed-out visitor on a known device is sent to /signin with the
 * title stashed (the /sims load resumes it after sign-in) instead of silently getting a
 * second account. Throws the redirect in that case.
 */
export async function startSim(
  event: RequestEvent,
  rawTitle: string
): Promise<StartSimFailure | { simId: string }> {
  const { locals, platform } = event;
  const checked = checkSimTitle(rawTitle);
  if (!('title' in checked)) return checked;
  const { title } = checked;

  const db = getDb(platform!);

  if (!locals.user && isKnownDevice(event.cookies)) {
    stashPendingSim(event.cookies, title);
    throw redirect(303, '/signin?returnTo=/sims');
  }

  let identityId = locals.user?.id ?? null;
  let pseudonymous = locals.user?.pseudonymous ?? true;
  let isFreshIdentity = false;
  if (!identityId) {
    const minted = await mintPseudonymousSession(event);
    if (!minted.ok) return fail(minted.status, { error: minted.message });
    identityId = minted.user.id;
    pseudonymous = minted.user.pseudonymous;
    isFreshIdentity = true;
  }

  // The handle is seeded from the sim title: one time, first sim, pseudonymous only.
  const isFirstSim =
    isFreshIdentity || (await listSimsForUser({ db, userId: identityId })).length === 0;
  if (pseudonymous && isFirstSim) {
    await reseedHandleFromSim({ db, identityId, simTitle: title });
  }

  const nudge = await simQuotaExceeded(db, { id: identityId });
  if (nudge) return fail(403, { error: nudge });

  try {
    return await createSim({ db, env: platform?.env, title, managerId: identityId });
  } catch (e) {
    // Never the error's text: it is an internal message (or a database error).
    console.error('create sim failed', e);
    return fail(400, { error: SIMS_COPY.createFailed });
  }
}
