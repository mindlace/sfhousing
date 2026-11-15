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
import { getRole, listSimsForUser, simAwaitingGrant, simIdInUse } from './sim-index';
import { simQuotaExceeded } from './sim-quota';
import { createSim, SimGrantFailed } from './sims';

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

/** How many times a registration that lost the insert re-reads the caller's role. */
const SETTLE_READS = 5;

/**
 * Whether the caller writes the sim, after an insert that did not create it. The registration
 * that won may still be between its insert and its manager grant (the index row exists and no
 * ledger event names the sim yet); while that is so, read again, a bounded number of times. Once
 * the sim has a ledger event (or no row) the answer is settled. Fails closed: false.
 */
async function writesOnceSettled(
  db: ReturnType<typeof getDb>,
  simId: string,
  userId: string
): Promise<boolean> {
  for (let i = 0; i < SETTLE_READS; i++) {
    // Read the state before the role: once no grant is awaited, the role read after it sees
    // the winner's grant.
    const awaiting = await simAwaitingGrant(db, simId);
    if (canWrite(await getRole({ db, simId, userId }))) return true;
    if (!awaiting) return false;
  }
  return false;
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
 * Order: id, title, known device, (signed out) in-use then mint, rate, (signed in) writer then
 * in-use, quota, insert, then the handle reseed.
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
    // An id in use mints nothing: the refusal must not leave an account behind.
    if (await simIdInUse(db, simId)) return taken();
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
    return (await writesOnceSettled(db, simId, identityId)) ? { simId, created: false } : taken();
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
    // createSim logged a failed grant itself, with the sim id, and removed its row.
    if (e instanceof SimGrantFailed) {
      return fail(500, { error: SIMS_COPY.createFailed, code: 'failed' });
    }
    // Never the error's text: it is an internal message (or a database error).
    console.error('[start-sim] create failed', loggable(e));
    return fail(400, { error: SIMS_COPY.createFailed, code: 'failed' });
  }

  if (!created) {
    // The id was taken between the checks above and the insert. It may be this caller's own
    // registration racing itself, so re-read the role: a writer gets the no-op. When the caller
    // was signed out, the account just minted is kept with no sim; that is accepted.
    if (await writesOnceSettled(db, simId, identityId)) return { simId, created: false };
    return taken();
  }

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
