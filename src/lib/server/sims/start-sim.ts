import { fail, redirect, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { SIM_TITLE_MAX, SIMS_COPY, titleTooLong } from '$lib/members/copy';
import { DEFAULT_SIM_NAME } from '$lib/sim-log';
import type { RegisterError, RegisterOk } from '$lib/sim-stream/register';
import { isValidId } from '$lib/server/ids/factory';
import { isKnownDevice } from '$lib/server/onboarding/known-device';
import { stashPendingSim } from '$lib/server/onboarding/pending-sim';
import { mintPseudonymousSession } from '$lib/server/onboarding/pseudonymous-mint';
import { enforceRate } from '$lib/server/security/rate-limit';
import { canWrite } from '$lib/server/sim-object/access';
import { loggable } from '$lib/server/sim-object/object-rules';
import { reseedHandleFromSim } from '$lib/server/user-store/identity';
import { getRole, listSimsForUser, simIdInUse } from './sim-index';
import { simQuotaExceeded } from './sim-quota';
import { createSim } from './sims';

export type StartSimFailure = ActionFailure<RegisterError>;

/** The one title check: typed, posted, or read back from the pending-sim cookie. */
export function checkSimTitle(raw: string): { title: string } | StartSimFailure {
  const title = raw.trim();
  if (!title) return fail(400, { error: SIMS_COPY.titleRequired, code: 'title' });
  if (title.length > SIM_TITLE_MAX) {
    return fail(400, { error: titleTooLong(SIM_TITLE_MAX), code: 'title' });
  }
  return { title };
}

/** The creation rate (R52), keyed by identity: true when this identity may register now. */
export function simStartAllowed(platform: App.Platform, identityId: string): Promise<boolean> {
  return enforceRate(platform.env.MUTATION_REGISTERED_RL, `sim_start:${identityId}`, platform.env, {
    critical: true
  });
}

const taken = (): StartSimFailure => fail(409, { error: SIMS_COPY.notYours, code: 'taken' });

/**
 * The answer for an id that is already registered: the no-op for a caller who writes it, `taken`
 * for anyone else. One role read is enough: createSim writes the index row and its manager grant
 * in one transaction, so a visible row always has its grant.
 */
async function answerForRegistered(
  db: ReturnType<typeof getDb>,
  simId: string,
  userId: string
): Promise<StartSimFailure | RegisterOk> {
  return canWrite(await getRole({ db, simId, userId })) ? { simId, created: false } : taken();
}

/**
 * Register the sim `simId` for the person at this request (R51), minting a pseudonymous account
 * first when they are signed out. Registering an id that has no past creates the sim with the
 * caller as manager; an id the caller already writes is a no-op (`created: false`); any other
 * id in use is refused 409 `taken`, the same answer whoever holds it.
 *
 * A signed-out visitor on a known device is sent to /signin with the title stashed (the /sims
 * load resumes it after sign-in) instead of silently getting a second account: throws the
 * redirect. `title` undefined: the default name, and no handle reseed.
 *
 * Order: id, title, known device, (signed out) in-use then mint, rate, (signed in) in-use then
 * writer, quota, insert, then the handle reseed.
 */
export async function startSim(
  event: RequestEvent,
  input: { simId: string; title?: string }
): Promise<StartSimFailure | RegisterOk> {
  const { locals, platform } = event;
  const { simId } = input;
  if (!isValidId(simId)) return fail(400, { error: SIMS_COPY.invalidId, code: 'invalid_id' });

  let title = DEFAULT_SIM_NAME;
  const named = input.title !== undefined;
  if (input.title !== undefined) {
    const checked = checkSimTitle(input.title);
    if (!('title' in checked)) return checked;
    title = checked.title;
  }

  if (!locals.user && isKnownDevice(event.cookies)) {
    stashPendingSim(event.cookies, title);
    throw redirect(303, '/signin?returnTo=/sims');
  }

  const db = getDb(platform!);
  const signedIn = locals.user ?? null;
  let identityId: string;
  let pseudonymous: boolean;
  if (signedIn) {
    identityId = signedIn.id;
    pseudonymous = signedIn.pseudonymous;
  } else {
    // An id in use mints nothing: the refusal must not leave an account behind. This check is
    // deliberately before the rate check and the mint; do not move the rate check above it.
    if (await simIdInUse(db, simId)) return taken();
    // Every mint passes the mint limit (PSEUDO_MINT_RL). An account minted here is left with no
    // sim when: the rate check below refuses it; a concurrent registration takes the id after
    // the mint; or the create fails. That is accepted.
    const minted = await mintPseudonymousSession(event);
    if (!minted.ok) {
      return fail(minted.status, {
        error: minted.message,
        code: minted.status === 429 ? 'rate' : 'session'
      });
    }
    identityId = minted.user.id;
    pseudonymous = minted.user.pseudonymous;
  }

  if (!(await simStartAllowed(platform!, identityId))) {
    return fail(429, { error: SIMS_COPY.tooManySims, code: 'rate' });
  }

  // Signed in: an id in use is a no-op for its writers and refused for anyone else. This comes
  // before the quota, so a writer at the cap still gets the no-op and a non-writer at the cap is
  // told `taken`, not `quota`.
  if (signedIn && (await simIdInUse(db, simId))) {
    return answerForRegistered(db, simId, identityId);
  }

  const nudge = await simQuotaExceeded(db, { id: identityId });
  if (nudge) return fail(403, { error: nudge, code: 'quota' });

  // The handle is seeded from the sim's name: one time, first sim, pseudonymous only. Counted
  // before the insert, which would make this sim the person's first.
  const reseed =
    named &&
    pseudonymous &&
    (!signedIn || (await listSimsForUser({ db, userId: identityId })).length === 0);

  let created: boolean;
  try {
    ({ created } = await createSim({
      db,
      env: platform?.env,
      simId,
      title,
      managerId: identityId
    }));
  } catch (e) {
    // The batch is one transaction: if it threw, nothing was written, and a retry answers 201
    // (or 200 if an earlier attempt had in fact committed). Never the error's text.
    console.error('[start-sim] create failed', simId, loggable(e));
    return fail(500, { error: SIMS_COPY.createFailed, code: 'failed' });
  }

  // The id was taken between the checks above and the insert; it may be this caller's own
  // registration racing itself.
  if (!created) return answerForRegistered(db, simId, identityId);

  if (reseed) {
    try {
      await reseedHandleFromSim({ db, identityId, simTitle: title });
    } catch (e) {
      // The sim exists: a failed reseed is logged, never reported as a failed registration.
      console.error('[start-sim] reseed failed', loggable(e));
    }
  }
  return { simId, created: true };
}
