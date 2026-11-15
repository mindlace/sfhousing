// Registering a sim from the browser (R51, R60): the request and its timeout, what each answer
// of POST /api/sims means to the client, and a gate that lets one registration run at a time.
// Nothing here logs; the caller does.
import type { RegisterCode } from '$lib/sim-stream/register';
import type { Clock, LocksLike } from './ports';

export const REGISTER_LOCK = 'sfh-register';
export const REGISTER_TIMEOUT_MS = 30_000;

export type RegisterAnswer =
  | { kind: 'ok'; created: boolean }
  | { kind: 'sign-in' }
  | { kind: 'taken' }
  | { kind: 'quota' }
  | { kind: 'retry' }
  | { kind: 'bug'; status: number; code: RegisterCode | null };

const CODES: readonly string[] = [
  'invalid_id',
  'title',
  'sign_in',
  'taken',
  'quota',
  'rate',
  'session',
  'failed'
] satisfies RegisterCode[];

/** The `code` of a parsed error body when it is a RegisterCode, else null. */
function codeOf(body: unknown): RegisterCode | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;
  const code = body.code;
  return typeof code === 'string' && CODES.includes(code) ? (code as RegisterCode) : null;
}

/** The answer for `simId` from a status and a parsed body (null when there is none). */
export function registerAnswerOf(simId: string, status: number, body: unknown): RegisterAnswer {
  if (status === 200 || status === 201) {
    if (
      typeof body === 'object' &&
      body !== null &&
      'simId' in body &&
      body.simId === simId &&
      'created' in body &&
      typeof body.created === 'boolean'
    ) {
      return { kind: 'ok', created: body.created };
    }
    return { kind: 'bug', status, code: null };
  }
  if (status === 401) return { kind: 'sign-in' };
  if (status === 403 && codeOf(body) === 'quota') return { kind: 'quota' };
  if (status === 409) return { kind: 'taken' };
  if (status === 429 || (status >= 500 && status <= 599)) return { kind: 'retry' };
  return { kind: 'bug', status, code: codeOf(body) };
}

/**
 * POST /api/sims { simId }, content-type application/json, aborted after REGISTER_TIMEOUT_MS on
 * `clock` (the timer is cancelled when an answer comes); a thrown or aborted fetch is 'retry'.
 * The request is same-origin with the browser's default credentials and adds no other header.
 */
export async function registerSim(
  fetchFn: typeof fetch,
  simId: string,
  clock: Clock
): Promise<RegisterAnswer> {
  const controller = new AbortController();
  const cancel = clock.after(REGISTER_TIMEOUT_MS, () => controller.abort());
  try {
    const res = await fetchFn('/api/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ simId }),
      signal: controller.signal
    });
    const body: unknown = await res.json().catch(() => null);
    return registerAnswerOf(simId, res.status, body);
  } catch {
    return { kind: 'retry' };
  } finally {
    cancel();
  }
}

/**
 * One registration at a time in this browser: the Web Lock REGISTER_LOCK, or a promise chain in
 * this tab when locks is null (so without Web Locks, tabs are not serialised against each
 * other). A job that throws releases it.
 */
export class RegisterGate {
  #locks: LocksLike | null;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(locks: LocksLike | null) {
    this.#locks = locks;
  }

  run<T>(job: () => Promise<T>): Promise<T> {
    if (this.#locks) {
      return this.#locks.request(REGISTER_LOCK, {}, () => job()) as Promise<T>;
    }
    const result = this.#tail.then(() => job());
    this.#tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
