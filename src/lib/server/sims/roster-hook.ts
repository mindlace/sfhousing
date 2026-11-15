import { loggable } from '$lib/server/sim-object/object-rules';
import { liveSimStub } from './live-sim';

/** Attempts per sim; the second runs on a fresh stub (a stub that threw is broken). */
export const REREAD_ATTEMPTS = 2;
/** Sims told at once by rosterChangedAll. */
export const ROSTER_FANOUT = 6;
/** Bound on one attempt: a call that has not settled by then is a failed attempt. */
export const REREAD_TIMEOUT_MS = 5000;

const TIMED_OUT = 'reread timed out';

/** The call, or a rejection after `ms`; the timer is cleared either way. */
async function bounded<T>(call: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMED_OUT)), ms);
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * After a roster change is written: tell the sim's object to re-read its open sockets'
 * roles, so a removed or demoted member loses write. Never rejects: the change already
 * stands, and a failed re-read revokes and grants nobody (the object's rule). Does nothing
 * where there is no object (`npm run dev`, no `SIM` binding). Retries once on a fresh stub,
 * except an overloaded object (retrying worsens the overload); logs once after the last
 * failed attempt, with the sim id and safe text only.
 */
export async function onSimRosterChanged(env: unknown, simId: string): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= REREAD_ATTEMPTS; attempt++) {
    try {
      const stub = liveSimStub(env, simId);
      if (!stub) return;
      await bounded(stub.rereadRoles(), REREAD_TIMEOUT_MS);
      return;
    } catch (e) {
      last = e;
      if ((e as { overloaded?: unknown } | null)?.overloaded === true) break;
    }
  }
  console.error('[roster-hook] reread failed', simId, loggable(last));
}

/** onSimRosterChanged for each sim, ROSTER_FANOUT at a time. Never rejects. */
export async function rosterChangedAll(env: unknown, simIds: readonly string[]): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < simIds.length) await onSimRosterChanged(env, simIds[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(ROSTER_FANOUT, simIds.length) }, worker));
}
